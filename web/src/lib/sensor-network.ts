import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import modelJson from "./sensor-model.json";
import {
  DEFAULT_CALIBRATION,
  SIM,
  bearingDeg,
  excessSeries,
  features,
  ppmFromRs,
  predictRise,
  simulateReading,
  weatherFromOpenMeteo,
  type Calibration,
  type SensorModel,
  type SimNode,
  type Weather,
} from "./sensors";

export const MODEL = modelJson as unknown as SensorModel;

const STEP_MS = SIM.stepMin * 60_000;
const H = 3_600_000;
/** A simulated node with no readings is backfilled this far, so charts and forecasts start full. */
const BACKFILL_MS = 2 * 86_400_000;
/** Simulated readings and all forecasts older than this are trimmed. */
const KEEP_SIMULATED_MS = 30 * 86_400_000;

export type NetworkNode = {
  id: string;
  code: string;
  role: SimNode["role"];
  mode: "simulated" | "live";
  lat: number;
  lon: number;
  calibration: Calibration;
  interval_s: number;
  created_at: string;
  last_seen: string | null;
  site: {
    id: string;
    slug: string;
    name: string;
    state: string;
    lat: number;
    lon: number;
  };
};

export type Levels = {
  risePpm: number;
  alertP: number;
  lelPpm: number;
  offlineMin: number;
};

export async function loadLevels(s: SupabaseClient): Promise<Levels> {
  const { data } = await s
    .from("settings")
    .select("key,value")
    .in("key", [
      "sensor_rise_ppm",
      "sensor_alert_p",
      "sensor_lel_ppm",
      "sensor_offline_min",
    ]);
  const v = Object.fromEntries(
    (data ?? []).map((r) => [r.key, Number(r.value)]),
  );
  const num = (k: string, d: number) => (Number.isFinite(v[k]) ? v[k] : d);
  return {
    risePpm: num("sensor_rise_ppm", 25),
    alertP: num("sensor_alert_p", MODEL.threshold),
    lelPpm: num("sensor_lel_ppm", 5000),
    offlineMin: num("sensor_offline_min", 60),
  };
}

export async function loadNodes(s: SupabaseClient): Promise<NetworkNode[]> {
  const [{ data: nodes, error }, { data: sites }] = await Promise.all([
    s
      .from("sensor_nodes")
      .select(
        "id,site_id,code,role,mode,lat,lon,calibration,interval_s,created_at,last_seen",
      )
      .eq("active", true),
    s.from("site_locations").select("id,slug,name,state,lat,lon"),
  ]);
  if (error) throw new Error(`sensor_nodes: ${error.message}`);
  const bySite = new Map((sites ?? []).map((x) => [x.id as string, x]));
  return (nodes ?? [])
    .filter((n) => bySite.has(n.site_id))
    .map((n) => {
      const site = bySite.get(n.site_id)!;
      return {
        id: n.id,
        code: n.code,
        role: n.role,
        mode: n.mode,
        lat: Number(n.lat),
        lon: Number(n.lon),
        calibration: { ...DEFAULT_CALIBRATION, ...(n.calibration ?? {}) },
        interval_s: n.interval_s,
        created_at: n.created_at,
        last_seen: n.last_seen,
        site: {
          id: site.id,
          slug: site.slug,
          name: site.name,
          state: site.state,
          lat: Number(site.lat),
          lon: Number(site.lon),
        },
      };
    });
}

/** Hourly weather around a point: `pastDays` back and 1 day of forecast (Open-Meteo, no key). */
export async function fetchWeather(
  lat: number,
  lon: number,
  pastDays: number,
): Promise<Weather[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}` +
    `&past_days=${pastDays}&forecast_days=1&timezone=UTC&wind_speed_unit=ms` +
    "&hourly=surface_pressure,wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m";
  let last: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(url, {
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
      const w = weatherFromOpenMeteo(await res.json());
      if (w.length < 24) throw new Error("Open-Meteo returned too little data");
      return w;
    } catch (e) {
      last = e;
    }
  }
  throw last;
}

type Row = Record<string, unknown>;

/** Readings in [from, to] for some nodes, as {node -> [{at, ppm}]} sorted by time. */
async function readingsFor(
  s: SupabaseClient,
  ids: string[],
  from: number,
  to: number,
) {
  const out = new Map<string, { at: number; ppm: number }[]>();
  ids.forEach((id) => out.set(id, []));
  for (let page = 0; page < 20; page++) {
    const { data, error } = await s
      .from("sensor_readings")
      .select("node_id,at,ch4_ppm")
      .in("node_id", ids)
      .gte("at", new Date(from).toISOString())
      .lte("at", new Date(to).toISOString())
      .order("at", { ascending: true })
      .range(page * 1000, page * 1000 + 999);
    if (error) throw new Error(`sensor_readings: ${error.message}`);
    (data as Row[]).forEach((r) => {
      if (r.ch4_ppm !== null)
        out
          .get(String(r.node_id))!
          .push({ at: Date.parse(String(r.at)), ppm: Number(r.ch4_ppm) });
    });
    if ((data ?? []).length < 1000) break;
  }
  return out;
}

/** Simulate the readings each simulated node has not produced yet, up to `now`. Returns the count. */
async function simulate(
  s: SupabaseClient,
  nodes: NetworkNode[],
  weather: Weather[],
  now: number,
): Promise<number> {
  const end = Math.floor(now / STEP_MS) * STEP_MS;
  let written = 0;
  for (const node of nodes.filter((n) => n.mode === "simulated")) {
    const { data: last } = await s
      .from("sensor_readings")
      .select("at")
      .eq("node_id", node.id)
      .order("at", { ascending: false })
      .limit(1)
      .maybeSingle();
    // Never before the weather window: a gap longer than it is left as a gap, not filled with stale weather.
    const from = Math.max(
      last ? Date.parse(last.at) + STEP_MS : end - BACKFILL_MS,
      weather[0].t + 3 * H,
    );
    const installed = Date.parse(node.created_at);
    const rows: Row[] = [];
    for (let t = from; t <= end; t += STEP_MS) {
      const r = simulateReading(node, node.site, weather, t, installed);
      rows.push({
        node_id: node.id,
        at: new Date(t).toISOString(),
        ch4_ppm: Number(r.ch4_ppm.toFixed(3)),
        rs_ratio: Number(r.rs_ratio.toFixed(5)),
        temp_c: Number(r.temp_c.toFixed(2)),
        rh_pct: Number(r.rh_pct.toFixed(1)),
        pressure_hpa: Number(r.pressure_hpa.toFixed(2)),
        battery_v: Number(r.battery_v.toFixed(3)),
      });
    }
    for (let i = 0; i < rows.length; i += 1000) {
      const { error } = await s
        .from("sensor_readings")
        .upsert(rows.slice(i, i + 1000), {
          onConflict: "node_id,at",
          ignoreDuplicates: true,
        });
      if (error) throw new Error(`simulate ${node.code}: ${error.message}`);
    }
    if (rows.length) {
      const lastRow = rows[rows.length - 1];
      await s
        .from("sensor_nodes")
        .update({ last_seen: lastRow.at, battery_v: lastRow.battery_v })
        .eq("id", node.id);
    }
    written += rows.length;
  }
  return written;
}

export type NodeOutcome = {
  code: string;
  pRise: number | null;
  excessNow: number | null;
  opened: string[];
  closed: string[];
};

type OpenAlert = {
  id: string;
  kind: string;
  opened_at: string;
  detail: Row;
  peak_ppm: number | null;
};

/** Forecast every node of one site and open or close its alerts. */
async function forecastSite(
  s: SupabaseClient,
  nodes: NetworkNode[],
  weather: Weather[],
  levels: Levels,
  now: number,
): Promise<NodeOutcome[]> {
  const ids = nodes.map((n) => n.id);
  const readings = await readingsFor(s, ids, now - 4 * H, now);
  const background = nodes.find((n) => n.role === "background");
  const bg = background ? readings.get(background.id)! : [];
  const { data: openRows } = await s
    .from("sensor_alerts")
    .select("id,node_id,kind,opened_at,detail,peak_ppm")
    .in("node_id", ids)
    .is("closed_at", null);
  const open = (nodeId: string, kind: string) =>
    (openRows ?? []).find((a) => a.node_id === nodeId && a.kind === kind) as
      OpenAlert | undefined;
  const outcomes: NodeOutcome[] = [];

  for (const node of nodes) {
    const pts = readings.get(node.id)!;
    const out: NodeOutcome = {
      code: node.code,
      pRise: null,
      excessNow: null,
      opened: [],
      closed: [],
    };
    outcomes.push(out);
    const close = async (a: OpenAlert, at: number, detail: Row = {}) => {
      await s
        .from("sensor_alerts")
        .update({
          closed_at: new Date(at).toISOString(),
          detail: { ...a.detail, ...detail },
        })
        .eq("id", a.id);
      out.closed.push(a.kind);
    };
    const openAlert = async (kind: string, at: number, extra: Row) => {
      const { error } = await s.from("sensor_alerts").insert({
        node_id: node.id,
        kind,
        opened_at: new Date(at).toISOString(),
        ...extra,
      });
      if (!error) out.opened.push(kind);
    };

    // Offline (live nodes only; simulated ones never go quiet).
    if (node.mode === "live") {
      const seen = node.last_seen ? Date.parse(node.last_seen) : 0;
      const quiet = now - seen > levels.offlineMin * 60_000;
      const off = open(node.id, "offline");
      if (quiet && !off)
        await openAlert("offline", now, {
          detail: { last_seen: node.last_seen },
        });
      if (!quiet && off) await close(off, now);
    }
    if (!pts.length) continue;
    const latest = pts[pts.length - 1];
    if (now - latest.at > 45 * 60_000) continue; // too stale to forecast from

    // Explosion safety: any reading at 10% of the lower explosive limit.
    const lel = open(node.id, "lel");
    if (latest.ppm >= levels.lelPpm && !lel)
      await openAlert("lel", latest.at, { peak_ppm: latest.ppm });
    if (latest.ppm < levels.lelPpm * 0.8 && lel) await close(lel, latest.at);

    if (node.role === "background") continue;
    const excess = excessSeries(pts, bg);
    const x = features(
      latest.at,
      excess,
      weather,
      bearingDeg(node.site.lat, node.site.lon, node.lat, node.lon),
    );
    if (!x) continue;
    const p = predictRise(MODEL, x);
    out.pRise = p;
    out.excessNow = x[0];
    await s.from("sensor_forecasts").upsert(
      {
        node_id: node.id,
        issued_at: new Date(latest.at).toISOString(),
        horizon_h: MODEL.horizon_h,
        p_rise: Number(p.toFixed(4)),
        excess_now: Number(x[0].toFixed(3)),
        model_version: MODEL.version,
      },
      { onConflict: "node_id,issued_at,horizon_h" },
    );

    const warn = open(node.id, "forecast_rise");
    const rise = open(node.id, "threshold");
    if (x[0] >= levels.risePpm) {
      if (!rise) {
        // A rise: credit the early warning that preceded it, if any.
        const leadMin = warn
          ? (latest.at - Date.parse(warn.opened_at)) / 60_000
          : null;
        await openAlert("threshold", latest.at, {
          peak_ppm: Number(x[0].toFixed(2)),
          lead_min: leadMin === null ? null : Math.round(leadMin),
          detail: { warned: Boolean(warn) },
        });
        if (warn)
          await close(warn, latest.at, {
            outcome: "rise",
            lead_min: Math.round(leadMin!),
          });
      } else if (x[0] > (rise.peak_ppm ?? 0)) {
        await s
          .from("sensor_alerts")
          .update({ peak_ppm: Number(x[0].toFixed(2)) })
          .eq("id", rise.id);
      }
    } else {
      if (rise && x[0] < levels.risePpm * 0.8) await close(rise, latest.at);
      if (!warn && !rise && p >= levels.alertP)
        await openAlert("forecast_rise", latest.at, {
          p_rise: Number(p.toFixed(3)),
          detail: Object.fromEntries(
            MODEL.features.map((f, i) => [f, Number(x[i].toFixed(3))]),
          ),
        });
      // A warning that saw no rise within the horizon is closed as a false alarm.
      if (warn && latest.at - Date.parse(warn.opened_at) > MODEL.horizon_h * H)
        await close(warn, latest.at, { outcome: "no_rise" });
    }
  }
  return outcomes;
}

/**
 * One run of the network: simulate, forecast, alert, trim. `replayHours` (first run only) walks the
 * alert logic through the backfilled window every 30 minutes, as if the cron had been running, so a
 * new network starts with a track record; sites that already have alerts are not replayed.
 */
export async function runNetwork(
  s: SupabaseClient,
  now = Date.now(),
  replayHours = 0,
) {
  const [nodes, levels] = await Promise.all([loadNodes(s), loadLevels(s)]);
  const bySite = new Map<string, NetworkNode[]>();
  nodes.forEach((n) =>
    bySite.set(n.site.id, [...(bySite.get(n.site.id) ?? []), n]),
  );
  const sites: Record<string, unknown>[] = [];
  let simulated = 0;
  for (const group of bySite.values()) {
    const site = group[0].site;
    try {
      const weather = await fetchWeather(site.lat, site.lon, 3);
      simulated += await simulate(s, group, weather, now);
      let replayed = 0;
      if (replayHours > 0) {
        const { count } = await s
          .from("sensor_alerts")
          .select("id", { count: "exact", head: true })
          .in(
            "node_id",
            group.map((n) => n.id),
          );
        if (!count) {
          const step = 30 * 60_000;
          for (
            let t = Math.ceil((now - replayHours * H) / step) * step;
            t < now;
            t += step
          ) {
            await forecastSite(s, group, weather, levels, t);
            replayed++;
          }
        }
      }
      const outcomes = await forecastSite(s, group, weather, levels, now);
      sites.push({ site: site.slug, replayed, nodes: outcomes });
    } catch (e) {
      sites.push({ site: site.slug, error: (e as Error).message });
    }
  }
  const cutoff = new Date(now - KEEP_SIMULATED_MS).toISOString();
  const simIds = nodes.filter((n) => n.mode === "simulated").map((n) => n.id);
  if (simIds.length)
    await s
      .from("sensor_readings")
      .delete()
      .in("node_id", simIds)
      .lt("at", cutoff);
  await s.from("sensor_forecasts").delete().lt("issued_at", cutoff);
  return {
    nodes: nodes.length,
    simulated,
    model: MODEL.version,
    levels,
    sites,
  };
}

/** Readings from a live node: Rs/R0 (plus temperature and humidity) or ready-made ppm. */
export function toReadingRow(
  node: { id: string; calibration: Calibration },
  r: Record<string, unknown>,
): Row | string {
  const at = typeof r.at === "string" ? Date.parse(r.at) : NaN;
  if (
    !Number.isFinite(at) ||
    at > Date.now() + 5 * 60_000 ||
    at < Date.now() - 30 * 86_400_000
  )
    return "at: ISO time within the last 30 days";
  const num = (k: string) =>
    r[k] === undefined || r[k] === null ? null : Number(r[k]);
  const rs = num("rs_ratio");
  const t = num("temp_c");
  const rh = num("rh_pct");
  let ppm = num("ch4_ppm");
  if (ppm === null && rs !== null && t !== null && rh !== null)
    ppm = ppmFromRs(rs, rh, t, node.calibration);
  if (ppm === null || !Number.isFinite(ppm) || ppm < 0)
    return "send ch4_ppm, or rs_ratio with temp_c and rh_pct";
  return {
    node_id: node.id,
    at: new Date(Math.floor(at / 1000) * 1000).toISOString(),
    ch4_ppm: Number(ppm.toFixed(3)),
    rs_ratio: rs,
    temp_c: t,
    rh_pct: rh,
    pressure_hpa: num("pressure_hpa"),
    battery_v: num("battery_v"),
  };
}
