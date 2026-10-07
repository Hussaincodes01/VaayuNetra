// Unit tests for src/lib/sensor-sim.ts, the engine behind the public /simulator page: the scenarios
// the page offers behave as its text says, and dragging a node never fabricates an alert.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  FEATURE_GROUPS,
  RISE_PPM,
  createSim,
  explain,
  istToday,
  median,
  moveNode,
  startLeak,
  step,
} from "../../src/lib/sensor-sim.ts";

const model = JSON.parse(
  readFileSync(
    new URL("../../src/lib/sensor-model.json", import.meta.url),
    "utf8",
  ),
);
const day = Date.parse("2026-10-07T06:00:00Z");
const controls = (o) => ({
  windFromDeg: 250,
  windMs: 2.5,
  trendHpa3h: 0,
  sourceKgph: 250,
  rhPct: 70,
  tempC: 30,
  ...o,
});
const run = (c, hour, steps) => {
  const sim = createSim(c, istToday(day, hour), model);
  for (let i = 0; i < steps; i++) step(sim, c, model);
  return sim;
};

test("a run starts with 6 hours of readings and forecasts on every node", () => {
  const sim = createSim(controls(), istToday(day, 11), model);
  assert.equal(sim.nodes.length, 5);
  for (const n of sim.nodes) {
    assert.equal(n.points.length, 37);
    assert.ok(n.track.length >= 30, `${n.code} track ${n.track.length}`);
  }
  assert.equal(sim.events.length, 0);
});

test("falling pressure: the downwind node is warned well before the rise", () => {
  const sim = run(controls({ trendHpa3h: -2 }), 11, 36);
  const rise = sim.events.find((e) => e.kind === "rise");
  assert.ok(rise, "a rise happens");
  assert.ok(
    rise.leadMin !== null && rise.leadMin >= 60,
    `lead ${rise.leadMin}`,
  );
  assert.equal(sim.tally.warned, sim.tally.rises);
});

test("windy with rising pressure: no warnings and no rises", () => {
  const sim = run(controls({ windMs: 6, trendHpa3h: 2 }), 13, 36);
  assert.equal(sim.tally.warnings, 0);
  assert.equal(sim.tally.rises, 0);
});

test("a crack in the cover raises methane downwind", () => {
  const c = controls();
  const quiet = run(c, 11, 6);
  const leak = createSim(c, istToday(day, 11), model);
  startLeak(leak);
  for (let i = 0; i < 6; i++) step(leak, c, model);
  const p1 = (s) => s.nodes.find((n) => n.code === "P1").track.at(-1).ppm;
  assert.ok(p1(leak) > p1(quiet) + 10, `${p1(leak)} vs ${p1(quiet)}`);
  assert.equal(leak.events[0].kind, "leak");
});

test("moving a node into the plume re-simulates it but opens no alert", () => {
  const c = controls();
  const sim = run(c, 22, 3); // night: stable air keeps the plume concentrated
  const before = sim.events.length;
  const rises = sim.tally.rises;
  // P2 sits off the plume axis; move it 200 m downwind of the centre.
  const to = ((250 + 180) % 360) * (Math.PI / 180);
  moveNode(sim, "P2", 200 * Math.sin(to), 200 * Math.cos(to), c, model);
  const p2 = sim.nodes.find((n) => n.code === "P2");
  assert.ok(p2.track.at(-1).ppm >= RISE_PPM, `ppm ${p2.track.at(-1).ppm}`);
  assert.equal(sim.events.length, before);
  assert.equal(sim.tally.rises, rises);
  assert.equal(p2.points.length, 37);
});

test("explain covers every feature once and median works", () => {
  const idx = FEATURE_GROUPS.flatMap((g) => g.idx).sort((a, b) => a - b);
  assert.deepEqual(idx, [...Array(14).keys()]);
  const sim = run(controls({ trendHpa3h: -2 }), 11, 6);
  const x = sim.nodes.find((n) => n.code === "P1").features;
  const parts = explain(model, x);
  assert.equal(parts.length, FEATURE_GROUPS.length);
  assert.ok(parts.every((p) => Number.isFinite(p.delta)));
  assert.equal(median([]), null);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 2, 3]), 2.5);
});

test("istToday lands on the IST hour of the same IST day", () => {
  const t = istToday(Date.parse("2026-10-07T20:00:00Z"), 11); // 01:30 IST on 8 Oct
  assert.equal(new Date(t).toISOString(), "2026-10-08T05:30:00.000Z");
});
