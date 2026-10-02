-- Rate limits for the two public-facing writes: access requests (anyone) and AI briefings (signed-in
-- users, each one a paid LLM call). Serverless functions share no memory, so the counters live here.

create table public.rate_limits (
  key          text        not null,
  window_start timestamptz not null,
  hits         integer     not null default 0,
  primary key (key, window_start)
);

-- No policies: only the service role and the security-definer functions below touch it.
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from anon, authenticated;
grant all on public.rate_limits to service_role;

-- Fixed-window counter: records one hit for p_key and returns true while the key is within p_max hits
-- in the current window of p_window_seconds.
create function public.rate_limit_hit(p_key text, p_max integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits  integer;
begin
  insert into public.rate_limits as r (key, window_start, hits)
  values (p_key, v_start, 1)
  on conflict (key, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;
  -- Expired windows are never read again; trim them now and then.
  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;
  return v_hits <= p_max;
end;
$$;

revoke execute on function public.rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, integer, integer) to service_role;

-- Access requests can be posted straight to the REST API with the public anon key, past the website's
-- per-IP limit. Cap them in the database too: 3 per email per 24 hours and 30 per hour overall.
-- SQLSTATE PT429 makes PostgREST answer HTTP 429.
create function public.limit_access_requests()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.access_requests
       where lower(email) = lower(new.email) and created_at > now() - interval '24 hours') >= 3 then
    raise exception 'too many access requests for this email; try again tomorrow' using errcode = 'PT429';
  end if;
  if (select count(*) from public.access_requests where created_at > now() - interval '1 hour') >= 30 then
    raise exception 'too many access requests; try again later' using errcode = 'PT429';
  end if;
  return new;
end;
$$;

revoke execute on function public.limit_access_requests() from public, anon, authenticated;

create trigger limit_access_requests
  before insert on public.access_requests
  for each row execute function public.limit_access_requests();
