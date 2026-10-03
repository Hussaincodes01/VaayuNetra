-- site_stats_field_test: site_stats restricted to the India field test (1 Jan 2024 to 31 Dec 2025).
-- The landing page tells the field-test story with these numbers (they match CLAUDE.md); new passes the
-- worker scans afterwards appear on the dashboard through site_stats but never change this view.
-- Same definition as site_stats in 20261002000200_site_stats.sql, plus the pass_date window.

create view public.site_stats_field_test
with (security_invoker = true)
as
with params as (
  select
    coalesce(
      (select value #>> '{}' from public.settings where key = 'model_version'),
      (select model_version from public.scans order by created_at desc limit 1)
    ) as model_version,
    coalesce((select (value #>> '{}')::double precision from public.settings where key = 'gwp100'), 27.0) as gwp100,
    coalesce((select (value #>> '{}')::double precision from public.settings where key = 'gwp20'), 79.7) as gwp20
),
per_site as (
  select
    sc.site_id,
    count(*)                                                          as passes,
    count(*) filter (where sc.detected)                               as flags,
    count(*) filter (where sc.tier = 'T1')                            as t1,
    count(*) filter (where sc.tier = 'T2')                            as t2,
    count(*) filter (where sc.tier = 'T3')                            as t3,
    count(*) filter (where sc.surface_kind = 'burn scar / smoke-like') as burn_like,
    percentile_cont(0.5) within group (order by sc.q_med) filter (where sc.tier = 'T1') as t1_q_med,
    max(sc.pass_date)                                                 as last_pass_date
  from public.scans sc
  join params p on sc.model_version = p.model_version
  where sc.pass_date between date '2024-01-01' and date '2025-12-31'
  group by sc.site_id
)
select
  s.id                                                   as site_id,
  s.slug,
  s.name,
  s.city,
  s.state,
  extensions.st_y(s.geom::extensions.geometry)           as lat,
  extensions.st_x(s.geom::extensions.geometry)           as lon,
  coalesce(l.passes, 0)                                  as passes,
  coalesce(l.flags, 0)                                   as flags,
  coalesce(l.t1, 0)                                      as t1,
  coalesce(l.t2, 0)                                      as t2,
  coalesce(l.t3, 0)                                      as t3,
  coalesce(l.burn_like, 0)                               as burn_like,
  coalesce(c.passes, 0)                                  as control_passes,
  coalesce(c.flags, 0)                                   as control_flags,
  case
    when l.passes > 0 and c.passes > 0
      then public.fisher_exact_greater(
        l.flags::integer, (l.passes - l.flags)::integer,
        c.flags::integer, (c.passes - c.flags)::integer)
  end                                                    as p_vs_control,
  mm.min_mean_kgph,
  mm.min_mean_kgph * 8.76 * p.gwp100                     as tco2e100_yr,
  mm.min_mean_kgph * 8.76 * p.gwp20                      as tco2e20_yr,
  ss.detect_rates,
  ss.persistent_upper_tph,
  l.last_pass_date,
  case
    when l.t1 > 0 then 'priority'
    when l.t2 > 0 then 'watch'
    when l.flags > 0 then 'surface_activity'
    else 'no_large_events'
  end                                                    as status,
  p.model_version
from public.sites s
cross join params p
left join per_site l on l.site_id = s.id
left join public.sites cs on cs.control_of = s.id
left join per_site c on c.site_id = cs.id
left join public.site_sensitivity ss on ss.site_id = s.id and ss.model_version = p.model_version
cross join lateral (
  select case
    when coalesce(l.t1, 0) = 0 then 0.0::double precision
    else l.t1::double precision / l.passes * l.t1_q_med
  end as min_mean_kgph
) mm
where s.kind = 'landfill';

comment on view public.site_stats_field_test is
  'site_stats for the India field test window (2024-01-01 to 2025-12-31). Screening-grade minimum estimates.';

grant select on public.site_stats_field_test to anon, authenticated, service_role;
