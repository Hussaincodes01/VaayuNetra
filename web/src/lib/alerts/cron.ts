import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { serviceRoleConfigured } from "@/lib/supabase/server";

/**
 * Vercel Cron sends `Authorization: Bearer $CRON_SECRET`. Anything else gets 401; without a secret
 * configured the routes stay closed.
 */
export function cronGuard(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret)
    return NextResponse.json(
      { error: "CRON_SECRET is not set" },
      { status: 503 },
    );
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  if (given.length !== expected.length || !timingSafeEqual(given, expected))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!serviceRoleConfigured)
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not set" },
      { status: 503 },
    );
  return null;
}

/** Load a value once, on first use. */
export function lazy<T>(load: () => Promise<T>): () => Promise<T> {
  let p: Promise<T> | null = null;
  return () => (p ??= load());
}
