import { NextResponse, type NextRequest } from "next/server";
import { openLimit } from "@/lib/open-data";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX = 1000;

/**
 * GET /api/open/ledger?after=<id>&limit=<1..1000>: integrity-ledger entries in id order, with the exact
 * hashed text, so anyone can recompute payload_hash = sha256(payload_text) and
 * entry_hash = sha256(prev_hash + "|" + id + "|" + payload_hash).
 */
export async function GET(request: NextRequest) {
  const limited = await openLimit(request);
  if (limited) return limited;
  if (!supabaseConfigured)
    return NextResponse.json(
      { error: "data source not configured" },
      { status: 503 },
    );
  const q = request.nextUrl.searchParams;
  const after = Math.max(0, Number(q.get("after") ?? 0) || 0);
  const limit = Math.min(
    MAX,
    Math.max(1, Number(q.get("limit") ?? MAX) || MAX),
  );
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("ledger_entries")
    .select(
      "id,created_at,kind,ref,payload_text,payload_hash,prev_hash,entry_hash",
    )
    .gt("id", after)
    .order("id", { ascending: true })
    .limit(limit);
  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });
  const entries = data ?? [];
  return NextResponse.json(
    {
      rule: 'entry_hash = sha256(prev_hash + "|" + id + "|" + payload_hash); payload_hash = sha256(payload_text); UTF-8, hex',
      entries,
      next: entries.length === limit ? entries[entries.length - 1].id : null,
    },
    {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=600",
      },
    },
  );
}
