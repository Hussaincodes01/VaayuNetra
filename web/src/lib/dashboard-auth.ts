import "server-only";

import { getViewer } from "@/lib/dashboard-data";
import { createClient } from "@/lib/supabase/server";

// Shared by the dashboard's server actions: role checks, form fields and attachment uploads.

export type Result =
  { ok: true; message?: string } | { ok: false; error: string };

export type ServerClient = Awaited<ReturnType<typeof createClient>>;

/** A trimmed form field, cut to `max` characters. */
export const formText = (form: FormData, key: string, max = 2000) =>
  String(form.get(key) ?? "")
    .trim()
    .slice(0, max);

/** A form number, or null when the field is empty; NaN when it is not a number. */
export const formNumber = (form: FormData, key: string): number | null => {
  const raw = formText(form, key, 40);
  return raw === "" ? null : Number(raw);
};

/** A yyyy-mm-dd form date, or null. */
export const formDate = (form: FormData, key: string): string | null => {
  const raw = formText(form, key, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
};

export async function requireRole(min: "viewer" | "officer" | "admin") {
  const supabase = await createClient();
  const viewer = await getViewer(supabase);
  const rank = { viewer: 0, officer: 1, admin: 2 } as const;
  if (!viewer || rank[viewer.role] < rank[min]) throw new Error("not allowed");
  return { supabase, viewer };
}

/** Upload to the private attachments bucket under `folder`; null when no file was chosen. */
export async function uploadAttachment(
  supabase: ServerClient,
  folder: string,
  file: File | null,
): Promise<string | null> {
  if (!file || file.size === 0) return null;
  if (file.size > 20 * 1024 * 1024)
    throw new Error("attachment larger than 20 MB");
  const safe = file.name.replace(/[^\w.-]+/g, "_").slice(-120);
  const path = `${folder}/${Date.now()}_${safe}`;
  const { error } = await supabase.storage
    .from("attachments")
    .upload(path, file, { contentType: file.type || undefined });
  if (error) throw new Error(error.message);
  return path;
}
