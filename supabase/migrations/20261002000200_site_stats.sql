-- site_stats: one row per landfill, the ops notebook's site summary computed live from scans.
--   passes, flags, t1/t2/t3     clear passes and flags at the landfill (active model version)
--   control_flags, p_vs_control flags at its control point; one-sided Fisher exact test
--   min_mean_kgph               minimum time-averaged rate: T1 days only, zero on every other pass
--                               = (T1 events / passes) x median Monte Carlo rate of the T1 events
--   tco2e100_yr, tco2e20_yr     minimum estimate, using gwp100 / gwp20 from settings
--   status                      priority (T1) | watch (T2) | surface_activity (T3 only) | no_large_events
-- security_invoker: the caller's RLS applies to every table read here.

create view public.site_stats
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

comment on view public.site_stats is
  'Per-landfill summary. Rates and CO2e are screening-grade minimum estimates; confirm by hyperspectral satellite, OGI drone or ground survey before enforcement or carbon crediting.';

-- site_locations: every site with plain lat/lon (PostgREST cannot return geography as numbers).
create view public.site_locations
with (security_invoker = true)
as
select
  s.id,
  s.slug,
  s.name,
  s.city,
  s.state,
  s.kind,
  extensions.st_y(s.geom::extensions.geometry) as lat,
  extensions.st_x(s.geom::extensions.geometry) as lon,
  s.elev_m,
  s.control_of,
  s.active
from public.sites s;
