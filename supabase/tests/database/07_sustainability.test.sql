-- Sustainability features: confirmation tasks, capture calculator, mitigation ledger, before-and-after
-- check, fire log, citizen report routing, wet-waste model, remediation, metered readings, scorecard.
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000d1', 'viewer7@test.local', '{"full_name": "Vimla Viewer"}'),
  ('00000000-0000-0000-0000-0000000000d2', 'officer7@test.local', '{"full_name": "Om Officer"}');
update public.profiles set role = 'officer' where user_id = '00000000-0000-0000-0000-0000000000d2';

-- ---------------------------------------------------------------------------
-- Confirmation tracker
-- ---------------------------------------------------------------------------
select is(
  (select count(*) from public.actions where origin = 'auto'),
  3::bigint, 'each seeded T1/T2 landfill flag has one confirmation task');

select is(
  (select count(*) from public.actions
   where origin = 'auto' and status = 'verification_requested' and due_date = current_date + 28),
  3::bigint, 'tasks open as verification_requested, due in 28 days');

update public.scans set tier = tier where tier in ('T1', 'T2');
select is(
  (select count(*) from public.actions where origin = 'auto'),
  3::bigint, 'rewriting a flagged scan does not open a second task');

insert into public.scans (site_id, pass_date, scene_score, detected, tier, threshold_used, model_version)
values
  ((select id from public.sites where slug = 'okhla'), '2026-09-01', 0.91, true, 'T2', 0.844,
   public.active_model_version()),
  ((select id from public.sites where slug = 'okhla'), '2026-09-06', 0.90, true, 'T3', 0.844,
   public.active_model_version()),
  ((select id from public.sites s where s.control_of = (select id from public.sites where slug = 'okhla')),
   '2026-09-01', 0.90, true, 'T2', 0.844, public.active_model_version());

select is(
  (select count(*) from public.actions a join public.scans sc on sc.id = a.scan_id
   where sc.pass_date between '2026-09-01' and '2026-09-06'),
  1::bigint, 'a new T2 at a landfill opens a task; T3 and control-point flags do not');

select ok(
  (select count(*) = 1 from public.scans
   where pass_date = '2026-09-01' and tier = 'T2'
     and site_id = (select id from public.sites where slug = 'okhla')),
  'the scan itself is stored');

update public.actions set status = 'confirmed'
where scan_id = (select id from public.scans where tier = 'T1' order by pass_date limit 1);
select isnt(
  (select result_at from public.actions
   where scan_id = (select id from public.scans where tier = 'T1' order by pass_date limit 1)),
  null, 'a confirmed task records when the answer came');

-- ---------------------------------------------------------------------------
-- Capture calculator (Deonar dossier: 301 kg/h at 60% capture -> about 41,894 t CO2e a year, 0.9 MW)
-- ---------------------------------------------------------------------------
select ok(
  (select avoided_tco2e_yr between 41850 and 41950 from public.capture_estimate(301.2, 0.6)),
  'avoided tonnes match the dossier action plan');
select ok(
  (select power_mw between 0.87 and 0.89 from public.capture_estimate(301.2, 0.6)),
  'electric output matches the dossier action plan');
select ok(
  (select annual_tco2e between 71200 and 71300 from public.capture_estimate(301.2, 0.6)),
  'annual CO2e matches the site minimum estimate');

-- ---------------------------------------------------------------------------
-- Mitigation ledger
-- ---------------------------------------------------------------------------
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-0000000000d1", "role": "authenticated"}', true);
set local role authenticated;

select throws_ok(
  $$ insert into public.measures (site_id, kind, title, agency)
     values ((select id from public.sites where slug = 'deonar'), 'biocover', 'Slope biocover', 'BMC') $$,
  '42501', null, 'viewers cannot add measures');

reset role;
select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-0000000000d2", "role": "authenticated"}', true);
set local role authenticated;

select lives_ok(
  $$ insert into public.measures (id, site_id, kind, title, agency, status, start_date, capture_share)
     values ('00000000-0000-0000-0000-00000000e001', (select id from public.sites where slug = 'deonar'),
             'gas_collection', 'Vertical wells on the flagged cell', 'BMC', 'in_progress', '2025-01-01', 0.6) $$,
  'officers can add a capture measure');

select ok(
  (select expected_tco2e_yr between 41800 and 42000 from public.measures
   where id = '00000000-0000-0000-0000-00000000e001'),
  'expected tonnes come from the site minimum rate');

select is(
  (select (assumptions ->> 'capture_share')::double precision from public.measures
   where id = '00000000-0000-0000-0000-00000000e001'),
  0.6::double precision, 'the inputs are stored beside the figure');

insert into public.measures (id, site_id, kind, title, agency, capture_share)
values ('00000000-0000-0000-0000-00000000e002', (select id from public.sites where slug = 'ghazipur'),
        'gas_collection', 'Gas wells', 'MCD', 0.6);
select is(
  (select expected_tco2e_yr from public.measures where id = '00000000-0000-0000-0000-00000000e002'),
  null::double precision, 'no avoided-tonnes figure for a site with only an upper bound');

select throws_ok(
  $$ insert into public.measures (site_id, kind, title, agency, capture_share)
     values ((select id from public.sites where slug = 'deonar'), 'biocover', 'Biocover', 'BMC', 0.5) $$,
  '23514', null, 'capture share only applies to gas collection, flare or engine');

select throws_ok(
  $$ insert into public.measures (site_id, kind, title, agency, status)
     values ((select id from public.sites where slug = 'deonar'), 'biocover', 'Biocover', 'BMC', 'in_progress') $$,
  '23514', null, 'a started measure needs a start date');

-- Before-and-after check: Deonar passes split at 1 January 2025.
select ok(
  (select before_passes > 0 and after_passes > 0 and p_value between 0 and 1
   from public.measure_effect('00000000-0000-0000-0000-00000000e001')),
  'the before-and-after check counts passes on both sides and tests them');

-- Metered readings need a confirmed emission.
select throws_ok(
  $$ insert into public.gas_meter_readings (site_id, period_start, period_end, ch4_destroyed_t, meter_id)
     values ((select id from public.sites where slug = 'ghazipur'), '2026-09-01', '2026-09-30', 10, 'GZ-1') $$,
  '23514', null, 'no metered tonnes without a confirmed emission');

select lives_ok(
  $$ insert into public.gas_meter_readings (site_id, measure_id, period_start, period_end, ch4_destroyed_t, meter_id)
     values ((select id from public.sites where slug = 'deonar'), '00000000-0000-0000-0000-00000000e001',
             '2026-09-01', '2026-09-30', 100, 'DN-FLOW-1') $$,
  'metered tonnes at a site with a confirmed emission');

select throws_ok(
  $$ insert into public.remediation_progress (site_id, as_of, legacy_tonnes_total, tonnes_processed, source)
     values ((select id from public.sites where slug = 'bhalswa'), '2026-09-30', 1000, 2000, 'test') $$,
  '23514', null, 'processed tonnes cannot exceed the legacy total');

select lives_ok(
  $$ insert into public.remediation_progress (site_id, as_of, legacy_tonnes_total, tonnes_processed,
                                               area_reclaimed_ha, source)
     values ((select id from public.sites where slug = 'bhalswa'), '2026-09-30', 1000, 400, 2.5,
             'Swachhatam portal') $$,
  'officers record remediation progress');

reset role;

-- ---------------------------------------------------------------------------
-- Fire log and citizen reports (inserted by the service role)
-- ---------------------------------------------------------------------------
insert into public.fire_detections (id, site_id, source, acq_at, lat, lon, dist_m, confidence)
values ('00000000-0000-0000-0000-00000000f001', (select id from public.sites where slug = 'ghazipur'),
        'VIIRS_SNPP_NRT', '2026-09-10 08:10+00', 28.62, 77.33, 300, 'n');

insert into public.citizen_reports (id, source, external_id, kind, reported_at, lat, lon, consent)
select '00000000-0000-0000-0000-00000000c001', 'ecosathi', 'r-1', 'smoke', '2026-09-12 10:00+00',
       extensions.st_y(geom::extensions.geometry) + 0.005, extensions.st_x(geom::extensions.geometry), true
from public.sites where slug = 'deonar';

select is(
  (select s.slug from public.citizen_reports r join public.sites s on s.id = r.site_id
   where r.id = '00000000-0000-0000-0000-00000000c001'),
  'deonar', 'a report 0.5 km away is routed to that landfill');

select is(
  (select due_at from public.citizen_reports where id = '00000000-0000-0000-0000-00000000c001'),
  '2026-09-15 10:00+00'::timestamptz, 'its deadline is the 72-hour default');

insert into public.citizen_reports (source, external_id, kind, reported_at, lat, lon, consent)
values ('ecosathi', 'r-2', 'odour', '2026-09-12 10:00+00', 10.0, 76.0, true);
select is(
  (select site_id from public.citizen_reports where external_id = 'r-2'),
  null::uuid, 'a report far from every landfill stays unrouted');

select throws_ok(
  $$ insert into public.citizen_reports (source, external_id, kind, reported_at, lat, lon, consent)
     values ('ecosathi', 'r-3', 'fire', now(), 19.07, 72.93, false) $$,
  '23514', null, 'a report without consent is refused');

select set_config('request.jwt.claims',
  '{"sub": "00000000-0000-0000-0000-0000000000d2", "role": "authenticated"}', true);
set local role authenticated;

update public.fire_detections set status = 'out' where id = '00000000-0000-0000-0000-00000000f001';
update public.citizen_reports set status = 'closed', closing_note = 'Fire tender sent'
where id = '00000000-0000-0000-0000-00000000c001';

reset role;
select is(
  (select closed_by from public.fire_detections where id = '00000000-0000-0000-0000-00000000f001'),
  '00000000-0000-0000-0000-0000000000d2'::uuid, 'marking a fire out records who did it');
select isnt(
  (select closed_at from public.citizen_reports where id = '00000000-0000-0000-0000-00000000c001'),
  null, 'closing a report records when');

-- ---------------------------------------------------------------------------
-- Wet-waste model: 1 t composted -> 0.15 x 0.5 x 0.8 x 0.5 x 16/12 = 0.04 t CH4 avoided,
-- x 27 = 1.08, minus 0.004 x 27 + 0.00024 x 273 for composting = 0.906 t CO2e
-- ---------------------------------------------------------------------------
select ok(
  public.diversion_avoided_tco2e(1, 0) between 0.906 and 0.907,
  'composting one tonne avoids about 0.906 t CO2e over the waste''s lifetime');
select ok(
  public.diversion_avoided_tco2e(0, 1) between 1.058 and 1.059,
  'biogas from one tonne avoids about 1.058 t CO2e');

-- ---------------------------------------------------------------------------
-- Public scorecard: aggregates for anon, nothing personal
-- ---------------------------------------------------------------------------
set local role anon;

select is(
  (select count(*) from public.site_scorecard('2026-09-01')),
  5::bigint, 'anon gets one scorecard row per active landfill');

select is(
  (select verified_tco2e_total from public.site_scorecard('2026-09-01') where slug = 'deonar'),
  2700::double precision, 'verified tonnes are metered methane x GWP100');

select is(
  (select fire_days_month from public.site_scorecard('2026-09-01') where slug = 'ghazipur'),
  1, 'fire days count each day with a detection');

select throws_ok(
  $$ select note from public.measures $$, '42501', null, 'anon cannot read the ledger''s notes');

select throws_ok(
  $$ select * from public.measure_effect('00000000-0000-0000-0000-00000000e001') $$,
  '42501', null, 'anon cannot call the internal before-and-after check');

reset role;

select * from finish();
rollback;
