// Build the early-warning model's training table from the simulator (src/lib/sensors.ts) driven by a
// year of real hourly weather at the five landfills (Open-Meteo historical API, ERA5-based; free for
// non-commercial use). Output: one row per node every 30 minutes, the 14 features and the label
// "the 30-minute mean excess crosses the rise level within 3 hours", only for rows where it has not
// already risen.
//
//   node scripts/sensor-training-data.mjs [outDir] [risePpm]
//
// The "next 3 hours" features get forecast-sized noise (pressure 0.3 hPa, wind direction, wind speed)
// so the model does not learn from a perfect view of the future.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  FEATURE_NAMES,
  bearingDeg,
  excessSeries,
  features,
  gaussian,
  prevailingWindFrom,
  riseAhead,
  simulateReading,
  simulatedLayout,
  weatherFromOpenMeteo,
} from "../src/lib/sensors.ts";

const OUT = process.argv[2] ?? "sensor-training";
const RISE = Number(process.argv[3] ?? 25);
const START = "2024-09-30";
const END = "2025-10-01";
const STEP = 10 * 60_000;
const ISSUE = 30 * 60_000;
mkdirSync(OUT, { recursive: true });

const sites = readFileSync(
  new URL("../../data/seed/site_summary.csv", import.meta.url),
  "utf8",
)
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((l) => l.split(","))
  .map((c) => ({
    name: c[0],
    code: c[0].slice(0, 3).toUpperCase(),
    lat: Number(c[2]),
    lon: Number(c[3]),
  }));

async function weatherFor(site) {
  const cache = join(OUT, `weather-${site.code}.json`);
  if (!existsSync(cache)) {
    const url =
      `https://archive-api.open-meteo.com/v1/archive?latitude=${site.lat}&longitude=${site.lon}` +
      `&start_date=${START}&end_date=${END}&timezone=UTC&wind_speed_unit=ms` +
      "&hourly=surface_pressure,wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m";
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo ${site.code}: HTTP ${res.status}`);
    writeFileSync(cache, await res.text());
  }
  return weatherFromOpenMeteo(JSON.parse(readFileSync(cache, "utf8")));
}

const header = ["site", "node", "role", "t", ...FEATURE_NAMES, "label"].join(
  ",",
);
const rows = [header];
let positives = 0;
const excessHist = [];
for (const site of sites) {
  const weather = await weatherFor(site);
  const t0 = weather[0].t + 3 * 3_600_000;
  const t1 = weather[weather.length - 1].t - 3 * 3_600_000;
  const nodes = simulatedLayout(site, prevailingWindFrom(weather));
  const series = new Map();
  for (const node of nodes) {
    const pts = [];
    for (let t = t0 - 3 * 3_600_000; t <= t1 + 3 * 3_600_000; t += STEP)
      pts.push({
        at: t,
        ppm: simulateReading(node, site, weather, t, t0).ch4_ppm,
      });
    series.set(node.code, pts);
  }
  const bg = series.get(nodes.find((n) => n.role === "background").code);
  for (const node of nodes.filter((n) => n.role !== "background")) {
    const excess = excessSeries(series.get(node.code), bg);
    const bearing = bearingDeg(site.lat, site.lon, node.lat, node.lon);
    for (let t = t0; t <= t1; t += ISSUE) {
      const x = features(t, excess, weather, bearing);
      if (!x || x[0] >= RISE) continue;
      // Forecast-sized noise on the look-ahead features.
      x[5] += 0.3 * gaussian(`${node.code}|${t}|dp`);
      x[7] = Math.max(
        -1,
        Math.min(1, x[7] + 0.15 * gaussian(`${node.code}|${t}|al`)),
      );
      x[9] = Math.max(0, x[9] * (1 + 0.15 * gaussian(`${node.code}|${t}|ws`)));
      const y = riseAhead(t, excess, RISE) ? 1 : 0;
      positives += y;
      if (t % (6 * 3_600_000) === 0) excessHist.push(x[0]);
      rows.push(
        [
          site.code,
          node.code,
          node.role,
          t,
          ...x.map((v) => v.toFixed(4)),
          y,
        ].join(","),
      );
    }
  }
  console.log(
    `${site.name}: ${nodes.length} nodes, prevailing wind from ${prevailingWindFrom(weather).toFixed(0)}°`,
  );
}
writeFileSync(join(OUT, "training.csv"), rows.join("\n") + "\n");
excessHist.sort((a, b) => a - b);
const q = (p) => excessHist[Math.floor(p * (excessHist.length - 1))].toFixed(1);
console.log(
  `rows ${rows.length - 1}, rises ahead ${positives} (${((100 * positives) / (rows.length - 1)).toFixed(1)}%), ` +
    `excess_now p50 ${q(0.5)} p90 ${q(0.9)} p99 ${q(0.99)} ppm, rise level ${RISE} ppm`,
);
