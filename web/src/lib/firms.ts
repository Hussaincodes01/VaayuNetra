import "server-only";

import { parseFirmsCsv, type Detection } from "@/lib/sustainability";

export type { Detection };

// NASA FIRMS active-fire detections near each landfill (area API, free MAP_KEY):
//   https://firms.modaps.eosdis.nasa.gov/api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north]/[DAY_RANGE]/[DATE]
// Near-real-time VIIRS products by default; the *_SP products replay the archive (e.g. April 2024).

export const FIRMS_SOURCES = [
  "VIIRS_SNPP_NRT",
  "VIIRS_NOAA20_NRT",
  "VIIRS_NOAA21_NRT",
] as const;
const ALLOWED = new Set<string>([
  ...FIRMS_SOURCES,
  "MODIS_NRT",
  "MODIS_SP",
  "VIIRS_SNPP_SP",
  "VIIRS_NOAA20_SP",
]);

export const firmsConfigured = () => Boolean(process.env.FIRMS_MAP_KEY);

export function isFirmsSource(s: string): boolean {
  return ALLOWED.has(s);
}

/** Detections within FIRE_RADIUS_M of a site for the last `days` days (1–5), or `days` ending on `date`. */
export async function fetchDetections(
  site: { lat: number; lon: number },
  source: string,
  days: number,
  date?: string,
): Promise<Detection[]> {
  const key = process.env.FIRMS_MAP_KEY;
  if (!key) return [];
  const d = 0.02; // about 2 km either side: comfortably larger than FIRE_RADIUS_M
  const area = [site.lon - d, site.lat - d, site.lon + d, site.lat + d]
    .map((v) => v.toFixed(4))
    .join(",");
  const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}/${source}/${area}/${days}${date ? `/${date}` : ""}`;
  const res = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`FIRMS ${source} ${res.status}`);
  const text = await res.text();
  if (/invalid|error/i.test(text.slice(0, 200)) && !text.includes("latitude"))
    throw new Error(`FIRMS ${source}: ${text.slice(0, 120)}`);
  return parseFirmsCsv(text, source, site);
}
