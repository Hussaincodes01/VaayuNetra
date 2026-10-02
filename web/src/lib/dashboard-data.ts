import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, SUPABASE_URL } from "@/lib/supabase/server";
import seed from "@/content/field-test.json";
import type { PlumeGeoJSON, SiteStatus, Tier } from "./landing-types";
import {
  CLOSED,
  WORKER_ONLINE_MS,
  type ActionRow,
  type ActionStatus,
  type Assignee,
  type EvidenceRow,
  type FeedItem,
  type Heartbeat,
  type JobRow,
  type OpenEvent,
  type Role,
  type ScanRow,
  type SiteRow,
  type Viewer,
} from "./dashboard-shared";

export * from "./dashboard-shared";

type Row = Record<string, unknown>;
const n = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

function mapSite(r: Row): SiteRow {
  return {
    id: String(r.site_id),
    slug: String(r.slug),
    name: String(r.name),
    city: String(r.city),
    state: String(r.state),
    lat: Number(r.lat),
    lon: Number(r.lon),
    status: r.status as SiteStatus,
    passes: Number(r.passes),
    flags: Number(r.flags),
    t1: Number(r.t1),
    t2: Number(r.t2),
    t3: Number(r.t3),
    controlPasses: Number(r.control_passes),
    controlFlags: Number(r.control_flags),
    pVsControl: n(r.p_vs_control),
    minMeanKgph: n(r.min_mean_kgph),
    tco2e100Yr: n(r.tco2e100_yr),
    tco2e20Yr: n(r.tco2e20_yr),
    persistentUpperTph: n(r.persistent_upper_tph),
    detectRates: (r.detect_rates as SiteRow["detectRates"]) ?? null,
    lastPassDate: r.last_pass_date ? String(r.last_pass_date) : null,
    modelVersion: String(r.model_version ?? ""),
  };
}

function mapScan(r: Row): ScanRow {
  const ev = (Array.isArray(r.evidence) ? r.evidence[0] : r.evidence) as
    Row | null | undefined;
  return {
    id: String(r.id),
    siteId: String(r.site_id),
    passDate: String(r.pass_date),
    overpassUtc: r.overpass_utc ? String(r.overpass_utc) : null,
    satellite: (r.satellite as string) ?? null,
    sceneScore: Number(r.scene_score),
    detected: Boolean(r.detected),
    tier: r.tier as ScanRow["tier"],
    surfaceKind: (r.surface_kind as string) ?? null,
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
    elong: n(r.elong),
    axisVsWind: n(r.axis_vs_wind),
    srcDistM: n(r.src_dist_m),
    thresholdUsed: Number(r.threshold_used),
    modelVersion: String(r.model_version),
    evidence: ev?.rgb_url
      ? {
          rgb: String(ev.rgb_url),
          mbmp: String(ev.mbmp_url),
          mask: String(ev.mask_url),
          panel: ev.panel_url ? String(ev.panel_url) : null,
          plume: (ev.plume_geojson as PlumeGeoJSON) ?? null,
          chipBounds: ev.chip_bounds as [number, number][],
        }
      : null,
  };
}

function mapAction(r: Row): ActionRow {
  return {
    id: String(r.id),
    siteId: String(r.site_id),
    scanId: (r.scan_id as string) ?? null,
    status: r.status as ActionStatus,
    assignee: (r.assignee as string) ?? null,
    dueDate: (r.due_date as string) ?? null,
    note: (r.note as string) ?? null,
    attachmentUrl: (r.attachment_url as string) ?? null,
    createdBy: (r.created_by as string) ?? null,
    createdAt: String(r.created_at),
  };
}

function mapJob(r: Row): JobRow {
  return {
    id: String(r.id),
    kind: r.kind as JobRow["kind"],
    siteId: (r.site_id as string) ?? null,
    status: r.status as JobRow["status"],
    log: (r.log as string) ?? null,
    createdAt: String(r.created_at),
    startedAt: (r.started_at as string) ?? null,
    finishedAt: (r.finished_at as string) ?? null,
  };
}

const SCAN_FIELDS =
  "id,site_id,pass_date,overpass_utc,satellite,scene_score,detected,tier,surface_kind,q_kgph,q_med,q_lo,q_hi,u10," +
  "wind_u,wind_v,d_b12,d_b11,d_visnir,elong,axis_vs_wind,src_dist_m,threshold_used,model_version";
const EVIDENCE_EMBED =
  "evidence(rgb_url,mbmp_url,mask_url,panel_url,plume_geojson,chip_bounds)";

/** Notebook evidence (data/seed) for flagged passes the worker has not uploaded evidence for yet. */
const SEED_EVIDENCE = new Map(
  seed.flags
    .filter((f) => f.evidence)
    .map((f) => [
      `${f.slug}|${f.date}`,
      {
        rgb: f.evidence!.rgb,
        mbmp: f.evidence!.mbmp,
        mask: f.evidence!.mask,
        panel: null,
        plume: f.evidence!.plume as PlumeGeoJSON,
        chipBounds: f.evidence!.chipBounds as [number, number][],
      } satisfies EvidenceRow,
    ]),
);

function withSeedEvidence(scan: ScanRow, slug: string): ScanRow {
  return scan.evidence || !scan.detected
    ? scan
    : {
        ...scan,
        evidence: SEED_EVIDENCE.get(`${slug}|${scan.passDate}`) ?? null,
      };
}

// --- Viewer --------------------------------------------------------------------------------------

export async function getViewer(
  supabase?: SupabaseClient,
): Promise<Viewer | null> {
  const s = supabase ?? (await createClient());
  const {
    data: { user },
  } = await s.auth.getUser();
  if (!user) return null;
  const { data: p } = await s
    .from("profiles")
    .select("full_name,role,lang")
    .eq("user_id", user.id)
    .maybeSingle();
  return {
    id: user.id,
    email: user.email ?? "",
    name: (p?.full_name as string) ?? null,
    role: ((p?.role as Role) ?? "viewer") as Role,
    lang: ((p?.lang as "en" | "hi") ?? "en") as "en" | "hi",
  };
}

// --- Shared --------------------------------------------------------------------------------------

export async function getSites(s: SupabaseClient): Promise<SiteRow[]> {
  const { data } = await s.from("site_stats").select("*").order("name");
  return (data ?? []).map(mapSite);
}

export async function getHeartbeat(s: SupabaseClient): Promise<Heartbeat> {
  const { data } = await s
    .from("worker_heartbeat")
    .select("worker_id,last_seen,device")
    .order("last_seen", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const lastSeen = String(data.last_seen);
  return {
    workerId: String(data.worker_id),
    lastSeen,
    online: Date.now() - new Date(lastSeen).getTime() < WORKER_ONLINE_MS,
    device: (data.device as string) ?? null,
  };
}

export async function getAssignees(s: SupabaseClient): Promise<Assignee[]> {
  const { data } = await s.rpc("list_assignees");
  return ((data as Row[] | null) ?? []).map((r) => ({
    userId: String(r.user_id),
    name: String(r.full_name || "—"),
    role: r.role as Role,
  }));
}

export function dossierUrl(slug: string): string {
  return `${SUPABASE_URL}/storage/v1/object/public/dossiers/${slug}.pdf`;
}

/** The worker's dossier if it has published one; the notebook's Deonar dossier ships with the site. */
export async function resolveDossier(slug: string): Promise<string | null> {
  try {
    const res = await fetch(dossierUrl(slug), {
      method: "HEAD",
      next: { revalidate: 300 },
    });
    if (res.ok) return dossierUrl(slug);
  } catch {
    // fall through
  }
  return slug === "deonar" ? "/dossiers/deonar.pdf" : null;
}

// --- Overview ------------------------------------------------------------------------------------

export async function getOverview(s: SupabaseClient) {
  const sites = await getSites(s);
  const modelVersion = sites[0]?.modelVersion ?? "";
  const bySiteId = new Map(sites.map((x) => [x.id, x]));
  const monthStart = new Date();
  monthStart.setUTCDate(1);
  const monthIso = monthStart.toISOString().slice(0, 10);

  const [heartbeat, month, flagged, actions, audit, jobs] = await Promise.all([
    getHeartbeat(s),
    s
      .from("scans")
      .select("id", { count: "exact", head: true })
      .gte("pass_date", monthIso)
      .eq("model_version", modelVersion),
    s
      .from("scans")
      .select(`${SCAN_FIELDS},${EVIDENCE_EMBED}`)
      .eq("detected", true)
      .eq("model_version", modelVersion)
      .neq("tier", "none")
      .order("pass_date", { ascending: false }),
    s.from("actions").select("*").order("created_at", { ascending: false }),
    s
      .from("audit_log")
      .select("action,row_id,diff,created_at")
      .eq("table_name", "actions")
      .order("created_at", { ascending: false })
      .limit(12),
    s
      .from("jobs")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(8),
  ]);

  const scans = (flagged.data ?? [])
    .map(mapScan)
    .filter((x) => bySiteId.has(x.siteId))
    .map((x) => withSeedEvidence(x, bySiteId.get(x.siteId)!.slug));
  const actionRows = (actions.data ?? []).map(mapAction);
  const latestActionByScan = new Map<string, ActionRow>();
  for (const a of actionRows)
    if (a.scanId && !latestActionByScan.has(a.scanId))
      latestActionByScan.set(a.scanId, a);
  const open: OpenEvent[] = scans
    .filter((x) => x.tier === "T1" || x.tier === "T2")
    .map((x) => ({
      scan: x,
      site: bySiteId.get(x.siteId)!,
      action: latestActionByScan.get(x.id) ?? null,
    }))
    .filter((e) => !e.action || !CLOSED.includes(e.action.status))
    .sort(
      (a, b) =>
        a.scan.tier.localeCompare(b.scan.tier) ||
        b.scan.passDate.localeCompare(a.scan.passDate),
    );

  const actionById = new Map(actionRows.map((a) => [a.id, a]));
  const feed: FeedItem[] = [
    ...scans.slice(0, 10).map((x) => ({
      kind: "flag" as const,
      at: x.overpassUtc ?? x.passDate,
      slug: bySiteId.get(x.siteId)!.slug,
      site: bySiteId.get(x.siteId)!.name,
      tier: x.tier as Tier,
      scanDate: x.passDate,
    })),
    ...((audit.data ?? []) as Row[]).flatMap((r) => {
      const a = actionById.get(String(r.row_id));
      const site = a ? bySiteId.get(a.siteId) : undefined;
      if (!a || !site) return [];
      return [
        {
          kind: "action" as const,
          at: String(r.created_at),
          slug: site.slug,
          site: site.name,
          status: ((r.diff as Row)?.status as Row)?.new
            ? (((r.diff as Row).status as Row).new as ActionStatus)
            : a.status,
          change:
            r.action === "insert" ? ("insert" as const) : ("update" as const),
        },
      ];
    }),
    ...(jobs.data ?? []).map(mapJob).map((j) => {
      const site = j.siteId ? bySiteId.get(j.siteId) : undefined;
      return {
        kind: "job" as const,
        at: j.finishedAt ?? j.startedAt ?? j.createdAt,
        slug: site?.slug ?? null,
        site: site?.name ?? null,
        jobKind: j.kind,
        status: j.status,
      };
    }),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 14);

  const lastScan = sites
    .map((x) => x.lastPassDate ?? "")
    .reduce((a, b) => (a > b ? a : b), "");
  return {
    sites,
    heartbeat,
    scansThisMonth: month.count ?? 0,
    open,
    feed,
    lastScan,
    modelVersion,
  };
}

// --- Site page -----------------------------------------------------------------------------------

export async function getSiteDetail(s: SupabaseClient, slug: string) {
  const sites = await getSites(s);
  const site = sites.find((x) => x.slug === slug);
  if (!site) return null;
  const [scans, actions, jobs, assignees, control, briefings] =
    await Promise.all([
      s
        .from("scans")
        .select(`${SCAN_FIELDS},${EVIDENCE_EMBED}`)
        .eq("site_id", site.id)
        .eq("model_version", site.modelVersion)
        .order("pass_date", { ascending: true }),
      s
        .from("actions")
        .select("*")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false }),
      s
        .from("jobs")
        .select("*")
        .eq("site_id", site.id)
        .order("created_at", { ascending: false })
        .limit(5),
      getAssignees(s),
      s
        .from("site_locations")
        .select("lat,lon")
        .eq("control_of", site.id)
        .maybeSingle(),
      s
        .from("ai_briefings")
        .select("lang,briefing,model,created_at")
        .eq("site_id", site.id)
        .eq("model_version", site.modelVersion),
    ]);
  return {
    site,
    scans: (scans.data ?? [])
      .map(mapScan)
      .map((x) => withSeedEvidence(x, site.slug)),
    actions: (actions.data ?? []).map(mapAction),
    jobs: (jobs.data ?? []).map(mapJob),
    assignees,
    control: control.data
      ? { lat: Number(control.data.lat), lon: Number(control.data.lon) }
      : null,
    briefings: (briefings.data ?? []) as {
      lang: "en" | "hi";
      briefing: string;
      model: string;
      created_at: string;
    }[],
  };
}

export type SiteDetail = NonNullable<Awaited<ReturnType<typeof getSiteDetail>>>;
