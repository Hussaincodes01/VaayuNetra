import "server-only";

import { DEFAULT_ASSUMPTIONS, type Assumptions } from "@/content/facts";
import seed from "@/content/field-test.json";
import type {
  Evidence,
  Flag,
  LandingData,
  Site,
  SiteStat,
  SiteStatus,
  Tier,
} from "./landing-types";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const REVALIDATE_S = 600;
const WORKER_ONLINE_MS = 3 * 60 * 1000;
/** India field test window (CLAUDE.md); the same window as the site_stats_field_test view. */
const FIELD_TEST = { from: "2024-01-01", to: "2025-12-31" };

type Row = Record<string, unknown>;

async function select(table: string, query: string): Promise<Row[] | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      next: { revalidate: REVALIDATE_S, tags: ["landing"] },
    });
    if (!res.ok) return null;
    return (await res.json()) as Row[];
  } catch {
    return null;
  }
}

async function exists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      method: "HEAD",
      next: { revalidate: REVALIDATE_S },
    });
    return res.ok;
  } catch {
    return false;
  }
}

const n = (v: unknown): number | null =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? null : Number(v);

// --- Seed (ops-notebook export, the same rows the database is seeded with) ----------------------

function fromSeed(): LandingData {
  return {
    source: "seed",
    modelVersion: seed.modelVersion,
    scenes: seed.scenes,
    sites: seed.sites.map((s) => ({
      slug: s.slug,
      name: s.name,
      city: s.city,
      state: s.state,
      lat: s.lat,
      lon: s.lon,
      control: s.control,
    })),
    stats: seed.stats.map((s) => ({ ...s, status: s.status as SiteStatus })),
    flags: seed.flags.map((f) => ({
      slug: f.slug,
      date: f.date,
      tier: f.tier as Tier,
      surfaceKind: f.surfaceKind,
      sceneScore: f.sceneScore,
      qKgph: f.qKgph,
      qMed: f.qMed,
      qLo: f.qLo,
      qHi: f.qHi,
      u10: f.u10,
      windU: f.windU,
      windV: f.windV,
      dB12: f.dB12,
      dB11: f.dB11,
      dVisNir: f.dVisNir,
      evidence: f.evidence
        ? {
            rgb: f.evidence.rgb,
            mbmp: f.evidence.mbmp,
            mask: f.evidence.mask,
            chipBounds: f.evidence.chipBounds as [number, number][],
            plume: f.evidence.plume as Evidence["plume"],
          }
        : null,
    })),
    worker: null,
    lastUpdated: null,
    assumptions: { ...DEFAULT_ASSUMPTIONS },
    dossierPdfUrl: "/dossiers/deonar.pdf",
  };
}

// --- Supabase -------------------------------------------------------------------------------------

export async function getLandingData(): Promise<LandingData> {
  const fallback = fromSeed();
  const [statsRows, siteRows, flagRows, heartbeat, settings, newest] =
    await Promise.all([
      // The landing page tells the field-test story: numbers from Jan 2024 to Dec 2025 only (they match
      // CLAUDE.md). Passes the worker scans later show up on the dashboard, not here.
      select("site_stats_field_test", "select=*"),
      select(
        "site_locations",
        "select=slug,name,city,state,kind,lat,lon,control_of,id&active=eq.true",
      ),
      select(
        "scans",
        "select=pass_date,tier,surface_kind,scene_score,q_kgph,q_med,q_lo,q_hi,u10,wind_u,wind_v,d_b12,d_b11,d_visnir," +
          "sites!inner(slug,kind),evidence(rgb_url,mbmp_url,mask_url,plume_geojson,chip_bounds)" +
          "&detected=eq.true&sites.kind=eq.landfill" +
          `&pass_date=gte.${FIELD_TEST.from}&pass_date=lte.${FIELD_TEST.to}&order=pass_date.desc`,
      ),
      select(
        "worker_heartbeat",
        "select=last_seen&order=last_seen.desc&limit=1",
      ),
      select("settings", "select=key,value"),
      select("scans", "select=created_at&order=created_at.desc&limit=1"),
    ]);
  if (!statsRows?.length || !siteRows?.length) return fallback;

  const sites: Site[] = siteRows
    .filter((r) => r.kind === "landfill")
    .map((r) => {
      const control = siteRows.find(
        (c) => c.kind === "control" && c.control_of === r.id,
      );
      return {
        slug: String(r.slug),
        name: String(r.name),
        city: String(r.city),
        state: String(r.state),
        lat: Number(r.lat),
        lon: Number(r.lon),
        control: control
          ? { lat: Number(control.lat), lon: Number(control.lon) }
          : null,
      };
    });

  const stats: SiteStat[] = statsRows.map((r) => ({
    slug: String(r.slug),
    passes: Number(r.passes),
    flags: Number(r.flags),
    t1: Number(r.t1),
    t2: Number(r.t2),
    t3: Number(r.t3),
    burnLike: Number(r.burn_like),
    controlPasses: Number(r.control_passes),
    controlFlags: Number(r.control_flags),
    pVsControl: n(r.p_vs_control),
    minMeanKgph: n(r.min_mean_kgph),
    tco2e100Yr: n(r.tco2e100_yr),
    persistentUpperTph: n(r.persistent_upper_tph),
    status: r.status as SiteStatus,
    lastPassDate: r.last_pass_date ? String(r.last_pass_date) : null,
  }));

  const seedEvidence = new Map(
    fallback.flags.map((f) => [`${f.slug}|${f.date}`, f.evidence]),
  );
  const flags: Flag[] = (flagRows ?? [])
    .filter((r) => r.tier !== "none")
    .map((r) => {
      const slug = String((r.sites as Row).slug);
      const date = String(r.pass_date);
      const ev = (Array.isArray(r.evidence) ? r.evidence[0] : r.evidence) as
        Row | null | undefined;
      const evidence: Evidence | null = ev?.rgb_url
        ? {
            rgb: String(ev.rgb_url),
            mbmp: String(ev.mbmp_url),
            mask: String(ev.mask_url),
            chipBounds: ev.chip_bounds as [number, number][],
            plume: (ev.plume_geojson as Evidence["plume"]) ?? null,
          }
        : (seedEvidence.get(`${slug}|${date}`) ?? null);
      return {
        slug,
        date,
        tier: r.tier as Tier,
        surfaceKind: (r.surface_kind as string | null) ?? null,
        sceneScore: Number(r.scene_score),
        qKgph: n(r.q_kgph),
        qMed: n(r.q_med),
        qLo: n(r.q_lo),
        qHi: n(r.q_hi),
        u10: n(r.u10),
        windU: n(r.wind_u),
        windV: n(r.wind_v),
        dB12: n(r.d_b12),
        dB11: n(r.d_b11),
        dVisNir: n(r.d_visnir),
        evidence,
      };
    })
    .sort(
      (a, b) =>
        a.tier.localeCompare(b.tier) ||
        b.sceneScore - a.sceneScore ||
        a.date.localeCompare(b.date),
    );

  const landfill = stats.reduce((s, r) => s + r.passes, 0);
  const control = stats.reduce((s, r) => s + r.controlPasses, 0);
  const lastPassDate = stats
    .map((r) => r.lastPassDate ?? "")
    .reduce((a, b) => (a > b ? a : b), "");

  const settingsMap = new Map(
    (settings ?? []).map((r) => [String(r.key), r.value]),
  );
  const assumptions = { ...DEFAULT_ASSUMPTIONS } as Assumptions;
  for (const key of Object.keys(DEFAULT_ASSUMPTIONS) as (keyof Assumptions)[]) {
    const v = n(settingsMap.get(key));
    if (v !== null) assumptions[key] = v;
  }

  const lastSeen = heartbeat?.[0]?.last_seen
    ? String(heartbeat[0].last_seen)
    : null;
  const remotePdf = `${SUPABASE_URL}/storage/v1/object/public/dossiers/deonar.pdf`;

  return {
    source: "supabase",
    modelVersion: statsRows[0]?.model_version
      ? String(statsRows[0].model_version)
      : fallback.modelVersion,
    scenes: {
      total: landfill + control,
      landfill,
      control,
      controlFlags: stats.reduce((s, r) => s + r.controlFlags, 0),
      lastPassDate: lastPassDate || fallback.scenes.lastPassDate,
    },
    sites: sites.length ? sites : fallback.sites,
    stats,
    flags: flags.length ? flags : fallback.flags,
    worker: lastSeen
      ? {
          online: Date.now() - new Date(lastSeen).getTime() < WORKER_ONLINE_MS,
          lastSeen,
        }
      : null,
    lastUpdated: newest?.[0]?.created_at ? String(newest[0].created_at) : null,
    assumptions,
    dossierPdfUrl: (await exists(remotePdf))
      ? remotePdf
      : fallback.dossierPdfUrl,
  };
}
