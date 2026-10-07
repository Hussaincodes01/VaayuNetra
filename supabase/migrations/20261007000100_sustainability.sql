-- Sustainability features (no AI): confirmation tracker, mitigation ledger, capture calculator, public
-- scorecard, landfill fire log, before-and-after check, citizen report routing, wet-waste diversion,
-- legacy-waste remediation and the carbon finance file (VayuNetra Sustainability Plan).
--
-- Grades: satellite numbers stay screening-grade; expected tonnes and diverted-waste tonnes are
-- modelled; only metered methane in gas_meter_readings counts as a verified reduction.

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.confirm_method as enum ('emit_match', 'hyperspectral_tasking', 'ogi_drone', 'ground_survey');

create type public.measure_kind as enum (
  'gas_collection',
  'flare_or_engine',
  'interim_cover',
  'biocover',
  'seep_repair',
  'fire_breaks',
  'organics_diversion',
  'biomining',
  'other'
);

create type public.measure_status as enum ('planned', 'in_progress', 'done', 'stopped');
create type public.fire_status as enum ('open', 'out', 'not_fire');
create type public.report_kind as enum ('smoke', 'fire', 'odour', 'dumping', 'burning');
create type public.report_status as enum ('open', 'closed');

-- ---------------------------------------------------------------------------
-- Settings: assumptions shown beside every modelled figure (public, admin-editable)
--   report_sla_hours      deadline for closing a citizen report
--   ipcc_*                IPCC 2006 Vol. 5 defaults for food waste in an unmanaged deep dumpsite:
--                         DOC 0.15 (Ch. 2 Table 2.4), DOCf 0.5 and F 0.5 (Ch. 3 text), MCF 0.8 (Table 3.1),
--                         OX 0 (Table 3.2)
--   compost_* / ad_*      treatment emissions per tonne of wet waste (Ch. 4 Table 4.1)
--   gwp100_n2o            IPCC AR6
-- ---------------------------------------------------------------------------
insert into public.settings (key, value, is_public) values
  ('report_sla_hours', '72'::jsonb, true),
  ('ipcc_doc_food', '0.15'::jsonb, true),
  ('ipcc_docf', '0.5'::jsonb, true),
  ('ipcc_mcf', '0.8'::jsonb, true),
  ('ipcc_f', '0.5'::jsonb, true),
  ('ipcc_ox', '0'::jsonb, true),
  ('compost_ch4_kg_per_t', '4'::jsonb, true),
  ('compost_n2o_kg_per_t', '0.24'::jsonb, true),
  ('ad_ch4_kg_per_t', '0.8'::jsonb, true),
  ('gwp100_n2o', '273'::jsonb, true)
on conflict (key) do nothing;

-- A numeric setting, or the default when it is missing.
create function public.setting_num(p_key text, p_default double precision)
returns double precision
language sql
stable
set search_path = ''
as $$
  select coalesce((select (s.value #>> '{}')::double precision from public.settings s where s.key = p_key), p_default)
$$;

-- The model version every live figure uses (as in site_stats).
create function public.active_model_version()
returns text
language sql
stable
set search_path = ''
as $$
  select coalesce(
    (select value #>> '{}' from public.settings where key = 'model_version'),
    (select model_version from public.scans order by created_at desc limit 1))
$$;

-- ---------------------------------------------------------------------------
-- 1. Confirmation tracker: every T1/T2 flag at a landfill gets a verification task
-- ---------------------------------------------------------------------------
alter table public.actions
  add column confirm_method public.confirm_method,
  add column origin         text not null default 'manual' check (origin in ('manual', 'auto')),
  add column result_at      timestamptz;

-- Stamp when a verification gets its answer, for "median days from flag to result".
create function public.stamp_action_result()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('confirmed', 'not_methane')
     and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    new.result_at := coalesce(new.result_at, now());
  end if;
  return new;
end;
$$;

create trigger stamp_action_result
  before insert or update on public.actions
  for each row execute function public.stamp_action_result();

-- One task per flagged pass: a re-scan of the same pass (new weights) does not open a second one.
-- Never blocks the worker's scan write: a failure is logged as a warning and the scan still lands.
create function public.open_confirmation_task()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.sites s where s.id = new.site_id and s.kind = 'landfill')
     and not exists (
       select 1
       from public.actions a
       join public.scans s2 on s2.id = a.scan_id
       where s2.site_id = new.site_id and s2.pass_date = new.pass_date) then
    insert into public.actions (site_id, scan_id, status, due_date, origin, created_by)
    values (new.site_id, new.id, 'verification_requested', current_date + 28, 'auto', null);
  end if;
  return null;
exception when others then
  raise warning 'open_confirmation_task(%): %', new.id, sqlerrm;
  return null;
end;
$$;

create trigger open_confirmation_task
  after insert or update of tier on public.scans
  for each row
  when (new.tier in ('T1', 'T2'))
  execute function public.open_confirmation_task();

-- Flags already stored (the India field test) get their tasks now.
insert into public.actions (site_id, scan_id, status, due_date, origin, created_by)
select distinct on (sc.site_id, sc.pass_date)
  sc.site_id, sc.id, 'verification_requested', current_date + 28, 'auto', null
from public.scans sc
join public.sites s on s.id = sc.site_id and s.kind = 'landfill'
where sc.tier in ('T1', 'T2')
  and not exists (
    select 1
    from public.actions a
    join public.scans s2 on s2.id = a.scan_id
    where s2.site_id = sc.site_id and s2.pass_date = sc.pass_date)
order by sc.site_id, sc.pass_date, sc.created_at desc;

-- ---------------------------------------------------------------------------
-- 2. Capture and energy calculator (the dossier's action-plan method)
--   annual_tco2e     = q x 8.76 x gwp100                     8.76 = 8,760 h a year / 1,000 kg a tonne
--   avoided_tco2e_yr = q x capture x 8.76 x gwp100 x flare_destruction
--   power_mw         = q x capture x lhv (MJ/kg) x engine_eff / 3,600
-- q is the site's minimum time-averaged rate (kg/h), a minimum estimate and screening-grade.
-- ---------------------------------------------------------------------------
create function public.capture_estimate(
  q_kgph            double precision,
  capture           double precision,
  gwp100            double precision default 27,
  flare_destruction double precision default 0.98,
  lhv_mj_per_kg     double precision default 50,
  engine_eff        double precision default 0.35)
returns table (annual_tco2e double precision, avoided_tco2e_yr double precision, power_mw double precision)
language sql
immutable
parallel safe
set search_path = ''
as $$
  select q_kgph * 8.76 * gwp100,
         q_kgph * capture * 8.76 * gwp100 * flare_destruction,
         q_kgph * capture * lhv_mj_per_kg * engine_eff / 3600.0
$$;

-- ---------------------------------------------------------------------------
-- 3. Mitigation ledger: site-level measures with an owning agency
-- ---------------------------------------------------------------------------
create table public.measures (
  id                uuid primary key default gen_random_uuid(),
  site_id           uuid not null references public.sites (id) on delete cascade,
  kind              public.measure_kind not null,
  title             text not null check (char_length(title) between 1 and 200),
  agency            text not null check (char_length(agency) between 1 and 200),
  status            public.measure_status not null default 'planned',
  start_date        date,
  capture_share     double precision check (capture_share > 0 and capture_share <= 1),
  expected_tco2e_yr double precision,  -- modelled at save time from the site's minimum rate; null without one
  assumptions       jsonb,             -- the inputs behind expected_tco2e_yr
  other_programmes  text check (char_length(other_programmes) <= 500),  -- guards against double counting
  evidence_url      text,              -- path in the attachments bucket
  note              text check (char_length(note) <= 2000),
  created_by        uuid default auth.uid() references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint measures_capture_only_for_gas
    check (capture_share is null or kind in ('gas_collection', 'flare_or_engine')),
  constraint measures_started_needs_date check (status = 'planned' or start_date is not null)
);

create index measures_site_idx on public.measures (site_id, created_at desc);

-- Expected avoided tonnes come from the site's minimum rate and the public assumptions, never the form.
create function public.compute_measure_expectation()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_q     double precision;
  v_gwp   double precision := public.setting_num('gwp100', 27);
  v_flare double precision := public.setting_num('flare_destruction', 0.98);
begin
  new.updated_at := now();
  if new.capture_share is null then
    new.expected_tco2e_yr := null;
    new.assumptions := null;
    return new;
  end if;
  v_q := (select ss.min_mean_kgph from public.site_stats ss where ss.site_id = new.site_id);
  new.expected_tco2e_yr := case
    when coalesce(v_q, 0) > 0 then
      (select e.avoided_tco2e_yr from public.capture_estimate(v_q, new.capture_share, v_gwp, v_flare) e)
  end;
  new.assumptions := jsonb_build_object(
    'min_mean_kgph', v_q, 'capture_share', new.capture_share,
    'gwp100', v_gwp, 'flare_destruction', v_flare);
  return new;
end;
$$;

create trigger compute_measure_expectation
  before insert or update on public.measures
  for each row execute function public.compute_measure_expectation();

create trigger audit_measures
  after insert or update or delete on public.measures
  for each row execute function public.audit_row('id');

-- ---------------------------------------------------------------------------
-- 4. Before-and-after check: flags of any tier in the 365 days before a measure started and since,
--    on the active model version. p_value is the one-sided Fisher exact test that the flag rate
--    before was higher than after.
-- ---------------------------------------------------------------------------
create function public.measure_effect(p_measure uuid)
returns table (
  before_passes integer,
  before_flags  integer,
  after_passes  integer,
  after_flags   integer,
  p_value       double precision)
language sql
stable
set search_path = ''
as $$
  with m as (
    select site_id, start_date from public.measures where id = p_measure and start_date is not null
  ),
  c as (
    select
      count(*) filter (where sc.pass_date >= m.start_date - 365 and sc.pass_date < m.start_date)::integer as bp,
      count(*) filter (where sc.pass_date >= m.start_date - 365 and sc.pass_date < m.start_date
                       and sc.detected)::integer as bf,
      count(*) filter (where sc.pass_date >= m.start_date)::integer as ap,
      count(*) filter (where sc.pass_date >= m.start_date and sc.detected)::integer as af
    from m
    join public.scans sc on sc.site_id = m.site_id and sc.model_version = public.active_model_version()
  )
  select bp, bf, ap, af,
         case when bp > 0 and ap > 0 then public.fisher_exact_greater(bf, bp - bf, af, ap - af) end
  from c
$$;

-- ---------------------------------------------------------------------------
-- 5. Landfill fire log: NASA FIRMS detections near each landfill (written by the fires cron)
-- ---------------------------------------------------------------------------
create table public.fire_detections (
  id         uuid primary key default gen_random_uuid(),
  site_id    uuid not null references public.sites (id) on delete cascade,
  source     text not null check (char_length(source) between 1 and 40),  -- FIRMS product, e.g. VIIRS_SNPP_NRT
  acq_at     timestamptz not null,
  lat        double precision not null,
  lon        double precision not null,
  dist_m     double precision not null check (dist_m >= 0),
  confidence text check (char_length(confidence) <= 20),
  frp_mw     double precision,
  status     public.fire_status not null default 'open',
  closed_at  timestamptz,
  closed_by  uuid references auth.users (id) on delete set null,
  note       text check (char_length(note) <= 1000),
  alerted_at timestamptz,
  created_at timestamptz not null default now(),
  constraint fire_detections_unique unique (site_id, source, acq_at, lat, lon)
);

create index fire_detections_site_idx on public.fire_detections (site_id, acq_at desc);

-- ---------------------------------------------------------------------------
-- 6. Citizen reports from partners (EcoSathi): routed to the nearest landfill within 5 km
-- ---------------------------------------------------------------------------
create table public.citizen_reports (
  id            uuid primary key default gen_random_uuid(),
  source        text not null check (char_length(source) between 1 and 40),
  external_id   text not null check (char_length(external_id) between 1 and 200),
  kind          public.report_kind not null,
  reported_at   timestamptz not null,
  lat           double precision not null check (lat between -90 and 90),
  lon           double precision not null check (lon between -180 and 180),
  description   text check (char_length(description) <= 2000),
  photo_url     text check (char_length(photo_url) <= 1000 and photo_url ~ '^https://'),
  consent       boolean not null check (consent),  -- the partner collected consent (DPDP Act, 2023)
  site_id       uuid references public.sites (id) on delete set null,
  dist_m        double precision,
  state         text,
  status        public.report_status not null default 'open',
  assignee      uuid references auth.users (id) on delete set null,
  due_at        timestamptz not null,
  escalated_at  timestamptz,
  closed_at     timestamptz,
  closing_note  text check (char_length(closing_note) <= 2000),
  closing_photo text,  -- path in the attachments bucket
  created_at    timestamptz not null default now(),
  constraint citizen_reports_source_key unique (source, external_id)
);

create index citizen_reports_open_idx on public.citizen_reports (due_at) where status = 'open';
create index citizen_reports_site_idx on public.citizen_reports (site_id, reported_at desc);

create function public.route_citizen_report()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_point extensions.geography :=
    extensions.st_setsrid(extensions.st_makepoint(new.lon, new.lat), 4326)::extensions.geography;
begin
  if tg_op = 'INSERT' then
    select s.id, extensions.st_distance(s.geom, v_point), s.state
      into new.site_id, new.dist_m, new.state
    from public.sites s
    where s.kind = 'landfill' and s.active and extensions.st_dwithin(s.geom, v_point, 5000)
    order by extensions.st_distance(s.geom, v_point)
    limit 1;
    new.due_at := coalesce(
      new.due_at,
      new.reported_at + make_interval(hours => public.setting_num('report_sla_hours', 72)::integer));
  end if;
  if new.status = 'closed' and (tg_op = 'INSERT' or old.status is distinct from 'closed') then
    new.closed_at := coalesce(new.closed_at, now());
  elsif new.status = 'open' then
    new.closed_at := null;
  end if;
  return new;
end;
$$;

create trigger route_citizen_report
  before insert or update on public.citizen_reports
  for each row execute function public.route_citizen_report();

create trigger audit_citizen_reports
  after update or delete on public.citizen_reports
  for each row execute function public.audit_row('id');

-- ---------------------------------------------------------------------------
-- 7. Wet-waste diversion by city, monthly
-- ---------------------------------------------------------------------------
create table public.diversion_monthly (
  id          uuid primary key default gen_random_uuid(),
  city        text not null check (char_length(city) between 1 and 100),
  month       date not null check (extract(day from month) = 1),
  composted_t double precision not null default 0 check (composted_t >= 0),
  biogas_t    double precision not null default 0 check (biogas_t >= 0),
  source      text not null check (char_length(source) between 1 and 200),
  note        text check (char_length(note) <= 1000),
  created_by  uuid default auth.uid() references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  constraint diversion_monthly_city_month unique (city, month)
);

-- Modelled lifetime landfill methane avoided by keeping wet food waste out of an unmanaged dumpsite,
-- minus the treatment's own emissions (t CO2e). IPCC 2006 Vol. 5 first-order-decay inputs:
--   CH4 potential per tonne = DOC x DOCf x MCF x F x 16/12 x (1 - OX)
-- The methane would have been released over years (food waste k = 0.085 a year in dry tropical
-- climates, 0.4 in wet), so this is the total avoided, not one year's.
create function public.diversion_avoided_tco2e(composted_t double precision, biogas_t double precision)
returns double precision
language sql
stable
set search_path = ''
as $$
  with p as (
    select
      public.setting_num('ipcc_doc_food', 0.15) * public.setting_num('ipcc_docf', 0.5)
        * public.setting_num('ipcc_mcf', 0.8) * public.setting_num('ipcc_f', 0.5) * 16.0 / 12.0
        * (1 - public.setting_num('ipcc_ox', 0)) as ch4_t_per_t,
      public.setting_num('gwp100', 27) as gwp,
      public.setting_num('gwp100_n2o', 273) as gwp_n2o,
      public.setting_num('compost_ch4_kg_per_t', 4) / 1000.0 as compost_ch4,
      public.setting_num('compost_n2o_kg_per_t', 0.24) / 1000.0 as compost_n2o,
      public.setting_num('ad_ch4_kg_per_t', 0.8) / 1000.0 as ad_ch4
  )
  select coalesce(composted_t, 0) * (p.ch4_t_per_t * p.gwp - p.compost_ch4 * p.gwp - p.compost_n2o * p.gwp_n2o)
       + coalesce(biogas_t, 0) * (p.ch4_t_per_t * p.gwp - p.ad_ch4 * p.gwp)
  from p
$$;

-- ---------------------------------------------------------------------------
-- 8. Legacy-waste remediation (Swachh Bharat Mission-Urban 2.0 biomining progress)
-- ---------------------------------------------------------------------------
create table public.remediation_progress (
  id                  uuid primary key default gen_random_uuid(),
  site_id             uuid not null references public.sites (id) on delete cascade,
  as_of               date not null,
  legacy_tonnes_total double precision check (legacy_tonnes_total > 0),
  tonnes_processed    double precision not null check (tonnes_processed >= 0),
  area_reclaimed_ha   double precision check (area_reclaimed_ha >= 0),
  source              text not null check (char_length(source) between 1 and 200),
  note                text check (char_length(note) <= 1000),
  created_by          uuid default auth.uid() references auth.users (id) on delete set null,
  created_at          timestamptz not null default now(),
  constraint remediation_site_date unique (site_id, as_of),
  constraint remediation_processed_le_total
    check (legacy_tonnes_total is null or tonnes_processed <= legacy_tonnes_total)
);

-- ---------------------------------------------------------------------------
-- 9. Carbon finance file: metered methane destroyed by a capture system (the only verified tonnes)
-- ---------------------------------------------------------------------------
create table public.gas_meter_readings (
  id              uuid primary key default gen_random_uuid(),
  site_id         uuid not null references public.sites (id) on delete cascade,
  measure_id      uuid references public.measures (id) on delete set null,
  period_start    date not null,
  period_end      date not null,
  ch4_destroyed_t double precision not null check (ch4_destroyed_t > 0),
  meter_id        text not null check (char_length(meter_id) between 1 and 100),
  verified_by     text check (char_length(verified_by) <= 200),
  document_url    text,  -- path in the attachments bucket
  created_by      uuid default auth.uid() references auth.users (id) on delete set null,
  created_at      timestamptz not null default now(),
  constraint gas_meter_period check (period_end >= period_start)
);

create index gas_meter_site_idx on public.gas_meter_readings (site_id, period_end desc);

-- A site with a confirmed emission: an action confirmed, or moved past confirmed.
create function public.site_has_confirmed_emission(p_site uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.actions a
    where a.site_id = p_site
      and a.status in ('confirmed', 'mitigation_planned', 'in_progress', 'resolved'))
$$;

create function public.guard_meter_reading()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.site_has_confirmed_emission(new.site_id) then
    raise exception 'metered readings need a confirmed emission at this site'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger guard_meter_reading
  before insert or update on public.gas_meter_readings
  for each row execute function public.guard_meter_reading();

create trigger audit_gas_meter_readings
  after insert or update or delete on public.gas_meter_readings
  for each row execute function public.audit_row('id');

-- ---------------------------------------------------------------------------
-- Stamp who closed a fire detection and when
-- ---------------------------------------------------------------------------
create function public.stamp_fire_status()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'open' and old.status = 'open' then
    new.closed_at := coalesce(new.closed_at, now());
    new.closed_by := coalesce(new.closed_by, auth.uid());
  elsif new.status = 'open' then
    new.closed_at := null;
    new.closed_by := null;
  end if;
  return new;
end;
$$;

create trigger stamp_fire_status
  before update on public.fire_detections
  for each row execute function public.stamp_fire_status();

-- ---------------------------------------------------------------------------
-- 10. Public scorecard: one row per active landfill for a month. Aggregates only: no notes, people,
--     report text or photos leave the database through these functions.
-- ---------------------------------------------------------------------------
create function public.site_scorecard(p_month date default null)
returns table (
  slug                       text,
  name                       text,
  city                       text,
  state                      text,
  month                      date,
  passes_month               integer,
  t1_month                   integer,
  t2_month                   integer,
  t3_month                   integer,
  passes_total               integer,
  t1_total                   integer,
  t2_total                   integer,
  t3_total                   integer,
  min_mean_kgph              double precision,
  tco2e100_yr                double precision,
  persistent_upper_tph       double precision,
  confirmations_open         integer,
  confirmations_confirmed    integer,
  confirmations_not_methane  integer,
  median_days_to_result      double precision,
  fire_days_month            integer,
  fires_open                 integer,
  measures_planned           integer,
  measures_in_progress       integer,
  measures_done              integer,
  expected_tco2e_yr          double precision,
  verified_tco2e_month       double precision,
  verified_tco2e_total       double precision,
  remediation_as_of          date,
  legacy_tonnes_total        double precision,
  tonnes_processed           double precision,
  area_reclaimed_ha          double precision,
  reports_month              integer,
  reports_closed_month       integer,
  median_hours_to_close      double precision)
language sql
stable
security definer
set search_path = ''
as $$
  with p as (
    select coalesce(date_trunc('month', p_month)::date, date_trunc('month', current_date)::date) as m0,
           public.active_model_version() as mv,
           public.setting_num('gwp100', 27) as gwp
  ),
  bounds as (select m0, (m0 + interval '1 month')::date as m1, mv, gwp from p),
  sc as (
    select sc.site_id,
      count(*) filter (where sc.pass_date >= b.m0 and sc.pass_date < b.m1)::integer as passes_month,
      count(*) filter (where sc.tier = 'T1' and sc.pass_date >= b.m0 and sc.pass_date < b.m1)::integer as t1_month,
      count(*) filter (where sc.tier = 'T2' and sc.pass_date >= b.m0 and sc.pass_date < b.m1)::integer as t2_month,
      count(*) filter (where sc.tier = 'T3' and sc.pass_date >= b.m0 and sc.pass_date < b.m1)::integer as t3_month
    from public.scans sc, bounds b
    where sc.model_version = b.mv
    group by sc.site_id
  ),
  conf as (
    select a.site_id,
      count(*) filter (where a.status in ('new', 'verification_requested'))::integer as open_n,
      count(*) filter (where a.status in ('confirmed', 'mitigation_planned', 'in_progress', 'resolved'))::integer as conf_n,
      count(*) filter (where a.status = 'not_methane')::integer as not_n,
      percentile_cont(0.5) within group (
        order by (extract(epoch from (a.result_at - coalesce(sc.overpass_utc, sc.pass_date::timestamptz))) / 86400.0)::double precision
      ) filter (where a.result_at is not null) as median_days
    from public.actions a
    left join public.scans sc on sc.id = a.scan_id
    where a.scan_id is not null
    group by a.site_id
  ),
  fires as (
    select f.site_id,
      count(distinct (f.acq_at at time zone 'Asia/Kolkata')::date)
        filter (where f.status <> 'not_fire' and f.acq_at >= b.m0 and f.acq_at < b.m1)::integer as days,
      count(*) filter (where f.status = 'open')::integer as open_n
    from public.fire_detections f, bounds b
    group by f.site_id
  ),
  meas as (
    select me.site_id,
      count(*) filter (where me.status = 'planned')::integer as planned,
      count(*) filter (where me.status = 'in_progress')::integer as in_progress,
      count(*) filter (where me.status = 'done')::integer as done,
      sum(me.expected_tco2e_yr) filter (where me.status in ('planned', 'in_progress', 'done')) as expected
    from public.measures me
    group by me.site_id
  ),
  meter as (
    select g.site_id,
      sum(g.ch4_destroyed_t * b.gwp) filter (where g.period_end >= b.m0 and g.period_end < b.m1) as verified_month,
      sum(g.ch4_destroyed_t * b.gwp) as verified_total
    from public.gas_meter_readings g, bounds b
    group by g.site_id
  ),
  rem as (
    select distinct on (r.site_id) r.site_id, r.as_of, r.legacy_tonnes_total, r.tonnes_processed, r.area_reclaimed_ha
    from public.remediation_progress r, bounds b
    where r.as_of < b.m1
    order by r.site_id, r.as_of desc
  ),
  rep as (
    select cr.site_id,
      count(*) filter (where cr.reported_at >= b.m0 and cr.reported_at < b.m1)::integer as month_n,
      count(*) filter (where cr.closed_at >= b.m0 and cr.closed_at < b.m1)::integer as closed_n,
      percentile_cont(0.5) within group (
        order by (extract(epoch from (cr.closed_at - cr.reported_at)) / 3600.0)::double precision)
        filter (where cr.closed_at >= b.m0 and cr.closed_at < b.m1) as median_hours
    from public.citizen_reports cr, bounds b
    where cr.site_id is not null
    group by cr.site_id
  )
  select
    s.slug, s.name, s.city, s.state, b.m0,
    coalesce(sc.passes_month, 0), coalesce(sc.t1_month, 0), coalesce(sc.t2_month, 0), coalesce(sc.t3_month, 0),
    coalesce(ss.passes, 0)::integer, coalesce(ss.t1, 0)::integer, coalesce(ss.t2, 0)::integer,
    coalesce(ss.t3, 0)::integer,
    ss.min_mean_kgph::double precision, ss.tco2e100_yr::double precision,
    ss.persistent_upper_tph::double precision,
    coalesce(conf.open_n, 0), coalesce(conf.conf_n, 0), coalesce(conf.not_n, 0), conf.median_days::double precision,
    coalesce(fires.days, 0), coalesce(fires.open_n, 0),
    coalesce(meas.planned, 0), coalesce(meas.in_progress, 0), coalesce(meas.done, 0), meas.expected,
    meter.verified_month, meter.verified_total,
    rem.as_of, rem.legacy_tonnes_total, rem.tonnes_processed, rem.area_reclaimed_ha,
    coalesce(rep.month_n, 0), coalesce(rep.closed_n, 0), rep.median_hours::double precision
  from public.sites s
  cross join bounds b
  left join public.site_stats ss on ss.site_id = s.id
  left join sc on sc.site_id = s.id
  left join conf on conf.site_id = s.id
  left join fires on fires.site_id = s.id
  left join meas on meas.site_id = s.id
  left join meter on meter.site_id = s.id
  left join rem on rem.site_id = s.id
  left join rep on rep.site_id = s.id
  where s.kind = 'landfill' and s.active
  order by s.name
$$;

-- The ledger's public face: what each agency committed to, without notes or people.
create function public.public_measures()
returns table (
  slug              text,
  kind              public.measure_kind,
  title             text,
  agency            text,
  status            public.measure_status,
  start_date        date,
  expected_tco2e_yr double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select s.slug, m.kind, m.title, m.agency, m.status, m.start_date, m.expected_tco2e_yr
  from public.measures m
  join public.sites s on s.id = m.site_id and s.active
  order by s.name, m.created_at
$$;

-- Wet waste diverted per city and month, with the modelled avoided tonnes beside it.
create function public.diversion_summary()
returns table (
  city                 text,
  month                date,
  composted_t          double precision,
  biogas_t             double precision,
  source               text,
  avoided_tco2e        double precision)
language sql
stable
security definer
set search_path = ''
as $$
  select d.city, d.month, d.composted_t, d.biogas_t, d.source,
         public.diversion_avoided_tco2e(d.composted_t, d.biogas_t)
  from public.diversion_monthly d
  order by d.city, d.month desc
$$;

-- ---------------------------------------------------------------------------
-- Row-level security and privileges
--   viewers read every new table; officers write measures, remediation, diversion, meter readings
--   and update fires and citizen reports; admins delete; fires and reports are inserted by the
--   service role only (FIRMS cron, partner API). anon sees only the scorecard functions.
-- ---------------------------------------------------------------------------
alter table public.measures             enable row level security;
alter table public.fire_detections      enable row level security;
alter table public.citizen_reports      enable row level security;
alter table public.diversion_monthly    enable row level security;
alter table public.remediation_progress enable row level security;
alter table public.gas_meter_readings   enable row level security;

create policy "viewers read measures" on public.measures
  for select to authenticated using (public.has_role('viewer'));
create policy "officers add measures" on public.measures
  for insert to authenticated with check (public.has_role('officer') and created_by = (select auth.uid()));
create policy "officers update measures" on public.measures
  for update to authenticated using (public.has_role('officer')) with check (public.has_role('officer'));
create policy "admins delete measures" on public.measures
  for delete to authenticated using (public.has_role('admin'));

create policy "viewers read fires" on public.fire_detections
  for select to authenticated using (public.has_role('viewer'));
create policy "officers update fires" on public.fire_detections
  for update to authenticated using (public.has_role('officer')) with check (public.has_role('officer'));

create policy "viewers read citizen reports" on public.citizen_reports
  for select to authenticated using (public.has_role('viewer'));
create policy "officers update citizen reports" on public.citizen_reports
  for update to authenticated using (public.has_role('officer')) with check (public.has_role('officer'));

create policy "viewers read diversion" on public.diversion_monthly
  for select to authenticated using (public.has_role('viewer'));
create policy "officers add diversion" on public.diversion_monthly
  for insert to authenticated with check (public.has_role('officer') and created_by = (select auth.uid()));
create policy "officers update diversion" on public.diversion_monthly
  for update to authenticated using (public.has_role('officer')) with check (public.has_role('officer'));
create policy "admins delete diversion" on public.diversion_monthly
  for delete to authenticated using (public.has_role('admin'));

create policy "viewers read remediation" on public.remediation_progress
  for select to authenticated using (public.has_role('viewer'));
create policy "officers add remediation" on public.remediation_progress
  for insert to authenticated with check (public.has_role('officer') and created_by = (select auth.uid()));
create policy "officers update remediation" on public.remediation_progress
  for update to authenticated using (public.has_role('officer')) with check (public.has_role('officer'));
create policy "admins delete remediation" on public.remediation_progress
  for delete to authenticated using (public.has_role('admin'));

create policy "viewers read meter readings" on public.gas_meter_readings
  for select to authenticated using (public.has_role('viewer'));
create policy "officers add meter readings" on public.gas_meter_readings
  for insert to authenticated with check (public.has_role('officer') and created_by = (select auth.uid()));
create policy "admins delete meter readings" on public.gas_meter_readings
  for delete to authenticated using (public.has_role('admin'));

revoke all on public.measures, public.fire_detections, public.citizen_reports, public.diversion_monthly,
  public.remediation_progress, public.gas_meter_readings from anon, authenticated;
grant select on public.measures, public.fire_detections, public.citizen_reports, public.diversion_monthly,
  public.remediation_progress, public.gas_meter_readings to authenticated;
grant insert, update, delete on public.measures, public.diversion_monthly, public.remediation_progress
  to authenticated;
grant insert, delete on public.gas_meter_readings to authenticated;
grant update on public.fire_detections, public.citizen_reports to authenticated;
grant all on public.measures, public.fire_detections, public.citizen_reports, public.diversion_monthly,
  public.remediation_progress, public.gas_meter_readings to service_role;

revoke execute on function
  public.site_scorecard(date), public.public_measures(), public.diversion_summary(),
  public.measure_effect(uuid), public.site_has_confirmed_emission(uuid)
from public, anon, authenticated;
grant execute on function public.site_scorecard(date), public.public_measures(), public.diversion_summary()
  to anon, authenticated, service_role;
grant execute on function public.measure_effect(uuid), public.site_has_confirmed_emission(uuid)
  to authenticated, service_role;
grant execute on function
  public.setting_num(text, double precision), public.active_model_version(),
  public.capture_estimate(double precision, double precision, double precision, double precision,
                          double precision, double precision),
  public.diversion_avoided_tco2e(double precision, double precision)
to anon, authenticated, service_role;

-- Realtime: the dashboard refreshes fires and citizen reports as they arrive.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.fire_detections, public.citizen_reports, public.measures;
  end if;
end;
$$;
