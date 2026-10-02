import "server-only";

import { NextResponse } from "next/server";
import { claim, settle } from "@/lib/alerts/claim";
import { composeMonthlyReport } from "@/lib/alerts/compose";
import { cronGuard, lazy } from "@/lib/alerts/cron";
import { loadDirectory, loadStateLists, pace } from "@/lib/alerts/people";
import { emailConfigured, sendMail } from "@/lib/email";
import { monthlySummaries, previousPeriod } from "@/lib/reports/monthly";
import { monthlyReportPdf } from "@/lib/reports/MonthlyReportPdf";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const slugify = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/**
 * Vercel Cron on the 1st of each month (vercel.json): one PDF per state for the previous month,
 * stored in the private `reports` bucket and emailed to the state's alert recipients.
 * `?period=YYYY-MM` re-runs a given month; each state and month is sent once (reports table).
 */
export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;
  if (!emailConfigured)
    return NextResponse.json(
      { error: "RESEND_API_KEY or ALERT_FROM_EMAIL is not set" },
      { status: 503 },
    );
  const now = new Date();
  const asked = new URL(request.url).searchParams.get("period");
  if (asked && !/^\d{4}-(0[1-9]|1[0-2])$/.test(asked))
    return NextResponse.json(
      { error: "period must be YYYY-MM" },
      { status: 400 },
    );
  const period = asked ?? previousPeriod(now);
  const admin = createAdminClient();
  const dir = lazy(() => loadDirectory(admin));

  try {
    const summaries = await monthlySummaries(admin, period);
    const recipients = await loadStateLists(admin, "alert_recipients");
    const results = [];
    for (const summary of summaries) {
      const claimed = await claim(admin, "reports", {
        kind: "monthly",
        state: summary.state,
        period,
      });
      if (!claimed) {
        results.push({ state: summary.state, result: "skipped_claimed" });
        continue;
      }
      const pdf = await monthlyReportPdf(summary, now);
      const path = `monthly/${period}/${slugify(summary.state)}.pdf`;
      const upload = await admin.storage
        .from("reports")
        .upload(path, pdf, { contentType: "application/pdf", upsert: true });
      if (upload.error) {
        await settle(admin, "reports", claimed.id, claimed.delivered, [
          `upload: ${upload.error.message}`,
        ]);
        results.push({
          state: summary.state,
          result: "failed",
          error: upload.error.message,
        });
        continue;
      }
      const to = recipients[summary.state] ?? [];
      if (!to.length) {
        await admin
          .from("reports")
          .update({ status: "no_recipients", pdf_path: path })
          .eq("id", claimed.id);
        results.push({
          state: summary.state,
          result: "no_recipients",
          pdf: path,
        });
        continue;
      }
      const directory = await dir();
      const attachment = {
        filename: `vayunetra-${slugify(summary.state)}-${period}.pdf`,
        content: pdf.toString("base64"),
      };
      const delivered = [...claimed.delivered];
      const errors: string[] = [];
      for (const address of to.filter((a) => !delivered.includes(a))) {
        const mail = await composeMonthlyReport(
          summary,
          directory.langOf(address),
        );
        const r = await sendMail({
          to: address,
          ...mail,
          attachments: [attachment],
          idempotencyKey: `report/${claimed.id}/${address}/${claimed.attempt}`,
        });
        if (r.ok) delivered.push(address);
        else errors.push(`${address}: ${r.error}`);
        await pace();
      }
      await settle(admin, "reports", claimed.id, delivered, errors, {
        pdf_path: path,
      });
      results.push({
        state: summary.state,
        result: errors.length ? "failed" : "sent",
        delivered: delivered.length,
        pdf: path,
        ...(errors.length ? { error: errors.join("; ") } : {}),
      });
    }
    const failed = results.some((r) => r.result === "failed");
    return NextResponse.json(
      { ok: !failed, period, results },
      { status: failed ? 502 : 200 },
    );
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: (e as Error).message },
      { status: 500 },
    );
  }
}
