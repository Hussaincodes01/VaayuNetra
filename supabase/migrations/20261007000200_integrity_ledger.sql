-- Integrity ledger: an append-only hash chain of the records that carbon accounting depends on,
-- anchored to Bitcoin through OpenTimestamps (web/src/app/api/cron/anchor). Anyone can re-check it:
--   payload_hash = sha256(payload_text)
--   entry_hash   = sha256(prev_hash || '|' || id || '|' || payload_hash)        (hex, UTF-8)
-- What goes in: T1/T2 flags, confirmation results, mitigation commitments and status changes, metered
-- readings and monthly scorecard snapshots. No personal data: no names, emails, notes or report text.

create table public.ledger_entries (
  id           bigint primary key,
  created_at   timestamptz not null default now(),
  kind         text not null check (kind in ('flag', 'confirmation', 'measure', 'meter', 'scorecard')),
  ref          text not null,  -- what the entry is about: a row id, or a month for scorecards
  payload_text text not null,  -- the exact text that was hashed (canonical jsonb text)
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  prev_hash    text not null check (prev_hash ~ '^[0-9a-f]{64}$'),
  entry_hash   text not null unique check (entry_hash ~ '^[0-9a-f]{64}$')
);

create index ledger_entries_ref_idx on public.ledger_entries (kind, ref, id desc);

-- One row per submission of a chain head to an OpenTimestamps calendar.
create table public.ledger_anchors (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  up_to_entry   bigint not null references public.ledger_entries (id),
  head_text     text not null,  -- the anchored text: "vayunetra-ledger:<id>:<entry_hash>"
  digest        text not null check (digest ~ '^[0-9a-f]{64}$'),  -- sha256(head_text)
  calendar      text not null,
  proof         text not null,  -- base64 OpenTimestamps timestamp for digest (pending, later upgraded)
  status        text not null default 'pending' check (status in ('pending', 'confirmed')),
  bitcoin_block integer,
  block_time    timestamptz,
  checked_at    timestamptz,
  confirmed_at  timestamptz
);

create index ledger_anchors_pending_idx on public.ledger_anchors (id) where status = 'pending';

-- ---------------------------------------------------------------------------
-- Append (serialised with an advisory lock, so ids and prev_hash never race)
-- ---------------------------------------------------------------------------
create function public.ledger_append(p_kind text, p_ref text, p_payload jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text;
  v_id   bigint;
  v_same bigint;
  v_text text := p_payload::text;
  v_hash text := encode(sha256(convert_to(v_text, 'UTF8')), 'hex');
begin
  if p_payload is null then
    return null;
  end if;
  perform pg_advisory_xact_lock(hashtext('vayunetra.ledger'));
  -- A rewrite that changes nothing (a re-scan, a seed re-run) adds no entry.
  select e.id into v_same from public.ledger_entries e
  where e.kind = p_kind and e.ref = p_ref
  order by e.id desc limit 1;
  if v_same is not null
     and (select payload_hash from public.ledger_entries where id = v_same) = v_hash then
    return v_same;
  end if;
  select e.id, e.entry_hash into v_id, v_prev from public.ledger_entries e order by e.id desc limit 1;
  v_id := coalesce(v_id, 0) + 1;
  v_prev := coalesce(v_prev, repeat('0', 64));
  insert into public.ledger_entries (id, kind, ref, payload_text, payload_hash, prev_hash, entry_hash)
  values (v_id, p_kind, p_ref, v_text, v_hash, v_prev,
          encode(sha256(convert_to(v_prev || '|' || v_id::text || '|' || v_hash, 'UTF8')), 'hex'));
  return v_id;
end;
$$;

revoke execute on function public.ledger_append(text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ledger_append(text, text, jsonb) to service_role;

-- Append-only: no update or delete, whoever asks (the service role included).
create function public.ledger_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'ledger entries are append-only' using errcode = '42501';
end;
$$;

create trigger ledger_entries_append_only
  before update or delete on public.ledger_entries
  for each row execute function public.ledger_append_only();

create trigger ledger_entries_no_truncate
  before truncate on public.ledger_entries
  for each statement execute function public.ledger_append_only();

-- ---------------------------------------------------------------------------
-- Payloads
-- ---------------------------------------------------------------------------
create function public.ledger_flag_payload(p_scan uuid)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'kind', 'flag', 'scan', sc.id, 'site', s.slug, 'pass_date', sc.pass_date, 'tier', sc.tier,
    'scene_score', sc.scene_score, 'q_med_kgph', sc.q_med, 'q_lo_kgph', sc.q_lo, 'q_hi_kgph', sc.q_hi,
    'model_version', sc.model_version, 'grade', 'screening')
  from public.scans sc join public.sites s on s.id = sc.site_id
  where sc.id = p_scan
$$;

-- Never blocks the write that triggered it: a ledger failure is logged as a warning.
create function public.ledger_on_scan()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.sites s where s.id = new.site_id and s.kind = 'landfill') then
    perform public.ledger_append('flag', new.id::text, public.ledger_flag_payload(new.id));
  end if;
  return null;
exception when others then
  raise warning 'ledger_on_scan(%): %', new.id, sqlerrm;
  return null;
end;
$$;

create trigger ledger_on_scan
  after insert or update of tier, q_med on public.scans
  for each row
  when (new.tier in ('T1', 'T2'))
  execute function public.ledger_on_scan();

create function public.ledger_on_action()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status in ('confirmed', 'not_methane')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform public.ledger_append('confirmation', new.id::text, jsonb_build_object(
      'kind', 'confirmation', 'action', new.id, 'site', (select slug from public.sites where id = new.site_id),
      'scan', new.scan_id, 'pass_date', (select pass_date from public.scans where id = new.scan_id),
      'result', new.status, 'method', new.confirm_method, 'result_at', new.result_at));
  end if;
  return null;
exception when others then
  raise warning 'ledger_on_action(%): %', new.id, sqlerrm;
  return null;
end;
$$;

create trigger ledger_on_action
  after insert or update of status on public.actions
  for each row execute function public.ledger_on_action();

create function public.ledger_on_measure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or old.status is distinct from new.status
     or old.expected_tco2e_yr is distinct from new.expected_tco2e_yr then
    perform public.ledger_append('measure', new.id::text, jsonb_build_object(
      'kind', 'measure', 'measure', new.id, 'site', (select slug from public.sites where id = new.site_id),
      'type', new.kind, 'title', new.title, 'agency', new.agency, 'status', new.status,
      'start_date', new.start_date, 'expected_tco2e_yr', new.expected_tco2e_yr, 'grade', 'modelled'));
  end if;
  return null;
exception when others then
  raise warning 'ledger_on_measure(%): %', new.id, sqlerrm;
  return null;
end;
$$;

create trigger ledger_on_measure
  after insert or update on public.measures
  for each row execute function public.ledger_on_measure();

create function public.ledger_on_meter()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.ledger_append('meter', new.id::text, jsonb_build_object(
    'kind', 'meter', 'reading', new.id, 'site', (select slug from public.sites where id = new.site_id),
    'measure', new.measure_id, 'period_start', new.period_start, 'period_end', new.period_end,
    'ch4_destroyed_t', new.ch4_destroyed_t, 'meter_id', new.meter_id, 'grade', 'verified'));
  return null;
exception when others then
  raise warning 'ledger_on_meter(%): %', new.id, sqlerrm;
  return null;
end;
$$;

create trigger ledger_on_meter
  after insert on public.gas_meter_readings
  for each row execute function public.ledger_on_meter();

-- A month's public scorecard, frozen into the ledger (called by the monthly cron, once per month).
create function public.ledger_snapshot_scorecard(p_month date)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_month date := date_trunc('month', p_month)::date;
begin
  if exists (select 1 from public.ledger_entries where kind = 'scorecard' and ref = v_month::text) then
    return null;
  end if;
  return public.ledger_append('scorecard', v_month::text, jsonb_build_object(
    'kind', 'scorecard', 'month', v_month,
    'sites', (select coalesce(jsonb_agg(to_jsonb(c) order by c.slug), '[]'::jsonb)
              from public.site_scorecard(v_month) c)));
end;
$$;

revoke execute on function public.ledger_snapshot_scorecard(date) from public, anon, authenticated;
grant execute on function public.ledger_snapshot_scorecard(date) to service_role;

-- Genesis: the flags and confirmations already stored, in time order.
do $$
declare r record;
begin
  for r in
    select sc.id from public.scans sc join public.sites s on s.id = sc.site_id and s.kind = 'landfill'
    where sc.tier in ('T1', 'T2') order by sc.pass_date, sc.created_at
  loop
    perform public.ledger_append('flag', r.id::text, public.ledger_flag_payload(r.id));
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Public read: the ledger exists to be checked by anyone
-- ---------------------------------------------------------------------------
alter table public.ledger_entries enable row level security;
alter table public.ledger_anchors enable row level security;

create policy "ledger is public" on public.ledger_entries
  for select to anon, authenticated using (true);
create policy "anchors are public" on public.ledger_anchors
  for select to anon, authenticated using (true);

revoke all on public.ledger_entries, public.ledger_anchors from anon, authenticated;
grant select on public.ledger_entries, public.ledger_anchors to anon, authenticated;
grant all on public.ledger_entries, public.ledger_anchors to service_role;
