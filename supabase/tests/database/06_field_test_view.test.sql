-- The landing page's field-test numbers come from site_stats_field_test (Jan 2024 to Dec 2025) and must not
-- move when the worker adds new passes; site_stats (the dashboard) includes them.
begin;
create extension if not exists pgtap with schema extensions;
select plan(5);

select results_eq(
  $$ select passes::int, t1::int, flags::int from public.site_stats_field_test where slug = 'deonar' $$,
  $$ values (67, 1, 3) $$,
  'field-test view: Deonar has 67 passes, 1 T1, 3 flags');

-- A monitoring pass after the field test (a 2026 T3).
insert into public.scans (site_id, pass_date, scene_score, detected, tier, threshold_used, model_version)
select id, date '2026-02-20', 0.81, true, 'T3', 0.793,
       (select value #>> '{}' from public.settings where key = 'model_version')
from public.sites where slug = 'deonar';

select results_eq(
  $$ select passes::int, flags::int from public.site_stats_field_test where slug = 'deonar' $$,
  $$ values (67, 3) $$,
  'field-test view ignores passes after December 2025');
select results_eq(
  $$ select passes::int, flags::int from public.site_stats where slug = 'deonar' $$,
  $$ values (68, 4) $$,
  'site_stats (dashboard) includes the new pass');
select is(
  (select sum(passes + control_passes)::int from public.site_stats_field_test), 674,
  'field-test view: 674 clear scenes in total');

set local role anon;
select lives_ok($$ select * from public.site_stats_field_test $$, 'anon can read the field-test view');

select * from finish();
rollback;
