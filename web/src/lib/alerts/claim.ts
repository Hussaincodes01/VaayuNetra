import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

// Exactly-once delivery for alerts, ops_alerts and reports. A run claims a row before sending: the
// insert wins only once thanks to the table's unique key, and a failed row is re-claimed by flipping
// failed -> pending with an optimistic check on `attempts`. `recipients` lists the addresses already
// delivered, so a retry only sends to the ones that failed.

export const MAX_ATTEMPTS = 3;

type Table = "alerts" | "ops_alerts" | "reports";
export type Claimed = { id: string; delivered: string[]; attempt: number };

export async function claim(
  admin: SupabaseClient,
  table: Table,
  key: Record<string, string>,
  extra: Record<string, unknown> = {},
): Promise<Claimed | null> {
  const inserted = await admin
    .from(table)
    .insert({ ...key, ...extra, status: "pending" })
    .select("id")
    .single();
  if (!inserted.error)
    return { id: inserted.data.id, delivered: [], attempt: 1 };
  if (inserted.error.code !== "23505")
    throw new Error(`${table}: ${inserted.error.message}`);

  let query = admin.from(table).select("id, status, attempts, recipients");
  for (const [k, v] of Object.entries(key)) query = query.eq(k, v);
  const { data: row, error } = await query.maybeSingle();
  if (error) throw new Error(`${table}: ${error.message}`);
  if (!row || row.status !== "failed" || row.attempts >= MAX_ATTEMPTS)
    return null;

  const retry = await admin
    .from(table)
    .update({ status: "pending", attempts: row.attempts + 1, error: null })
    .eq("id", row.id)
    .eq("status", "failed")
    .eq("attempts", row.attempts)
    .select("id");
  if (retry.error) throw new Error(`${table}: ${retry.error.message}`);
  if (!retry.data?.length) return null; // another run got there first
  return {
    id: row.id,
    delivered: row.recipients ?? [],
    attempt: row.attempts + 1,
  };
}

export async function settle(
  admin: SupabaseClient,
  table: Table,
  id: string,
  delivered: string[],
  errors: string[],
  extra: Record<string, unknown> = {},
) {
  const ok = errors.length === 0;
  const { error } = await admin
    .from(table)
    .update({
      ...extra,
      status: ok ? "sent" : "failed",
      recipients: delivered,
      error: ok ? null : errors.join("; ").slice(0, 2000),
      sent_at: delivered.length ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw new Error(`${table}: ${error.message}`);
}
