-- VayuNetra core schema: sites, Sentinel-2 scans, evidence, actions, jobs, profiles, settings.
-- Numbers and tiers follow notebooks/vayunetra_ops.ipynb; see .claude/CLAUDE.md for wording rules.

create extension if not exists postgis with schema extensions;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type public.site_kind as enum ('landfill', 'control');

-- T1 methane-confident, T2 probable (needs confirmation), T3 surface change (rejected as methane).
create type public.tier as enum ('T1', 'T2', 'T3', 'none');

create type public.action_status as enum (
  'new',
  'verification_requested',
  'confirmed',
  'not_methane',
  'mitigation_planned',
  'in_progress',
  'resolved'
);

create type public.job_kind as enum ('scan_site', 'monitor_all', 'rebuild_dossier');
create type public.job_status as enum ('queued', 'running', 'done', 'failed');

-- Declared in ascending order of privilege: has_role() compares with >=.
create type public.user_role as enum ('viewer', 'officer', 'admin');
create type public.ui_lang as enum ('en', 'hi');

-- ---------------------------------------------------------------------------
-- Sites: landfills and their control points (~5 km away)
-- ---------------------------------------------------------------------------
create table public.sites (
  id         uuid primary key default gen_random_uuid(),
  slug       text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name       text not null,
  city       text not null,
  state      text not null,
  kind       public.site_kind not null,
  geom       extensions.geography(point, 4326) not null,
  elev_m     double precision,
  control_of uuid references public.sites (id) on delete cascade,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  constraint sites_control_of_matches_kind check ((kind = 'control') = (control_of is not null))
);

create index sites_geom_idx on public.sites using gist (geom);
-- One control point per landfill keeps site_stats one row per landfill.
create unique index sites_one_control_per_landfill on public.sites (control_of)
  where control_of is not null;

-- ---------------------------------------------------------------------------
-- Scans: one row per clear Sentinel-2 pass per site per model version
-- ---------------------------------------------------------------------------
create table public.scans (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites (id) on delete cascade,
  pass_date      date not null,
  overpass_utc   timestamptz,
  satellite      text,
  sza            double precision,
  vza            double precision,
  scene_score    double precision not null check (scene_score between 0 and 1),
  detected       boolean not null default false,
  tier           public.tier not null default 'none',
  surface_kind   text,
  q_kgph         double precision,  -- IME point estimate (kg/h); null in calm wind (u10 < 1.5 m/s)
  q_med          double precision,  -- Monte Carlo median (kg/h) for T1/T2 events
  q_lo           double precision,  -- 16th percentile (68% range)
  q_hi           double precision,  -- 84th percentile (68% range)
  u10            double precision,  -- ERA5-Land 10 m wind speed (m/s)
  wind_u         double precision,
  wind_v         double precision,
  d_b12          double precision,  -- physics gate: relative B12 change in the plume vs its ring
  d_b11          double precision,
  d_visnir       double precision,
  elong          double precision,
  axis_vs_wind   double precision,  -- degrees
  src_dist_m     double precision,
  threshold_used double precision not null,
  model_version  text not null,     -- first 12 hex chars of the weights SHA256
  created_at     timestamptz not null default now(),
  constraint scans_site_pass_model_key unique (site_id, pass_date, model_version),
  constraint scans_tier_needs_detection check (tier = 'none' or detected)
);

create index scans_site_date_idx on public.scans (site_id, pass_date desc);
create index scans_flagged_idx on public.scans (tier) where tier <> 'none';

-- ---------------------------------------------------------------------------
-- Evidence for a flagged scan: image URLs (evidence bucket) and plume geometry
-- ---------------------------------------------------------------------------
create table public.evidence (
  scan_id       uuid primary key references public.scans (id) on delete cascade,
  rgb_url       text,
  mbmp_url      text,
  mask_url      text,
  panel_url     text,
  plume_geojson jsonb,  -- plume polygon(s), WGS84
  chip_bounds   jsonb   -- 4 corner [lon, lat] pairs of the 2 km chip, for draping on the map
);

-- ---------------------------------------------------------------------------
-- Per-site sensitivity from injected-plume tests (written by the worker)
-- ---------------------------------------------------------------------------
create table public.site_sensitivity (
  site_id              uuid not null references public.sites (id) on delete cascade,
  model_version        text not null,
  detect_rates         jsonb,             -- {"rates_kgph": [...], "pod": [...], "pod_confirmed": [...]}
  persistent_upper_tph double precision,  -- 95% upper bound on a steady emitter (t/h)
  computed_at          timestamptz not null default now(),
  primary key (site_id, model_version)
);

-- ---------------------------------------------------------------------------
-- People and workflow
-- ---------------------------------------------------------------------------
create table public.profiles (
  user_id   uuid primary key references auth.users (id) on delete cascade,
  full_name text,
  org       text,
  state     text,
  role      public.user_role not null default 'viewer',
  lang      public.ui_lang not null default 'en'
);

create table public.actions (
  id             uuid primary key default gen_random_uuid(),
  site_id        uuid not null references public.sites (id) on delete cascade,
  scan_id        uuid references public.scans (id) on delete set null,
  status         public.action_status not null default 'new',
  assignee       uuid references auth.users (id) on delete set null,
  due_date       date,
  note           text,
  attachment_url text,
  created_by     uuid default auth.uid() references auth.users (id) on delete set null,
  created_at     timestamptz not null default now()
);

create index actions_site_idx on public.actions (site_id, created_at desc);

create table public.jobs (
  id           uuid primary key default gen_random_uuid(),
  kind         public.job_kind not null,
  site_id      uuid references public.sites (id) on delete cascade,
  params       jsonb not null default '{}'::jsonb,
  status       public.job_status not null default 'queued',
  requested_by uuid default auth.uid() references auth.users (id) on delete set null,
  log          text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz,
  constraint jobs_scan_site_needs_site check (kind <> 'scan_site' or site_id is not null)
);

create index jobs_queue_idx on public.jobs (created_at) where status = 'queued';

-- Key/value settings: threshold_mode, economic assumptions, alert recipients per state.
-- is_public marks values the public website may read (assumptions shown next to figures).
create table public.settings (
  key       text primary key,
  value     jsonb not null,
  is_public boolean not null default false
);

create table public.alerts (
  id         uuid primary key default gen_random_uuid(),
  scan_id    uuid not null references public.scans (id) on delete cascade,
  channel    text not null check (channel in ('email', 'sms', 'whatsapp')),
  recipients text[] not null default '{}',
  sent_at    timestamptz,
  status     text not null default 'pending' check (status in ('pending', 'sent', 'failed'))
);

create table public.access_requests (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 200),
  org        text not null check (char_length(org) between 1 and 200),
  email      text not null check (char_length(email) <= 320 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  state      text check (char_length(state) <= 100),
  message    text check (char_length(message) <= 2000),
  created_at timestamptz not null default now()
);

create table public.worker_heartbeat (
  worker_id   text primary key,
  last_seen   timestamptz not null default now(),
  version     text,
  device      text,
  queue_depth integer not null default 0 check (queue_depth >= 0)
);

create table public.audit_log (
  id         bigint generated always as identity primary key,
  actor      uuid,
  action     text not null,
  table_name text not null,
  row_id     text,
  diff       jsonb,
  created_at timestamptz not null default now()
);

create index audit_log_row_idx on public.audit_log (table_name, row_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Statistics helpers
-- ---------------------------------------------------------------------------
-- ln C(n, k) for 0 <= k <= n.
create function public.ln_choose(n integer, k integer)
returns double precision
language sql
immutable strict parallel safe
set search_path = ''
as $$
  select coalesce(sum(ln((n - k + i)::double precision) - ln(i::double precision)), 0)
  from generate_series(1, k) as i
$$;

-- One-sided Fisher exact test, alternative "greater", for the 2x2 table [[a, b], [c, d]];
-- matches scipy.stats.fisher_exact(..., alternative="greater") used in the ops notebook.
-- Rows: landfill (flags, non-flags), control (flags, non-flags).
create function public.fisher_exact_greater(a integer, b integer, c integer, d integer)
returns double precision
language sql
immutable strict parallel safe
set search_path = ''
as $$
  select least(1.0, sum(exp(
           public.ln_choose(a + b, x)
           + public.ln_choose(c + d, a + c - x)
           - public.ln_choose(a + b + c + d, a + c))))
  from generate_series(a, least(a + b, a + c)) as x
  where a + c - x <= c + d
$$;
