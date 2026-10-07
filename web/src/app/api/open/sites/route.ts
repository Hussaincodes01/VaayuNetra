import { NextResponse, type NextRequest } from "next/server";
import { OPEN_CACHE, OPEN_NOTES, openLimit } from "@/lib/open-data";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { monthParam } from "@/lib/sustainability";

export const dynamic = "force-dynamic";

/** GET /api/open/sites?month=YYYY-MM: every active landfill as a GeoJSON point with its scorecard. */
export async function GET(request: NextRequest) {
  const limited = await openLimit(request);
  if (limited) return limited;
  if (!supabaseConfigured)
    return NextResponse.json(
      { error: "data source not configured" },
      { status: 503 },
    );
  const month = monthParam(request.nextUrl.searchParams.get("month"));
  const supabase = await createClient();
  const [card, locs] = await Promise.all([
    supabase.rpc("site_scorecard", { p_month: `${month}-01` }),
    supabase
      .from("site_locations")
      .select("slug,lat,lon")
      .eq("kind", "landfill"),
  ]);
  if (card.error || locs.error)
    return NextResponse.json(
      { error: card.error?.message ?? locs.error?.message },
      { status: 500 },
    );
  const where = new Map((locs.data ?? []).map((l) => [l.slug as string, l]));
  const features = ((card.data ?? []) as Record<string, unknown>[])
    .filter((r) => where.has(String(r.slug)))
    .map((r) => {
      const l = where.get(String(r.slug))!;
      return {
        type: "Feature" as const,
        geometry: {
          type: "Point" as const,
          coordinates: [Number(l.lon), Number(l.lat)],
        },
        properties: r,
      };
    });
  return NextResponse.json(
    { type: "FeatureCollection", month, notes: OPEN_NOTES, features },
    {
      headers: {
        "Content-Type": "application/geo+json",
        "Cache-Control": OPEN_CACHE,
      },
    },
  );
}
