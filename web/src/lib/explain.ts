import "server-only";

import type { ScanRow, SiteRow } from "./dashboard-shared";

/** The facts the briefing may use. Numbers are pre-rounded so the model never has to compute. */
export function siteFacts(
  site: SiteRow,
  scans: ScanRow[],
  gwp: { g100: number; g20: number },
) {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const flagged = scans.filter((s) => s.tier !== "none");
  const window = scans.length
    ? `${scans[0].passDate} to ${scans[scans.length - 1].passDate}`
    : null;
  return {
    site: site.name,
    city: site.city,
    state: site.state,
    scan_window: window,
    sentinel2_revisit_days: 5,
    clear_passes: site.passes,
    flags: site.flags,
    tiers: {
      T1_methane_confident: site.t1,
      T2_probable_needs_confirmation: site.t2,
      T3_surface_change_rejected: site.t3,
    },
    control_point: {
      distance_km: 5,
      passes: site.controlPasses,
      flags: site.controlFlags,
    },
    p_value_vs_control:
      site.pVsControl === null
        ? null
        : Math.round(site.pVsControl * 1000) / 1000,
    flagged_passes: flagged.map((s) => ({
      date: s.passDate,
      tier: s.tier,
      surface_kind: s.surfaceKind,
      rate_t_per_h:
        s.tier !== "T3" && s.qMed !== null ? r1(s.qMed / 1000) : null,
      rate_68pct_range_t_per_h:
        s.tier !== "T3" && s.qLo !== null && s.qHi !== null
          ? [r1(s.qLo / 1000), r1(s.qHi / 1000)]
          : null,
      rate_not_estimated_calm_wind: s.u10 !== null && s.u10 < 1.5,
      wind_m_per_s: s.u10 === null ? null : r1(s.u10),
      band12_change_percent: s.dB12 === null ? null : r1(s.dB12 * 100),
      band11_change_percent: s.dB11 === null ? null : r1(s.dB11 * 100),
      visible_nir_change_percent:
        s.dVisNir === null ? null : r1(s.dVisNir * 100),
    })),
    minimum_mean_rate_kg_per_h: site.minMeanKgph
      ? Math.round(site.minMeanKgph)
      : 0,
    minimum_annual_t_co2e_gwp100: site.tco2e100Yr
      ? Math.round(site.tco2e100Yr)
      : 0,
    minimum_annual_t_co2e_gwp20: site.tco2e20Yr
      ? Math.round(site.tco2e20Yr)
      : 0,
    gwp100: gwp.g100,
    gwp20: gwp.g20,
    persistent_emission_upper_bound_t_per_h: site.persistentUpperTph,
    bound_confidence_percent: 95,
    model_version: site.modelVersion,
  };
}

const DEVANAGARI = "०१२३४५६७८९";
const toLatin = (s: string) =>
  s.replace(/[०-९]/g, (d) => String(DEVANAGARI.indexOf(d)));

/** Every way a number from the facts may legitimately be written. */
export function allowedNumbers(facts: unknown): Set<string> {
  const out = new Set<string>([
    "1",
    "2",
    "3",
    "11",
    "12",
    "20",
    "100",
    "68",
    "95",
  ]); // T1-3, B11/B12, GWP20/100, CO2
  const add = (v: number) => {
    for (const x of [v, Math.abs(v)]) {
      out.add(String(x));
      for (const d of [0, 1, 2]) {
        const fixed = x.toFixed(d);
        out.add(fixed);
        out.add(fixed.replace(/\.0+$/, ""));
        out.add(Number(fixed).toLocaleString("en-US"));
        out.add(Number(fixed).toLocaleString("en-IN"));
      }
    }
  };
  const walk = (v: unknown) => {
    if (typeof v === "number") add(v);
    else if (typeof v === "string") {
      for (const m of v.match(/\d+(?:\.\d+)?/g) ?? []) {
        out.add(m);
        out.add(String(Number(m)));
      }
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(facts);
  return out;
}

/** Numbers in the text that do not come from the facts. */
export function strayNumbers(text: string, allowed: Set<string>): string[] {
  const found = toLatin(text).match(/\d[\d,]*(?:\.\d+)?/g) ?? [];
  return [...new Set(found.map((n) => n.replace(/[.,]$/, "")))].filter(
    (n) =>
      !allowed.has(n) &&
      !allowed.has(n.replace(/,/g, "")) &&
      !allowed.has(String(Number(n.replace(/,/g, "")))),
  );
}
