// Seed VayuNetra from the ops notebook export in data/seed/.
//
//   node supabase/seed.ts            writes supabase/seed.sql (loaded by `supabase db reset`)
//   node supabase/seed.ts --remote   upserts into SUPABASE_URL with SUPABASE_SERVICE_ROLE_KEY
//
// Inputs: scan_all_passes.csv, confirmed_events.csv (Monte Carlo q_med/q_lo/q_hi),
// site_sensitivity.csv (persistent-emission bounds printed by the notebook), model_sha256.txt and
// model_card.json (copied from the model zip). Needs Node 24+ (runs TypeScript directly).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SEED_DIR = join(ROOT, "data", "seed");

// Landfills from the ops notebook (SITES): lat, lon, elevation (m), city.
const LANDFILLS = [
  { name: "Ghazipur", lat: 28.6247, lon: 77.3272, elev: 210, city: "Delhi", state: "Delhi" },
  { name: "Bhalswa", lat: 28.7406, lon: 77.1582, elev: 215, city: "Delhi", state: "Delhi" },
  { name: "Okhla", lat: 28.5125, lon: 77.2835, elev: 205, city: "Delhi", state: "Delhi" },
  { name: "Deonar", lat: 19.0717, lon: 72.9278, elev: 10, city: "Mumbai", state: "Maharashtra" },
  { name: "Pirana", lat: 22.9762, lon: 72.5656, elev: 50, city: "Ahmedabad", state: "Gujarat" },
];
// Control point ≈5 km north of each landfill (CONTROL_OFFSET_DEG in the notebook).
const CONTROL_OFFSET_DEG = 0.045;

type Row = Record<string, string>;

type Site = {
  slug: string;
  name: string;
  city: string;
  state: string;
  kind: "landfill" | "control";
  lat: number;
  lon: number;
  elev_m: number;
  control_of_slug: string | null;
};

type Scan = {
  site_slug: string;
  pass_date: string;
  overpass_utc: string;
  satellite: string;
  sza: number | null;
  vza: number | null;
  scene_score: number;
  detected: boolean;
  tier: "T1" | "T2" | "T3" | "none";
  surface_kind: string | null;
  q_kgph: number | null;
  q_med: number | null;
  q_lo: number | null;
  q_hi: number | null;
  u10: number | null;
  wind_u: number | null;
  wind_v: number | null;
  d_b12: number | null;
  d_b11: number | null;
  d_visnir: number | null;
  elong: number | null;
  axis_vs_wind: number | null;
  src_dist_m: number | null;
  threshold_used: number;
  model_version: string;
};

type Setting = { key: string; value: unknown; is_public: boolean };

// --- CSV --------------------------------------------------------------------------------------

function parseCsv(path: string): Row[] {
  const text = readFileSync(path, "utf8").replace(/^﻿/, "");
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      record.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      if (record.some((f) => f !== "")) records.push(record);
      record = [];
      field = "";
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length) {
    record.push(field);
    records.push(record);
  }
  const [header, ...rows] = records;
  return rows.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const num = (s: string | undefined): number | null => {
  if (s === undefined || s.trim() === "" || s === "nan" || s === "NaN") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

const slugOf = (siteName: string): string =>
  siteName.trim().toLowerCase().replace(/\s+/g, "-");

// --- Build rows -------------------------------------------------------------------------------

function buildSites(): Site[] {
  const sites: Site[] = [];
  for (const l of LANDFILLS) {
    sites.push({
      slug: slugOf(l.name),
      name: l.name,
      city: l.city,
      state: l.state,
      kind: "landfill",
      lat: l.lat,
      lon: l.lon,
      elev_m: l.elev,
      control_of_slug: null,
    });
  }
  for (const l of LANDFILLS) {
    sites.push({
      slug: slugOf(`${l.name} control`),
      name: `${l.name} control`,
      city: l.city,
      state: l.state,
      kind: "control",
      lat: Math.round((l.lat + CONTROL_OFFSET_DEG) * 1e4) / 1e4,
      lon: l.lon,
      elev_m: l.elev,
      control_of_slug: slugOf(l.name),
    });
  }
  return sites;
}

function readModel(): { modelVersion: string; threshold: number; card: Record<string, unknown> } {
  const sha = readFileSync(join(SEED_DIR, "model_sha256.txt"), "utf8").trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(sha)) throw new Error(`bad SHA256 in model_sha256.txt: ${sha}`);
  const card = JSON.parse(readFileSync(join(SEED_DIR, "model_card.json"), "utf8"));
  return { modelVersion: sha.slice(0, 12), threshold: Number(card.scene_threshold), card };
}

function buildScans(modelVersion: string, threshold: number, siteSlugs: Set<string>): Scan[] {
  const confirmed = new Map<string, Row>();
  for (const r of parseCsv(join(SEED_DIR, "confirmed_events.csv"))) {
    confirmed.set(`${r.site}|${r.date}`, r);
  }
  return parseCsv(join(SEED_DIR, "scan_all_passes.csv")).map((r) => {
    const slug = slugOf(r.site);
    if (!siteSlugs.has(slug)) throw new Error(`scan for unknown site ${r.site}`);
    const tier = r.tier === "-" || r.tier === "" ? "none" : r.tier;
    if (!["T1", "T2", "T3", "none"].includes(tier)) throw new Error(`bad tier ${r.tier}`);
    const mc = confirmed.get(`${r.site}|${r.date}`);
    return {
      site_slug: slug,
      pass_date: r.date,
      overpass_utc: new Date(Number(r.t_ms)).toISOString(),
      satellite: r.sat,
      sza: num(r.sza),
      vza: num(r.vza),
      scene_score: Number(r.scene_score),
      detected: r.detected === "True",
      tier: tier as Scan["tier"],
      surface_kind: r.surface_kind ? r.surface_kind : null,
      q_kgph: num(r.q_kgph),
      q_med: num(mc?.q_med),
      q_lo: num(mc?.q_lo),
      q_hi: num(mc?.q_hi),
      u10: num(r.u10),
      wind_u: num(r.u),
      wind_v: num(r.v),
      d_b12: num(r.dB12),
      d_b11: num(r.dB11),
      d_visnir: num(r.dVisNIR),
      elong: num(r.elong),
      axis_vs_wind: num(r.axis_vs_wind),
      src_dist_m: num(r.src_dist_m),
      threshold_used: threshold,
      model_version: modelVersion,
    };
  });
}

function buildSensitivity(): { site_slug: string; persistent_upper_tph: number | null }[] {
  return parseCsv(join(SEED_DIR, "site_sensitivity.csv")).map((r) => ({
    site_slug: slugOf(r.site),
    persistent_upper_tph: num(r.persistent_upper_tph),
  }));
}

function buildSettings(modelVersion: string, threshold: number): Setting[] {
  const pub = (key: string, value: unknown): Setting => ({ key, value, is_public: true });
  return [
    pub("model_version", modelVersion),
    pub("threshold_mode", "model_card"),
    // model_card: scene_threshold from the model card; india_calibrated: 99th percentile of the
    // 334 Indian control scenes (ops notebook Cell 7b).
    pub("thresholds", { model_card: threshold, india_calibrated: 0.793 }),
    pub("capture_eff", 0.6),
    pub("flare_destruction", 0.98),
    pub("gwp100", 27),
    pub("gwp20", 79.7),
    pub("power_price_inr_per_kwh", 5),
    pub("carbon_price_usd_per_t", 10),
    // Remaining ops-notebook assumptions, needed for the action plan's energy figures.
    pub("ch4_lhv_mj_per_kg", 50),
    pub("engine_eff", 0.35),
    pub("wind_rel_unc", 0.3),
    pub("calib_rel_unc", 0.2),
    { key: "alert_recipients", value: { Delhi: [], Maharashtra: [], Gujarat: [] }, is_public: false },
    // E.164 numbers for the optional WhatsApp/SMS alerts (ALERTS_TWILIO_ENABLED=true on Vercel).
    { key: "alert_phones", value: { Delhi: [], Maharashtra: [], Gujarat: [] }, is_public: false },
  ];
}

// --- SQL output -------------------------------------------------------------------------------

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "null";
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "null";
  return `'${String(v).replace(/'/g, "''")}'`;
};
const jsonLit = (v: unknown): string => `${lit(JSON.stringify(v))}::jsonb`;
const point = (lat: number, lon: number): string =>
  `extensions.st_geogfromtext('SRID=4326;POINT(${lon} ${lat})')`;
const siteId = (slug: string): string => `(select id from public.sites where slug = ${lit(slug)})`;

const SCAN_COLS = [
  "pass_date", "overpass_utc", "satellite", "sza", "vza", "scene_score", "detected", "tier",
  "surface_kind", "q_kgph", "q_med", "q_lo", "q_hi", "u10", "wind_u", "wind_v", "d_b12", "d_b11",
  "d_visnir", "elong", "axis_vs_wind", "src_dist_m", "threshold_used", "model_version",
] as const;

function toSql(sites: Site[], scans: Scan[], sens: ReturnType<typeof buildSensitivity>,
  settings: Setting[], modelVersion: string): string {
  const out: string[] = [
    "-- Generated by supabase/seed.ts from data/seed/. Do not edit by hand; re-run the script.",
    `-- ${sites.length} sites, ${scans.length} scans, model_version ${modelVersion}.`,
    "",
  ];

  for (const kind of ["landfill", "control"] as const) {
    const rows = sites.filter((s) => s.kind === kind).map((s) =>
      `  (${[lit(s.slug), lit(s.name), lit(s.city), lit(s.state), lit(s.kind),
        point(s.lat, s.lon), lit(s.elev_m), s.control_of_slug ? siteId(s.control_of_slug) : "null"].join(", ")})`);
    out.push(
      "insert into public.sites (slug, name, city, state, kind, geom, elev_m, control_of) values",
      rows.join(",\n"),
      "on conflict (slug) do update set name = excluded.name, city = excluded.city, state = excluded.state,",
      "  kind = excluded.kind, geom = excluded.geom, elev_m = excluded.elev_m, control_of = excluded.control_of;",
      "",
    );
  }

  const scanRows = scans.map((s) =>
    `  (${[siteId(s.site_slug), ...SCAN_COLS.map((c) => lit(s[c]))].join(", ")})`);
  out.push(
    `insert into public.scans (site_id, ${SCAN_COLS.join(", ")}) values`,
    scanRows.join(",\n"),
    "on conflict (site_id, pass_date, model_version) do update set",
    SCAN_COLS.filter((c) => c !== "pass_date" && c !== "model_version")
      .map((c) => `  ${c} = excluded.${c}`).join(",\n") + ";",
    "",
  );

  out.push(
    "insert into public.site_sensitivity (site_id, model_version, persistent_upper_tph) values",
    sens.map((s) => `  (${siteId(s.site_slug)}, ${lit(modelVersion)}, ${lit(s.persistent_upper_tph)})`).join(",\n"),
    "on conflict (site_id, model_version) do update set persistent_upper_tph = excluded.persistent_upper_tph;",
    "",
  );

  // Existing settings are left alone so a re-seed never overwrites edits made in the dashboard.
  out.push(
    "insert into public.settings (key, value, is_public) values",
    settings.map((s) => `  (${lit(s.key)}, ${jsonLit(s.value)}, ${lit(s.is_public)})`).join(",\n"),
    "on conflict (key) do nothing;",
    "",
  );
  return out.join("\n");
}

// --- Remote upsert through PostgREST ----------------------------------------------------------

async function upsert(base: string, key: string, table: string, rows: object[], onConflict: string,
  resolution: "merge-duplicates" | "ignore-duplicates"): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (let i = 0; i < rows.length; i += 500) {
    const res = await fetch(`${base}/rest/v1/${table}?on_conflict=${onConflict}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        Prefer: `resolution=${resolution},return=representation`,
      },
      body: JSON.stringify(rows.slice(i, i + 500)),
    });
    if (!res.ok) throw new Error(`${table}: ${res.status} ${await res.text()}`);
    out.push(...((await res.json()) as Record<string, unknown>[]));
  }
  return out;
}

async function seedRemote(sites: Site[], scans: Scan[], sens: ReturnType<typeof buildSensitivity>,
  settings: Setting[], modelVersion: string): Promise<void> {
  const base = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw new Error("set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY for --remote");

  const ids = new Map<string, string>();
  const siteRow = (s: Site) => ({
    slug: s.slug, name: s.name, city: s.city, state: s.state, kind: s.kind,
    geom: `SRID=4326;POINT(${s.lon} ${s.lat})`, elev_m: s.elev_m,
    control_of: s.control_of_slug ? ids.get(s.control_of_slug) : null,
  });
  for (const kind of ["landfill", "control"] as const) {
    const saved = await upsert(base, key, "sites", sites.filter((s) => s.kind === kind).map(siteRow),
      "slug", "merge-duplicates");
    for (const r of saved) ids.set(String(r.slug), String(r.id));
  }
  const scanRows = scans.map(({ site_slug, ...rest }) => ({ site_id: ids.get(site_slug), ...rest }));
  await upsert(base, key, "scans", scanRows, "site_id,pass_date,model_version", "merge-duplicates");
  await upsert(base, key, "site_sensitivity",
    sens.map((s) => ({ site_id: ids.get(s.site_slug), model_version: modelVersion,
      persistent_upper_tph: s.persistent_upper_tph })),
    "site_id,model_version", "merge-duplicates");
  await upsert(base, key, "settings", settings, "key", "ignore-duplicates");
}

// --- Main -------------------------------------------------------------------------------------

const { modelVersion, threshold } = readModel();
const sites = buildSites();
const scans = buildScans(modelVersion, threshold, new Set(sites.map((s) => s.slug)));
const sens = buildSensitivity();
const settings = buildSettings(modelVersion, threshold);

if (process.argv.includes("--remote")) {
  await seedRemote(sites, scans, sens, settings, modelVersion);
  console.log(`seeded ${sites.length} sites and ${scans.length} scans into ${process.env.SUPABASE_URL}`);
} else {
  const path = join(ROOT, "supabase", "seed.sql");
  writeFileSync(path, toSql(sites, scans, sens, settings, modelVersion));
  console.log(`wrote ${path}: ${sites.length} sites, ${scans.length} scans (model ${modelVersion})`);
}
