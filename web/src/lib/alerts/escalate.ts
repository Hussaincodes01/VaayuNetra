import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "@/lib/email";
import { SITE_URL } from "@/lib/site-url";
import { pace, type Directory } from "./people";

export type EscalationOutcome = {
  reports: number;
  result: "sent" | "failed" | "no_admins" | "none";
};

/** Email admins once about citizen reports still open past their deadline, then stamp escalated_at. */
export async function runReportEscalation(
  admin: SupabaseClient,
  now: Date,
  dir: () => Promise<Directory>,
): Promise<EscalationOutcome> {
  const { data, error } = await admin
    .from("citizen_reports")
    .select("id,kind,state,due_at,sites(name)")
    .eq("status", "open")
    .is("escalated_at", null)
    .lt("due_at", now.toISOString())
    .order("due_at", { ascending: true })
    .limit(50);
  if (error) throw new Error(`citizen_reports: ${error.message}`);
  const overdue = (data ?? []) as unknown as {
    id: string;
    kind: string;
    state: string | null;
    due_at: string;
    sites: { name: string } | null;
  }[];
  if (!overdue.length) return { reports: 0, result: "none" };
  const admins = (await dir()).adminEmails;
  if (!admins.length) return { reports: overdue.length, result: "no_admins" };

  const items = overdue
    .map(
      (r) =>
        `<li>${r.kind} near ${r.sites?.name ?? "an unmonitored location"}${r.state ? `, ${r.state}` : ""}: due ${r.due_at.slice(0, 16).replace("T", " ")} UTC</li>`,
    )
    .join("");
  const html = `<p><b>${overdue.length}</b> citizen report(s) are past their deadline and still open.</p>
    <ul>${items}</ul>
    <p>${overdue.length} नागरिक रिपोर्ट समय-सीमा के बाद भी खुली हैं।</p>
    <p><a href="${SITE_URL}/dashboard/sustainability#reports">Open the report queue</a>.</p>`;
  let sent = false;
  for (const to of admins) {
    sent =
      (await sendEmail(
        to,
        "VayuNetra: citizen reports past their deadline",
        html,
      )) || sent;
    await pace();
  }
  if (!sent) return { reports: overdue.length, result: "failed" };
  await admin
    .from("citizen_reports")
    .update({ escalated_at: now.toISOString() })
    .in(
      "id",
      overdue.map((r) => r.id),
    );
  return { reports: overdue.length, result: "sent" };
}
