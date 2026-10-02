-- Roles and row-level security.
--   anon      read sites, site_stats, scans, evidence, site_sensitivity, worker_heartbeat and public
--             settings; insert access_requests. Nothing else.
--   viewer    read everything except other people's profiles.
--   officer   viewer + insert/update actions, insert jobs.
--   admin     officer + manage profiles and settings.
--   The worker uses the service-role key, which bypasses RLS.

-- ---------------------------------------------------------------------------
-- Role helpers (security definer: read profiles without recursing into its RLS)
-- ---------------------------------------------------------------------------
create function public.has_role(min_role public.user_role)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.role >= min_role from public.profiles p where p.user_id = (select auth.uid())),
    false)
$$;

-- Database-level roles that administer the project (migrations, seed, worker).
create function public.is_privileged_session()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('postgres', 'service_role', 'supabase_admin')
$$;

-- Every new auth user gets a viewer profile.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Non-admins may edit their own name and language, nothing else.
create function public.guard_profile_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if public.is_privileged_session() or public.has_role('admin') then
    return new;
  end if;
  if (new.user_id, new.role, new.org, new.state)
     is distinct from (old.user_id, old.role, old.org, old.state) then
    raise exception 'only an admin can change role, org or state'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger guard_profile_update
  before update on public.profiles
  for each row execute function public.guard_profile_update();

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.sites            enable row level security;
alter table public.scans            enable row level security;
alter table public.evidence         enable row level security;
alter table public.site_sensitivity enable row level security;
alter table public.profiles         enable row level security;
alter table public.actions          enable row level security;
alter table public.jobs             enable row level security;
alter table public.settings         enable row level security;
alter table public.alerts           enable row level security;
alter table public.access_requests  enable row level security;
alter table public.worker_heartbeat enable row level security;
alter table public.audit_log        enable row level security;

-- ---------------------------------------------------------------------------
-- Public data (no personal data in these tables)
-- ---------------------------------------------------------------------------
create policy "sites are public" on public.sites
  for select to anon, authenticated using (true);

create policy "scans are public" on public.scans
  for select to anon, authenticated using (true);

create policy "evidence is public" on public.evidence
  for select to anon, authenticated using (true);

create policy "site sensitivity is public" on public.site_sensitivity
  for select to anon, authenticated using (true);

create policy "worker heartbeat is public" on public.worker_heartbeat
  for select to anon, authenticated using (true);

create policy "public settings are readable" on public.settings
  for select to anon, authenticated using (is_public);

create policy "anyone can request access" on public.access_requests
  for insert to anon, authenticated with check (true);

-- ---------------------------------------------------------------------------
-- Viewer: read everything except other people's profiles
-- ---------------------------------------------------------------------------
create policy "viewers read settings" on public.settings
  for select to authenticated using (public.has_role('viewer'));

create policy "viewers read actions" on public.actions
  for select to authenticated using (public.has_role('viewer'));

create policy "viewers read jobs" on public.jobs
  for select to authenticated using (public.has_role('viewer'));

create policy "viewers read alerts" on public.alerts
  for select to authenticated using (public.has_role('viewer'));

create policy "viewers read access requests" on public.access_requests
  for select to authenticated using (public.has_role('viewer'));

create policy "viewers read audit log" on public.audit_log
  for select to authenticated using (public.has_role('viewer'));

create policy "users read own profile" on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));

create policy "users update own profile" on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Officer: actions and scan requests
-- ---------------------------------------------------------------------------
create policy "officers create actions" on public.actions
  for insert to authenticated
  with check (public.has_role('officer') and created_by = (select auth.uid()));

create policy "officers update actions" on public.actions
  for update to authenticated
  using (public.has_role('officer'))
  with check (public.has_role('officer'));

create policy "officers queue jobs" on public.jobs
  for insert to authenticated
  with check (
    public.has_role('officer')
    and requested_by = (select auth.uid())
    and status = 'queued'
  );

-- ---------------------------------------------------------------------------
-- Admin: profiles and settings
-- ---------------------------------------------------------------------------
create policy "admins manage profiles" on public.profiles
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));

create policy "admins manage settings" on public.settings
  for all to authenticated
  using (public.has_role('admin'))
  with check (public.has_role('admin'));
