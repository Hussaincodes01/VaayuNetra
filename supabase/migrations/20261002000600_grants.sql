-- Explicit table privileges for the Data API roles. RLS decides which rows; these grants decide which
-- statements a role may attempt at all. Written out so behaviour does not depend on the project's
-- auto-expose default for new tables.

revoke all on all tables in schema public from anon, authenticated;

-- anon: the public website
grant select on
  public.sites,
  public.scans,
  public.evidence,
  public.site_sensitivity,
  public.site_stats,
  public.site_locations,
  public.settings,
  public.worker_heartbeat
to anon;
grant insert on public.access_requests to anon;

-- authenticated: viewer / officer / admin, separated by RLS
grant select on all tables in schema public to authenticated;
grant insert on public.access_requests to authenticated;
grant insert, update on public.actions to authenticated;
grant insert on public.jobs to authenticated;
grant insert, update, delete on public.settings to authenticated;
grant insert, update, delete on public.profiles to authenticated;

-- service_role: the worker and server routes (bypasses RLS)
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;

grant execute on function
  public.has_role(public.user_role),
  public.is_privileged_session(),
  public.ln_choose(integer, integer),
  public.fisher_exact_greater(integer, integer, integer, integer)
to anon, authenticated, service_role;
