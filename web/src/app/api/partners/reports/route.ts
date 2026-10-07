import "server-only";

import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { loadStateLists, pace } from "@/lib/alerts/people";
import { emailConfigured, sendEmail } from "@/lib/email";
import { rateLimit } from "@/lib/rate-limit";
import { SITE_URL } from "@/lib/site-url";
import {
  createAdminClient,
  serviceRoleConfigured,
} from "@/lib/supabase/server";
import { REPORT_KINDS, type ReportKind } from "@/lib/sustainability";

export const dynamic = "force-dynamic";

const MAX_BATCH = 100;

/** PARTNER_API_KEYS = {"ecosathi": "<key>", …}; returns the partner whose key matches the bearer token. */
function partnerFor(request: NextRequest): string | null {
  let keys: Record<string, unknown>;
  try {
    keys = JSON.parse(process.env.PARTNER_API_KEYS || "{}");
  } catch {
    return null;
  }
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  for (const [partner, key] of Object.entries(keys)) {
    if (typeof key !== "string" || key.length < 24) continue;
    const expected = Buffer.from(`Bearer ${key}`);
    if (given.length === expected.length && timingSafeEqual(given, expected))
      return partner;
  }
  return null;
}

type Incoming = {
  id?: unknown;
  kind?: unknown;
  reported_at?: unknown;
  lat?: unknown;
  lon?: unknown;
  description?: unknown;
  photo_url?: unknown;
  consent?: unknown;
};

function validate(r: Incoming): {
  row?: Record<string, unknown>;
  reason?: string;
} {
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const kind = r.kind as ReportKind;
  const at =
    typeof r.reported_at === "string" ? Date.parse(r.reported_at) : NaN;
  const lat = Number(r.lat);
  const lon = Number(r.lon);
  if (!id || id.length > 200) return { reason: "id: 1–200 characters" };
  if (!REPORT_KINDS.includes(kind))
    return { reason: `kind: one of ${REPORT_KINDS.join(", ")}` };
  if (!Number.isFinite(at) || at > Date.now() + 3_600_000)
    return { reason: "reported_at: ISO time, not in the future" };
  if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180))
    return { reason: "lat/lon: WGS84 degrees" };
  if (r.consent !== true)
    return { reason: "consent: must be true (DPDP Act, 2023)" };
  const photo = typeof r.photo_url === "string" ? r.photo_url.trim() : "";
  if (photo && (!photo.startsWith("https://") || photo.length > 1000))
    return { reason: "photo_url: https URL up to 1,000 characters" };
  const description =
    typeof r.description === "string"
      ? r.description.trim().slice(0, 2000)
      : "";
  return {
    row: {
      external_id: id,
      kind,
      reported_at: new Date(at).toISOString(),
      lat,
      lon,
      description: description || null,
      photo_url: photo || null,
      consent: true,
    },
  };
}

/**
 * Citizen reports from partners (EcoSathi). POST one report or {"reports": [...]} (up to 100) with
 * `Authorization: Bearer <partner key>`. Each report is routed to the nearest landfill within 5 km and
 * given the report deadline; the state's alert recipients are emailed. Reporter identity is never sent.
 */
export async function POST(request: NextRequest) {
  if (!serviceRoleConfigured)
    return NextResponse.json(
      { error: "SUPABASE_SERVICE_ROLE_KEY is not set" },
      { status: 503 },
    );
  const partner = partnerFor(request);
  if (!partner)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const limit = await rateLimit(`partner:${partner}`, 600, 3600);
  if (!limit.ok)
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
    );

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "body must be JSON" }, { status: 400 });
  }
  const list = (
    Array.isArray((body as { reports?: unknown })?.reports)
      ? (body as { reports: unknown[] }).reports
      : [body]
  ) as Incoming[];
  if (!list.length || list.length > MAX_BATCH)
    return NextResponse.json(
      { error: `1–${MAX_BATCH} reports per request` },
      { status: 400 },
    );

  const rejected: { index: number; reason: string }[] = [];
  const rows: Record<string, unknown>[] = [];
  list.forEach((r, index) => {
    const v = validate(r ?? {});
    if (v.row) rows.push({ ...v.row, source: partner });
    else rejected.push({ index, reason: v.reason! });
  });

  const admin = createAdminClient();
  let accepted: {
    id: string;
    external_id: string;
    site_id: string | null;
    state: string | null;
    kind: string;
  }[] = [];
  if (rows.length) {
    const { data, error } = await admin
      .from("citizen_reports")
      .upsert(rows, {
        onConflict: "source,external_id",
        ignoreDuplicates: true,
      })
      .select("id,external_id,site_id,state,kind");
    if (error)
      return NextResponse.json({ error: error.message }, { status: 500 });
    accepted = (data ?? []) as typeof accepted;
  }

  // One email per state for the new routed reports.
  if (accepted.some((a) => a.site_id) && emailConfigured) {
    const lists = await loadStateLists(admin, "alert_recipients");
    const byState = new Map<string, typeof accepted>();
    for (const a of accepted.filter((x) => x.site_id && x.state)) {
      byState.set(a.state!, [...(byState.get(a.state!) ?? []), a]);
    }
    for (const [state, items] of byState) {
      const html = `<p><b>${items.length}</b> new citizen report(s) near a monitored landfill in ${state}
        (${items.map((i) => i.kind).join(", ")}).</p>
        <p>${state} में निगरानी वाले लैंडफिल के पास ${items.length} नई नागरिक रिपोर्ट।</p>
        <p><a href="${SITE_URL}/dashboard/sustainability#reports">Open the report queue</a> to assign and close them.</p>`;
      for (const addr of lists[state] ?? []) {
        await sendEmail(
          addr,
          `VayuNetra: new citizen report in ${state}`,
          html,
        );
        await pace();
      }
    }
  }

  return NextResponse.json(
    {
      partner,
      accepted: accepted.length,
      duplicates: rows.length - accepted.length,
      routed: accepted.filter((a) => a.site_id).map((a) => a.external_id),
      rejected,
    },
    { status: rejected.length && !accepted.length ? 422 : 200 },
  );
}

export function GET() {
  return NextResponse.json({ error: "POST reports here" }, { status: 405 });
}
