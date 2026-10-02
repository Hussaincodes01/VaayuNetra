-- Row-level security: who can read and write what. Run with `supabase test db`.
begin;
create extension if not exists pgtap with schema extensions;
select plan(18);

-- Fixtures (as postgres): one user per role and one existing action.
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-00000000000a', 'viewer@test.local', '{"full_name": "Test Viewer"}'),
  ('00000000-0000-0000-0000-00000000000b', 'officer@test.local', '{"full_name": "Test Officer"}'),
  ('00000000-0000-0000-0000-00000000000c', 'admin@test.local', '{"full_name": "Test Admin"}');
update public.profiles set role = 'officer' where user_id = '00000000-0000-0000-0000-00000000000b';
update public.profiles set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000c';
insert into public.actions (site_id, note)
values ((select id from public.sites where slug = 'deonar'), 'fixture');

select is(
  (select count(*) from public.profiles where user_id::text like '00000000-0000-0000-0000-00000000000_'),
  3::bigint, 'every new auth user gets a profile');

-- ---------------------------------------------------------------------------
-- anon
-- ---------------------------------------------------------------------------
set local role anon;

select throws_ok(
  $$ insert into public.actions (site_id, note)
     values ((select id from public.sites where slug = 'deonar'), 'anon write') $$,
  '42501', null, 'anon cannot insert actions');

select throws_ok(
  $$ update public.actions set note = 'anon edit' $$,
  '42501', null, 'anon cannot update actions');

select throws_ok(
  $$ delete from public.actions $$,
  '42501', null, 'anon cannot delete actions');

select throws_ok($$ select id from public.actions $$, '42501', null, 'anon cannot read actions');

select throws_ok(
  $$ insert into public.jobs (kind) values ('monitor_all') $$,
  '42501', null, 'anon cannot queue jobs');

select lives_ok(
  $$ insert into public.access_requests (name, org, email)
     values ('A. Officer', 'Delhi Pollution Control Committee', 'a.officer@example.org') $$,
  'anon can request access');

select is_empty(
  $$ select key from public.settings where key = 'alert_recipients' $$,
  'anon cannot read private settings');

select isnt_empty(
  $$ select key from public.settings where key = 'gwp100' $$,
  'anon can read public settings');

reset role;

-- ---------------------------------------------------------------------------
-- viewer
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000a", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$ insert into public.actions (site_id, note)
     values ((select id from public.sites where slug = 'deonar'), 'viewer write') $$,
  '42501', null, 'viewers cannot create actions');

select is((select count(*) from public.profiles), 1::bigint, 'viewers see only their own profile');

reset role;

-- ---------------------------------------------------------------------------
-- officer
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000b", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$ insert into public.actions (site_id, note, status)
     values ((select id from public.sites where slug = 'deonar'), 'task OGI drone survey',
             'verification_requested') $$,
  'officers can create actions');

select throws_ok(
  $$ insert into public.settings (key, value) values ('capture_eff_override', '0.9') $$,
  '42501', null, 'officers cannot add settings');

select is_empty(
  $$ update public.settings set value = '0.1' where key = 'capture_eff' returning key $$,
  'officers cannot change settings');

select throws_ok(
  $$ update public.profiles set role = 'admin' where user_id = '00000000-0000-0000-0000-00000000000b' $$,
  '42501', null, 'officers cannot promote themselves');

reset role;

select is((select value from public.settings where key = 'capture_eff'), '0.6'::jsonb,
  'capture_eff is unchanged after the officer attempt');

-- ---------------------------------------------------------------------------
-- admin
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-00000000000c", "role": "authenticated"}', true);
set local role authenticated;

update public.settings set value = '0.65' where key = 'capture_eff';

reset role;

select is((select value from public.settings where key = 'capture_eff'), '0.65'::jsonb,
  'admins can change settings');

select ok(
  exists (
    select 1 from public.audit_log
    where table_name = 'settings' and row_id = 'capture_eff'
      and actor = '00000000-0000-0000-0000-00000000000c'
      and diff -> 'value' ->> 'new' = '0.65'),
  'settings changes are audited with the actor and the diff');

select * from finish();
rollback;
