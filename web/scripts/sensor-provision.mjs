// Place a simulated sensor network at every active landfill that has no nodes yet: three perimeter
// nodes, one community node downwind of the prevailing wind and one background node upwind
// (src/lib/sensors.ts simulatedLayout). The prevailing wind comes from the last year of Open-Meteo
// (ERA5) hourly weather at the site. Simulated nodes are labelled as such everywhere.
//
//   SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… node scripts/sensor-provision.mjs

import {
  prevailingWindFrom,
  simulatedLayout,
  weatherFromOpenMeteo,
} from "../src/lib/sensors.ts";

const URL_ = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY)
  throw new Error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
const headers = {
  apikey: KEY,
  Authorization: `Bearer ${KEY}`,
  "Content-Type": "application/json",
};

async function rest(path, init = {}) {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    ...init,
    headers: { ...headers, ...init.headers },
  });
  if (!res.ok)
    throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

async function yearOfWeather(lat, lon) {
  const day = (d) =>
    new Date(Date.now() - d * 86_400_000).toISOString().slice(0, 10);
  const url =
    `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}` +
    `&start_date=${day(372)}&end_date=${day(7)}&timezone=UTC&wind_speed_unit=ms` +
    "&hourly=surface_pressure,wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m";
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return weatherFromOpenMeteo(await res.json());
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 3000 * attempt));
    }
  }
}

const sites = await rest(
  "site_locations?select=id,slug,name,lat,lon&kind=eq.landfill&active=eq.true",
);
const existing = new Set(
  (await rest("sensor_nodes?select=site_id")).map((n) => n.site_id),
);
for (const site of sites) {
  if (existing.has(site.id)) {
    console.log(`${site.name}: already has nodes, skipped`);
    continue;
  }
  const weather = await yearOfWeather(site.lat, site.lon);
  const from = prevailingWindFrom(weather);
  const code = site.slug.slice(0, 3).toUpperCase();
  const nodes = simulatedLayout(
    { code, lat: site.lat, lon: site.lon },
    from,
  ).map((n) => ({
    site_id: site.id,
    code: n.code,
    role: n.role,
    mode: "simulated",
    lat: Number(n.lat.toFixed(6)),
    lon: Number(n.lon.toFixed(6)),
    installed_at: new Date().toISOString().slice(0, 10),
  }));
  await rest("sensor_nodes", {
    method: "POST",
    body: JSON.stringify(nodes),
    headers: { Prefer: "return=minimal" },
  });
  console.log(
    `${site.name}: 5 simulated nodes, prevailing wind from ${from.toFixed(0)}°`,
  );
}
