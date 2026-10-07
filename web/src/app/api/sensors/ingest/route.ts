import "server-only";

import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { rateLimit } from "@/lib/rate-limit";
import { toReadingRow } from "@/lib/sensor-network";
import { DEFAULT_CALIBRATION } from "@/lib/sensors";
import {
  createAdminClient,
  serviceRoleConfigured,
} from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const MAX_BATCH = 500;

/**
 * Readings from a live sensor node. POST {"readings": [{"at", "rs_ratio", "temp_c", "rh_pct",
 * "pressure_hpa", "battery_v"} ...]} (or "ch4_ppm" instead of rs_ratio) with
 * `Authorization: Bearer <device key>`. Up to 500 readings per call, so a node that lost its
 * connection can send its backlog. Answers with the sampling interval the node should use.
 */
export async function POST(request: NextRequest) {
  if (!serviceRoleConfigured)
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not set" },
      { status: 503 },
    );
  const token = (request.headers.get("authorization") ?? "").replace(
    /^Bearer\s+/i,
    "",
  );
  if (token.length < 24)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const admin = createAdminClient();
  const keyHash = createHash("sha256").update(token).digest("hex");
  const { data: key } = await admin
    .from("sensor_node_keys")
    .select("node_id")
    .eq("key_hash", keyHash)
    .maybeSingle();
  if (!key)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { data: node } = await admin
    .from("sensor_nodes")
    .select("id,code,mode,active,calibration,interval_s")
    .eq("id", key.node_id)
    .single();
  if (!node?.active || node.mode !== "live")
    return NextResponse.json({ error: "node is not active" }, { status: 403 });
  const limit = await rateLimit(`sensor:${node.id}`, 240, 3600);
  if (!limit.ok)
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );

  let body: { readings?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const list = Array.isArray(body.readings)
    ? (body.readings as Record<string, unknown>[])
    : [];
  if (!list.length || list.length > MAX_BATCH)
    return NextResponse.json(
      { error: `1–${MAX_BATCH} readings per call` },
      { status: 400 },
    );

  const calibration = { ...DEFAULT_CALIBRATION, ...(node.calibration ?? {}) };
  const rows: Record<string, unknown>[] = [];
  const rejected: { index: number; reason: string }[] = [];
  list.forEach((r, index) => {
    const row = toReadingRow({ id: node.id, calibration }, r ?? {});
    if (typeof row === "string") rejected.push({ index, reason: row });
    else rows.push(row);
  });
  if (rows.length) {
    const { error } = await admin
      .from("sensor_readings")
      .upsert(rows, { onConflict: "node_id,at", ignoreDuplicates: true });
    if (error)
      return NextResponse.json({ error: error.message }, { status: 422 });
    const last = rows.reduce((a, b) => (String(a.at) > String(b.at) ? a : b));
    await admin
      .from("sensor_nodes")
      .update({ last_seen: last.at, battery_v: last.battery_v ?? null })
      .eq("id", node.id);
  }
  return NextResponse.json({
    node: node.code,
    accepted: rows.length,
    rejected,
    interval_s: node.interval_s,
  });
}
