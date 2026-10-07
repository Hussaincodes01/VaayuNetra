// Ground sensor network: simulator, calibration, forecast features and model inference.
// One implementation serves the live sensors cron, the training-data export (scripts/
// sensor-training-data.mjs) and the unit tests, so the model is trained on exactly the features it
// sees in production. No imports, so Node's test runner loads this file directly.
//
// The simulator stands in for hardware until real nodes report. It is physics-shaped, not measured:
//   emission   Q(t) = Q0 x pumping(dP/dt): falling barometric pressure pushes landfill gas out and
//              rising pressure suppresses it (Kissas 2022, DTU; Xu et al. 2014)
//   transport  Gaussian plume from a source of radius R, Briggs rural sigmas: class C by day, E at night
//   sensor     metal-oxide Rs/R0 = (C/ref)^-beta x (1 + rh_coef(RH-65) + t_coef(T-20)) x drift x noise,
//              the humidity and temperature cross-sensitivity low-cost sensors show (Furuta et al. 2024)

export type Weather = {
  t: number; // epoch ms (UTC)
  pressureHpa: number;
  windMs: number;
  windFromDeg: number;
  tempC: number;
  rhPct: number;
};

export type Calibration = {
  ref_ppm: number;
  beta: number;
  rh_coef: number;
  t_coef: number;
};

export const DEFAULT_CALIBRATION: Calibration = {
  ref_ppm: 100,
  beta: 0.6,
  rh_coef: -0.004,
  t_coef: -0.006,
};

export const SIM = {
  stepMin: 10,
  backgroundPpm: 2.0,
  /** Simulation input, not a measurement: a landfill emitting this much at average pressure. */
  sourceKgph: 250,
  sourceRadiusM: 250,
  pumpingK: 2.5,
  rsNoise: 0.05,
};

const RAD = Math.PI / 180;
const IST_MS = 5.5 * 3_600_000;

// --- deterministic noise: re-running a simulated step gives the same reading ---------------------

function hash32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Standard normal from a string seed (Box-Muller on two hashed uniforms). */
export function gaussian(seed: string): number {
  const u1 = (hash32(`${seed}|a`) + 1) / 4294967297;
  const u2 = (hash32(`${seed}|b`) + 1) / 4294967297;
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// --- weather -------------------------------------------------------------------------------------

/** Weather at time t, linear between hourly samples (wind as a vector); clamped at the ends. */
export function weatherAt(series: Weather[], t: number): Weather {
  if (!series.length) throw new Error("no weather");
  if (t <= series[0].t) return series[0];
  const last = series[series.length - 1];
  if (t >= last.t) return last;
  let lo = 0;
  let hi = series.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (series[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = series[lo];
  const b = series[hi];
  const f = (t - a.t) / (b.t - a.t);
  const mix = (x: number, y: number) => x + (y - x) * f;
  // Wind "from" direction -> vector, interpolate, back to degrees.
  const ua = -a.windMs * Math.sin(a.windFromDeg * RAD);
  const va = -a.windMs * Math.cos(a.windFromDeg * RAD);
  const ub = -b.windMs * Math.sin(b.windFromDeg * RAD);
  const vb = -b.windMs * Math.cos(b.windFromDeg * RAD);
  const u = mix(ua, ub);
  const v = mix(va, vb);
  return {
    t,
    pressureHpa: mix(a.pressureHpa, b.pressureHpa),
    windMs: Math.hypot(u, v),
    windFromDeg: (Math.atan2(-u, -v) / RAD + 360) % 360,
    tempC: mix(a.tempC, b.tempC),
    rhPct: mix(a.rhPct, b.rhPct),
  };
}

/** Open-Meteo hourly response -> Weather[] (request wind_speed_unit=ms, timezone=UTC). */
export function weatherFromOpenMeteo(json: {
  hourly?: Record<string, (number | null)[] | string[]>;
}): Weather[] {
  const h = json.hourly ?? {};
  const time = (h.time ?? []) as string[];
  const out: Weather[] = [];
  time.forEach((iso, i) => {
    const get = (k: string) => (h[k] as (number | null)[] | undefined)?.[i];
    const p = get("surface_pressure");
    const w = get("wind_speed_10m");
    const d = get("wind_direction_10m");
    const tc = get("temperature_2m");
    const rh = get("relative_humidity_2m");
    if ([p, w, d, tc, rh].some((v) => v === null || v === undefined)) return;
    out.push({
      t: Date.parse(`${iso}:00Z`),
      pressureHpa: p!,
      windMs: w!,
      windFromDeg: d!,
      tempC: tc!,
      rhPct: rh!,
    });
  });
  return out;
}

// --- geometry ------------------------------------------------------------------------------------

/** East / north offset in metres of (lat, lon) from (lat0, lon0). */
export function offsetM(lat0: number, lon0: number, lat: number, lon: number) {
  return {
    x: (lon - lon0) * 111_320 * Math.cos(lat0 * RAD),
    y: (lat - lat0) * 110_574,
  };
}

/** Bearing in degrees (0 = north, clockwise) from the first point to the second. */
export function bearingDeg(
  lat0: number,
  lon0: number,
  lat: number,
  lon: number,
): number {
  const { x, y } = offsetM(lat0, lon0, lat, lon);
  return (Math.atan2(x, y) / RAD + 360) % 360;
}

export function destination(
  lat: number,
  lon: number,
  bearing: number,
  distM: number,
) {
  return {
    lat: lat + (distM * Math.cos(bearing * RAD)) / 110_574,
    lon:
      lon + (distM * Math.sin(bearing * RAD)) / (111_320 * Math.cos(lat * RAD)),
  };
}

/** Local (IST) hour of day, fractional. */
export const istHour = (t: number) =>
  ((((t + IST_MS) / 3_600_000) % 24) + 24) % 24;
const isNight = (t: number) => {
  const h = istHour(t);
  return h < 6 || h >= 19;
};

// --- physics -------------------------------------------------------------------------------------

/** Emission multiplier from the pressure tendency (hPa/h): falling pressure raises it. */
export function pumping(dpdtHpaPerH: number): number {
  return Math.min(25, Math.max(0.03, Math.exp(-SIM.pumpingK * dpdtHpaPerH)));
}

/** Ground-level methane above background (ppm) at offset (x, y) m from the source centre. */
export function plumeExcessPpm(
  qKgph: number,
  x: number,
  y: number,
  windMs: number,
  windFromDeg: number,
  night: boolean,
): number {
  const to = (windFromDeg + 180) * RAD;
  const down = x * Math.sin(to) + y * Math.cos(to);
  const cross = x * Math.cos(to) - y * Math.sin(to);
  const d = Math.max(down, 0) + SIM.sourceRadiusM;
  const upwindFade = down < 0 ? Math.exp(down / 60) : 1;
  const sy = night
    ? 0.06 * d * (1 + 0.0001 * d) ** -0.5
    : 0.11 * d * (1 + 0.0001 * d) ** -0.5;
  const sz = night
    ? (0.03 * d) / (1 + 0.0003 * d)
    : 0.08 * d * (1 + 0.0002 * d) ** -0.5;
  const u = Math.max(0.7, windMs);
  const kgPerM3 =
    (qKgph / 3600 / (Math.PI * u * sy * sz)) *
    Math.exp(-(cross * cross) / (2 * sy * sy));
  return kgPerM3 * 1e6 * (24.45 / 16.04) * upwindFade; // mg/m3 -> ppm at 25 C
}

const humidityFactor = (cal: Calibration, rh: number, t: number) =>
  Math.max(0.2, 1 + cal.rh_coef * (rh - 65) + cal.t_coef * (t - 20));

/** Metal-oxide sensor response Rs/R0 for a true concentration. */
export function rsRatio(
  truePpm: number,
  rh: number,
  t: number,
  cal: Calibration,
  drift = 1,
): number {
  return (
    Math.pow(Math.max(truePpm, 0.1) / cal.ref_ppm, -cal.beta) *
    humidityFactor(cal, rh, t) *
    drift
  );
}

/** Calibrated concentration from Rs/R0, correcting for humidity and temperature. */
export function ppmFromRs(
  rs: number,
  rh: number,
  t: number,
  cal: Calibration = DEFAULT_CALIBRATION,
): number {
  return cal.ref_ppm * Math.pow(rs / humidityFactor(cal, rh, t), -1 / cal.beta);
}

// --- simulated nodes -----------------------------------------------------------------------------

export type SimNode = {
  code: string;
  role: "perimeter" | "community" | "background";
  lat: number;
  lon: number;
};

/**
 * Where simulated nodes go: three on the perimeter (about 300 m out), one in the community about
 * 900 m downwind of the prevailing wind, one background node 3 km upwind of it.
 */
export function simulatedLayout(
  site: { code: string; lat: number; lon: number },
  prevailingWindFromDeg: number,
): SimNode[] {
  const downwind = (prevailingWindFromDeg + 180) % 360;
  const at = (b: number, m: number) => destination(site.lat, site.lon, b, m);
  return [
    {
      code: `${site.code}-P1`,
      role: "perimeter",
      ...at((downwind + 0) % 360, 300),
    },
    {
      code: `${site.code}-P2`,
      role: "perimeter",
      ...at((downwind + 120) % 360, 320),
    },
    {
      code: `${site.code}-P3`,
      role: "perimeter",
      ...at((downwind + 240) % 360, 340),
    },
    {
      code: `${site.code}-C1`,
      role: "community",
      ...at((downwind + 15) % 360, 900),
    },
    {
      code: `${site.code}-B1`,
      role: "background",
      ...at(prevailingWindFromDeg, 3000),
    },
  ];
}

/** Mean wind "from" direction (vector average) of a weather series. */
export function prevailingWindFrom(series: Weather[]): number {
  let u = 0;
  let v = 0;
  for (const w of series) {
    u += -w.windMs * Math.sin(w.windFromDeg * RAD);
    v += -w.windMs * Math.cos(w.windFromDeg * RAD);
  }
  return (Math.atan2(-u, -v) / RAD + 360) % 360;
}

/** The sensor each simulated node "really" has: its coefficients differ a little from the calibration. */
function trueSensor(code: string): Calibration {
  return {
    ref_ppm: DEFAULT_CALIBRATION.ref_ppm,
    beta: DEFAULT_CALIBRATION.beta * (1 + 0.05 * gaussian(`${code}|beta`)),
    rh_coef: DEFAULT_CALIBRATION.rh_coef * (1 + 0.25 * gaussian(`${code}|rh`)),
    t_coef: DEFAULT_CALIBRATION.t_coef * (1 + 0.25 * gaussian(`${code}|t`)),
  };
}

export type Reading = {
  at: number;
  ch4_ppm: number;
  rs_ratio: number;
  temp_c: number;
  rh_pct: number;
  pressure_hpa: number;
  battery_v: number;
  /** Simulation only: the concentration the sensor was exposed to. */
  true_ppm: number;
};

/** One simulated reading for a node at time t (deterministic for a given node, site and time). */
export function simulateReading(
  node: SimNode,
  site: { lat: number; lon: number },
  weather: Weather[],
  t: number,
  installedAt: number,
): Reading {
  const w = weatherAt(weather, t);
  const w2h = weatherAt(weather, t - 2 * 3_600_000);
  const dpdt = (w.pressureHpa - w2h.pressureHpa) / 2;
  const { x, y } = offsetM(site.lat, site.lon, node.lat, node.lon);
  const q = SIM.sourceKgph * pumping(dpdt);
  const excess = plumeExcessPpm(q, x, y, w.windMs, w.windFromDeg, isNight(t));
  const truePpm =
    SIM.backgroundPpm + excess + 0.05 * gaussian(`${node.code}|${t}|bg`);
  const days = Math.max(0, (t - installedAt) / 86_400_000);
  const drift = 1 + 0.0004 * days;
  const rs =
    rsRatio(truePpm, w.rhPct, w.tempC, trueSensor(node.code), drift) *
    Math.exp(SIM.rsNoise * gaussian(`${node.code}|${t}|rs`));
  const sunUp = Math.max(0, Math.sin(((istHour(t) - 6) / 12) * Math.PI));
  return {
    at: t,
    ch4_ppm: ppmFromRs(rs, w.rhPct, w.tempC),
    rs_ratio: rs,
    temp_c: w.tempC,
    rh_pct: w.rhPct,
    pressure_hpa: w.pressureHpa,
    battery_v: 3.7 + 0.35 * sunUp + 0.02 * gaussian(`${node.code}|${t}|bat`),
    true_ppm: truePpm,
  };
}

// --- forecast features ---------------------------------------------------------------------------

export const FEATURE_NAMES = [
  "excess_now",
  "excess_prev",
  "excess_trend",
  "excess_max_3h",
  "dp_past_3h",
  "dp_next_3h",
  "align_now",
  "align_next_3h",
  "wind_now",
  "wind_next_3h",
  "night_next_3h",
  "hour_sin",
  "hour_cos",
  "rh_now",
] as const;

export const HORIZON_H = 3;

type Point = { at: number; ppm: number };

/** Index of the first point with at > t (points sorted by time). */
function after(pts: Point[], t: number): number {
  let lo = 0;
  let hi = pts.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].at > t) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Points with from < at <= to (sorted input; binary search, so long series stay fast). */
const between = (pts: Point[], from: number, to: number) =>
  pts.slice(after(pts, from), after(pts, to));

const meanIn = (pts: Point[], from: number, to: number) => {
  const xs = between(pts, from, to);
  return xs.length ? xs.reduce((a, p) => a + p.ppm, 0) / xs.length : null;
};

/**
 * Excess over the background node, matched by timestamp; without a background node the node's own
 * 10th percentile over the window stands in for background. Both inputs sorted by time.
 */
export function excessSeries(node: Point[], background: Point[]): Point[] {
  if (background.length) {
    const bg = new Map(background.map((p) => [p.at, p.ppm]));
    const median = [...background].map((p) => p.ppm).sort((a, b) => a - b)[
      background.length >> 1
    ];
    return node.map((p) => ({
      at: p.at,
      ppm: p.ppm - (bg.get(p.at) ?? median),
    }));
  }
  const sorted = node.map((p) => p.ppm).sort((a, b) => a - b);
  const floor = sorted[Math.floor(sorted.length * 0.1)] ?? 0;
  return node.map((p) => ({ at: p.at, ppm: p.ppm - floor }));
}

/**
 * The 14 features at issue time t: recent excess (readings up to t only), pressure change over the
 * last and next 3 hours, how well the wind lines up from the landfill to the node now and next, wind
 * speed, night share ahead, time of day, humidity. `weather` must cover t-3h to t+3h (forecast ahead).
 */
export function features(
  t: number,
  excess: Point[],
  weather: Weather[],
  bearingSiteToNode: number,
): number[] | null {
  const now = meanIn(excess, t - 30 * 60_000, t);
  const prev = meanIn(excess, t - 90 * 60_000, t - 30 * 60_000);
  if (now === null || prev === null) return null;
  const recent = between(excess, t - 3 * 3_600_000, t).map((p) => p.ppm);
  const w = weatherAt(weather, t);
  const align = (x: Weather) =>
    Math.cos((((x.windFromDeg + 180) % 360) - bearingSiteToNode) * RAD);
  const ahead = [1, 2, 3].map((h) => weatherAt(weather, t + h * 3_600_000));
  const hour = istHour(t);
  return [
    now,
    prev,
    now - prev,
    Math.max(...recent),
    w.pressureHpa - weatherAt(weather, t - 3 * 3_600_000).pressureHpa,
    ahead[2].pressureHpa - w.pressureHpa,
    align(w),
    ahead.reduce((s, x) => s + align(x), 0) / 3,
    w.windMs,
    ahead.reduce((s, x) => s + x.windMs, 0) / 3,
    [0.5, 1.5, 2.5].filter((h) => isNight(t + h * 3_600_000)).length / 3,
    Math.sin((hour / 24) * 2 * Math.PI),
    Math.cos((hour / 24) * 2 * Math.PI),
    w.rhPct,
  ];
}

/** Training label: the 30-minute mean excess crosses `risePpm` within the next HORIZON_H hours. */
export function riseAhead(
  t: number,
  excess: Point[],
  risePpm: number,
): boolean {
  for (let k = 30; k <= HORIZON_H * 60; k += 10) {
    const m = meanIn(excess, t + (k - 30) * 60_000, t + k * 60_000);
    if (m !== null && m >= risePpm) return true;
  }
  return false;
}

// --- model ---------------------------------------------------------------------------------------

export type SensorModel = {
  version: string;
  kind: "mlp" | "logistic";
  features: string[];
  mean: number[];
  std: number[];
  /** Layers in order; W is n_in x n_out (scikit-learn coefs_ layout); relu between, sigmoid last. */
  layers: { W: number[][]; b: number[] }[];
  threshold: number;
  horizon_h: number;
  trained_on: string;
  metrics: Record<string, number | string>;
};

/** Probability that a rise starts within the horizon. */
export function predictRise(model: SensorModel, x: number[]): number {
  let h = x.map((v, i) => (v - model.mean[i]) / (model.std[i] || 1));
  model.layers.forEach((layer, li) => {
    const out = layer.b.map((b, j) =>
      h.reduce((s, v, i) => s + v * layer.W[i][j], b),
    );
    h = li < model.layers.length - 1 ? out.map((v) => Math.max(0, v)) : out;
  });
  return 1 / (1 + Math.exp(-h[0]));
}
