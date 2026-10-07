import { NextResponse, type NextRequest } from "next/server";
import { openLimit } from "@/lib/open-data";
import { otsFile, parseStamp } from "@/lib/ots";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/open/ledger/proof/<anchor id>: the OpenTimestamps proof (.ots) for an anchored ledger head.
 * GET /api/open/ledger/proof/<anchor id>?file=head: the anchored text itself. Drop both on
 * https://opentimestamps.org to verify (or run `ots verify vayunetra-ledger-N.txt.ots`).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const limited = await openLimit(request);
  if (limited) return limited;
  if (!supabaseConfigured)
    return NextResponse.json(
      { error: "data source not configured" },
      { status: 503 },
    );
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id < 1)
    return NextResponse.json({ error: "unknown anchor" }, { status: 404 });
  const supabase = await createClient();
  const { data: a } = await supabase
    .from("ledger_anchors")
    .select("up_to_entry,head_text,digest,proof,status")
    .eq("id", id)
    .maybeSingle();
  if (!a)
    return NextResponse.json({ error: "unknown anchor" }, { status: 404 });
  const name = `vayunetra-ledger-${a.up_to_entry}.txt`;
  const cache =
    a.status === "confirmed" ? "public, max-age=86400, immutable" : "no-store";

  if (request.nextUrl.searchParams.get("file") === "head")
    return new NextResponse(a.head_text, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Disposition": `attachment; filename="${name}"`,
        "Cache-Control": cache,
      },
    });

  const digest = Uint8Array.from(Buffer.from(a.digest, "hex"));
  const stamp = parseStamp(
    Uint8Array.from(Buffer.from(a.proof, "base64")),
    digest,
  );
  return new NextResponse(Buffer.from(otsFile(digest, stamp)), {
    headers: {
      "Content-Type": "application/vnd.opentimestamps.v1",
      "Content-Disposition": `attachment; filename="${name}.ots"`,
      "Cache-Control": cache,
    },
  });
}
