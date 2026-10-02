-- site_stats reproduces the ops notebook's site summary from the seeded scans (supabase/seed.sql).
-- Read as anon: the public website uses this view.
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

set local role anon;

select is((select count(*) from public.site_stats), 5::bigint, 'one row per landfill');

select is((select passes from public.site_stats where slug = 'deonar'), 67::bigint,
  'Deonar: 67 clear passes');
select is((select t1 from public.site_stats where slug = 'deonar'), 1::bigint,
  'Deonar: one T1 (methane-confident) event');
select is((select status from public.site_stats where slug = 'deonar'), 'priority',
  'Deonar status is priority');

select is((select sum(passes) from public.site_stats), 340::numeric, '340 landfill passes');
select is((select sum(control_passes) from public.site_stats), 334::numeric, '334 control passes');
select is((select sum(flags) from public.site_stats), 14::numeric, '14 landfill flags');
select is((select sum(control_flags) from public.site_stats), 0::numeric, '0 control flags');
select is(
  (select array[sum(t1), sum(t2), sum(t3)] from public.site_stats),
  array[1, 2, 11]::numeric[], 'tiers: 1 T1, 2 T2, 11 T3');

select ok(
  abs((select min_mean_kgph from public.site_stats where slug = 'deonar') - 301.239) < 0.01,
  'Deonar minimum time-averaged rate is 301 kg/h');
select ok(
  abs((select tco2e100_yr from public.site_stats where slug = 'deonar') - 71249.07) < 1,
  'Deonar minimum estimate is about 71,000 t CO2e/yr (GWP100 = 27)');

select ok(
  abs((select p_vs_control from public.site_stats where slug = 'ghazipur') - 0.124980) < 1e-5,
  'Fisher exact p for Ghazipur matches the notebook (0.125)');
select ok(
  abs((select p_vs_control from public.site_stats where slug = 'okhla') - 0.030101) < 1e-5,
  'Fisher exact p for Okhla matches the notebook (0.0301)');

select is((select persistent_upper_tph from public.site_stats where slug = 'okhla'), 20::double precision,
  'Okhla persistent-emission upper bound is 20 t/h');

select * from finish();
rollback;
