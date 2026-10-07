// Unit tests for src/lib/sensors.ts: physics shape, calibration round trip, determinism, features and
// the exported model (src/lib/sensor-model.json) behaving physically.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  DEFAULT_CALIBRATION,
  FEATURE_NAMES,
  bearingDeg,
  destination,
  excessSeries,
  features,
  plumeExcessPpm,
  ppmFromRs,
  predictRise,
  pumping,
  riseAhead,
  rsRatio,
  simulateReading,
  weatherAt,
} from "../../src/lib/sensors.ts";

const model = JSON.parse(
  readFileSync(
    new URL("../../src/lib/sensor-model.json", import.meta.url),
    "utf8",
  ),
);

const H = 3_600_000;
const flatWeather = (fromDeg, pressureAt = () => 1008) =>
  Array.from({ length: 48 }, (_, i) => ({
    t: Date.UTC(2026, 9, 7, 0) + i * H,
    pressureHpa: pressureAt(i),
    windMs: 2,
    windFromDeg: fromDeg,
    tempC: 28,
    rhPct: 70,
  }));

test("falling pressure pushes gas out, rising pressure holds it in", () => {
  assert.ok(pumping(-0.5) > 1 && pumping(0) === 1 && pumping(0.5) < 1);
});

test("the plume reaches nodes downwind, and more at night than by day", () => {
  // Wind from the west blows east: a node 300 m east is downwind, 300 m west is upwind.
  const down = plumeExcessPpm(250, 300, 0, 2, 270, false);
  const up = plumeExcessPpm(250, -300, 0, 2, 270, false);
  const night = plumeExcessPpm(250, 300, 0, 2, 270, true);
  assert.ok(down > 1, `downwind ${down}`);
  assert.ok(up < down / 10, `upwind ${up} vs downwind ${down}`);
  assert.ok(night > down, "stable night air keeps the plume near the ground");
});

test("calibration inverts the sensor response", () => {
  for (const ppm of [2, 25, 400, 5000]) {
    const rs = rsRatio(ppm, 80, 31, DEFAULT_CALIBRATION);
    assert.ok(Math.abs(ppmFromRs(rs, 80, 31) - ppm) / ppm < 1e-9);
  }
});

test("weather interpolates wind as a vector across north", () => {
  const w = [
    {
      t: 0,
      pressureHpa: 1000,
      windMs: 2,
      windFromDeg: 350,
      tempC: 20,
      rhPct: 50,
    },
    {
      t: H,
      pressureHpa: 1002,
      windMs: 2,
      windFromDeg: 10,
      tempC: 22,
      rhPct: 60,
    },
  ];
  const mid = weatherAt(w, H / 2);
  assert.ok(
    mid.windFromDeg < 1 || mid.windFromDeg > 359,
    `got ${mid.windFromDeg}`,
  );
  assert.equal(mid.pressureHpa, 1001);
});

test("a simulated reading is deterministic and realistic", () => {
  const site = { lat: 19.0717, lon: 72.9278 };
  const node = {
    code: "DEO-P1",
    role: "perimeter",
    ...destination(site.lat, site.lon, 90, 300),
  };
  const weather = flatWeather(270);
  const t = weather[10].t;
  const a = simulateReading(node, site, weather, t, weather[0].t);
  const b = simulateReading(node, site, weather, t, weather[0].t);
  assert.deepEqual(a, b);
  assert.ok(a.ch4_ppm > 2 && a.ch4_ppm < 2000, `ppm ${a.ch4_ppm}`);
  assert.ok(a.battery_v > 3.5 && a.battery_v < 4.3);
});

test("features need history and give 14 numbers; labels look ahead", () => {
  const weather = flatWeather(270, (i) => 1010 - i * 0.2);
  const t = weather[20].t;
  const pts = Array.from({ length: 40 }, (_, i) => ({
    at: t - 3 * H + i * 600_000,
    ppm: 3 + i,
  }));
  const ex = excessSeries(
    pts,
    pts.map((p) => ({ at: p.at, ppm: 2 })),
  );
  const x = features(t, ex, weather, 90);
  assert.equal(x.length, FEATURE_NAMES.length);
  assert.ok(x[4] < 0, "pressure fell over the last 3 hours");
  assert.equal(features(weather[0].t, [], weather, 90), null);
  // Excess climbs 1 ppm per 10 minutes and crosses 25 ppm about 70 minutes after t.
  assert.equal(riseAhead(t - H, ex, 25), true);
  assert.equal(riseAhead(t - 3 * H, ex, 25), false);
});

test("the trained model warns more for falling pressure, downwind, at night", () => {
  const base = Object.fromEntries(FEATURE_NAMES.map((n) => [n, 0]));
  const vec = (o) =>
    FEATURE_NAMES.map(
      (n) => ({ ...base, rh_now: 70, wind_now: 2, wind_next_3h: 2, ...o })[n],
    );
  const risky = predictRise(
    model,
    vec({
      excess_now: 12,
      excess_prev: 8,
      excess_trend: 4,
      excess_max_3h: 14,
      dp_past_3h: -1.2,
      dp_next_3h: -1.0,
      align_now: 1,
      align_next_3h: 1,
      night_next_3h: 1,
      hour_sin: -0.26,
      hour_cos: 0.97,
    }),
  );
  const calm = predictRise(
    model,
    vec({
      excess_now: 0.2,
      excess_prev: 0.2,
      dp_past_3h: 1.0,
      dp_next_3h: 0.8,
      align_now: -1,
      align_next_3h: -1,
      night_next_3h: 0,
      hour_sin: 0.5,
      hour_cos: -0.87,
    }),
  );
  assert.ok(
    risky > model.threshold && calm < model.threshold,
    `risky ${risky}, calm ${calm}`,
  );
  assert.equal(model.features.join(","), FEATURE_NAMES.join(","));
  assert.ok(bearingDeg(0, 0, 0, 1) > 89 && bearingDeg(0, 0, 0, 1) < 91);
});
