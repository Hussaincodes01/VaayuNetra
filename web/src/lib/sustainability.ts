// Sustainability calculators and types shared by the dashboard, the public scorecard and the unit tests.
// The formulas mirror supabase/migrations/20261007000100_sustainability.sql (capture_estimate,
// diversion_avoided_tco2e); tests/unit/sustainability.test.mjs checks both give the same numbers.
// No imports, so Node's test runner can load this file directly.

export type CaptureAssumptions = {
  gwp100: number;
  flareDestruction: number;
  lhvMjPerKg: number;
  engineEff: number;
};

/** The ops notebook's action-plan assumptions (settings: gwp100, flare_destruction, ch4_lhv_mj_per_kg, engine_eff). */
export const DEFAULT_CAPTURE: CaptureAssumptions = {
  gwp100: 27,
  flareDestruction: 0.98,
  lhvMjPerKg: 50,
  engineEff: 0.35,
};

/**
 * The dossier's action plan for a minimum time-averaged rate q (kg/h) and a capture share:
 * annual CO2e = q x 8.76 x GWP100 (8.76 = 8,760 h a year / 1,000 kg a tonne), avoided = that x capture
 * x flare destruction, electric MW = q x capture x heating value x engine efficiency / 3,600.
 */
export function captureEstimate(
  qKgph: number,
  capture: number,
  a: CaptureAssumptions = DEFAULT_CAPTURE,
) {
  return {
    annualTco2e: qKgph * 8.76 * a.gwp100,
    avoidedTco2eYr: qKgph * capture * 8.76 * a.gwp100 * a.flareDestruction,
    powerMw: (qKgph * capture * a.lhvMjPerKg * a.engineEff) / 3600,
  };
}

export type DiversionAssumptions = {
  docFood: number;
  docf: number;
  mcf: number;
  f: number;
  ox: number;
  gwp100: number;
  gwp100N2o: number;
  compostCh4KgPerT: number;
  compostN2oKgPerT: number;
  adCh4KgPerT: number;
};

/**
 * IPCC 2006 Vol. 5 defaults for wet food waste in an unmanaged deep dumpsite (DOC Ch. 2 Table 2.4;
 * DOCf and F Ch. 3 text; MCF Table 3.1; OX Table 3.2), treatment emissions from Ch. 4 Table 4.1,
 * N2O GWP100 from IPCC AR6.
 */
export const DEFAULT_DIVERSION: DiversionAssumptions = {
  docFood: 0.15,
  docf: 0.5,
  mcf: 0.8,
  f: 0.5,
  ox: 0,
  gwp100: 27,
  gwp100N2o: 273,
  compostCh4KgPerT: 4,
  compostN2oKgPerT: 0.24,
  adCh4KgPerT: 0.8,
};

/** Modelled lifetime t CO2e avoided per tonne of wet waste composted or sent to biogas, net of treatment. */
export function diversionPerTonne(a: DiversionAssumptions = DEFAULT_DIVERSION) {
  const ch4PerTonne = a.docFood * a.docf * a.mcf * a.f * (16 / 12) * (1 - a.ox);
  const avoided = ch4PerTonne * a.gwp100;
  return {
    ch4PerTonne,
    composted:
      avoided -
      (a.compostCh4KgPerT / 1000) * a.gwp100 -
      (a.compostN2oKgPerT / 1000) * a.gwp100N2o,
    biogas: avoided - (a.adCh4KgPerT / 1000) * a.gwp100,
  };
}

export function diversionAvoided(
  compostedT: number,
  biogasT: number,
  a: DiversionAssumptions = DEFAULT_DIVERSION,
): number {
  const per = diversionPerTonne(a);
  return compostedT * per.composted + biogasT * per.biogas;
}

/** Settings rows -> assumptions, falling back to the defaults for any key that is missing. */
export function assumptionsFrom(settings: Record<string, unknown>) {
  const n = (key: string, fallback: number) => {
    const v = Number(settings[key]);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    capture: {
      gwp100: n("gwp100", DEFAULT_CAPTURE.gwp100),
      flareDestruction: n(
        "flare_destruction",
        DEFAULT_CAPTURE.flareDestruction,
      ),
      lhvMjPerKg: n("ch4_lhv_mj_per_kg", DEFAULT_CAPTURE.lhvMjPerKg),
      engineEff: n("engine_eff", DEFAULT_CAPTURE.engineEff),
    } satisfies CaptureAssumptions,
    captureShare: n("capture_eff", 0.6),
    diversion: {
      docFood: n("ipcc_doc_food", DEFAULT_DIVERSION.docFood),
      docf: n("ipcc_docf", DEFAULT_DIVERSION.docf),
      mcf: n("ipcc_mcf", DEFAULT_DIVERSION.mcf),
      f: n("ipcc_f", DEFAULT_DIVERSION.f),
      ox: n("ipcc_ox", DEFAULT_DIVERSION.ox),
      gwp100: n("gwp100", DEFAULT_DIVERSION.gwp100),
      gwp100N2o: n("gwp100_n2o", DEFAULT_DIVERSION.gwp100N2o),
      compostCh4KgPerT: n(
        "compost_ch4_kg_per_t",
        DEFAULT_DIVERSION.compostCh4KgPerT,
      ),
      compostN2oKgPerT: n(
        "compost_n2o_kg_per_t",
        DEFAULT_DIVERSION.compostN2oKgPerT,
      ),
      adCh4KgPerT: n("ad_ch4_kg_per_t", DEFAULT_DIVERSION.adCh4KgPerT),
    } satisfies DiversionAssumptions,
    reportSlaHours: n("report_sla_hours", 72),
  };
}

export type Assumptions = ReturnType<typeof assumptionsFrom>;

/** Settings keys the sustainability screens read (all public). */
export const ASSUMPTION_KEYS = [
  "gwp100",
  "flare_destruction",
  "ch4_lhv_mj_per_kg",
  "engine_eff",
  "capture_eff",
  "ipcc_doc_food",
  "ipcc_docf",
  "ipcc_mcf",
  "ipcc_f",
  "ipcc_ox",
  "gwp100_n2o",
  "compost_ch4_kg_per_t",
  "compost_n2o_kg_per_t",
  "ad_ch4_kg_per_t",
  "report_sla_hours",
] as const;

/** Parse "month,composted_t,biogas_t" CSV text (header optional; month as YYYY-MM or YYYY-MM-DD). */
export function parseDiversionCsv(text: string): {
  rows: { month: string; compostedT: number; biogasT: number }[];
  errors: number[];
} {
  const rows: { month: string; compostedT: number; biogasT: number }[] = [];
  const errors: number[] = [];
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .forEach((line, i) => {
      if (!line || /^month\b/i.test(line)) return;
      const [m, c, b] = line.split(",").map((s) => s.trim());
      const month = /^\d{4}-\d{2}(-\d{2})?$/.test(m ?? "")
        ? `${m.slice(0, 7)}-01`
        : null;
      const compostedT = Number(c ?? "0");
      const biogasT = Number(b ?? "0");
      if (
        !month ||
        !Number.isFinite(compostedT) ||
        !Number.isFinite(biogasT) ||
        compostedT < 0 ||
        biogasT < 0
      )
        errors.push(i + 1);
      else rows.push({ month, compostedT, biogasT });
    });
  return { rows, errors };
}

// --- Row types for the dashboard and the scorecard ------------------------------------------------

export const MEASURE_KINDS = [
  "gas_collection",
  "flare_or_engine",
  "interim_cover",
  "biocover",
  "seep_repair",
  "fire_breaks",
  "organics_diversion",
  "biomining",
  "other",
] as const;
export type MeasureKind = (typeof MEASURE_KINDS)[number];
export const MEASURE_STATUSES = [
  "planned",
  "in_progress",
  "done",
  "stopped",
] as const;
export type MeasureStatus = (typeof MEASURE_STATUSES)[number];
export const CAPTURE_KINDS: MeasureKind[] = [
  "gas_collection",
  "flare_or_engine",
];
export const CONFIRM_METHODS = [
  "emit_match",
  "hyperspectral_tasking",
  "ogi_drone",
  "ground_survey",
] as const;
export type ConfirmMethod = (typeof CONFIRM_METHODS)[number];
export type FireStatus = "open" | "out" | "not_fire";
export type ReportKind = "smoke" | "fire" | "odour" | "dumping" | "burning";
export const REPORT_KINDS: ReportKind[] = [
  "smoke",
  "fire",
  "odour",
  "dumping",
  "burning",
];

export type MeasureEffect = {
  beforePasses: number;
  beforeFlags: number;
  afterPasses: number;
  afterFlags: number;
  pValue: number | null;
};

export type MeasureRow = {
  id: string;
  kind: MeasureKind;
  title: string;
  agency: string;
  status: MeasureStatus;
  startDate: string | null;
  captureShare: number | null;
  expectedTco2eYr: number | null;
  otherProgrammes: string | null;
  evidenceUrl: string | null;
  note: string | null;
  createdAt: string;
  effect: MeasureEffect | null;
};

export type FireRow = {
  id: string;
  source: string;
  acqAt: string;
  distM: number;
  confidence: string | null;
  frpMw: number | null;
  status: FireStatus;
  note: string | null;
};

export type ReportRow = {
  id: string;
  source: string;
  kind: ReportKind;
  reportedAt: string;
  distM: number | null;
  siteSlug: string | null;
  state: string | null;
  description: string | null;
  photoUrl: string | null;
  status: "open" | "closed";
  assignee: string | null;
  dueAt: string;
  closedAt: string | null;
  closingNote: string | null;
};

export type RemediationRow = {
  id: string;
  asOf: string;
  legacyTonnesTotal: number | null;
  tonnesProcessed: number;
  areaReclaimedHa: number | null;
  source: string;
};

export type MeterRow = {
  id: string;
  measureId: string | null;
  periodStart: string;
  periodEnd: string;
  ch4DestroyedT: number;
  meterId: string;
  verifiedBy: string | null;
  documentUrl: string | null;
};

export type DiversionRow = {
  city: string;
  month: string;
  compostedT: number;
  biogasT: number;
  source: string;
  avoidedTco2e: number;
};

export type ScorecardRow = {
  slug: string;
  name: string;
  city: string;
  state: string;
  month: string;
  passesMonth: number;
  t1Month: number;
  t2Month: number;
  t3Month: number;
  passesTotal: number;
  t1Total: number;
  t2Total: number;
  t3Total: number;
  minMeanKgph: number | null;
  tco2e100Yr: number | null;
  persistentUpperTph: number | null;
  confirmationsOpen: number;
  confirmationsConfirmed: number;
  confirmationsNotMethane: number;
  medianDaysToResult: number | null;
  fireDaysMonth: number;
  firesOpen: number;
  measuresPlanned: number;
  measuresInProgress: number;
  measuresDone: number;
  expectedTco2eYr: number | null;
  verifiedTco2eMonth: number | null;
  verifiedTco2eTotal: number | null;
  remediationAsOf: string | null;
  legacyTonnesTotal: number | null;
  tonnesProcessed: number | null;
  areaReclaimedHa: number | null;
  reportsMonth: number;
  reportsClosedMonth: number;
  medianHoursToClose: number | null;
};

export type PublicMeasure = {
  slug: string;
  kind: MeasureKind;
  title: string;
  agency: string;
  status: MeasureStatus;
  startDate: string | null;
  expectedTco2eYr: number | null;
};

const num = (v: unknown): number | null =>
  v === null || v === undefined || v === "" ? null : Number(v);
const int = (v: unknown): number => Number(v ?? 0);

/** site_scorecard() row (snake_case, numerics as strings or numbers) -> ScorecardRow. */
export function toScorecardRow(r: Record<string, unknown>): ScorecardRow {
  return {
    slug: String(r.slug),
    name: String(r.name),
    city: String(r.city),
    state: String(r.state),
    month: String(r.month),
    passesMonth: int(r.passes_month),
    t1Month: int(r.t1_month),
    t2Month: int(r.t2_month),
    t3Month: int(r.t3_month),
    passesTotal: int(r.passes_total),
    t1Total: int(r.t1_total),
    t2Total: int(r.t2_total),
    t3Total: int(r.t3_total),
    minMeanKgph: num(r.min_mean_kgph),
    tco2e100Yr: num(r.tco2e100_yr),
    persistentUpperTph: num(r.persistent_upper_tph),
    confirmationsOpen: int(r.confirmations_open),
    confirmationsConfirmed: int(r.confirmations_confirmed),
    confirmationsNotMethane: int(r.confirmations_not_methane),
    medianDaysToResult: num(r.median_days_to_result),
    fireDaysMonth: int(r.fire_days_month),
    firesOpen: int(r.fires_open),
    measuresPlanned: int(r.measures_planned),
    measuresInProgress: int(r.measures_in_progress),
    measuresDone: int(r.measures_done),
    expectedTco2eYr: num(r.expected_tco2e_yr),
    verifiedTco2eMonth: num(r.verified_tco2e_month),
    verifiedTco2eTotal: num(r.verified_tco2e_total),
    remediationAsOf: r.remediation_as_of ? String(r.remediation_as_of) : null,
    legacyTonnesTotal: num(r.legacy_tonnes_total),
    tonnesProcessed: num(r.tonnes_processed),
    areaReclaimedHa: num(r.area_reclaimed_ha),
    reportsMonth: int(r.reports_month),
    reportsClosedMonth: int(r.reports_closed_month),
    medianHoursToClose: num(r.median_hours_to_close),
  };
}

/** "2026-10" from a query parameter, or the current month (UTC) when it is missing or malformed. */
export function monthParam(
  raw: string | null | undefined,
  now = new Date(),
): string {
  if (raw && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) return raw;
  return now.toISOString().slice(0, 7);
}

/** Great-circle distance in metres (FIRMS detections against a site point). */
export function haversineM(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const r = 6_371_000;
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

// --- NASA FIRMS detections (parsed here so the unit tests can reach it) ---------------------------

/** A detection counts for a site when it falls within this distance of the site point. */
export const FIRE_RADIUS_M = 1000;

export type Detection = {
  source: string;
  acqAt: string;
  lat: number;
  lon: number;
  confidence: string | null;
  frpMw: number | null;
  distM: number;
};

/** Parse a FIRMS CSV by header name (VIIRS and MODIS share latitude, longitude, acq_date, acq_time, frp). */
export function parseFirmsCsv(
  text: string,
  source: string,
  site: { lat: number; lon: number },
): Detection[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2 || !lines[0].includes("latitude")) return [];
  const head = lines[0].split(",");
  const col = (name: string) => head.indexOf(name);
  const [iLat, iLon, iDate, iTime, iConf, iFrp] = [
    "latitude",
    "longitude",
    "acq_date",
    "acq_time",
    "confidence",
    "frp",
  ].map(col);
  const out: Detection[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",");
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    const date = c[iDate];
    const hhmm = (c[iTime] ?? "").padStart(4, "0");
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lon) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")
    )
      continue;
    const distM = haversineM(site.lat, site.lon, lat, lon);
    if (distM > FIRE_RADIUS_M) continue;
    out.push({
      source,
      acqAt: `${date}T${hhmm.slice(0, 2)}:${hhmm.slice(2, 4)}:00Z`,
      lat,
      lon,
      confidence: iConf >= 0 ? (c[iConf] ?? "").slice(0, 20) || null : null,
      frpMw: iFrp >= 0 && c[iFrp] !== "" ? Number(c[iFrp]) : null,
      distM: Math.round(distM),
    });
  }
  return out;
}
