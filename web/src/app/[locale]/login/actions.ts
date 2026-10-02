"use server";

import { createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/site-url";

export type LoginState = {
  status: "idle" | "sent" | "not_invited" | "error" | "invalid";
  email?: string;
};

/** Magic link for invited users only: shouldCreateUser is false, so unknown emails get nothing. */
export async function sendMagicLink(
  _prev: LoginState,
  form: FormData,
): Promise<LoginState> {
  const email = String(form.get("email") ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 320);
  const next = String(form.get("next") ?? "/dashboard");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return { status: "invalid" };
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/dashboard";
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      emailRedirectTo: `${SITE_URL}/auth/callback?next=${encodeURIComponent(safeNext)}`,
    },
  });
  if (!error) return { status: "sent", email };
  // GoTrue refuses magic links for emails that were never invited (signups are disabled).
  if (
    error.code === "otp_disabled" ||
    /signups not allowed/i.test(error.message)
  ) {
    return { status: "not_invited", email };
  }
  return { status: "error", email };
}
