import "server-only";

import { NextResponse } from "next/server";
import { cronGuard } from "@/lib/alerts/cron";
import { runNetwork } from "@/lib/sensor-network";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Sensor network upkeep (GitHub Actions every 15 minutes): simulate readings for simulated nodes,
 * forecast every node 3 hours ahead with the early-warning model, open and close alerts (forecast
 * rise, rise, 10% of the lower explosive limit, offline), and trim old simulated data.
 */
export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;
  try {
    const result = await runNetwork(createAdminClient());
    const failed = result.sites.some((x) => "error" in x);
    return NextResponse.json(
      { ok: !failed, ...result },
      { status: failed && !result.simulated ? 502 : 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
