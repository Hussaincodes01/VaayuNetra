-- Scheduler inside Supabase: pg_cron calls the site's cron routes through pg_net, because GitHub
-- Actions' free schedule runs every few hours in practice. The site URL and the cron secret live in
-- Supabase Vault under the names below, set once outside migrations (DEPLOY.md, step 4.5):
--   vayu_site_url     https://vayunetra-india.vercel.app
--   vayu_cron_secret  the same value as CRON_SECRET in Vercel
-- Without them the jobs run and do nothing. The routes are idempotent, so the GitHub Actions schedule
-- can stay on as a backstop.

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  end if;
end;
$$;

-- GET <site>/<path> with the cron secret; returns the pg_net request id, or null when not configured.
create function public.call_cron_route(p_path text)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_url    text;
  v_secret text;
begin
  if to_regclass('vault.decrypted_secrets') is null or to_regproc('net.http_get') is null then
    return null;
  end if;
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_url using 'vayu_site_url';
  execute 'select decrypted_secret from vault.decrypted_secrets where name = $1' into v_secret using 'vayu_cron_secret';
  if v_url is null or v_secret is null then
    return null;
  end if;
  return net.http_get(
    url := rtrim(v_url, '/') || p_path,
    headers := jsonb_build_object('Authorization', 'Bearer ' || v_secret),
    timeout_milliseconds := 60000);
end;
$$;

revoke execute on function public.call_cron_route(text) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('vayu-alerts', '*/15 * * * *', $job$select public.call_cron_route('/api/cron/alerts')$job$);
    perform cron.schedule('vayu-sensors', '5,20,35,50 * * * *', $job$select public.call_cron_route('/api/cron/sensors')$job$);
    perform cron.schedule('vayu-fires', '10 * * * *', $job$select public.call_cron_route('/api/cron/fires')$job$);
    perform cron.schedule('vayu-anchor', '40 * * * *', $job$select public.call_cron_route('/api/cron/anchor')$job$);
  end if;
end;
$$;
