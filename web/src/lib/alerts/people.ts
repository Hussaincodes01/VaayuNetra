import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Lang } from "./compose";

export type Directory = {
  /** Email language per address: a recipient who is also a dashboard user gets their dashboard language. */
  langOf: (email: string) => Lang;
  adminEmails: string[];
};

/** Dashboard users (auth emails + profile language and role), read with the service role. */
export async function loadDirectory(admin: SupabaseClient): Promise<Directory> {
  const emails = new Map<string, string>(); // user id -> email
  for (let page = 1; page < 50; page++) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw new Error(`auth users: ${error.message}`);
    data.users.forEach(
      (u) => u.email && emails.set(u.id, u.email.toLowerCase()),
    );
    if (data.users.length < 200) break;
  }
  const { data: profiles, error } = await admin
    .from("profiles")
    .select("user_id, lang, role");
  if (error) throw new Error(`profiles: ${error.message}`);
  const lang = new Map<string, Lang>();
  const adminEmails: string[] = [];
  for (const p of profiles ?? []) {
    const email = emails.get(p.user_id as string);
    if (!email) continue;
    lang.set(email, p.lang === "hi" ? "hi" : "en");
    if (p.role === "admin") adminEmails.push(email);
  }
  return {
    langOf: (email) => lang.get(email.toLowerCase()) ?? "en",
    adminEmails,
  };
}

/** Private settings holding per-state lists: alert_recipients (emails) and alert_phones (E.164). */
export async function loadStateLists(
  admin: SupabaseClient,
  key: "alert_recipients" | "alert_phones",
): Promise<Record<string, string[]>> {
  const { data, error } = await admin
    .from("settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(`settings.${key}: ${error.message}`);
  const value = (data?.value ?? {}) as Record<string, unknown>;
  const out: Record<string, string[]> = {};
  for (const [state, list] of Object.entries(value))
    if (Array.isArray(list))
      out[state] = [
        ...new Set(
          list
            .filter((e): e is string => typeof e === "string")
            .map((e) => e.trim()),
        ),
      ].filter(Boolean);
  return out;
}

/** Resend's default limit is 2 requests per second per team. */
export const pace = () => new Promise((r) => setTimeout(r, 600));
