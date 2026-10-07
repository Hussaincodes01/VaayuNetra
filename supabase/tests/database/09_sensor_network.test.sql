-- Sensor network: public readings, private keys, one open alert per kind, ledger only for live nodes.
begin;
create extension if not exists pgtap with schema extensions;
select plan(10);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000f1', 'officer9@test.local', '{"full_name": "Sensor Officer"}');
update public.profiles set role = 'officer' where user_id = '00000000-0000-0000-0000-0000000000f1';

insert into public.sensor_nodes (id, site_id, code, role, mode, lat, lon) values
  ('00000000-0000-0000-0000-00000000a901', (select id from public.sites where slug = 'deonar'),
   'DEO-SIM-P1', 'perimeter', 'simulated', 19.07, 72.93),
  ('00000000-0000-0000-0000-00000000a902', (select id from public.sites where slug = 'deonar'),
   'DEO-LIVE-P2', 'perimeter', 'live', 19.07, 72.94);
insert into public.sensor_node_keys (node_id, key_hash)
values ('00000000-0000-0000-0000-00000000a902', repeat('ab', 32));
insert into public.sensor_readings (node_id, at, ch4_ppm, rs_ratio, temp_c, rh_pct, pressure_hpa)
values ('00000000-0000-0000-0000-00000000a901', '2026-10-08 06:00+00', 42.5, 0.81, 29.5, 70, 1008.2);

select throws_ok(
  $$ insert into public.sensor_readings (node_id, at, ch4_ppm) values
     ('00000000-0000-0000-0000-00000000a901', '2026-10-08 06:00+00', 1) $$,
  '23505', null, 'one reading per node and time');
select throws_ok(
  $$ insert into public.sensor_readings (node_id, at, rh_pct) values
     ('00000000-0000-0000-0000-00000000a901', '2026-10-08 06:10+00', 140) $$,
  '23514', null, 'impossible humidity is refused');

insert into public.sensor_alerts (node_id, kind, p_rise) values
  ('00000000-0000-0000-0000-00000000a901', 'forecast_rise', 0.8),
  ('00000000-0000-0000-0000-00000000a902', 'forecast_rise', 0.7);
select throws_ok(
  $$ insert into public.sensor_alerts (node_id, kind) values ('00000000-0000-0000-0000-00000000a901', 'forecast_rise') $$,
  '23505', null, 'one open alert per node and kind');
select is(
  (select count(*) from public.ledger_entries where kind = 'sensor_alert'),
  1::bigint, 'a live node''s alert enters the ledger; a simulated one does not');
select is(
  (select payload_text::jsonb ->> 'node' from public.ledger_entries where kind = 'sensor_alert'),
  'DEO-LIVE-P2', 'the ledger names the node');

set local role anon;
select isnt_empty('select id from public.sensor_nodes', 'anyone can see the nodes');
select isnt_empty('select at from public.sensor_readings', 'anyone can see the readings');
select throws_ok($$ select key_hash from public.sensor_node_keys $$, '42501', null, 'device keys are hidden');
select throws_ok($$ select id from public.sensor_alerts $$, '42501', null, 'alerts need a sign-in');
reset role;

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-0000000000f1", "role": "authenticated"}', true);
set local role authenticated;
update public.sensor_alerts set acknowledged_by = '00000000-0000-0000-0000-0000000000f1', acknowledged_at = now()
where node_id = '00000000-0000-0000-0000-00000000a901';
reset role;
select isnt(
  (select acknowledged_at from public.sensor_alerts where node_id = '00000000-0000-0000-0000-00000000a901'),
  null, 'officers acknowledge alerts');

select * from finish();
rollback;
