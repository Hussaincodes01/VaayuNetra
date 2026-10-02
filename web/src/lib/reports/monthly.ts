import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { MonthlySummary } from "@/lib/alerts/compose";

const IST = "+05:30";

/** The calendar month before `now`, in India time, as YYYY-MM. */
export function previousPeriod(now: Date): string {
  const ist = new Date(now.getTime() + 5.5 * 3_600_000);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
  return d.toISOString().slice(0, 7);
}

function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 7);
}

type Site = {
  id: string;
  slug: string;
  name: string;
  state: string;
  kind: "landfill" | "control";
  control_of: string | null;
};

type Scan = {
  site_id: string;
  pass_date: string;
  detected: boolean;
  tier: "none" | "T1" | "T2" | "T3";
  q_med: number | null;
  q_lo: number | null;
  q_hi: number | null;
  q_kgph: number | null;
};

/**
 * Per-state figures for one month: passes scanned at the landfills and their control points, T1/T2/T3
 * events, actions closed (resolved or not methane, from the audit log) and the minimum CO2e estimate
 * from site_stats. Uses the active model version, like site_stats.
 */
export async function monthlySummaries(
  admin: SupabaseClient,
  period: string,
): Promise<MonthlySummary[]> {
  const start = `${period}-01`;
  const end = `${nextPeriod(period)}-01`;

  const [sitesRes, statsRes, gwpRes] = await Promise.all([
    admin.from("sites").select("id, slug, name, state, kind, control_of"),
    admin
      .from("site_stats")
      .select("site_id, min_mean_kgph, tco2e100_yr, model_version"),
    admin.from("settings").select("value").eq("key", "gwp100").maybeSingle(),
  ]);
  for (const r of [sitesRes, statsRes, gwpRes])
    if (r.error) throw new Error(`monthly report: ${r.error.message}`);
  const sites = (sitesRes.data ?? []) as Site[];
  const stats = new Map(
    (statsRes.data ?? []).map((r) => [
      r.site_id as string,
      r as {
        min_mean_kgph: number | null;
        tco2e100_yr: number | null;
        model_version: string;
      },
    ]),
  );
  const modelVersion = statsRes.data?.[0]?.model_version as string | undefined;
  const gwp100 = Number(gwpRes.data?.value ?? 27);

  let scanQuery = admin
    .from("scans")
    .select("site_id, pass_date, detected, tier, q_med, q_lo, q_hi, q_kgph")
    .gte("pass_date", start)
    .lt("pass_date", end)
    .order("pass_date");
  if (modelVersion) scanQuery = scanQuery.eq("model_version", modelVersion);
  const { data: scanRows, error: scanErr } = await scanQuery;
  if (scanErr) throw new Error(`scans: ${scanErr.message}`);
  const scans = (scanRows ?? []) as Scan[];

  // Actions closed this month: status changes to resolved / not_methane recorded by the audit trigger.
  const { data: audit, error: auditErr } = await admin
    .from("audit_log")
    .select("row_id, created_at, diff")
    .eq("table_name", "actions")
    .eq("action", "update")
    .in("diff->status->>new", ["resolved", "not_methane"])
    .gte("created_at", `${start}T00:00:00${IST}`)
    .lt("created_at", `${end}T00:00:00${IST}`);
  if (auditErr) throw new Error(`audit_log: ${auditErr.message}`);
  const ids = [...new Set((audit ?? []).map((a) => a.row_id as string))];
  const actionSite = new Map<string, string>();
  if (ids.length) {
    const { data: acts, error } = await admin
      .from("actions")
      .select("id, site_id")
      .in("id", ids);
    if (error) throw new Error(`actions: ${error.message}`);
    (acts ?? []).forEach((a) =>
      actionSite.set(a.id as string, a.site_id as string),
    );
  }

  const byId = new Map(sites.map((s) => [s.id, s]));
  const states = [
    ...new Set(sites.filter((s) => s.kind === "landfill").map((s) => s.state)),
  ].sort();

  return states.map((state) => {
    const landfills = sites.filter(
      (s) => s.kind === "landfill" && s.state === state,
    );
    const landfillIds = new Set(landfills.map((s) => s.id));
    const controlIds = new Set(
      sites
        .filter(
          (s) =>
            s.kind === "control" &&
            s.control_of &&
            landfillIds.has(s.control_of),
        )
        .map((s) => s.id),
    );
    const at = scans.filter((s) => landfillIds.has(s.site_id));
    const controls = scans.filter((s) => controlIds.has(s.site_id));
    const siteRows = landfills
      .map((s) => {
        const st = stats.get(s.id);
        return {
          slug: s.slug,
          name: s.name,
          minMeanKgph: st?.min_mean_kgph ?? null,
          tco2e100Yr: st?.tco2e100_yr ?? null,
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    const co2 = siteRows.reduce((sum, s) => sum + (s.tco2e100Yr ?? 0), 0);
    const closed = (audit ?? [])
      .map((a) => {
        const site = byId.get(actionSite.get(a.row_id as string) ?? "");
        const status = (a.diff as { status: { new: string } }).status.new;
        return site && landfillIds.has(site.id)
          ? {
              slug: site.slug,
              siteName: site.name,
              status: status as "resolved" | "not_methane",
              at: a.created_at as string,
            }
          : null;
      })
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .sort((a, b) => a.at.localeCompare(b.at));
    return {
      state,
      period,
      passes: at.length,
      controlPasses: controls.length,
      controlFlags: controls.filter((s) => s.detected).length,
      t1: at.filter((s) => s.tier === "T1").length,
      t2: at.filter((s) => s.tier === "T2").length,
      t3: at.filter((s) => s.tier === "T3").length,
      actionsClosed: closed.length,
      gwp100,
      tco2e100Yr: co2 > 0 ? co2 : null,
      sites: siteRows,
      closed,
      events: at
        .filter(
          (s): s is Scan & { tier: "T1" | "T2" } =>
            s.tier === "T1" || s.tier === "T2",
        )
        .map((s) => {
          const site = byId.get(s.site_id)!;
          return {
            slug: site.slug,
            siteName: site.name,
            tier: s.tier,
            passDate: s.pass_date,
            qMed: s.q_med,
            qLo: s.q_lo,
            qHi: s.q_hi,
            qKgph: s.q_kgph,
          };
        }),
    };
  });
}
