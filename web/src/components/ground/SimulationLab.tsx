"use client";

import { Pause, Play, RotateCcw } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { GroundSim, K, S, loadFirmware } from "@/lib/ground/sim";
import {
  getJson,
  type ReplayResult,
  type SiteBundle,
  type SiteIndex,
} from "@/lib/ground/types";
import { cn } from "@/lib/utils";
import { LineChart } from "./LineChart";
import { MeshCheck } from "./MeshCheck";
import { NodeInspector } from "./NodeInspector";
import { PlanView } from "./PlanView";
import type { Snapshot } from "./snapshot";

const Site3D = dynamic(() => import("./Site3D"), { ssr: false });

type Knob = {
  k: number;
  key: string;
  min: number;
  max: number;
  step: number;
  def: number;
  scale?: number;
};

const GROUPS: { key: string; knobs: Knob[] }[] = [
  {
    key: "weather",
    knobs: [
      { k: K.windFrom, key: "windFrom", min: 0, max: 359, step: 1, def: 270 },
      { k: K.windMs, key: "windMs", min: 0, max: 12, step: 0.1, def: 3 },
      { k: K.temp, key: "temp", min: 5, max: 48, step: 0.5, def: 28 },
      { k: K.rh, key: "rh", min: 10, max: 100, step: 1, def: 65 },
      { k: K.dpdt, key: "dpdt", min: -2, max: 2, step: 0.1, def: 0 },
      { k: K.sun, key: "sun", min: 0, max: 1, step: 0.05, def: 0.8 },
    ],
  },
  {
    key: "methane",
    knobs: [
      { k: K.leakKgph, key: "leak", min: 0, max: 5000, step: 50, def: 1500 },
      {
        k: K.leakStartS,
        key: "leakAfter",
        min: 0,
        max: 240,
        step: 5,
        def: 60,
        scale: 60,
      },
      { k: K.bgPpm, key: "bgPpm", min: 1.8, max: 5, step: 0.1, def: 2 },
      { k: K.risePpm, key: "rise", min: 2, max: 50, step: 1, def: 10 },
    ],
  },
  {
    key: "fire",
    knobs: [
      { k: K.firePm, key: "firePm", min: 100, max: 1500, step: 10, def: 450 },
      { k: K.pmBg, key: "pmBg", min: 10, max: 300, step: 5, def: 60 },
    ],
  },
  {
    key: "radio",
    knobs: [
      { k: K.sf, key: "sf", min: 7, max: 12, step: 1, def: 7 },
      { k: K.txDbm, key: "txDbm", min: 2, max: 22, step: 1, def: 20 },
      { k: K.plExp, key: "plExp", min: 2, max: 4, step: 0.1, def: 2.9 },
      { k: K.shadowDb, key: "shadow", min: 0, max: 12, step: 0.5, def: 6 },
    ],
  },
  {
    key: "power",
    knobs: [
      { k: K.panelW, key: "panel", min: 1, max: 20, step: 1, def: 6 },
      { k: K.cells, key: "cells", min: 1, max: 4, step: 1, def: 3 },
      { k: K.mcuMa, key: "mcu", min: 5, max: 80, step: 1, def: 12 },
      { k: K.soil, key: "soil", min: 0.4, max: 1, step: 0.05, def: 0.85 },
    ],
  },
];

const SPEEDS = [60, 300, 1200, 3600];
const HISTORY_MAX = 1500;
const REPLAY_EVERY_MIN = 10;

type History = {
  m: number;
  tp: number[];
  pp: number[];
  bs: number[];
  soc: number[];
};

function defaults(windFrom: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (const g of GROUPS) for (const k of g.knobs) out[k.k] = k.def;
  out[K.windFrom] = Math.round(windFrom);
  out[K.bw] = 125_000;
  out[K.heaterSwitch] = 1;
  return out;
}

export function SimulationLab() {
  const t = useTranslations("Ground.sim");
  const tr = useTranslations("Ground.roles");
  // Knob and legend labels are keys chosen at run time; the catalogue is typed.
  const tk = (k: string) => t(k as Parameters<typeof t>[0]);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const [sites, setSites] = useState<SiteIndex>([]);
  const [slug, setSlug] = useState("deonar");
  const [bundle, setBundle] = useState<SiteBundle | null>(null);
  const [fw, setFw] = useState<WebAssembly.Module | null>(null);
  const [error, setError] = useState("");
  const [knobs, setKnobs] = useState<Record<number, number>>(() =>
    defaults(270),
  );
  const [hour, setHour] = useState(10);
  const [speed, setSpeed] = useState(300);
  const [running, setRunning] = useState(false);
  const [view, setView] = useState<"3d" | "plan">(token ? "3d" : "plan");
  const [selected, setSelected] = useState(-1);
  const [fireNode, setFireNode] = useState(-1);
  const [gatewayDown, setGatewayDown] = useState(false);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [chartTick, setChartTick] = useState(0);
  const [replay, setReplay] = useState<ReplayResult | null>(null);
  const [replayMsg, setReplayMsg] = useState("");
  const [auto, setAuto] = useState(true);
  const [build, setBuild] = useState(0);

  const sim = useRef<GroundSim | null>(null);
  const simMs = useRef(0);
  const startUnix = useRef(0);
  const lines = useRef<string[]>([]);
  const lineSeen = useRef(0);
  const txSeen = useRef(0);
  const packets = useRef<Snapshot["packets"]>([]);
  const history = useRef<History[]>([]);
  const plume = useRef<{ at: number; cells: Snapshot["plume"]; cell: number }>({
    at: -1,
    cells: [],
    cell: 50,
  });
  const downFrom = useRef<number | null>(null);
  const lastReplayMin = useRef(-1);
  const replaying = useRef(false);
  const knobsRef = useRef(knobs);
  useEffect(() => {
    knobsRef.current = knobs;
  }, [knobs]);

  useEffect(() => {
    loadFirmware().then(setFw, (e: Error) => setError(e.message));
    getJson<SiteIndex>("/ground/data/sites/index.json").then(
      setSites,
      (e: Error) => setError(e.message),
    );
  }, []);

  useEffect(() => {
    setBundle(null);
    getJson<SiteBundle>(`/ground/data/sites/${slug}.json`).then(
      (b) => {
        setKnobs(defaults(b.site.wind.prevailing_from_deg));
        setBundle(b);
      },
      (e: Error) => setError(e.message),
    );
  }, [slug]);

  const snapshot = useCallback((): Snapshot | null => {
    const s = sim.current;
    if (!s || !bundle) return null;
    const nodes = bundle.lab.nodes;
    if (plume.current.at < 0 || performance.now() - plume.current.at > 1000) {
      const xs = [
        ...bundle.lab.outline_xy.map((p) => p[0]),
        ...nodes.filter((n) => n.role !== "background").map((n) => n.x),
      ];
      const ys = [
        ...bundle.lab.outline_xy.map((p) => p[1]),
        ...nodes.filter((n) => n.role !== "background").map((n) => n.y),
      ];
      const x0 = Math.min(...xs) - 500;
      const x1 = Math.max(...xs) + 500;
      const y0 = Math.min(...ys) - 500;
      const y1 = Math.max(...ys) + 500;
      const cell = Math.max(x1 - x0, y1 - y0) / 44;
      const bg = s.get(K.bgPpm);
      const cells: Snapshot["plume"] = [];
      for (let x = x0 + cell / 2; x < x1; x += cell)
        for (let y = y0 + cell / 2; y < y1; y += cell) {
          const ex = s.truePpmAt(x, y) - bg;
          if (ex >= 0.5) cells.push({ x, y, ex });
        }
      plume.current = { at: performance.now(), cells, cell };
    }
    const now = performance.now();
    packets.current = packets.current.filter((p) => now - p.born < 900);
    return {
      simMs: simMs.current,
      states: nodes.map((_, i) => s.state(i)),
      packets: packets.current,
      plume: plume.current.cells,
      plumeCell: plume.current.cell,
      leak: { x: s.get(K.leakX), y: s.get(K.leakY) },
      wind: { from: s.get(K.windFrom), ms: s.get(K.windMs) },
    };
  }, [bundle]);

  const collect = useCallback(() => {
    const s = sim.current;
    if (!s || !bundle) return;
    const n = s.lineCount();
    for (let k = Math.max(lineSeen.current, n - 256); k < n; k++) {
      const l = s.line(k);
      if (l !== null) lines.current.push(l);
    }
    lineSeen.current = n;
    if (lines.current.length > 20_000)
      lines.current = lines.current.slice(-12_000);
    const count = s.txCount();
    if (count - txSeen.current > 256) txSeen.current = count - 256;
    const born = performance.now();
    while (txSeen.current < count) {
      const p = s.tx(txSeen.current);
      if (!p.delivered) break;
      packets.current.push({
        src: p.src,
        type: p.type,
        relay: p.relay,
        heard: p.heard,
        born,
      });
      txSeen.current++;
    }
    if (packets.current.length > 24)
      packets.current = packets.current.slice(-24);
    const m = Math.floor(simMs.current / 60_000);
    const h = history.current;
    if (!h.length || h[h.length - 1].m !== m) {
      const st = bundle.lab.nodes.map((_, i) => s.state(i));
      h.push({
        m,
        tp: st.map((x) => x[S.truePpm]),
        pp: st.map((x) => x[S.ppm]),
        bs: st.map((x) => x[S.base]),
        soc: st.map((x) => x[S.soc]),
      });
      if (h.length > HISTORY_MAX) h.shift();
    }
  }, [bundle]);

  // Build the network: every planned node of the site, the gateway first, the knobs applied.
  useEffect(() => {
    if (!fw || !bundle) return;
    const s = new GroundSim(fw);
    startUnix.current = bundle.lab.local_midnight_unix + hour * 3600;
    s.reset(1, startUnix.current);
    for (const [k, v] of Object.entries(knobsRef.current)) {
      const knob = GROUPS.flatMap((g) => g.knobs).find(
        (x) => x.k === Number(k),
      );
      s.set(Number(k), v * (knob?.scale ?? 1));
    }
    const hot = bundle.lab.hotspots[0];
    s.set(K.leakX, hot ? hot.x : 0);
    s.set(K.leakY, hot ? hot.y : 0);
    for (const n of bundle.lab.nodes)
      s.add(n.role, n.x, n.y, n.has_wind, n.has_pms);
    s.runUntil(0);
    sim.current = s;
    simMs.current = 0;
    lines.current = [];
    lineSeen.current = 0;
    txSeen.current = 0;
    packets.current = [];
    history.current = [];
    plume.current = { at: -1, cells: [], cell: 50 };
    downFrom.current = null;
    lastReplayMin.current = -1;
    setFireNode(-1);
    setGatewayDown(false);
    setReplay(null);
    setReplayMsg("");
    setSelected((i) => (i < bundle.lab.nodes.length ? i : -1));
    collect();
    setSnap(snapshot());
    return () => {
      sim.current = null;
    };
  }, [fw, bundle, hour, build, collect, snapshot]);

  const runReplay = useCallback(async () => {
    if (replaying.current || !lines.current.length || !bundle) return;
    replaying.current = true;
    try {
      const r = await fetch("/api/ground?op=replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          site: bundle.site.slug,
          lines: lines.current.slice(-12_000),
          gateway_down_from: downFrom.current,
        }),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.detail || `HTTP ${r.status}`);
      setReplay(d as ReplayResult);
      setReplayMsg("");
    } catch (e) {
      setReplayMsg((e as Error).message);
    } finally {
      replaying.current = false;
    }
  }, [bundle]);

  // The run loop: advance the firmware by real time x speed, redraw at about 5 frames a second.
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = 0;
    let lastDraw = 0;
    let lastChart = 0;
    const frame = (ts: number) => {
      const s = sim.current;
      if (!s) return;
      const dt = Math.min(250, ts - (last || ts));
      last = ts;
      simMs.current += dt * speed;
      s.runUntil(simMs.current);
      collect();
      if (ts - lastDraw > 180) {
        lastDraw = ts;
        setSnap(snapshot());
      }
      if (ts - lastChart > 1000) {
        lastChart = ts;
        setChartTick((c) => c + 1);
      }
      const m = Math.floor(simMs.current / (REPLAY_EVERY_MIN * 60_000));
      if (auto && m > 0 && m !== lastReplayMin.current) {
        lastReplayMin.current = m;
        void runReplay();
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      // Once paused, let the last packets fade instead of freezing on the map.
      setTimeout(() => setSnap(snapshot()), 1000);
    };
  }, [running, speed, auto, collect, snapshot, runReplay]);

  const setKnob = (knob: Knob, v: number) => {
    setKnobs((k) => ({ ...k, [knob.k]: v }));
    sim.current?.set(knob.k, v * (knob.scale ?? 1));
    if (!running) setSnap(snapshot());
  };
  const setRaw = (k: number, v: number) => {
    setKnobs((x) => ({ ...x, [k]: v }));
    sim.current?.set(k, v);
  };
  const pick = useCallback(
    (x: number, y: number) => {
      sim.current?.set(K.leakX, x);
      sim.current?.set(K.leakY, y);
      plume.current.at = -1;
      setSnap(snapshot());
    },
    [snapshot],
  );
  const select = useCallback((i: number) => setSelected(i), []);

  if (error)
    return (
      <p
        role="alert"
        className="rounded-lg border border-tier-1/40 bg-[#FEF2F2] p-3 text-sm text-tier-1-ink"
      >
        {t("failed")} ({error})
      </p>
    );
  if (!bundle || !fw || !snap)
    return <p className="text-sm text-muted-foreground">{t("loading")}</p>;

  const nodes = bundle.lab.nodes;
  const clock = new Date(
    (startUnix.current + snap.simMs / 1000 + bundle.lab.utc_offset_h * 3600) *
      1000,
  )
    .toISOString()
    .slice(11, 19);
  const reports = snap.states.reduce(
    (a, s, i) => a + (nodes[i].role === "gateway" ? 0 : s[S.reports]),
    0,
  );
  const delivered = lines.current.reduce(
    (a, l) => a + (l.includes('"type":"data"') ? 1 : 0),
    0,
  );
  const h = history.current;
  const sel = selected >= 0 ? selected : -1;
  void chartTick;

  return (
    <section className="space-y-6" aria-labelledby="sim-title">
      <div className="space-y-1">
        <h2
          id="sim-title"
          className="font-heading text-xl font-semibold text-canopy"
        >
          {t("title")}
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("intro")}</p>
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-border bg-card p-3 text-sm">
        <label className="grid gap-1">
          <span className="text-muted-foreground">{t("site")}</span>
          <select
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            className="rounded-md border border-border bg-card px-2 py-1.5"
          >
            {sites.map((s) => (
              <option key={s.slug} value={s.slug}>
                {s.name}, {s.city}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">{t("startHour")}</span>
          <input
            type="number"
            min={0}
            max={23}
            value={hour}
            onChange={(e) =>
              setHour(Math.max(0, Math.min(23, Number(e.target.value) || 0)))
            }
            className="w-20 rounded-md border border-border bg-card px-2 py-1.5"
          />
        </label>
        <label className="grid gap-1">
          <span className="text-muted-foreground">{t("speed")}</span>
          <select
            value={speed}
            onChange={(e) => setSpeed(Number(e.target.value))}
            className="rounded-md border border-border bg-card px-2 py-1.5"
          >
            {SPEEDS.map((v) => (
              <option key={v} value={v}>
                {v}×
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          onClick={() => setRunning((r) => !r)}
          aria-pressed={running}
          className="inline-flex items-center gap-1.5 rounded-md bg-leaf px-3 py-1.5 font-medium text-white hover:bg-leaf/90"
        >
          {running ? (
            <Pause className="size-4" aria-hidden />
          ) : (
            <Play className="size-4" aria-hidden />
          )}
          {running ? t("pause") : t("play")}
        </button>
        <button
          type="button"
          onClick={() => setBuild((b) => b + 1)}
          className="inline-flex items-center gap-1.5 rounded-md border border-leaf px-3 py-1.5 text-leaf hover:bg-sprout/40"
        >
          <RotateCcw className="size-4" aria-hidden /> {t("restart")}
        </button>
        <div className="flex rounded-md border border-border" role="group">
          {(["3d", "plan"] as const).map((v) => (
            <button
              key={v}
              type="button"
              disabled={v === "3d" && !token}
              onClick={() => setView(v)}
              aria-pressed={view === v}
              className={cn(
                "px-3 py-1.5 disabled:opacity-50",
                view === v
                  ? "bg-sprout font-medium text-canopy"
                  : "text-muted-foreground",
              )}
            >
              {v === "3d" ? t("view3d") : t("viewPlan")}
            </button>
          ))}
        </div>
        <p className="ml-auto font-mono text-sm">
          <span className="font-sans text-muted-foreground">{t("clock")} </span>
          {clock}{" "}
          <span className="text-muted-foreground">
            (+{(snap.simMs / 3_600_000).toFixed(2)} h)
          </span>
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[260px_minmax(0,1fr)_320px]">
        <aside
          className="max-h-[780px] space-y-3 overflow-y-auto rounded-xl border border-border bg-card p-3 text-sm"
          aria-label={t("weather")}
        >
          {GROUPS.map((g) => (
            <fieldset
              key={g.key}
              className="rounded-lg border border-border px-3 pt-1 pb-2"
            >
              <legend className="px-1 font-heading text-sm font-semibold text-canopy">
                {tk(g.key)}
              </legend>
              {g.knobs.map((knob) => (
                <label
                  key={knob.k}
                  className="mt-2 grid grid-cols-[1fr_auto] items-center gap-x-2 text-xs"
                >
                  <span>{tk(knob.key)}</span>
                  <output className="font-mono text-canopy">
                    {knobs[knob.k]}
                  </output>
                  <input
                    type="range"
                    min={knob.min}
                    max={knob.max}
                    step={knob.step}
                    value={knobs[knob.k]}
                    onChange={(e) => setKnob(knob, Number(e.target.value))}
                    className="col-span-2 accent-leaf"
                  />
                </label>
              ))}
              {g.key === "methane" && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {t("sourceHint")}
                </p>
              )}
              {g.key === "fire" && (
                <label className="mt-2 grid gap-1 text-xs">
                  {t("fireNode")}
                  <select
                    value={fireNode}
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      setFireNode(v);
                      sim.current?.set(K.fireStartS, simMs.current / 1000);
                      sim.current?.set(K.fireNode, v);
                    }}
                    className="rounded-md border border-border bg-card px-2 py-1"
                  >
                    <option value={-1}>{t("none")}</option>
                    {nodes.map(
                      (n, i) =>
                        n.role !== "gateway" && (
                          <option key={n.id} value={i}>
                            {n.id}
                          </option>
                        ),
                    )}
                  </select>
                </label>
              )}
              {g.key === "radio" && (
                <label className="mt-2 grid gap-1 text-xs">
                  {t("bw")}
                  <select
                    value={knobs[K.bw]}
                    onChange={(e) => setRaw(K.bw, Number(e.target.value))}
                    className="rounded-md border border-border bg-card px-2 py-1"
                  >
                    <option value={125000}>125</option>
                    <option value={250000}>250</option>
                  </select>
                </label>
              )}
              {g.key === "power" && (
                <label className="mt-2 grid gap-1 text-xs">
                  {t("heaterSwitch")}
                  <select
                    value={knobs[K.heaterSwitch]}
                    onChange={(e) =>
                      setRaw(K.heaterSwitch, Number(e.target.value))
                    }
                    className="rounded-md border border-border bg-card px-2 py-1"
                  >
                    <option value={1}>{t("heaterGpio")}</option>
                    <option value={0}>{t("heaterNone")}</option>
                  </select>
                </label>
              )}
            </fieldset>
          ))}
          <fieldset className="rounded-lg border border-border px-3 pt-1 pb-3">
            <legend className="px-1 font-heading text-sm font-semibold text-canopy">
              {t("faults")}
            </legend>
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={gatewayDown}
                className="accent-leaf"
                onChange={(e) => {
                  setGatewayDown(e.target.checked);
                  sim.current?.set(K.gatewayDown, e.target.checked ? 1 : 0);
                  downFrom.current = e.target.checked
                    ? Math.round(startUnix.current + simMs.current / 1000)
                    : null;
                }}
              />
              {t("gatewayDown")}
            </label>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={sel < 0}
                onClick={() => {
                  const s = sim.current;
                  if (!s || sel < 0) return;
                  s.kill(sel, s.state(sel)[S.alive] === 1);
                  setSnap(snapshot());
                }}
                className="rounded-md border border-leaf px-2 py-1 text-xs text-leaf disabled:opacity-50"
              >
                {sel >= 0 && snap.states[sel][S.alive] === 0
                  ? t("revive")
                  : t("kill")}
              </button>
              <button
                type="button"
                disabled={sel < 0 || nodes[sel]?.role === "gateway"}
                onClick={() => {
                  sim.current?.setSoc(sel, 0.15);
                  setSnap(snapshot());
                }}
                className="rounded-md border border-leaf px-2 py-1 text-xs text-leaf disabled:opacity-50"
              >
                {t("drain")}
              </button>
            </div>
          </fieldset>
        </aside>

        <div className="space-y-2">
          <div
            className={cn(
              "relative overflow-hidden rounded-xl border border-border bg-sky",
              view === "3d" ? "h-[640px]" : "",
            )}
          >
            {view === "3d" && token ? (
              <Site3D
                token={token}
                bundle={bundle}
                snap={snap}
                selected={sel}
                onSelect={select}
                onPick={pick}
                label={t("title")}
                leakLabel={t("legend.leak")}
              />
            ) : (
              <PlanView
                bundle={bundle}
                snap={snap}
                selected={sel}
                onSelect={select}
                onPick={pick}
                label={t("title")}
              />
            )}
          </div>
          <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {[
              ["#1E7B45", "ok"],
              ["#DC2626", "rise"],
              ["#94A3B8", "off"],
              ["#F59E0B", "plume"],
            ].map(([c, k]) => (
              <li key={k} className="flex items-center gap-1.5">
                <span
                  aria-hidden
                  className="size-2.5 rounded-full"
                  style={{ background: c }}
                />
                {tk(`legend.${k}`)}
              </li>
            ))}
            <li className="flex items-center gap-1.5">
              <span aria-hidden className="h-0.5 w-4 bg-leaf" />
              {t("legend.packet")}
            </li>
          </ul>
          <p className="text-xs text-muted-foreground">
            {t("clickNode")} {view === "3d" && t("basemapNote")}
          </p>
          <p className="text-sm">
            {t("delivery")}:{" "}
            <span className="font-mono">
              {Math.min(delivered, reports)} / {reports}
              {reports
                ? ` (${((100 * Math.min(delivered, reports)) / reports).toFixed(1)} %)`
                : ""}
            </span>
          </p>
        </div>

        <NodeInspector
          sim={sim.current}
          snap={snap}
          nodes={nodes}
          selected={sel}
          roleLabel={(r) => tr(r)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-heading text-base font-semibold text-canopy">
            {t("chartPpm")}
            {sel >= 0 ? `: ${nodes[sel].id}` : ""}
          </h3>
          {sel >= 0 && nodes[sel].role !== "gateway" && h.length > 1 ? (
            <LineChart
              label={t("chartPpm")}
              x={h.map((r) => r.m)}
              xFormat={(v) => `${(v / 60).toFixed(1)} h`}
              yLabel="ppm"
              yMin={0}
              series={[
                {
                  name: t("chartTrue"),
                  color: "#0E3B2A",
                  values: h.map((r) => r.tp[sel]),
                },
                {
                  name: t("chartEst"),
                  color: "#DC2626",
                  width: 2.5,
                  values: h.map((r) =>
                    Number.isFinite(r.pp[sel]) ? r.pp[sel] : null,
                  ),
                },
                {
                  name: t("chartBase"),
                  color: "#64748B",
                  dash: "5 4",
                  values: h.map((r) =>
                    Number.isFinite(r.bs[sel]) ? r.bs[sel] : null,
                  ),
                },
              ]}
              threshold={{
                value:
                  (Number.isFinite(h[h.length - 1].bs[sel])
                    ? h[h.length - 1].bs[sel]
                    : 2) + knobs[K.risePpm],
                label: t("chartRise"),
              }}
            />
          ) : (
            <p className="mt-2 text-sm text-muted-foreground">
              {t("clickNode")}
            </p>
          )}
        </section>
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-heading text-base font-semibold text-canopy">
            {t("chartSoc")}
          </h3>
          {h.length > 1 && (
            <LineChart
              label={t("chartSoc")}
              x={h.map((r) => r.m)}
              xFormat={(v) => `${(v / 60).toFixed(1)} h`}
              yLabel="%"
              yMin={0}
              yMax={100}
              threshold={{ value: 25, label: t("heaterCut") }}
              series={nodes.flatMap((n, i) =>
                n.role === "gateway"
                  ? []
                  : [
                      {
                        name: n.id,
                        color: [
                          "#1E7B45",
                          "#4A86CF",
                          "#B45309",
                          "#7E22CE",
                          "#0E3B2A",
                          "#0891B2",
                          "#BE185D",
                          "#64748B",
                        ][i % 8],
                        values: h.map((r) => 100 * r.soc[i]),
                      },
                    ],
              )}
            />
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card p-4">
          <h3 className="font-heading text-base font-semibold text-canopy">
            {t("console")}
          </h3>
          <pre
            tabIndex={0}
            className="mt-2 max-h-80 overflow-auto rounded-lg border border-border bg-cloud p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap text-foreground"
          >
            {lines.current.slice(-30).join("\n")}
          </pre>
        </section>
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h3 className="font-heading text-base font-semibold text-canopy">
            {t("pi")}
          </h3>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <button
              type="button"
              onClick={() => void runReplay()}
              className="rounded-md bg-leaf px-3 py-1.5 font-medium text-white hover:bg-leaf/90"
            >
              {t("piRun")}
            </button>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => setAuto(e.target.checked)}
                className="accent-leaf"
              />
              {t("piAuto")}
            </label>
          </div>
          <p role="status" className="text-xs text-muted-foreground">
            {replayMsg ||
              (replay
                ? t("piStatus", {
                    n: replay.lines,
                    a: replay.accepted,
                    s: replay.skipped,
                  })
                : "")}
          </p>
          <h4 className="font-heading text-sm font-semibold text-canopy">
            {t("events")}
          </h4>
          {replay && replay.events.length ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-muted-foreground">
                  <tr>
                    <th className="py-1 pr-3">{t("kind")}</th>
                    <th className="pr-3">{t("nodes")}</th>
                    <th className="pr-3">{t("status")}</th>
                    <th className="pr-3">{t("opened")}</th>
                    <th className="pr-3">{t("windCheck")}</th>
                    <th>{t("peak")}</th>
                  </tr>
                </thead>
                <tbody>
                  {replay.events.map((e, i) => (
                    <tr key={i} className="border-t border-border">
                      <td className="py-1 pr-3">{e.kind.replace("_", " ")}</td>
                      <td className="pr-3">
                        {e.node_id ?? e.nodes.join(", ")}
                      </td>
                      <td className="pr-3">{e.status}</td>
                      <td className="pr-3 font-mono">
                        +{e.opened_minute} {t("minute")}
                      </td>
                      <td className="pr-3">{e.wind_check ?? ""}</td>
                      <td className="font-mono">
                        {e.peak === null ? "" : e.peak.toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">{t("noEvents")}</p>
          )}
          {replay && replay.sms.length > 0 && (
            <>
              <h4 className="font-heading text-sm font-semibold text-canopy">
                {t("sms")}
              </h4>
              <ul className="space-y-2 text-xs">
                {replay.sms.slice(-6).map((m, i) => (
                  <li
                    key={i}
                    lang={m.language}
                    className="rounded-lg bg-cloud p-2"
                  >
                    <span className="font-medium">
                      {m.to} ({m.language})
                    </span>
                    : {m.text}
                  </li>
                ))}
              </ul>
            </>
          )}
          {replay && replay.timeline.length > 0 && (
            <>
              <h4 className="font-heading text-sm font-semibold text-canopy">
                {t("timeline")}
              </h4>
              <ul className="max-h-48 space-y-1 overflow-auto text-xs">
                {replay.timeline.slice(-20).map((x, i) => (
                  <li key={i} className={x.sms ? "text-tier-3-ink" : ""}>
                    <span className="inline-block min-w-16 font-mono text-muted-foreground">
                      +{x.minute} {t("minute")}
                    </span>{" "}
                    {x.text}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      </div>

      <MeshCheck fw={fw} />
      <p className="text-xs text-muted-foreground">{t("screening")}</p>
    </section>
  );
}
