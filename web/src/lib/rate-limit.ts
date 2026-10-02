import "server-only";

import {
  createAdminClient,
  serviceRoleConfigured,
} from "@/lib/supabase/server";

export type Limit = { ok: boolean; retryAfter: number };

/**
 * Count one hit for `key` and say whether it is within `max` per `windowSeconds` (fixed windows, counted
 * in Supabase by public.rate_limit_hit so every serverless instance sees the same numbers).
 * Without a service-role key (local development) nothing is limited.
 */
export async function rateLimit(
  key: string,
  max: number,
  windowSeconds: number,
): Promise<Limit> {
  const retryAfter =
    windowSeconds - (Math.floor(Date.now() / 1000) % windowSeconds);
  if (!serviceRoleConfigured) return { ok: true, retryAfter: 0 };
  const { data, error } = await createAdminClient().rpc("rate_limit_hit", {
    p_key: key,
    p_max: max,
    p_window_seconds: windowSeconds,
  });
  if (error) {
    // A broken counter must not take the feature down; the database-side caps still apply.
    console.error(`rate limit ${key}: ${error.message}`);
    return { ok: true, retryAfter: 0 };
  }
  return { ok: data === true, retryAfter };
}

/** Client IP as Vercel reports it (first x-forwarded-for entry), for per-visitor limits. */
export function clientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    "unknown"
  );
}
