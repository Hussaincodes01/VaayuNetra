import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

const SCAN_COLUMNS = [
  "pass_date",
  "overpass_utc",
  "satellite",
  "scene_score",
  "detected",
  "tier",
  "surface_kind",
  "q_kgph",
  "q_med",
  "q_lo",
  "q_hi",
  "u10",
  "wind_u",
  "wind_v",
  "d_b12",
  "d_b11",
  "d_visnir",
  "elong",
  "axis_vs_wind",
  "src_dist_m",
  "threshold_used",
  "model_version",
] as const;

const csvCell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** GET /api/export/scans?site=slug (CSV) · GET /api/export/tasking[?site=slug] (GeoJSON of T1/T2 events). */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ kind: string }> },
) {
  const { kind } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json({ error: "sign in required" }, { status: 401 });
  const slug = request.nextUrl.searchParams.get("site");

  const { data: stats } = await supabase
    .from("site_stats")
    .select("site_id,slug,name,lat,lon,model_version");
  const sites = (stats ?? []).filter((s) => !slug || s.slug === slug);
  if (!sites.length)
    return NextResponse.json({ error: "unknown site" }, { status: 404 });
  const modelVersion = String(sites[0].model_version);
  const ids = sites.map((s) => s.site_id as string);

  if (kind === "scans") {
    const { data, error } = await supabase
      .from("scans")
      .select(["site_id", ...SCAN_COLUMNS].join(","))
      .in("site_id", ids)
      .eq("model_version", modelVersion)
      .order("pass_date");
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    const name = new Map(sites.map((s) => [s.site_id, s.slug]));
    const rows = (data as unknown as Record<string, unknown>[]).map((r) =>
      [name.get(r.site_id as string), ...SCAN_COLUMNS.map((c) => r[c])]
        .map(csvCell)
        .join(","),
    );
    const body =
      [["site", ...SCAN_COLUMNS].join(","), ...rows].join("\n") + "\n";
    return new NextResponse(body, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="vayunetra_${slug ?? "all"}_scans.csv"`,
      },
    });
  }

  if (kind === "tasking") {
    const { data, error } = await supabase
      .from("scans")
      .select("site_id,pass_date,overpass_utc,tier,q_med,q_lo,q_hi,u10")
      .in("site_id", ids)
      .eq("model_version", modelVersion)
      .in("tier", ["T1", "T2"])
      .order("pass_date");
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    const byId = new Map(sites.map((s) => [s.site_id, s]));
    const geojson = {
      type: "FeatureCollection",
      properties: {
        note: "Screening-grade satellite estimates: confirm with a hyperspectral satellite, an OGI drone or a ground survey before enforcement or carbon crediting.",
        model_version: modelVersion,
      },
      features: (data ?? []).map((r) => {
        const s = byId.get(r.site_id)!;
        return {
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [Number(s.lon), Number(s.lat)],
          },
          properties: {
            site: s.name,
            slug: s.slug,
            date: r.pass_date,
            tier: r.tier,
            overpass_utc: r.overpass_utc,
            rate_kgph: r.q_med === null ? null : Math.round(Number(r.q_med)),
            rate_68: [
              r.q_lo === null ? null : Math.round(Number(r.q_lo)),
              r.q_hi === null ? null : Math.round(Number(r.q_hi)),
            ],
            u10_ms: r.u10 === null ? null : Number(Number(r.u10).toFixed(1)),
            request:
              r.tier === "T1"
                ? "confirm + quantify (hyperspectral tasking / OGI drone)"
                : "confirm (hyperspectral or ground survey)",
          },
        };
      }),
    };
    return new NextResponse(JSON.stringify(geojson, null, 1), {
      headers: {
        "Content-Type": "application/geo+json; charset=utf-8",
        "Content-Disposition": `attachment; filename="vayunetra_${slug ?? "all"}_tasking.geojson"`,
      },
    });
  }

  return NextResponse.json({ error: "unknown export" }, { status: 404 });
}
