"use server";

import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import {
  formNumber,
  formText as text,
  requireRole,
  type Result,
} from "@/lib/dashboard-auth";
import {
  createAdminClient,
  serviceRoleConfigured,
} from "@/lib/supabase/server";

/** An officer acknowledges a sensor alert (it stays open until readings close it). */
export async function acknowledgeSensorAlert(form: FormData): Promise<Result> {
  try {
    const { supabase, viewer } = await requireRole("officer");
    const { error } = await supabase
      .from("sensor_alerts")
      .update({
        acknowledged_by: viewer.id,
        acknowledged_at: new Date().toISOString(),
      })
      .eq("id", text(form, "id", 64));
    if (error) return { ok: false, error: error.message };
    revalidatePath("/[locale]/dashboard/sensors", "page");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * An admin registers a real (live) sensor node. The device key is returned once, in the message,
 * and only its SHA-256 is stored; flash it into the node's firmware.
 */
export async function createLiveNode(form: FormData): Promise<Result> {
  try {
    const { supabase } = await requireRole("admin");
    if (!serviceRoleConfigured)
      return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set" };
    const code = text(form, "code", 24).toUpperCase();
    const role = text(form, "role", 20);
    const lat = formNumber(form, "lat");
    const lon = formNumber(form, "lon");
    if (!/^[A-Z0-9-]{3,24}$/.test(code))
      return { ok: false, error: "code: 3–24 letters, digits or dashes" };
    if (!["perimeter", "community", "background"].includes(role))
      return { ok: false, error: "invalid role" };
    if (
      lat === null ||
      lon === null ||
      Math.abs(lat) > 90 ||
      Math.abs(lon) > 180
    )
      return { ok: false, error: "latitude and longitude in degrees" };
    const { data: node, error } = await supabase
      .from("sensor_nodes")
      .insert({
        site_id: text(form, "siteId", 64),
        code,
        role,
        mode: "live",
        lat,
        lon,
        sensor: text(form, "sensor", 60) || "TGS2611-E00",
        installed_at: new Date().toISOString().slice(0, 10),
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    const key = randomBytes(24).toString("base64url");
    const { error: keyError } = await createAdminClient()
      .from("sensor_node_keys")
      .insert({
        node_id: node.id,
        key_hash: createHash("sha256").update(key).digest("hex"),
      });
    if (keyError) return { ok: false, error: keyError.message };
    revalidatePath("/[locale]/dashboard/sensors", "page");
    return { ok: true, message: `key:${key}` };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
