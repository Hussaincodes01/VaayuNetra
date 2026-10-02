-- Dashboard support: AI briefing cache, assignee list, action workflow, Realtime.

-- ---------------------------------------------------------------------------
-- "Explain this site" cache: one briefing per site, model version and language
-- ---------------------------------------------------------------------------
create table public.ai_briefings (
  site_id       uuid not null references public.sites (id) on delete cascade,
  model_version text not null,
  lang          public.ui_lang not null,
  model         text not null,
  briefing      text not null,
  created_at    timestamptz not null default now(),
  primary key (site_id, model_version, lang)
);

alter table public.ai_briefings enable row level security;

create policy "viewers read briefings" on public.ai_briefings
  for select to authenticated using (public.has_role('viewer'));

grant select on public.ai_briefings to authenticated;
grant all on public.ai_briefings to service_role;

-- ---------------------------------------------------------------------------
-- People an action can be assigned to. Profiles of others are hidden by RLS, so this
-- returns only id, name and role of officers and admins, to signed-in viewers and above.
-- ---------------------------------------------------------------------------
create function public.list_assignees()
returns table (user_id uuid, full_name text, role public.user_role)
language sql
stable
security definer
set search_path = ''
as $$
  select p.user_id, coalesce(p.full_name, ''), p.role
  from public.profiles p
  where p.role in ('officer', 'admin') and public.has_role('viewer')
  order by p.full_name
$$;

grant execute on function public.list_assignees() to authenticated;

-- ---------------------------------------------------------------------------
-- Action workflow:
--   new -> verification_requested -> confirmed | not_methane
--   confirmed -> mitigation_planned -> in_progress -> resolved
-- An update may keep the status (editing assignee, due date, note, attachment).
-- ---------------------------------------------------------------------------
create function public.action_transition_allowed(from_status public.action_status, to_status public.action_status)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select from_status = to_status or (from_status, to_status) in (
    ('new'::public.action_status, 'verification_requested'::public.action_status),
    ('verification_requested', 'confirmed'),
    ('verification_requested', 'not_methane'),
    ('confirmed', 'mitigation_planned'),
    ('mitigation_planned', 'in_progress'),
    ('in_progress', 'resolved')
  )
$$;

create function public.guard_action_workflow()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if new.status not in ('new', 'verification_requested') and not public.is_privileged_session() then
      raise exception 'a new action starts as new or verification_requested, not %', new.status
        using errcode = '23514';
    end if;
  elsif not public.action_transition_allowed(old.status, new.status) and not public.is_privileged_session() then
    raise exception 'action status cannot move from % to %', old.status, new.status
      using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger guard_action_workflow
  before insert or update on public.actions
  for each row execute function public.guard_action_workflow();

grant execute on function public.action_transition_allowed(public.action_status, public.action_status)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Realtime: job status, actions and the worker heartbeat update the dashboard live.
-- RLS still applies to what each subscriber receives.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.jobs, public.actions, public.worker_heartbeat, public.scans;
  end if;
end;
$$;
