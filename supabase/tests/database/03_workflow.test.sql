-- Action workflow and the assignee list.
begin;
create extension if not exists pgtap with schema extensions;
select plan(7);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000b1', 'officer1@test.local', '{"full_name": "Asha Officer"}'),
  ('00000000-0000-0000-0000-0000000000c1', 'viewer1@test.local', '{"full_name": "Vikram Viewer"}');
update public.profiles set role = 'officer' where user_id = '00000000-0000-0000-0000-0000000000b1';

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-0000000000b1", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$ insert into public.actions (id, site_id, status, note)
     values ('00000000-0000-0000-0000-00000000a001', (select id from public.sites where slug = 'deonar'),
             'verification_requested', 'task OGI drone') $$,
  'officers can open an action as verification_requested');

select throws_ok(
  $$ insert into public.actions (site_id, status) values ((select id from public.sites where slug = 'deonar'), 'resolved') $$,
  '23514', null, 'a new action cannot start as resolved');

select throws_ok(
  $$ update public.actions set status = 'in_progress' where id = '00000000-0000-0000-0000-00000000a001' $$,
  '23514', null, 'verification_requested cannot jump to in_progress');

select lives_ok(
  $$ update public.actions set status = 'confirmed' where id = '00000000-0000-0000-0000-00000000a001' $$,
  'verification_requested -> confirmed is allowed');

select lives_ok(
  $$ update public.actions set note = 'drone survey booked', due_date = '2026-10-20'
     where id = '00000000-0000-0000-0000-00000000a001' $$,
  'editing fields without a status change is allowed');

reset role;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-0000000000c1", "role": "authenticated"}', true);
set local role authenticated;

select is(
  (select count(*) from public.list_assignees() where full_name = 'Asha Officer'),
  1::bigint, 'viewers see officers in the assignee list');
select is(
  (select count(*) from public.list_assignees() where full_name = 'Vikram Viewer'),
  0::bigint, 'viewers are not assignees');

select * from finish();
rollback;
