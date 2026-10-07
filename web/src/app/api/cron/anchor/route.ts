import "server-only";

import { NextResponse } from "next/server";
import { cronGuard } from "@/lib/alerts/cron";
import {
  CALENDARS,
  bitcoinAttestations,
  checkBitcoinBlock,
  fetchUpgrade,
  mergeStamp,
  parseStamp,
  pendingAttestations,
  serializeStamp,
  sha256,
  submitDigest,
  toHex,
} from "@/lib/ots";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** A new chain head is stamped at most this often. */
const SUBMIT_EVERY_MS = 60 * 60 * 1000;
/** A pending proof is asked about at most this often. */
const CHECK_EVERY_MS = 30 * 60 * 1000;

const b64 = (b: Uint8Array) => Buffer.from(b).toString("base64");
const unb64 = (s: string) => Uint8Array.from(Buffer.from(s, "base64"));

/**
 * Integrity ledger upkeep (GitHub Actions every 15 minutes, Vercel daily as a backstop):
 *   1. freeze last month's public scorecard into the ledger (once per month);
 *   2. stamp the current chain head on the OpenTimestamps calendars when it has moved;
 *   3. upgrade pending proofs and check each Bitcoin attestation against the block's Merkle root.
 */
export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;
  const admin = createAdminClient();
  const now = new Date();
  const out: Record<string, unknown> = { at: now.toISOString() };

  // 1. Last month's scorecard.
  const lastMonth = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  )
    .toISOString()
    .slice(0, 10);
  const snap = await admin.rpc("ledger_snapshot_scorecard", {
    p_month: lastMonth,
  });
  out.scorecard = snap.error
    ? `error: ${snap.error.message}`
    : snap.data
      ? `frozen ${lastMonth}`
      : "already frozen";

  // 2. Stamp the head.
  const { data: head } = await admin
    .from("ledger_entries")
    .select("id,entry_hash")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: lastAnchor } = await admin
    .from("ledger_anchors")
    .select("up_to_entry,created_at")
    .order("id", { ascending: false })
    .limit(1)
    .maybeSingle();
  const moved =
    head && (!lastAnchor || Number(lastAnchor.up_to_entry) < Number(head.id));
  const due =
    !lastAnchor ||
    now.getTime() - Date.parse(lastAnchor.created_at) >= SUBMIT_EVERY_MS;
  const submitted: string[] = [];
  const failures: string[] = [];
  if (head && moved && due) {
    const headText = `vayunetra-ledger:${head.id}:${head.entry_hash}`;
    const digest = sha256(headText);
    for (const calendar of CALENDARS) {
      try {
        const stamp = await submitDigest(calendar, digest);
        const { error } = await admin.from("ledger_anchors").insert({
          up_to_entry: head.id,
          head_text: headText,
          digest: toHex(digest),
          calendar,
          proof: b64(serializeStamp(stamp)),
        });
        if (error) throw new Error(error.message);
        submitted.push(new URL(calendar).hostname);
      } catch (e) {
        failures.push(`submit ${calendar}: ${(e as Error).message}`);
      }
    }
  }
  out.submitted = submitted;

  // 3. Upgrade pending proofs.
  const { data: pending } = await admin
    .from("ledger_anchors")
    .select("id,digest,proof,checked_at")
    .eq("status", "pending")
    .order("id", { ascending: true })
    .limit(20);
  const confirmed: { id: number; block: number }[] = [];
  for (const a of pending ?? []) {
    if (
      a.checked_at &&
      now.getTime() - Date.parse(a.checked_at) < CHECK_EVERY_MS
    )
      continue;
    const digest = Uint8Array.from(Buffer.from(a.digest, "hex"));
    try {
      const stamp = parseStamp(unb64(a.proof), digest);
      for (const p of pendingAttestations(stamp)) {
        const upgrade = await fetchUpgrade(p.uri, p.node.msg);
        if (upgrade) mergeStamp(p.node, upgrade);
      }
      const patch: Record<string, unknown> = {
        proof: b64(serializeStamp(stamp)),
        checked_at: now.toISOString(),
      };
      for (const b of bitcoinAttestations(stamp)) {
        const check = await checkBitcoinBlock(b.height, b.msg);
        if (!check.ok) {
          failures.push(
            `anchor ${a.id}: block ${b.height} Merkle root does not match`,
          );
          continue;
        }
        Object.assign(patch, {
          status: "confirmed",
          bitcoin_block: b.height,
          block_time: check.time,
          confirmed_at: now.toISOString(),
        });
        confirmed.push({ id: a.id, block: b.height });
        break;
      }
      const { error } = await admin
        .from("ledger_anchors")
        .update(patch)
        .eq("id", a.id);
      if (error) throw new Error(error.message);
    } catch (e) {
      failures.push(`anchor ${a.id}: ${(e as Error).message}`);
    }
  }
  out.confirmed = confirmed;
  out.failures = failures;
  out.ok = failures.length === 0;
  return NextResponse.json(out, {
    status:
      failures.length && !submitted.length && !confirmed.length ? 502 : 200,
  });
}
