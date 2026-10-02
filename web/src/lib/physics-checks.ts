// Plain-language physics-gate checks from a scan's stored band changes. Same rules as the worker's
// physics_check (worker/src/vayunetra/physics.py). The tier stored with the scan is authoritative; these
// chips explain it.

import type { ScanRow } from "./dashboard-shared";

export type Check = {
  key: "b12" | "b11" | "vis" | "wind";
  /** Message key under Dash.physics, and the values it needs. */
  message: string;
  values: Record<string, number>;
  pass: boolean;
};

export function physicsChecks(
  s: Pick<ScanRow, "dB12" | "dB11" | "dVisNir" | "elong" | "axisVsWind">,
): Check[] {
  const out: Check[] = [];
  const { dB12, dB11, dVisNir, elong, axisVsWind } = s;
  if (dB12 === null) return out;
  const b12pct = Math.abs(dB12);
  out.push(
    dB12 < -0.01
      ? { key: "b12", message: "b12Pass", values: { pct: b12pct }, pass: true }
      : dB12 < 0
        ? {
            key: "b12",
            message: "b12Weak",
            values: { pct: b12pct },
            pass: false,
          }
        : {
            key: "b12",
            message: "b12Bright",
            values: { pct: b12pct },
            pass: false,
          },
  );
  if (dB11 !== null) {
    const pass = dB11 > 0.5 * dB12;
    out.push({
      key: "b11",
      message: pass ? "b11Pass" : "b11Fail",
      values: { pct: Math.abs(dB11) },
      pass,
    });
  }
  if (dVisNir !== null) {
    const pass = dVisNir < 0.5 * b12pct;
    out.push({
      key: "vis",
      message: pass ? "visPass" : "visFail",
      values: { pct: dVisNir },
      pass,
    });
  }
  if (elong !== null && elong < 2) {
    out.push({
      key: "wind",
      message: "windCompact",
      values: { elong },
      pass: true,
    });
  } else if (axisVsWind !== null) {
    const pass = axisVsWind <= 45;
    out.push({
      key: "wind",
      message: pass ? "windPass" : "windFail",
      values: { deg: axisVsWind },
      pass,
    });
  }
  return out;
}

/** One-sentence summary, e.g. "B12 dimmed 5.2% while visible bands barely changed (2.2%)". */
export function physicsSummary(
  s: Pick<ScanRow, "dB12" | "dVisNir">,
): { message: string; values: Record<string, number> } | null {
  if (s.dB12 === null || s.dVisNir === null) return null;
  if (s.dB12 < -0.01 && s.dVisNir < 0.5 * Math.abs(s.dB12)) {
    return {
      message: "summaryMethane",
      values: { b12: Math.abs(s.dB12), vis: s.dVisNir },
    };
  }
  if (s.dB12 < 0)
    return {
      message: "summaryBroadband",
      values: { b12: Math.abs(s.dB12), vis: s.dVisNir },
    };
  return { message: "summaryBright", values: { b12: s.dB12 } };
}

export const CALM_WIND_MS = 1.5;
