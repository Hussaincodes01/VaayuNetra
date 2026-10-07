-- Ground sensor network: low-cost methane sensor nodes around flagged landfills, their readings, the
-- early-warning forecasts ("a rise is likely within 3 hours") and the alerts opened from them.
-- Nodes are "simulated" until real hardware reports ("live"); simulated data is labelled everywhere
-- and never enters the integrity ledger.

create type public.node_role as enum ('perimeter', 'community', 'background');
create type public.node_mode as enum ('simulated', 'live');
create type public.sensor_alert_kind as enum ('forecast_rise', 'threshold', 'lel', 'offline');

create table public.sensor_nodes (
  id           uuid primary key default gen_random_uuid(),
  site_id      uuid not null references public.sites (id) on delete cascade,
  code         text not null unique check (code ~ '^[A-Z0-9-]{3,24}$'),
  role         public.node_role not null,
  mode         public.node_mode not null default 'simulated',
  lat          double precision not null check (lat between -90 and 90),
  lon          double precision not null check (lon between -180 and 180),
  sensor       text not null default 'TGS2611-E00' check (char_length(sensor) <= 60),
  -- Raw Rs/R0 -> ppm: ppm = ref_ppm * (rs_ratio / (1 + rh_coef*(rh-65) + t_coef*(t-20)))^(-1/beta)
  calibration  jsonb not null default '{"ref_ppm": 100, "beta": 0.6, "rh_coef": -0.004, "t_coef": -0.006}',
  interval_s   integer not null default 600 check (interval_s between 60 and 3600),
  installed_at date,
  active       boolean not null default true,
  last_seen    timestamptz,
  battery_v    double precision,
  created_at   timestamptz not null default now()
);

create index sensor_nodes_site_idx on public.sensor_nodes (site_id);

-- Device keys live apart from the public node rows: only the service role reads them.
create table public.sensor_node_keys (
  node_id  uuid primary key references public.sensor_nodes (id) on delete cascade,
  key_hash text not null unique check (key_hash ~ '^[0-9a-f]{64}$')
);

create table public.sensor_readings (
  node_id      uuid not null references public.sensor_nodes (id) on delete cascade,
  at           timestamptz not null,
  ch4_ppm      double precision check (ch4_ppm >= 0 and ch4_ppm < 1000000),  -- calibrated
  rs_ratio     double precision check (rs_ratio > 0),                         -- raw sensor Rs/R0
  temp_c       double precision check (temp_c between -40 and 85),
  rh_pct       double precision check (rh_pct between 0 and 100),
  pressure_hpa double precision check (pressure_hpa between 300 and 1100),
  battery_v    double precision check (battery_v between 0 and 10),
  primary key (node_id, at)
);

create index sensor_readings_at_idx on public.sensor_readings (at desc);

create table public.sensor_forecasts (
  node_id       uuid not null references public.sensor_nodes (id) on delete cascade,
  issued_at     timestamptz not null,
  horizon_h     smallint not null check (horizon_h between 1 and 6),
  p_rise        double precision not null check (p_rise between 0 and 1),
  excess_now    double precision,  -- ppm above the background node at issue time
  model_version text not null,
  primary key (node_id, issued_at, horizon_h)
);

create table public.sensor_alerts (
  id              uuid primary key default gen_random_uuid(),
  node_id         uuid not null references public.sensor_nodes (id) on delete cascade,
  kind            public.sensor_alert_kind not null,
  opened_at       timestamptz not null default now(),
  closed_at       timestamptz,
  p_rise          double precision,
  peak_ppm        double precision,
  lead_min        double precision,  -- threshold alerts: minutes since the forecast warned, if it did
  detail          jsonb not null default '{}'::jsonb,
  acknowledged_by uuid references auth.users (id) on delete set null,
  acknowledged_at timestamptz,
  alerted_at      timestamptz,
  constraint sensor_alerts_closed_after check (closed_at is null or closed_at >= opened_at)
);

-- At most one open alert per node and kind.
create unique index sensor_alerts_one_open on public.sensor_alerts (node_id, kind) where closed_at is null;
create index sensor_alerts_node_idx on public.sensor_alerts (node_id, opened_at desc);

-- Alert levels (public, admin-editable).
insert into public.settings (key, value, is_public) values
  ('sensor_rise_ppm', '25'::jsonb, true),       -- 30-minute mean above the background node that counts as a rise
  ('sensor_alert_p', '0.6'::jsonb, true),       -- forecast probability that opens an early warning
  ('sensor_lel_ppm', '5000'::jsonb, true),      -- 10% of methane's lower explosive limit (5% by volume)
  ('sensor_offline_min', '60'::jsonb, true)
on conflict (key) do nothing;

-- ---------------------------------------------------------------------------
-- Integrity ledger: alerts from live nodes are written in (simulated ones are not), so an early
-- warning is provably on record before the rise it warned about.
-- ---------------------------------------------------------------------------
alter table public.ledger_entries drop constraint ledger_entries_kind_check;
alter table public.ledger_entries add constraint ledger_entries_kind_check
  check (kind in ('flag', 'confirmation', 'measure', 'meter', 'scorecard', 'sensor_alert'));

create function public.ledger_on_sensor_alert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_node record;
begin
  select n.code, n.mode, n.role, s.slug into v_node
  from public.sensor_nodes n join public.sites s on s.id = n.site_id
  where n.id = new.node_id;
  if v_node.mode = 'live' and new.kind <> 'offline' then
    perform public.ledger_append('sensor_alert', new.id::text, jsonb_build_object(
      'kind', 'sensor_alert', 'alert', new.id, 'site', v_node.slug, 'node', v_node.code,
      'role', v_node.role, 'alert_kind', new.kind, 'opened_at', new.opened_at,
      'p_rise', new.p_rise, 'peak_ppm', new.peak_ppm, 'grade', 'screening'));
  end if;
  return null;
exception when others then
  raise warning 'ledger_on_sensor_alert(%): %', new.id, sqlerrm;
  return null;
end;
$$;

create trigger ledger_on_sensor_alert
  after insert on public.sensor_alerts
  for each row execute function public.ledger_on_sensor_alert();

create trigger audit_sensor_nodes
  after insert or update or delete on public.sensor_nodes
  for each row execute function public.audit_row('id', 'last_seen,battery_v');

-- ---------------------------------------------------------------------------
-- Row-level security
--   nodes, readings and forecasts are public (no personal data); alerts are for signed-in users.
--   admins manage nodes; officers acknowledge alerts; readings, forecasts and alerts are written by
--   the service role (ingestion API, sensors cron).
-- ---------------------------------------------------------------------------
alter table public.sensor_nodes     enable row level security;
alter table public.sensor_node_keys enable row level security;
alter table public.sensor_readings  enable row level security;
alter table public.sensor_forecasts enable row level security;
alter table public.sensor_alerts    enable row level security;

create policy "sensor nodes are public" on public.sensor_nodes
  for select to anon, authenticated using (true);
create policy "admins manage sensor nodes" on public.sensor_nodes
  for all to authenticated using (public.has_role('admin')) with check (public.has_role('admin'));
create policy "sensor readings are public" on public.sensor_readings
  for select to anon, authenticated using (true);
create policy "sensor forecasts are public" on public.sensor_forecasts
  for select to anon, authenticated using (true);
create policy "viewers read sensor alerts" on public.sensor_alerts
  for select to authenticated using (public.has_role('viewer'));
create policy "officers acknowledge sensor alerts" on public.sensor_alerts
  for update to authenticated using (public.has_role('officer')) with check (public.has_role('officer'));

revoke all on public.sensor_nodes, public.sensor_node_keys, public.sensor_readings,
  public.sensor_forecasts, public.sensor_alerts from anon, authenticated;
grant select on public.sensor_nodes, public.sensor_readings, public.sensor_forecasts to anon, authenticated;
grant insert, update, delete on public.sensor_nodes to authenticated;
grant select, update on public.sensor_alerts to authenticated;
grant all on public.sensor_nodes, public.sensor_node_keys, public.sensor_readings,
  public.sensor_forecasts, public.sensor_alerts to service_role;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.sensor_alerts;
  end if;
end;
$$;
