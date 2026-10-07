// Unit tests for src/lib/sustainability.ts (Node's test runner; Node 24 strips the TypeScript types).
// The expected values are the ones the SQL tests check in supabase/tests/database/07_sustainability.test.sql.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assumptionsFrom,
  captureEstimate,
  diversionAvoided,
  diversionPerTonne,
  haversineM,
  monthParam,
  parseDiversionCsv,
} from "../../src/lib/sustainability.ts";

const near = (actual, expected, tol, label) =>
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `${label}: ${actual} not within ${tol} of ${expected}`,
  );

test("capture plan matches the Deonar dossier (301 kg/h, 60% capture)", () => {
  const e = captureEstimate(301.2, 0.6);
  near(e.avoidedTco2eYr, 41893, 10, "avoided t CO2e a year");
  near(e.powerMw, 0.878, 0.002, "electric MW");
  near(e.annualTco2e, 71240, 20, "annual t CO2e");
});

test("diversion per tonne follows the IPCC 2006 defaults", () => {
  const per = diversionPerTonne();
  near(per.ch4PerTonne, 0.04, 1e-9, "CH4 potential t/t");
  near(per.composted, 0.90648, 1e-5, "composted, net of composting emissions");
  near(per.biogas, 1.0584, 1e-5, "biogas, net of digester leakage");
  near(
    diversionAvoided(100, 50),
    100 * 0.90648 + 50 * 1.0584,
    1e-6,
    "mixed tonnes",
  );
});

test("assumptions fall back to the defaults and read numeric settings", () => {
  const a = assumptionsFrom({
    gwp100: 27,
    capture_eff: "0.5",
    ipcc_mcf: "bad",
  });
  assert.equal(a.captureShare, 0.5);
  assert.equal(a.diversion.mcf, 0.8);
  assert.equal(a.reportSlaHours, 72);
});

test("diversion CSV: header skipped, bad lines reported by line number", () => {
  const { rows, errors } = parseDiversionCsv(
    "month,composted_t,biogas_t\n2026-08,120,30\n2026-09-01, 80 ,0\nSept,1,1\n2026-10,-5,0\n",
  );
  assert.deepEqual(rows, [
    { month: "2026-08-01", compostedT: 120, biogasT: 30 },
    { month: "2026-09-01", compostedT: 80, biogasT: 0 },
  ]);
  assert.deepEqual(errors, [4, 5]);
});

test("month parameter and distance helpers", () => {
  assert.equal(monthParam("2026-09"), "2026-09");
  assert.equal(
    monthParam("2026-13", new Date("2026-10-07T00:00:00Z")),
    "2026-10",
  );
  near(
    haversineM(19.07, 72.93, 19.08, 72.93),
    1112,
    2,
    "0.01 degree of latitude",
  );
});

test("FIRMS CSV: keeps detections within 1 km of the site, builds UTC times", async () => {
  const { parseFirmsCsv } = await import("../../src/lib/sustainability.ts");
  const csv = [
    "latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight",
    "28.6235,77.3271,330.1,0.39,0.36,2024-04-21,0812,N,VIIRS,n,2.0NRT,290.4,4.8,D",
    "28.6500,77.3271,331.0,0.39,0.36,2024-04-21,0812,N,VIIRS,h,2.0NRT,291.0,9.1,D",
  ].join("\n");
  const out = parseFirmsCsv(csv, "VIIRS_SNPP_SP", {
    lat: 28.6235,
    lon: 77.3265,
  });
  assert.equal(out.length, 1, "the second detection is about 3 km away");
  assert.equal(out[0].acqAt, "2024-04-21T08:12:00Z");
  assert.equal(out[0].confidence, "n");
  assert.equal(out[0].frpMw, 4.8);
  assert.ok(out[0].distM < 100);
  assert.deepEqual(
    parseFirmsCsv("Invalid MAP_KEY.", "VIIRS_SNPP_NRT", { lat: 0, lon: 0 }),
    [],
  );
});
