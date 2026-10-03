"use server";

import "server-only";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ACTION_FLOW,
  getViewer,
  type ActionStatus,
} from "@/lib/dashboard-data";
import { sendEmail } from "@/lib/email";
import {
  createAdminClient,
  createClient,
  serviceRoleConfigured,
} from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site-url";

export type Result =
  { ok: true; message?: string } | { ok: false; error: string };

const STATUSES = Object.keys(ACTION_FLOW) as ActionStatus[];
const text = (form: FormData, key: string, max = 2000) =>
  String(form.get(key) ?? "")
    .trim()
    .slice(0, max);

async function requireRole(min: "viewer" | "officer" | "admin") {
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  const rank = { viewer: 0, officer: 1, admin: 2 } as const;
  if (!viewer || rank[viewer.role] < rank[min]) throw new Error("not allowed");
  return { supabase, viewer };
}

/** Email the assignee (service role reads their address). False if email is not configured. */
async function notifyAssignee(
  assignee: string,
  siteName: string,
  slug: string,
  status: string,
  locale: string,
) {
  if (!serviceRoleConfigured) return false;
  const admin = createAdminClient();
  const { data } = await admin.auth.admin.getUserById(assignee);
  const email = data.user?.email;
  if (!email) return false;
  const prefix = locale === "hi" ? "/hi" : "";
  const link = `${SITE_URL}${prefix}/dashboard/sites/${slug}#actions`;
  return sendEmail(
    email,
    `VayuNetra: ${siteName} action assigned to you (${status.replace(/_/g, " ")})`,
    `<p>An action at <b>${siteName}</b> is assigned to you. Status: <b>${status.replace(/_/g, " ")}</b>.</p>
     <p><a href="${link}">Open it in the VayuNetra dashboard</a>.</p>
     <p style="color:#666">Satellite estimates are screening-grade: confirm with a hyperspectral satellite, an OGI drone
     or a ground survey before enforcement or carbon crediting.</p>`,
  );
}

async function uploadAttachment(
  supabase: Awaited<ReturnType<typeof createClient>>,
  actionId: string,
  file: File | null,
): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > 20 * 1024 * 1024)
    throw new Error("attachment larger than 20 MB");
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-120);
  const path = `${actionId}/${Date.now()}_${safe}`;
  const { error } = await supabase.storage
    .from("attachments")
    .upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return path;
}

export async function createAction(form: FormData): Promise<Result> {
  try {
    const { supabase } = await requireRole("officer");
    const siteId = text(form, "siteId", 64);
    const scanId = text(form, "scanId", 64) || null;
    const status = (text(form, "status", 40) || "new") as ActionStatus;
    const assignee = text(form, "assignee", 64) || null;
    const dueDate = text(form, "dueDate", 10) || null;
    const note = text(form, "note") || null;
    const slug = text(form, "slug", 80);
    const siteName = text(form, "siteName", 120);
    const locale = text(form, "locale", 4);
    if (!siteId || !STATUSES.includes(status))
      return { ok: false, error: "invalid" };
    const { data, error } = await supabase
      .from("actions")
      .insert({
        site_id: siteId,
        scan_id: scanId,
        status,
        assignee,
        due_date: dueDate,
        note,
      })
      .select("id")
      .single();
    if (error) return { ok: false, error: error.message };
    const file = form.get("attachment") as File | null;
    const path = await uploadAttachment(supabase, String(data.id), file);
    if (path)
      await supabase
        .from("actions")
        .update({ attachment_url: path })
        .eq("id", data.id);
    const mailed = assignee
      ? await notifyAssignee(assignee, siteName, slug, status, locale)
      : false;
    revalidatePath("/[locale]/dashboard", "layout");
    return { ok: true, message: mailed ? "mailed" : undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function updateAction(form: FormData): Promise<Result> {
  try {
    const { supabase } = await requireRole("officer");
    const id = text(form, "id", 64);
    const { data: current } = await supabase
      .from("actions")
      .select("status,assignee")
      .eq("id", id)
      .single();
    if (!current) return { ok: false, error: "not found" };
    const patch: Record<string, unknown> = {};
    const status = text(form, "status", 40) as ActionStatus;
    if (status && status !== current.status) {
      if (!ACTION_FLOW[current.status as ActionStatus].includes(status))
        return { ok: false, error: "transition" };
      patch.status = status;
    }
    if (form.has("assignee"))
      patch.assignee = text(form, "assignee", 64) || null;
    if (form.has("dueDate")) patch.due_date = text(form, "dueDate", 10) || null;
    if (form.has("note")) patch.note = text(form, "note") || null;
    const path = await uploadAttachment(
      supabase,
      id,
      form.get("attachment") as File | null,
    );
    if (path) patch.attachment_url = path;
    if (Object.keys(patch).length) {
      const { error } = await supabase
        .from("actions")
        .update(patch)
        .eq("id", id);
      if (error) return { ok: false, error: error.message };
    }
    const newAssignee = patch.assignee as string | null | undefined;
    const mailed =
      newAssignee && newAssignee !== current.assignee
        ? await notifyAssignee(
            newAssignee,
            text(form, "siteName", 120),
            text(form, "slug", 80),
            String(patch.status ?? current.status),
            text(form, "locale", 4),
          )
        : false;
    revalidatePath("/[locale]/dashboard", "layout");
    return { ok: true, message: mailed ? "mailed" : undefined };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Signed link to an attachment in the private attachments bucket (officers only, 10 minutes). */
export async function attachmentLink(path: string): Promise<string | null> {
  const { supabase } = await requireRole("officer");
  const { data } = await supabase.storage
    .from("attachments")
    .createSignedUrl(path, 600);
  return data?.signedUrl ?? null;
}

export async function requestJob(
  siteId: string,
  kind: "scan_site" | "rebuild_dossier",
): Promise<Result & { jobId?: string; job?: Record<string, unknown> }> {
  try {
    const { supabase } = await requireRole("officer");
    const { data, error } = await supabase
      .from("jobs")
      .insert({
        kind,
        site_id: siteId,
        // No dates: the worker scans only passes newer than the last stored one, so the field-test
        // record is never rescanned from the dashboard (full rescans are `vayu scan --from`).
        params: {},
      })
      .select(
        "id, kind, site_id, status, log, created_at, started_at, finished_at",
      )
      .single();
    if (error) return { ok: false, error: error.message };
    revalidatePath("/[locale]/dashboard", "layout");
    // Returned so the panel shows the job at once; Realtime then reports its status changes.
    return { ok: true, jobId: String(data.id), job: data };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function setLanguage(lang: "en" | "hi"): Promise<void> {
  const { supabase, viewer } = await requireRole("viewer");
  await supabase.from("profiles").update({ lang }).eq("user_id", viewer.id);
}

export async function signOut(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

// --- Admin ---------------------------------------------------------------------------------------

const NUMERIC_SETTINGS = [
  "capture_eff",
  "flare_destruction",
  "gwp100",
  "gwp20",
  "ch4_lhv_mj_per_kg",
  "engine_eff",
  "power_price_inr_per_kwh",
  "carbon_price_usd_per_t",
] as const;

export async function saveSettings(form: FormData): Promise<Result> {
  try {
    const { supabase } = await requireRole("admin");
    const rows: { key: string; value: unknown; is_public: boolean }[] = [];
    const mode = text(form, "threshold_mode", 40);
    if (mode === "model_card" || mode === "india_calibrated")
      rows.push({ key: "threshold_mode", value: mode, is_public: true });
    for (const key of NUMERIC_SETTINGS) {
      const raw = text(form, key, 40);
      if (!raw) continue;
      const v = Number(raw);
      if (!Number.isFinite(v) || v < 0)
        return { ok: false, error: `${key}: not a number` };
      rows.push({ key, value: v, is_public: true });
    }
    // Per-state lists: emails for alerts and monthly reports, E.164 numbers for WhatsApp/SMS.
    const lists = [
      ["alert_recipients", /^[^@\s]+@[^@\s]+\.[^@\s]+$/, "email"],
      ["alert_phones", /^\+[1-9]\d{6,14}$/, "+91…"],
    ] as const;
    for (const [key, pattern, example] of lists) {
      const raw = text(form, key, 20000);
      if (!raw) continue;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { ok: false, error: `${key}: invalid JSON` };
      }
      const valid =
        parsed !== null &&
        typeof parsed === "object" &&
        !Array.isArray(parsed) &&
        Object.values(parsed as Record<string, unknown>).every(
          (list) =>
            Array.isArray(list) &&
            list.every((e) => typeof e === "string" && pattern.test(e)),
        );
      if (!valid)
        return {
          ok: false,
          error: `${key}: expected {"State": ["${example}", …]}`,
        };
      rows.push({ key, value: parsed, is_public: false });
    }
    const { error } = await supabase
      .from("settings")
      .upsert(rows, { onConflict: "key" });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/[locale]/dashboard", "layout");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

export async function inviteUser(form: FormData): Promise<Result> {
  try {
    await requireRole("admin");
    if (!serviceRoleConfigured)
      return { ok: false, error: "SUPABASE_SERVICE_ROLE_KEY is not set" };
    const email = text(form, "email", 320).toLowerCase();
    const role = text(form, "role", 10);
    const fullName = text(form, "full_name", 200) || null;
    const org = text(form, "org", 200) || null;
    const state = text(form, "state", 100) || null;
    const locale = text(form, "locale", 4) === "hi" ? "hi" : "en";
    if (
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
      !["viewer", "officer", "admin"].includes(role)
    ) {
      return { ok: false, error: "invalid" };
    }
    const admin = createAdminClient();
    const prefix = locale === "hi" ? "/hi" : "";
    const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${SITE_URL}${prefix}/login?invited=1`,
      data: { full_name: fullName },
    });
    if (error) return { ok: false, error: error.message };
    const { error: pErr } = await admin.from("profiles").upsert(
      {
        user_id: data.user.id,
        full_name: fullName,
        org,
        state,
        role,
        lang: locale,
      },
      { onConflict: "user_id" },
    );
    if (pErr) return { ok: false, error: pErr.message };
    revalidatePath("/[locale]/dashboard/settings", "page");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}
