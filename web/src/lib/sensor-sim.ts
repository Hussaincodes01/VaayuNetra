// Interactive sensor-network simulator for the public /simulator page. It runs the same physics,
// sensor response, forecast features and early-warning model as the deployed network (./sensors.ts),
// but with weather the viewer sets; the forecast assumes that weather carries on for 3 hours. The
// alert rules mirror runNetwork in ./sensor-network.ts. No framework imports, so unit tests run it.
import {
  SIM,
  bearingDeg,
  excessSeries,
  features,
  isNight,
  offsetM,
  plumeExcessPpm,
  predictRise,
  pumping,
  simulateReading,
  simulatedLayout,
  weatherAt,
  type SensorModel,
  type SimNode,
  type Weather,
} from "./sensors.ts";

const H = 3_600_000;
const STEP = SIM.stepMin * 60_000;
const RAD = Math.PI / 180;

/** Hours of readings kept and charted. */
export const HISTORY_H = 6;
/** The database default for sensor_rise_ppm: a rise is a 30-minute mean this far above background. */
export const RISE_PPM = 25;
/** Extra emission while a crack in the cover is open (simulation input). */
export const LEAK_KGPH = 1500;
export const LEAK_MIN = 60;
const START_HPA = 1008;

/** The five monitored landfills (supabase/seed.ts); the simulator only uses their positions. */
export const SIM_SITES = [
  { slug: "ghazipur", name: "Ghazipur", lat: 28.6247, lon: 77.3272 },
  { slug: "bhalswa", name: "Bhalswa", lat: 28.7406, lon: 77.1582 },
  { slug: "okhla", name: "Okhla", lat: 28.5125, lon: 77.2835 },
  { slug: "deonar", name: "Deonar", lat: 19.0717, lon: 72.9278 },
  { slug: "pirana", name: "Pirana", lat: 22.9762, lon: 72.5656 },
] as const;
export type SimSite = (typeof SIM_SITES)[number];

export type Controls = {
  windFromDeg: number;
  windMs: number;
  /** Pressure change over 3 hours, hPa; negative is falling. */
  trendHpa3h: number;
  /** Emission at steady pressure, kg/h. */
  sourceKgph: number;
  rhPct: number;
  tempC: number;
};

type SimWeather = Weather & { kgph: number };

export type TrackPoint = {
  at: number;
  /** 30-minute mean above background (ppm); for the background node, its own level. */
  ppm: number;
  /** Chance of a rise within 3 hours; null for the background node. */
  p: number | null;
};

export type NodeSim = {
  code: string;
  role: SimNode["role"];
  /** Metres east and north of the landfill centre. */
  x: number;
  y: number;
  points: { at: number; ppm: number }[];
  track: TrackPoint[];
  features: number[] | null;
  warnAt: number | null;
  warnP: number | null;
  riseAt: number | null;
};

export type SimEvent =
  | { at: number; kind: "warning"; code: string; p: number }
  | {
      at: number;
      kind: "rise";
      code: string;
      ppm: number;
      leadMin: number | null;
    }
  | { at: number; kind: "noRise"; code: string }
  | { at: number; kind: "clear"; code: string }
  | { at: number; kind: "leak" };

export type Sim = {
  site: SimSite;
  t: number;
  pressure: number;
  weather: SimWeather[];
  nodes: NodeSim[];
  events: SimEvent[];
  leakUntil: number;
  installedAt: number;
  tally: {
    warnings: number;
    rises: number;
    warned: number;
    leads: number[];
    noRise: number;
  };
};

const latLon = (site: SimSite, x: number, y: number) => ({
  lat: site.lat + y / 110_574,
  lon: site.lon + x / (111_320 * Math.cos(site.lat * RAD)),
});

const sample = (
  t: number,
  pressureHpa: number,
  c: Controls,
  kgph: number,
): SimWeather => ({
  t,
  pressureHpa,
  windMs: c.windMs,
  windFromDeg: c.windFromDeg,
  tempC: c.tempC,
  rhPct: c.rhPct,
  kgph,
});

const kgphAt = (sim: Sim, c: Controls, t: number) =>
  c.sourceKgph + (t < sim.leakUntil ? LEAK_KGPH : 0);

function reading(sim: Sim, n: NodeSim, w: SimWeather): number {
  const node = { code: n.code, role: n.role, ...latLon(sim.site, n.x, n.y) };
  return simulateReading(
    node,
    sim.site,
    sim.weather,
    w.t,
    sim.installedAt,
    w.kgph,
  ).ch4_ppm;
}

/** History plus the next 4 hours, assuming the viewer's weather carries on. */
function withForecast(sim: Sim, c: Controls): Weather[] {
  const ahead = [1, 2, 3, 4].map((h) =>
    sample(sim.t + h * H, sim.pressure + (c.trendHpa3h / 3) * h, c, 0),
  );
  return [...sim.weather, ...ahead];
}

function forecast(
  sim: Sim,
  n: NodeSim,
  t: number,
  series: Weather[],
  model: SensorModel,
) {
  const bg = sim.nodes.find((m) => m.role === "background")!;
  const ll = latLon(sim.site, n.x, n.y);
  const x = features(
    t,
    excessSeries(n.points, bg.points),
    series,
    bearingDeg(sim.site.lat, sim.site.lon, ll.lat, ll.lon),
  );
  return x ? { x, p: predictRise(model, x) } : null;
}

function setTrack(n: NodeSim, pt: TrackPoint) {
  const last = n.track[n.track.length - 1];
  if (last && last.at === pt.at) n.track[n.track.length - 1] = pt;
  else n.track.push(pt);
}

/** Readings and forecasts for one node over the whole kept history (used on start and after a move). */
function rebuildNode(sim: Sim, n: NodeSim) {
  const from = sim.t - HISTORY_H * H;
  n.points = sim.weather
    .filter((w) => w.t >= from)
    .map((w) => ({ at: w.t, ppm: reading(sim, n, w) }));
  if (n.role === "background") {
    n.track = n.points.map((p) => ({ at: p.at, ppm: p.ppm, p: null }));
  }
}

function rebuildTracks(
  sim: Sim,
  c: Controls,
  model: SensorModel,
  only?: NodeSim,
) {
  const series = withForecast(sim, c);
  for (const n of sim.nodes) {
    if (n.role === "background" || (only && n !== only)) continue;
    n.track = [];
    for (const pt of n.points) {
      const r = forecast(sim, n, pt.at, series, model);
      if (r) n.track.push({ at: pt.at, ppm: r.x[0], p: r.p });
    }
    n.features = n.track.length
      ? (forecast(sim, n, sim.t, series, model)?.x ?? null)
      : null;
  }
}

/** A new run: a landfill with five nodes laid out for the current wind, and 6 hours of history. */
export function createSim(
  c: Controls,
  t0: number,
  model: SensorModel,
  site: SimSite = SIM_SITES[3],
): Sim {
  const start = Math.floor(t0 / STEP) * STEP;
  const lead = HISTORY_H + 3; // simulateReading looks 2 hours back for the pressure tendency
  const sim: Sim = {
    site,
    t: start,
    pressure: START_HPA,
    weather: [],
    nodes: [],
    events: [],
    leakUntil: 0,
    installedAt: start - 30 * 24 * H,
    tally: { warnings: 0, rises: 0, warned: 0, leads: [], noRise: 0 },
  };
  // The past hours were steady; the viewer's weather applies from now on, which the forecast sees.
  for (let t = start - lead * H; t <= start; t += STEP) {
    sim.weather.push(sample(t, START_HPA, c, c.sourceKgph));
  }
  sim.nodes = simulatedLayout({ code: "SIM", ...site }, c.windFromDeg).map(
    (n) => {
      const { x, y } = offsetM(site.lat, site.lon, n.lat, n.lon);
      return {
        code: n.code.replace("SIM-", ""),
        role: n.role,
        x,
        y,
        points: [],
        track: [],
        features: null,
        warnAt: null,
        warnP: null,
        riseAt: null,
      };
    },
  );
  for (const n of sim.nodes) rebuildNode(sim, n);
  rebuildTracks(sim, c, model);
  // A node already above the rise level at the start is treated as an ongoing rise, not a new one.
  for (const n of sim.nodes) {
    const last = n.track[n.track.length - 1];
    if (n.role !== "background" && last && last.ppm >= RISE_PPM)
      n.riseAt = sim.t;
  }
  return sim;
}

/**
 * Forecast every node at the current time and apply the network's alert rules: an early warning
 * when the chance reaches the model threshold, a rise when the 30-minute mean excess reaches
 * RISE_PPM (credited with the warning's lead time), a warning closed as "no rise" after 3 hours.
 */
export function evaluate(sim: Sim, c: Controls, model: SensorModel) {
  const now = sim.weather[sim.weather.length - 1];
  // The viewer's latest settings are the weather now.
  Object.assign(now, {
    windMs: c.windMs,
    windFromDeg: c.windFromDeg,
    rhPct: c.rhPct,
    tempC: c.tempC,
  });
  const series = withForecast(sim, c);
  for (const n of sim.nodes) {
    if (n.role === "background") continue;
    const r = forecast(sim, n, sim.t, series, model);
    n.features = r?.x ?? null;
    if (!r) continue;
    const ppm = r.x[0];
    setTrack(n, { at: sim.t, ppm, p: r.p });
    if (ppm >= RISE_PPM) {
      if (n.riseAt === null) {
        const leadMin = n.warnAt === null ? null : (sim.t - n.warnAt) / 60_000;
        n.riseAt = sim.t;
        sim.tally.rises++;
        if (leadMin !== null) {
          sim.tally.warned++;
          sim.tally.leads.push(leadMin);
        }
        sim.events.push({
          at: sim.t,
          kind: "rise",
          code: n.code,
          ppm,
          leadMin,
        });
        n.warnAt = null;
        n.warnP = null;
      }
    } else {
      if (n.riseAt !== null && ppm < RISE_PPM * 0.8) {
        n.riseAt = null;
        sim.events.push({ at: sim.t, kind: "clear", code: n.code });
      }
      if (n.warnAt === null && n.riseAt === null && r.p >= model.threshold) {
        n.warnAt = sim.t;
        n.warnP = r.p;
        sim.tally.warnings++;
        sim.events.push({ at: sim.t, kind: "warning", code: n.code, p: r.p });
      }
      if (n.warnAt !== null && sim.t - n.warnAt > model.horizon_h * H) {
        n.warnAt = null;
        n.warnP = null;
        sim.tally.noRise++;
        sim.events.push({ at: sim.t, kind: "noRise", code: n.code });
      }
    }
  }
  if (sim.events.length > 200) sim.events.splice(0, sim.events.length - 200);
}

/** Advance 10 minutes: new weather from the controls, a reading from every node, then evaluate. */
export function step(sim: Sim, c: Controls, model: SensorModel) {
  sim.t += STEP;
  sim.pressure += (c.trendHpa3h * STEP) / (3 * H);
  sim.weather.push(sample(sim.t, sim.pressure, c, kgphAt(sim, c, sim.t)));
  const keepFrom = sim.t - (HISTORY_H + 3) * H;
  while (sim.weather.length && sim.weather[0].t < keepFrom) sim.weather.shift();
  const w = sim.weather[sim.weather.length - 1];
  const from = sim.t - HISTORY_H * H;
  for (const n of sim.nodes) {
    n.points.push({ at: sim.t, ppm: reading(sim, n, w) });
    while (n.points.length && n.points[0].at < from) n.points.shift();
    while (n.track.length && n.track[0].at < from) n.track.shift();
    if (n.role === "background")
      n.track.push({
        at: sim.t,
        ppm: n.points[n.points.length - 1].ppm,
        p: null,
      });
  }
  evaluate(sim, c, model);
}

/** Open a crack in the landfill cover for LEAK_MIN minutes. */
export function startLeak(sim: Sim) {
  sim.leakUntil = sim.t + LEAK_MIN * 60_000;
  sim.events.push({ at: sim.t, kind: "leak" });
}

/**
 * Move a node. Its history is re-simulated at the new spot, as if it had always been there, and its
 * alert state restarts quietly (a node moved into the plume is not a new rise).
 */
export function moveNode(
  sim: Sim,
  code: string,
  x: number,
  y: number,
  c: Controls,
  model: SensorModel,
) {
  const n = sim.nodes.find((m) => m.code === code);
  if (!n || n.role === "background") return;
  n.x = x;
  n.y = y;
  rebuildNode(sim, n);
  rebuildTracks(sim, c, model, n);
  const last = n.track[n.track.length - 1];
  n.warnAt = null;
  n.warnP = null;
  n.riseAt = last && last.ppm >= RISE_PPM ? sim.t : null;
}

/** Emission now (kg/h): the source, plus any leak, times the pressure pumping factor. */
export function emissionNow(sim: Sim): number {
  const w = sim.weather[sim.weather.length - 1];
  const dpdt =
    (w.pressureHpa - weatherAt(sim.weather, sim.t - 2 * H).pressureHpa) / 2;
  return w.kgph * pumping(dpdt);
}

/** Methane above background (ppm) on an n x n grid spanning +-halfM metres (row 0 = north). */
export function plumeGrid(sim: Sim, n: number, halfM: number): Float32Array {
  const w = sim.weather[sim.weather.length - 1];
  const q = emissionNow(sim);
  const night = isNight(sim.t);
  const out = new Float32Array(n * n);
  const cell = (2 * halfM) / n;
  for (let r = 0; r < n; r++) {
    const y = halfM - (r + 0.5) * cell;
    for (let k = 0; k < n; k++) {
      const x = -halfM + (k + 0.5) * cell;
      out[r * n + k] = plumeExcessPpm(q, x, y, w.windMs, w.windFromDeg, night);
    }
  }
  return out;
}

/** Input groups for "what moved the forecast". */
export const FEATURE_GROUPS = [
  { key: "methane", idx: [0, 1, 2, 3] },
  { key: "pressurePast", idx: [4] },
  { key: "pressureNext", idx: [5] },
  { key: "windToward", idx: [6, 7] },
  { key: "windSpeed", idx: [8, 9] },
  { key: "night", idx: [10] },
  { key: "hour", idx: [11, 12] },
  { key: "humidity", idx: [13] },
] as const;
export type FeatureGroup = (typeof FEATURE_GROUPS)[number]["key"];

/**
 * How much each input group moves the chance: the change when that group is set to its typical
 * (training mean) value, all else equal. A simple occlusion test, not an exact attribution.
 */
export function explain(model: SensorModel, x: number[]) {
  const p = predictRise(model, x);
  return FEATURE_GROUPS.map((g) => {
    const y = [...x];
    for (const i of g.idx) y[i] = model.mean[i];
    return { key: g.key as FeatureGroup, delta: p - predictRise(model, y) };
  });
}

/** Median of a list, or null. */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Epoch ms for today's date (IST) at an IST hour. */
export function istToday(now: number, hour: number): number {
  const ist = 5.5 * H;
  const dayStart = Math.floor((now + ist) / (24 * H)) * 24 * H - ist;
  return dayStart + hour * H;
}
