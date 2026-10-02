// Every number on the landing page that does not come from Supabase comes from here.
// Source of truth: .claude/CLAUDE.md (global benchmark, India field test, context facts).

export const BENCHMARK = {
  rocAuc: { vayunetra: 0.759, mbmp: 0.513 },
  recallAtFalseAlarm: [
    { falseAlarm: 0.05, vayunetra: 0.24, mbmp: 0.1 },
    { falseAlarm: 0.1, vayunetra: 0.34, mbmp: 0.15 },
    { falseAlarm: 0.2, vayunetra: 0.52, mbmp: 0.24 },
  ],
  operatingPoint: {
    precision: { vayunetra: 0.779, mbmp: 0.602 },
    recall: { vayunetra: 0.303, mbmp: 0.144 },
    falseAlarm: { vayunetra: 0.086, mbmp: 0.096 },
  },
  pixelIoU: { vayunetra: 0.312, mbmp: 0.077 },
  // Bins as listed in CLAUDE.md (t/h).
  recallByRate: [
    { bin: "<1", vayunetra: 0.09, mbmp: 0.27 },
    { bin: "3–5", vayunetra: 0.35, mbmp: 0.1 },
    { bin: "5–10", vayunetra: 0.34, mbmp: 0.1 },
    { bin: ">10", vayunetra: 0.37, mbmp: 0.06 },
  ],
  rateAccuracy: { withinHalf: 0.58, plumes: 839, medianRatio: 1.02 },
} as const;

export const MODEL = {
  encoder: "ResNet-50",
  pretraining: "SSL4EO-S12",
  inputChannels: 17,
  parametersM: 33.9,
  realPlumes: 3552,
  sceneThreshold: 0.844,
  windCalibration: { a: 0.14, b: 1.111 },
} as const;

export const FIELD_TEST = {
  window: { start: "2024-01", end: "2025-12" },
  controlDistanceKm: 5,
  scenes: { total: 674, landfill: 340, control: 334 },
  controlFalseAlarms: 0,
  flags: { landfill: 14, control: 0, pValue: "< 0.001" },
  indiaCalibrated: {
    threshold: 0.793,
    landfill: 31,
    control: 4,
    pValue: "≈ 1e-6",
  },
  tiers: { t1: 1, t2: 2, t3: 11, burnLikeGhazipur: 2 },
  t1: {
    slug: "deonar",
    date: "2025-01-06",
    tph: 20.2,
    lo: 15.1,
    hi: 25.0,
    windMs: 5.1,
  },
  t2: [
    { slug: "bhalswa", date: "2025-05-18", tph: 19.1 },
    { slug: "okhla", date: "2024-11-29", tph: null, windMs: 0.7 },
  ],
  persistentUpperTph: {
    ghazipur: 5,
    bhalswa: 5,
    deonar: 10,
    pirana: 10,
    okhla: 20,
  },
  perPassDetection: "25–35%",
  perPassDetectionMinTph: 10,
  knownTruthRatio: 0.98,
  knownTruthTph: 10,
  deonar: {
    minMeanKgph: 301,
    tco2e100Yr: 71000,
    captureShare: 0.6,
    avoidedTco2eYr: 41900,
    powerMw: 0.9,
  },
  fineTuneAuc: 0.55,
} as const;

export const CONTEXT = {
  warming20yr: 80,
  gwp20: 79.7,
  gwp100: 27.0,
  maasakkers: { low: 1.4, high: 2.6 },
  ghazipurFire: "2024-04",
  revisitDays: 5,
  netZeroYear: 2070,
} as const;

export const SOURCES = {
  ipcc: "https://www.ipcc.ch/report/ar6/wg1/chapter/chapter-7/",
  maasakkers: "https://doi.org/10.1126/sciadv.abn9683",
  github: "https://github.com/Hussaincodes01/VaayuNetra",
} as const;

// Fallback for the action plan when Supabase settings are not reachable (same values as the seed).
export const DEFAULT_ASSUMPTIONS = {
  capture_eff: 0.6,
  flare_destruction: 0.98,
  gwp100: 27,
  gwp20: 79.7,
  ch4_lhv_mj_per_kg: 50,
  engine_eff: 0.35,
  power_price_inr_per_kwh: 5,
  carbon_price_usd_per_t: 10,
} as const;

export type Assumptions = {
  -readonly [K in keyof typeof DEFAULT_ASSUMPTIONS]: number;
};
