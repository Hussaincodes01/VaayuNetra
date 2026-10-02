"use server";

import "server-only";

import { headers } from "next/headers";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export type RequestState = {
  status: "idle" | "sent" | "error" | "invalid" | "limited";
};

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const field = (form: FormData, key: string, max: number): string =>
  String(form.get(key) ?? "")
    .trim()
    .slice(0, max);

/**
 * Insert an access request (RLS lets anon insert into access_requests and nothing else). At most 5 per
 * hour per visitor IP here; the database adds 3 per email per day and 30 per hour overall.
 */
export async function requestAccess(
  _prev: RequestState,
  form: FormData,
): Promise<RequestState> {
  // Honeypot: real visitors never see or fill this field.
  if (field(form, "website", 200)) return { status: "sent" };

  const name = field(form, "name", 200);
  const org = field(form, "org", 200);
  const email = field(form, "email", 320);
  const state = field(form, "state", 100);
  const message = field(form, "message", 2000);
  if (!name || !org || !EMAIL.test(email)) return { status: "invalid" };
  const ip = clientIp(await headers());
  if (!(await rateLimit(`access_requests:${ip}`, 5, 3600)).ok)
    return { status: "limited" };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return { status: "error" };
  try {
    const res = await fetch(`${url}/rest/v1/access_requests`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        name,
        org,
        email,
        state: state || null,
        message: message || null,
      }),
      cache: "no-store",
    });
    if (res.status === 429) return { status: "limited" };
    return { status: res.ok ? "sent" : "error" };
  } catch {
    return { status: "error" };
  }
}
