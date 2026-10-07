import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { MODEL, loadLevels, type Levels } from "./sensor-network";
import { excessSeries } from "./sensors";

export type SensorNodeView = {
  id: string;
  code: string;
  role: "perimeter" | "community" | "background";
  mode: "simulated" | "live";
  lastSeen: string | null;
  batteryV: number | null;
  latestPpm: number | null;
  /** Excess over the background node, every reading of the last 24 hours. */
  series: { t: number; v: number }[];
  excessNow: number | null;
  max24h: number | null;
  pRise: number | null;
  status: "rise" | "warning" | "normal" | "quiet";
};

export type SensorAlertView = {
  id: string;
  node: string;
  site: string;
  kind: "forecast_rise" | "threshold" | "lel" | "offline";
  mode: "simulated" | "live";
  openedAt: string;
  closedAt: string | null;
  pRise: number | null;
  peakPpm: number | null;
  leadMin: number | null;
  outcome: string | null;
  acknowledgedAt: string | null;
};

export type TrackRecord = {
  warnings: number;
  cameTrue: number;
  rises: number;
  risesWarned: number;
  medianLeadMin: number | null;
};

type Row = Record<string, unknown>;
const DAY = 86_400_000;

/** Track record of the early warnings over closed alerts (30 days). */
function trackRecord(alerts: SensorAlertView[]): TrackRecord {
  const warnings = alerts.filter(
    (a) => a.kind === "forecast_rise" && a.closedAt,
  );
  const rises = alerts.filter((a) => a.kind === "threshold");
  const leads = rises
    .map((r) => r.leadMin)
    .filter((v): v is number => v !== null)
    .sort((a, b) => a - b);
  return {
    warnings: warnings.length,
    cameTrue: warnings.filter((w) => w.outcome === "rise").length,
    rises: rises.length,
    risesWarned: leads.length,
    medianLeadMin: leads.length ? leads[Math.floor(leads.length / 2)] : null,
  };
}

/** The sensor network for the dashboard: nodes per site with 24-hour series, alerts and the record. */
export async function getSensorNetwork(s: SupabaseClient, now = Date.now()) {
  const [{ data: nodeRows }, { data: siteRows }, levels] = await Promise.all([
    s
      .from("sensor_nodes")
      .select("id,site_id,code,role,mode,last_seen,battery_v")
      .eq("active", true)
      .order("code"),
    s.from("site_locations").select("id,slug,name").eq("kind", "landfill"),
    loadLevels(s),
  ]);
  const nodes = (nodeRows ?? []) as Row[];
  const ids = nodes.map((n) => String(n.id));
  const since = new Date(now - DAY).toISOString();

  const readings = new Map<string, { at: number; ppm: number }[]>(
    ids.map((id) => [id, []]),
  );
  for (let page = 0; ids.length && page < 30; page++) {
    const { data } = await s
      .from("sensor_readings")
      .select("node_id,at,ch4_ppm")
      .in("node_id", ids)
      .gte("at", since)
      .order("at", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    (data ?? []).forEach((r) =>
      readings
        .get(r.node_id)
        ?.push({ at: Date.parse(r.at), ppm: Number(r.ch4_ppm) }),
    );
    if ((data ?? []).length < 1000) break;
  }

  const [{ data: forecastRows }, { data: alertRows }] = await Promise.all([
    ids.length
      ? s
          .from("sensor_forecasts")
          .select("node_id,issued_at,p_rise")
          .in("node_id", ids)
          .gte("issued_at", new Date(now - 6 * 3_600_000).toISOString())
          .order("issued_at", { ascending: false })
      : Promise.resolve({ data: [] as Row[] }),
    ids.length
      ? s
          .from("sensor_alerts")
          .select(
            "id,node_id,kind,opened_at,closed_at,p_rise,peak_ppm,lead_min,detail,acknowledged_at",
          )
          .in("node_id", ids)
          .gte("opened_at", new Date(now - 30 * DAY).toISOString())
          .order("opened_at", { ascending: false })
          .limit(500)
      : Promise.resolve({ data: [] as Row[] }),
  ]);
  const latestP = new Map<string, number>();
  (forecastRows ?? []).forEach((f) => {
    if (!latestP.has(String(f.node_id)))
      latestP.set(String(f.node_id), Number(f.p_rise));
  });
  const nodeById = new Map(nodes.map((n) => [String(n.id), n]));
  const siteById = new Map((siteRows ?? []).map((x) => [String(x.id), x]));
  const alerts: SensorAlertView[] = ((alertRows ?? []) as Row[]).map((a) => {
    const n = nodeById.get(String(a.node_id))!;
    return {
      id: String(a.id),
      node: String(n.code),
      site: String(siteById.get(String(n.site_id))?.slug ?? ""),
      kind: a.kind as SensorAlertView["kind"],
      mode: n.mode as SensorAlertView["mode"],
      openedAt: String(a.opened_at),
      closedAt: (a.closed_at as string) ?? null,
      pRise: a.p_rise === null ? null : Number(a.p_rise),
      peakPpm: a.peak_ppm === null ? null : Number(a.peak_ppm),
      leadMin: a.lead_min === null ? null : Number(a.lead_min),
      outcome: ((a.detail as Row | null)?.outcome as string) ?? null,
      acknowledgedAt: (a.acknowledged_at as string) ?? null,
    };
  });
  const openKinds = (code: string) =>
    new Set(
      alerts.filter((a) => a.node === code && !a.closedAt).map((a) => a.kind),
    );

  const sites = ((siteRows ?? []) as Row[])
    .map((site) => {
      const own = nodes.filter((n) => n.site_id === site.id);
      if (!own.length) return null;
      const bg = own.find((n) => n.role === "background");
      const bgPts = bg ? readings.get(String(bg.id))! : [];
      const views: SensorNodeView[] = own.map((n) => {
        const pts = readings.get(String(n.id))!;
        const isBg = n.role === "background";
        const ex = isBg ? [] : excessSeries(pts, bgPts);
        const recent = ex.filter(
          (p) => p.at > (pts.at(-1)?.at ?? 0) - 30 * 60_000,
        );
        const excessNow = recent.length
          ? recent.reduce((s2, p) => s2 + p.ppm, 0) / recent.length
          : null;
        const open = openKinds(String(n.code));
        const quiet = !pts.length || now - pts[pts.length - 1].at > 45 * 60_000;
        return {
          id: String(n.id),
          code: String(n.code),
          role: n.role as SensorNodeView["role"],
          mode: n.mode as SensorNodeView["mode"],
          lastSeen: (n.last_seen as string) ?? null,
          batteryV: n.battery_v === null ? null : Number(n.battery_v),
          latestPpm: pts.length ? pts[pts.length - 1].ppm : null,
          series: (isBg ? pts.map((p) => ({ at: p.at, ppm: p.ppm })) : ex).map(
            (p) => ({
              t: p.at,
              v: Number(p.ppm.toFixed(2)),
            }),
          ),
          excessNow,
          max24h: ex.length ? Math.max(...ex.map((p) => p.ppm)) : null,
          pRise: latestP.get(String(n.id)) ?? null,
          status: quiet
            ? "quiet"
            : open.has("threshold") || open.has("lel")
              ? "rise"
              : open.has("forecast_rise")
                ? "warning"
                : "normal",
        };
      });
      return { slug: String(site.slug), name: String(site.name), nodes: views };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  return {
    sites,
    alerts,
    record: trackRecord(alerts),
    levels: levels satisfies Levels,
    model: {
      version: MODEL.version,
      threshold: MODEL.threshold,
      horizonH: MODEL.horizon_h,
      trainedOn: MODEL.trained_on,
      metrics: MODEL.metrics,
      weights: MODEL.layers.reduce(
        (n, l) => n + l.W.length * l.W[0].length + l.b.length,
        0,
      ),
    },
  };
}

export type SensorNetworkView = Awaited<ReturnType<typeof getSensorNetwork>>;
