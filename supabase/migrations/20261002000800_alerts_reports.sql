-- Alerting and monthly reports (sent by the Vercel cron routes with the service role).

-- At most one alert per scan per channel: the cron claims the row before sending, so two
-- overlapping runs cannot both email the same event.
create unique index alerts_scan_channel_key on public.alerts (scan_id, channel);

-- Failed sends are retried by later runs (claimed by flipping failed -> pending), up to 3 attempts.
alter table public.alerts
  add column attempts   integer not null default 1 check (attempts >= 0),
  add column error      text,
  add column created_at timestamptz not null default now();

-- Monthly per-state reports: one row per kind, state and period (YYYY-MM).
create table public.reports (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('monthly')),
  state      text not null,
  period     text not null check (period ~ '^\d{4}-\d{2}$'),
  pdf_path   text,
  recipients text[] not null default '{}',
  status     text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'no_recipients')),
  attempts   integer not null default 1 check (attempts >= 0),
  error      text,
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, state, period)
);

-- System alerts that are not tied to a scan. worker_offline: ref = '<worker_id>@<last_seen>', so each
-- outage is emailed once, and a worker that comes back and drops again gets a new alert.
create table public.ops_alerts (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null check (kind in ('worker_offline')),
  ref        text not null,
  recipients text[] not null default '{}',
  status     text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'no_recipients')),
  attempts   integer not null default 1 check (attempts >= 0),
  error      text,
  sent_at    timestamptz,
  created_at timestamptz not null default now(),
  unique (kind, ref)
);

alter table public.ops_alerts enable row level security;

create policy "admins read ops alerts" on public.ops_alerts
  for select to authenticated using (public.has_role('admin'));

alter table public.reports enable row level security;

create policy "viewers read reports" on public.reports
  for select to authenticated using (public.has_role('viewer'));

-- New tables inherit the project's default grants; state them explicitly as in the grants migration.
revoke all on public.reports, public.ops_alerts, public.ai_briefings from anon, authenticated;
grant select on public.reports, public.ops_alerts, public.ai_briefings to authenticated;
grant all on public.reports, public.ops_alerts to service_role;

-- Report PDFs: private bucket, readable by signed-in viewers (signed URLs), written by the service role.
insert into storage.buckets (id, name, public)
values ('reports', 'reports', false)
on conflict (id) do nothing;

create policy "viewers read reports bucket" on storage.objects
  for select to authenticated
  using (bucket_id = 'reports' and public.has_role('viewer'));
