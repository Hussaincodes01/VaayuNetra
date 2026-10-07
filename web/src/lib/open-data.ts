import "server-only";

import { NextResponse } from "next/server";
import { clientIp, rateLimit } from "@/lib/rate-limit";

export const OPEN_NOTES = {
  grades:
    "Satellite figures are screening-grade: confirm with a hyperspectral satellite, an OGI drone or a ground survey before enforcement or carbon crediting. Annual figures are minimum estimates. expected_tco2e_yr is modelled; only verified_tco2e_* (metered methane x GWP100) is a verified reduction.",
  licence:
    "Contains modified Copernicus Sentinel data. Fire detections: NASA FIRMS. Cite VayuNetra and the month.",
};

export const OPEN_CACHE = "public, s-maxage=600, stale-while-revalidate=3600";

/** 120 requests an hour per IP for the open-data endpoints; null when allowed. */
export async function openLimit(
  request: Request,
): Promise<NextResponse | null> {
  const limit = await rateLimit(`open:${clientIp(request.headers)}`, 120, 3600);
  return limit.ok
    ? null
    : NextResponse.json(
        { error: "rate limited" },
        { status: 429, headers: { "Retry-After": String(limit.retryAfter) } },
      );
}

const cell = (v: unknown) => {
  if (v === null || v === undefined) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const cols = Object.keys(rows[0]);
  return (
    [
      cols.join(","),
      ...rows.map((r) => cols.map((c) => cell(r[c])).join(",")),
    ].join("\n") + "\n"
  );
}
