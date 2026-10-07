import { NextResponse, type NextRequest } from "next/server";
import { OPEN_CACHE, OPEN_NOTES, openLimit, toCsv } from "@/lib/open-data";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { monthParam } from "@/lib/sustainability";

export const dynamic = "force-dynamic";

/** GET /api/open/scorecard?month=YYYY-MM[&format=csv]: the public scorecard as JSON or CSV. */
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
  const { data, error } = await supabase.rpc("site_scorecard", {
    p_month: `${month}-01`,
  });
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  const rows = (data ?? []) as Record<string, unknown>[];

  if (request.nextUrl.searchParams.get("format") === "csv")
    return new NextResponse(toCsv(rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="vayunetra-scorecard-${month}.csv"`,
        "Cache-Control": OPEN_CACHE,
      },
    });
  return NextResponse.json(
    { month, notes: OPEN_NOTES, sites: rows },
    { headers: { "Cache-Control": OPEN_CACHE } },
  );
}
