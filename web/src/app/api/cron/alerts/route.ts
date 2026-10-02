import "server-only";

import { NextResponse } from "next/server";
import { cronGuard, lazy } from "@/lib/alerts/cron";
import { loadDirectory } from "@/lib/alerts/people";
import { runEventAlerts, runWorkerOffline } from "@/lib/alerts/run";
import { emailConfigured } from "@/lib/email";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Vercel Cron, every 15 minutes (vercel.json): email new T1/T2 events to the state's recipients
 * (plus WhatsApp/SMS when ALERTS_TWILIO_ENABLED=true), and tell admins once when the worker has
 * been silent for more than two hours.
 */
export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;
  if (!emailConfigured)
    return NextResponse.json(
      { error: "RESEND_API_KEY or ALERT_FROM_EMAIL is not set" },
      { status: 503 },
    );
  const admin = createAdminClient();
  const now = new Date();
  const dir = lazy(() => loadDirectory(admin));
  try {
    const events = await runEventAlerts(admin, now, dir);
    const worker = await runWorkerOffline(admin, now, dir);
    const failed = [...events, ...worker].some((o) => o.result === "failed");
    return NextResponse.json(
      { ok: !failed, at: now.toISOString(), events, worker },
      { status: failed ? 502 : 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
