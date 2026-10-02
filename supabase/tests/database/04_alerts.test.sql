-- One alert per scan per channel; reports are readable by viewers only.
begin;
create extension if not exists pgtap with schema extensions;
select plan(6);

insert into public.alerts (scan_id, channel, recipients, status)
select id, 'email', '{a@test.local}', 'sent' from public.scans
where tier = 'T1' order by pass_date desc limit 1;

select throws_ok(
  $$ insert into public.alerts (scan_id, channel, recipients)
     select id, 'email', '{b@test.local}' from public.scans where tier = 'T1' order by pass_date desc limit 1 $$,
  '23505', null, 'a second email alert for the same scan is refused');

select lives_ok(
  $$ insert into public.alerts (scan_id, channel, recipients)
     select id, 'sms', '{+910000000000}' from public.scans where tier = 'T1' order by pass_date desc limit 1 $$,
  'the same scan can still get an SMS alert');

insert into public.reports (kind, state, period, status) values ('monthly', 'Test State', '1999-01', 'sent');
select throws_ok(
  $$ insert into public.reports (kind, state, period) values ('monthly', 'Test State', '1999-01') $$,
  '23505', null, 'one monthly report per state and period');

insert into public.ops_alerts (kind, ref, status) values ('worker_offline', 'w1@2025-01-01T00:00:00Z', 'sent');
select throws_ok(
  $$ insert into public.ops_alerts (kind, ref) values ('worker_offline', 'w1@2025-01-01T00:00:00Z') $$,
  '23505', null, 'one worker-offline email per outage');

set local role anon;
select throws_ok($$ select * from public.reports $$, '42501', null, 'anon cannot read reports');
select throws_ok($$ select * from public.ops_alerts $$, '42501', null, 'anon cannot read ops alerts');

select * from finish();
rollback;
