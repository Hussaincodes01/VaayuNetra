import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Page } from "@playwright/test";

// Environment: CI exports it from `supabase status -o env`; locally it comes from .env.local.
const envFile = join(__dirname, "..", ".env.local");
if (existsSync(envFile))
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !(m[1] in process.env))
      process.env[m[1]] = m[2].replace(/\s+#.*$/, "").replace(/^"|"$/g, "");
  }

export const SUPABASE_URL = (
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? ""
).replace(/\/$/, "");
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const MAILPIT = (process.env.MAILPIT_URL ?? "http://127.0.0.1:54324").replace(
  /\/$/,
  "",
);

export const OFFICER = {
  email: "e2e-officer@vayunetra.test",
  name: "E2E Officer",
  role: "officer",
  state: "Maharashtra",
};
export const OFFICER_STATE = "e2e/.auth/officer.json";
export const E2E_WORKER = "e2e-worker";

/** PostgREST call with the service role (test setup and assertions only). */
export async function rest<T = Record<string, unknown>[]>(
  method: string,
  path: string,
  body?: unknown,
  prefer = "return=representation",
): Promise<T> {
  if (!SUPABASE_URL || !SERVICE_KEY)
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required",
    );
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
      Prefer: prefer,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text}`);
  return (text ? JSON.parse(text) : null) as T;
}

/** Create (or find) a confirmed auth user and give the profile its role. */
export async function ensureUser(u: typeof OFFICER): Promise<string> {
  const headers = {
    apikey: SERVICE_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
    "Content-Type": "application/json",
  };
  let res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      email: u.email,
      email_confirm: true,
      user_metadata: { full_name: u.name },
    }),
  });
  let id: string | undefined = res.ok
    ? ((await res.json()) as { id: string }).id
    : undefined;
  if (!id) {
    res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=1000`, {
      headers,
    });
    const list = (await res.json()) as {
      users: { id: string; email: string }[];
    };
    id = list.users.find((x) => x.email === u.email)?.id;
  }
  if (!id) throw new Error(`could not create ${u.email}`);
  await rest("PATCH", `profiles?user_id=eq.${id}`, {
    full_name: u.name,
    role: u.role,
    state: u.state,
    lang: "en",
  });
  return id;
}

/** The magic link Supabase emailed to `email` after `since` (read from the local Mailpit inbox). */
export async function magicLink(email: string, since: number): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const res = await fetch(`${MAILPIT}/api/v1/messages?limit=50`);
    const { messages } = (await res.json()) as {
      messages: { ID: string; Created: string; To: { Address: string }[] }[];
    };
    for (const m of messages) {
      if (Date.parse(m.Created) < since - 5000) continue;
      if (!m.To.some((t) => t.Address.toLowerCase() === email)) continue;
      const msg = (await (
        await fetch(`${MAILPIT}/api/v1/message/${m.ID}`)
      ).json()) as { HTML: string };
      const link = msg.HTML.match(/href="([^"]+\/auth\/v1\/verify[^"]+)"/)?.[1];
      if (link) return link.replace(/&amp;/g, "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`no sign-in email for ${email}`);
}

/** Sign in through the real login form and the emailed magic link. */
export async function signIn(page: Page, email: string) {
  const since = Date.now();
  await page.goto("/login");
  await page.fill("input[name=email]", email);
  await page.click("button[type=submit]");
  await expect(page.getByRole("status")).toContainText("inbox");
  await page.goto(await magicLink(email, since));
  await page.waitForURL(/\/dashboard/);
}

/** Console errors and uncaught exceptions from this site's own code (third-party frames excluded). */
export function trackErrors(page: Page, baseURL: string): string[] {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const url = m.location().url;
    if (!url || url.startsWith(baseURL)) errors.push(`${m.text()} (${url})`);
  });
  return errors;
}

export async function setWorkerOnline(online: boolean) {
  if (online)
    await rest(
      "POST",
      "worker_heartbeat?on_conflict=worker_id",
      [
        {
          worker_id: E2E_WORKER,
          last_seen: new Date().toISOString(),
          version: "e2e",
          device: "cpu",
          queue_depth: 0,
        },
      ],
      "resolution=merge-duplicates",
    );
  else await rest("DELETE", "worker_heartbeat?worker_id=not.is.null");
}
