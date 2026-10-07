import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ASSUMPTION_KEYS,
  assumptionsFrom,
  toScorecardRow,
  type Assumptions,
  type DiversionRow,
  type FireRow,
  type MeasureEffect,
  type MeasureRow,
  type MeterRow,
  type PublicMeasure,
  type RemediationRow,
  type ReportRow,
  type ScorecardRow,
} from "./sustainability";

type Row = Record<string, unknown>;
const num = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export async function loadAssumptions(s: SupabaseClient): Promise<Assumptions> {
  const { data } = await s
    .from("settings")
    .select("key,value")
    .in("key", [...ASSUMPTION_KEYS]);
  return assumptionsFrom(
    Object.fromEntries((data ?? []).map((r) => [r.key, r.value])),
  );
}

function mapMeasure(r: Row, effect: MeasureEffect | null): MeasureRow {
  return {
    id: String(r.id),
    kind: r.kind as MeasureRow["kind"],
    title: String(r.title),
    agency: String(r.agency),
    status: r.status as MeasureRow["status"],
    startDate: (r.start_date as string) ?? null,
    captureShare: num(r.capture_share),
    expectedTco2eYr: num(r.expected_tco2e_yr),
    otherProgrammes: (r.other_programmes as string) ?? null,
    evidenceUrl: (r.evidence_url as string) ?? null,
    note: (r.note as string) ?? null,
    createdAt: String(r.created_at),
    effect,
  };
}

function mapReport(r: Row): ReportRow {
  const site = r.sites as { slug?: string } | null;
  return {
    id: String(r.id),
    source: String(r.source),
    kind: r.kind as ReportRow["kind"],
    reportedAt: String(r.reported_at),
    distM: num(r.dist_m),
    siteSlug: site?.slug ?? null,
    state: (r.state as string) ?? null,
    description: (r.description as string) ?? null,
    photoUrl: (r.photo_url as string) ?? null,
    status: r.status === "closed" ? "closed" : "open",
    assignee: (r.assignee as string) ?? null,
    dueAt: String(r.due_at),
    closedAt: (r.closed_at as string) ?? null,
    closingNote: (r.closing_note as string) ?? null,
  };
}

const REPORT_FIELDS =
  "id,source,kind,reported_at,dist_m,state,description,photo_url,status,assignee,due_at,closed_at,closing_note,sites(slug)";

/** Everything the site page's sustainability sections need, read with the viewer's own session. */
export async function getSiteSustainability(s: SupabaseClient, siteId: string) {
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const [
    measures,
    fires,
    reports,
    remediation,
    meters,
    confirmed,
    assumptions,
  ] = await Promise.all([
    s
      .from("measures")
      .select("*")
      .eq("site_id", siteId)
      .order("created_at", { ascending: true }),
    s
      .from("fire_detections")
      .select("id,source,acq_at,dist_m,confidence,frp_mw,status,note")
      .eq("site_id", siteId)
      .gte("acq_at", since)
      .order("acq_at", { ascending: false })
      .limit(50),
    s
      .from("citizen_reports")
      .select(REPORT_FIELDS)
      .eq("site_id", siteId)
      .order("reported_at", { ascending: false })
      .limit(50),
    s
      .from("remediation_progress")
      .select(
        "id,as_of,legacy_tonnes_total,tonnes_processed,area_reclaimed_ha,source",
      )
      .eq("site_id", siteId)
      .order("as_of", { ascending: false }),
    s
      .from("gas_meter_readings")
      .select(
        "id,measure_id,period_start,period_end,ch4_destroyed_t,meter_id,verified_by,document_url",
      )
      .eq("site_id", siteId)
      .order("period_end", { ascending: false }),
    s.rpc("site_has_confirmed_emission", { p_site: siteId }),
    loadAssumptions(s),
  ]);

  const rows = (measures.data ?? []) as Row[];
  const effects = await Promise.all(
    rows.map(async (m) => {
      if (!m.start_date || m.status === "planned") return null;
      const { data } = await s
        .rpc("measure_effect", { p_measure: m.id })
        .maybeSingle();
      const e = data as Row | null;
      return e
        ? ({
            beforePasses: Number(e.before_passes),
            beforeFlags: Number(e.before_flags),
            afterPasses: Number(e.after_passes),
            afterFlags: Number(e.after_flags),
            pValue: num(e.p_value),
          } satisfies MeasureEffect)
        : null;
    }),
  );

  return {
    measures: rows.map((m, i) => mapMeasure(m, effects[i])),
    fires: ((fires.data ?? []) as Row[]).map((r): FireRow => ({
      id: String(r.id),
      source: String(r.source),
      acqAt: String(r.acq_at),
      distM: Number(r.dist_m),
      confidence: (r.confidence as string) ?? null,
      frpMw: num(r.frp_mw),
      status: r.status as FireRow["status"],
      note: (r.note as string) ?? null,
    })),
    reports: ((reports.data ?? []) as Row[]).map(mapReport),
    remediation: ((remediation.data ?? []) as Row[]).map(
      (r): RemediationRow => ({
        id: String(r.id),
        asOf: String(r.as_of),
        legacyTonnesTotal: num(r.legacy_tonnes_total),
        tonnesProcessed: Number(r.tonnes_processed),
        areaReclaimedHa: num(r.area_reclaimed_ha),
        source: String(r.source),
      }),
    ),
    meters: ((meters.data ?? []) as Row[]).map((r): MeterRow => ({
      id: String(r.id),
      measureId: (r.measure_id as string) ?? null,
      periodStart: String(r.period_start),
      periodEnd: String(r.period_end),
      ch4DestroyedT: Number(r.ch4_destroyed_t),
      meterId: String(r.meter_id),
      verifiedBy: (r.verified_by as string) ?? null,
      documentUrl: (r.document_url as string) ?? null,
    })),
    confirmed: confirmed.data === true,
    assumptions,
    firmsConfigured: Boolean(process.env.FIRMS_MAP_KEY),
  };
}

export type SiteSustainability = Awaited<
  ReturnType<typeof getSiteSustainability>
>;

async function scorecard(
  s: SupabaseClient,
  month: string,
): Promise<ScorecardRow[]> {
  const { data, error } = await s.rpc("site_scorecard", {
    p_month: `${month}-01`,
  });
  if (error) throw new Error(`site_scorecard: ${error.message}`);
  return ((data ?? []) as Row[]).map(toScorecardRow);
}

async function diversion(s: SupabaseClient): Promise<DiversionRow[]> {
  const { data } = await s.rpc("diversion_summary");
  return ((data ?? []) as Row[]).map((r) => ({
    city: String(r.city),
    month: String(r.month),
    compostedT: Number(r.composted_t),
    biogasT: Number(r.biogas_t),
    source: String(r.source),
    avoidedTco2e: Number(r.avoided_tco2e),
  }));
}

/** The dashboard's sustainability page: every site's scorecard, diversion and the open report queue. */
export async function getSustainabilityOverview(
  s: SupabaseClient,
  month: string,
) {
  const [rows, div, reports, assumptions] = await Promise.all([
    scorecard(s, month),
    diversion(s),
    s
      .from("citizen_reports")
      .select(REPORT_FIELDS)
      .eq("status", "open")
      .order("due_at", { ascending: true })
      .limit(100),
    loadAssumptions(s),
  ]);
  return {
    scorecard: rows,
    diversion: div,
    openReports: ((reports.data ?? []) as Row[]).map(mapReport),
    assumptions,
  };
}

/** The public scorecard: aggregates and the ledger's public face only (works for anonymous visitors). */
export async function getPublicScorecard(s: SupabaseClient, month: string) {
  const [rows, measures, div, assumptions] = await Promise.all([
    scorecard(s, month),
    s.rpc("public_measures"),
    diversion(s),
    loadAssumptions(s),
  ]);
  return {
    scorecard: rows,
    measures: ((measures.data ?? []) as Row[]).map((r): PublicMeasure => ({
      slug: String(r.slug),
      kind: r.kind as PublicMeasure["kind"],
      title: String(r.title),
      agency: String(r.agency),
      status: r.status as PublicMeasure["status"],
      startDate: (r.start_date as string) ?? null,
      expectedTco2eYr: num(r.expected_tco2e_yr),
    })),
    diversion: div,
    assumptions,
  };
}
