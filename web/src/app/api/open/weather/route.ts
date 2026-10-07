import { NextResponse } from "next/server";
import { SIM_SITES } from "@/lib/sensor-sim";
import { weatherAt, weatherFromOpenMeteo } from "@/lib/sensors";

// Today's weather at a monitored landfill for the /simulator page: wind, humidity and temperature now
// and the forecast pressure change over the next 3 hours. Open-Meteo is free and keyless; the
// response is cached for 30 minutes so viewers' requests don't reach it.
export async function GET(req: Request) {
  const slug = new URL(req.url).searchParams.get("site");
  const site = SIM_SITES.find((s) => s.slug === slug);
  if (!site)
    return NextResponse.json({ error: "unknown site" }, { status: 400 });
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${site.lat}&longitude=${site.lon}` +
    "&past_days=1&forecast_days=2&timezone=UTC&wind_speed_unit=ms" +
    "&hourly=surface_pressure,wind_speed_10m,wind_direction_10m,temperature_2m,relative_humidity_2m";
  try {
    const res = await fetch(url, {
      next: { revalidate: 1800 },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    const series = weatherFromOpenMeteo(await res.json());
    if (series.length < 24) throw new Error("too little data");
    const now = Date.now();
    const w = weatherAt(series, now);
    const ahead = weatherAt(series, now + 3 * 3_600_000);
    return NextResponse.json(
      {
        site: site.slug,
        at: now,
        windMs: w.windMs,
        windFromDeg: w.windFromDeg,
        rhPct: w.rhPct,
        tempC: w.tempC,
        pressureHpa: w.pressureHpa,
        trendHpa3h: ahead.pressureHpa - w.pressureHpa,
        source: "Open-Meteo forecast",
      },
      { headers: { "Cache-Control": "public, s-maxage=600" } },
    );
  } catch {
    return NextResponse.json({ error: "weather unavailable" }, { status: 502 });
  }
}
