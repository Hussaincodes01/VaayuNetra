-- Audit trail for actions, settings and jobs.
-- Trigger arguments: (primary-key column, optional comma-separated columns to ignore in update diffs).
-- Inserts store the new row, deletes the old row, updates only the changed fields as {"col": {"old", "new"}}.

create function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old    jsonb := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) end;
  v_new    jsonb := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) end;
  v_ignore text[] := coalesce(string_to_array(nullif(tg_argv[1], ''), ','), '{}');
  v_diff   jsonb;
begin
  if tg_op = 'UPDATE' then
    select coalesce(jsonb_object_agg(n.key, jsonb_build_object('old', v_old -> n.key, 'new', n.value)), '{}'::jsonb)
      into v_diff
      from jsonb_each(v_new) as n
     where (v_old -> n.key) is distinct from n.value
       and n.key <> all (v_ignore);
    if v_diff = '{}'::jsonb then
      return new;
    end if;
  else
    v_diff := coalesce(v_new, v_old);
  end if;

  insert into public.audit_log (actor, action, table_name, row_id, diff)
  values (auth.uid(), lower(tg_op), tg_table_name, coalesce(v_new, v_old) ->> tg_argv[0], v_diff);

  return coalesce(new, old);
end;
$$;

create trigger audit_actions
  after insert or update or delete on public.actions
  for each row execute function public.audit_row('id');

create trigger audit_settings
  after insert or update or delete on public.settings
  for each row execute function public.audit_row('key');

-- The worker appends to jobs.log while it runs; log-only updates are not audited.
create trigger audit_jobs
  after insert or update or delete on public.jobs
  for each row execute function public.audit_row('id', 'log');
