"use client";

import {
  Moon,
  Pause,
  Play,
  RotateCcw,
  SkipForward,
  Sun,
  TriangleAlert,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";
import { makeFormat } from "@/lib/format";
import {
  RISE_PPM,
  SIM_SITES,
  createSim,
  emissionNow,
  evaluate,
  explain,
  istToday,
  median,
  moveNode,
  startLeak,
  step,
  type Controls,
  type NodeSim,
  type Sim,
  type SimEvent,
  type SimSite,
} from "@/lib/sensor-sim";
import modelJson from "@/lib/sensor-model.json";
import { isNight, type SensorModel } from "@/lib/sensors";
import { PlumeMap, statusOf, type NodeStatus } from "./PlumeMap";
import { SimChart } from "./SimChart";

const MODEL = modelJson as SensorModel;
const H = 3_600_000;
const STEP_MS = 700;
const SPEEDS = [1, 3, 10] as const;

type ScenarioKey = "front" | "evening" | "windy";
const SCENARIOS: Record<ScenarioKey, { hour: number; c: Controls }> = {
  front: {
    hour: 11,
    c: {
      windFromDeg: 250,
      windMs: 2.5,
      trendHpa3h: -2,
      sourceKgph: 250,
      rhPct: 70,
      tempC: 30,
    },
  },
  evening: {
    hour: 16,
    c: {
      windFromDeg: 250,
      windMs: 1.5,
      trendHpa3h: 0,
      sourceKgph: 250,
      rhPct: 70,
      tempC: 29,
    },
  },
  windy: {
    hour: 13,
    c: {
      windFromDeg: 250,
      windMs: 6,
      trendHpa3h: 2,
      sourceKgph: 250,
      rhPct: 60,
      tempC: 31,
    },
  },
};

const COMPASS = ["n", "ne", "e", "se", "s", "sw", "w", "nw"] as const;
const compassKey = (deg: number) => COMPASS[Math.round(deg / 45) % 8];

const primary =
  "inline-flex items-center gap-1.5 rounded-lg bg-leaf px-3 py-2 text-sm font-medium text-white hover:bg-leaf/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf";
const quiet =
  "inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-sm hover:border-leaf focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf disabled:cursor-not-allowed disabled:opacity-60";

function StatusChip({ s, label }: { s: NodeStatus; label: string }) {
  const tone = {
    clear: "bg-sprout text-canopy",
    warning: "bg-amber-100 text-tier-3-ink",
    rise: "bg-red-100 text-tier-1-ink",
  }[s];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap ${tone}`}
    >
      {label}
    </span>
  );
}

function Slider({
  id,
  label,
  display,
  value,
  min,
  max,
  step: stepBy,
  onChange,
  note,
}: {
  id: string;
  label: string;
  display: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  note?: string;
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <label htmlFor={id}>{label}</label>
        <span className="shrink-0 font-mono text-canopy">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={stepBy}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1.5 w-full accent-[#1E7B45]"
      />
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

function Spark({ pts, max }: { pts: number[]; max: number }) {
  if (pts.length < 2) return null;
  const d = pts
    .map(
      (v, i) =>
        `${i ? "L" : "M"}${((i / (pts.length - 1)) * 100).toFixed(1)} ${(22 - (Math.min(Math.max(v, 0), max) / max) * 20).toFixed(1)}`,
    )
    .join("");
  return (
    <svg
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className="mt-2 h-6 w-full"
      aria-hidden
    >
      <path
        d={d}
        fill="none"
        stroke="#1E7B45"
        strokeWidth="1.5"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

const niceMax = (v: number) =>
  v <= 40
    ? 40
    : v <= 60
      ? 60
      : v <= 100
        ? 100
        : v <= 200
          ? 200
          : Math.ceil(v / 100) * 100;

/**
 * The interactive sensor network: five simulated nodes around a landfill, the early-warning model
 * running on each new reading, and the network's alert rules. Everything runs in the browser.
 */
export function SensorSimulator() {
  const t = useTranslations("Simulator");
  const locale = useLocale();
  const f = makeFormat(locale);
  const simRef = useRef<Sim | null>(null);
  const startRef = useRef(0);
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const [controls, setControls] = useState<Controls>(SCENARIOS.front.c);
  const controlsRef = useRef(controls);
  const [scenario, setScenario] = useState<ScenarioKey | "custom" | "forecast">(
    "front",
  );
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<(typeof SPEEDS)[number]>(1);
  const [selected, setSelected] = useState("P1");
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const [siteSlug, setSiteSlug] = useState<SimSite["slug"]>("deonar");
  const [wx, setWx] = useState<{
    state: "idle" | "loading" | "loaded" | "failed";
    site?: string;
  }>({ state: "idle" });

  // Start after mount: the clock uses today's date, so the simulator is not rendered on the server.
  useEffect(() => {
    startRef.current = istToday(Date.now(), SCENARIOS.front.hour);
    simRef.current = createSim(SCENARIOS.front.c, startRef.current, MODEL);
    setPlaying(!window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    bump();
  }, [bump]);

  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      if (!simRef.current) return;
      step(simRef.current, controlsRef.current, MODEL);
      bump();
    }, STEP_MS / speed);
    return () => window.clearInterval(id);
  }, [playing, speed, bump]);

  const site = SIM_SITES.find((s) => s.slug === siteSlug) ?? SIM_SITES[3];

  const restart = (c: Controls, t0: number, at: SimSite = site) => {
    controlsRef.current = c;
    setControls(c);
    startRef.current = t0;
    simRef.current = createSim(c, t0, MODEL, at);
    setHoverAt(null);
    bump();
  };

  const setControl = (patch: Partial<Controls>) => {
    const next = { ...controlsRef.current, ...patch };
    controlsRef.current = next;
    setControls(next);
    setScenario("custom");
    if (simRef.current) {
      evaluate(simRef.current, next, MODEL);
      bump();
    }
  };

  const onMove = useCallback(
    (code: string, x: number, y: number) => {
      if (!simRef.current) return;
      moveNode(simRef.current, code, x, y, controlsRef.current, MODEL);
      bump();
    },
    [bump],
  );

  const loadForecast = async () => {
    setWx({ state: "loading" });
    try {
      const r = await fetch(`/api/open/weather?site=${siteSlug}`);
      if (!r.ok) throw new Error(String(r.status));
      const j = (await r.json()) as {
        at: number;
        windMs: number;
        windFromDeg: number;
        rhPct: number;
        tempC: number;
        trendHpa3h: number;
      };
      const round = (v: number, lo: number, hi: number) =>
        Math.min(hi, Math.max(lo, Math.round(v * 10) / 10));
      restart(
        {
          windFromDeg: Math.round(j.windFromDeg) % 360,
          windMs: round(j.windMs, 0.5, 8),
          trendHpa3h: round(j.trendHpa3h, -4, 4),
          sourceKgph: controlsRef.current.sourceKgph,
          rhPct: Math.round(j.rhPct),
          tempC: j.tempC,
        },
        j.at,
        site,
      );
      setScenario("forecast");
      setWx({ state: "loaded", site: site.name });
    } catch {
      setWx({ state: "failed" });
    }
  };

  const sim = simRef.current;
  if (!sim)
    return (
      <div className="flex aspect-[16/9] items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground">
        {t("starting")}
      </div>
    );

  const tag = locale === "hi" ? "hi-IN" : "en-IN";
  const fmtTime = (ms: number) =>
    new Intl.DateTimeFormat(tag, {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone: "Asia/Kolkata",
    }).format(new Date(ms));
  const night = isNight(sim.t);
  const sel = sim.nodes.find((n) => n.code === selected) ?? sim.nodes[0];
  const role = (n: NodeSim) => t(`roles.${n.role}`);
  const lastOf = (n: NodeSim) => n.track[n.track.length - 1];
  const statusLabel = (n: NodeSim) => t(`status.${statusOf(n)}`);
  const leakLeft = Math.max(0, (sim.leakUntil - sim.t) / 60_000);
  const trendWord =
    controls.trendHpa3h <= -0.3
      ? t("controls.falling")
      : controls.trendHpa3h >= 0.3
        ? t("controls.rising")
        : t("controls.steady");
  const windLabel = t("map.windFrom", {
    dir: t(`compass.${compassKey(controls.windFromDeg)}`),
    ms: f.num(controls.windMs, 1),
  });
  const leadMedian = median(sim.tally.leads);

  const eventText = (e: SimEvent) => {
    switch (e.kind) {
      case "warning":
        return t("log.warning", { code: e.code, p: f.pct(e.p) });
      case "rise":
        return e.leadMin === null
          ? t("log.riseUnwarned", { code: e.code, ppm: f.num(e.ppm) })
          : t("log.riseWarned", {
              code: e.code,
              ppm: f.num(e.ppm),
              min: f.num(e.leadMin),
            });
      case "noRise":
        return t("log.noRise", { code: e.code });
      case "clear":
        return t("log.clear", { code: e.code });
      case "leak":
        return t("log.leak");
    }
  };
  const eventDot = (e: SimEvent) =>
    e.kind === "rise"
      ? "bg-[#DC2626]"
      : e.kind === "warning"
        ? "bg-[#F59E0B]"
        : e.kind === "leak"
          ? "bg-[#B45309]"
          : "bg-muted-foreground";

  const selLast = lastOf(sel);
  const t0 = sim.t - 6 * H;
  const ppmPts = sel.track.map((p) => ({ at: p.at, v: p.ppm }));
  const pPts = sel.track
    .filter((p) => p.p !== null)
    .map((p) => ({ at: p.at, v: p.p as number }));
  const yMax = niceMax(Math.max(RISE_PPM * 1.3, ...ppmPts.map((p) => p.v)));
  const why = sel.features
    ? explain(MODEL, sel.features)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
        .slice(0, 5)
    : [];
  // Bars scale to the largest effect shown (at least 25 points), so small effects stay visible.
  const whyScale = Math.max(0.25, ...why.map((w) => Math.abs(w.delta)));

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-border bg-card px-4 py-3 text-sm">
            <span className="flex items-center gap-2 font-mono text-base text-canopy">
              {night ? (
                <Moon className="size-4" aria-hidden />
              ) : (
                <Sun className="size-4" aria-hidden />
              )}
              {t("clock", { time: fmtTime(sim.t) })}
            </span>
            <span className="text-muted-foreground">
              {night ? t("night") : t("day")}
            </span>
            <span>
              {t("pressure", {
                hpa: f.num(sim.pressure, 1),
                trend: trendWord,
              })}
            </span>
            <span>{t("emission", { kgph: f.num(emissionNow(sim)) })}</span>
            <span className="rounded-full bg-sky px-2 py-0.5 text-xs font-semibold text-[#1F4A5C]">
              {t("simulated")}
            </span>
          </div>
          <PlumeMap
            sim={sim}
            version={version}
            selected={sel.code}
            onSelect={setSelected}
            onMove={onMove}
            windLabel={windLabel}
            nodeLabel={(n) =>
              t("map.node", {
                code: n.code,
                role: role(n),
                ppm: f.num(lastOf(n)?.ppm ?? 0, 1),
                status: statusLabel(n),
              })
            }
          />
        </div>

        <aside className="min-w-0 space-y-6">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className={primary}
              onClick={() => setPlaying((p) => !p)}
            >
              {playing ? (
                <Pause className="size-4" aria-hidden />
              ) : (
                <Play className="size-4" aria-hidden />
              )}
              {playing ? t("controls.pause") : t("controls.play")}
            </button>
            <button
              type="button"
              className={quiet}
              onClick={() => {
                step(sim, controlsRef.current, MODEL);
                bump();
              }}
            >
              <SkipForward className="size-4" aria-hidden />
              {t("controls.step")}
            </button>
            <div
              role="group"
              aria-label={t("controls.speed")}
              className="flex overflow-hidden rounded-lg border border-border"
            >
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={speed === s}
                  onClick={() => setSpeed(s)}
                  className={`px-2.5 py-2 font-mono text-sm ${speed === s ? "bg-sprout text-canopy" : "bg-card hover:bg-muted"}`}
                >
                  {s}×
                </button>
              ))}
            </div>
            <button
              type="button"
              className={quiet}
              onClick={() =>
                restart(controlsRef.current, startRef.current, sim.site)
              }
            >
              <RotateCcw className="size-4" aria-hidden />
              {t("controls.reset")}
            </button>
          </div>

          <fieldset>
            <legend className="font-heading text-base font-semibold text-canopy">
              {t("scenarios.title")}
            </legend>
            <div className="mt-2 grid gap-2">
              {(Object.keys(SCENARIOS) as ScenarioKey[]).map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={scenario === k}
                  onClick={() => {
                    restart(
                      SCENARIOS[k].c,
                      istToday(Date.now(), SCENARIOS[k].hour),
                    );
                    setScenario(k);
                    setSelected("P1");
                  }}
                  className={`rounded-lg border p-3 text-left focus-visible:outline-2 focus-visible:outline-leaf ${scenario === k ? "border-leaf bg-[#EAF7E4]" : "border-border bg-card hover:border-leaf"}`}
                >
                  <span className="block text-sm font-semibold text-canopy">
                    {t(`scenarios.${k}.name`)}
                  </span>
                  <span className="block text-xs text-foreground/80">
                    {t(`scenarios.${k}.text`)}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="space-y-1.5">
            <button
              type="button"
              className={quiet}
              disabled={leakLeft > 0}
              onClick={() => {
                startLeak(sim);
                bump();
              }}
            >
              <TriangleAlert className="size-4 text-tier-3-ink" aria-hidden />
              {leakLeft > 0
                ? t("leak.open", { min: f.num(leakLeft) })
                : t("leak.button")}
            </button>
            <p className="text-xs text-muted-foreground">{t("leak.note")}</p>
          </div>

          <div className="space-y-4">
            <h2 className="font-heading text-base font-semibold text-canopy">
              {t("controls.title")}
            </h2>
            <Slider
              id="sim-wind-dir"
              label={t("controls.windFrom")}
              display={t("controls.windFromValue", {
                deg: Math.round(controls.windFromDeg),
                dir: t(`compass.${compassKey(controls.windFromDeg)}`),
              })}
              value={controls.windFromDeg}
              min={0}
              max={359}
              step={1}
              onChange={(v) => setControl({ windFromDeg: v })}
            />
            <Slider
              id="sim-wind-speed"
              label={t("controls.windSpeed")}
              display={t("controls.ms", { v: f.num(controls.windMs, 1) })}
              value={controls.windMs}
              min={0.5}
              max={8}
              step={0.1}
              onChange={(v) => setControl({ windMs: v })}
            />
            <Slider
              id="sim-trend"
              label={t("controls.trend")}
              display={t("controls.trendValue", {
                v: f.num(controls.trendHpa3h, 1),
                word: trendWord,
              })}
              value={controls.trendHpa3h}
              min={-4}
              max={4}
              step={0.1}
              onChange={(v) => setControl({ trendHpa3h: v })}
            />
            <Slider
              id="sim-source"
              label={t("controls.source")}
              display={t("controls.kgph", { v: f.num(controls.sourceKgph) })}
              value={controls.sourceKgph}
              min={50}
              max={1000}
              step={50}
              onChange={(v) => setControl({ sourceKgph: v })}
              note={t("controls.sourceNote")}
            />
          </div>

          <div className="space-y-2 rounded-xl border border-border bg-card p-4">
            <h2 className="font-heading text-base font-semibold text-canopy">
              {t("forecast.title")}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="sim-site" className="sr-only">
                {t("forecast.site")}
              </label>
              <select
                id="sim-site"
                value={siteSlug}
                onChange={(e) => setSiteSlug(e.target.value as SimSite["slug"])}
                className="rounded-lg border border-border bg-card px-3 py-2 text-sm"
              >
                {SIM_SITES.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {t(`sites.${s.slug}`)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={quiet}
                disabled={wx.state === "loading"}
                onClick={loadForecast}
              >
                {wx.state === "loading"
                  ? t("forecast.loading")
                  : t("forecast.load")}
              </button>
            </div>
            <p className="text-xs text-muted-foreground" aria-live="polite">
              {wx.state === "loaded"
                ? t("forecast.loaded", {
                    site: t(`sites.${siteSlug}`),
                  })
                : wx.state === "failed"
                  ? t("forecast.failed")
                  : t("forecast.hint")}
            </p>
          </div>
        </aside>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {sim.nodes.map((n) => {
          const last = lastOf(n);
          const bg = n.role === "background";
          const isSel = n.code === sel.code;
          return (
            <li key={n.code} className="min-w-0">
              <button
                type="button"
                aria-pressed={isSel}
                onClick={() => setSelected(n.code)}
                className={`w-full rounded-xl border bg-card p-3 text-left focus-visible:outline-2 focus-visible:outline-leaf ${isSel ? "border-leaf ring-1 ring-leaf" : "border-border hover:border-leaf"}`}
              >
                <span className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">
                    {n.code}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {role(n)}
                  </span>
                  {!bg && (
                    <span className="ml-auto">
                      <StatusChip s={statusOf(n)} label={statusLabel(n)} />
                    </span>
                  )}
                </span>
                <span className="mt-2 block font-mono text-xl text-canopy">
                  {last
                    ? bg
                      ? t("ppm", { v: f.num(last.ppm, 2) })
                      : t("ppmPlus", { v: f.num(Math.max(0, last.ppm), 1) })
                    : "—"}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {bg ? t("tile.level") : t("tile.excess")}
                </span>
                {!bg && (
                  <span className="mt-1 block text-xs">
                    {t("tile.chance")}{" "}
                    <span className="font-mono">
                      {last?.p != null ? f.pct(last.p) : "—"}
                    </span>
                  </span>
                )}
                <Spark
                  pts={n.track.map((p) => p.ppm)}
                  max={
                    bg
                      ? 4
                      : Math.max(RISE_PPM * 1.3, ...n.track.map((p) => p.ppm))
                  }
                />
              </button>
            </li>
          );
        })}
      </ul>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,380px)]">
        <section className="min-w-0 space-y-5 rounded-xl border border-border bg-card p-4">
          <h2 className="font-heading text-lg font-semibold text-canopy">
            {t("detail.title", {
              code: sel.code,
              role: role(sel),
              m: f.num(Math.hypot(sel.x, sel.y), 0),
            })}
          </h2>
          {sel.role === "background" ? (
            <p className="text-sm text-foreground/85">
              {t("detail.background")}
            </p>
          ) : !selLast ? (
            <p className="text-sm text-muted-foreground">
              {t("detail.noForecast")}
            </p>
          ) : (
            <>
              <SimChart
                title={t("detail.excessChart")}
                points={ppmPts}
                t0={t0}
                t1={sim.t}
                yMax={yMax}
                yTicks={[0, RISE_PPM, yMax]}
                fmtY={(v) => f.num(v)}
                fmtTime={fmtTime}
                refLine={{
                  v: RISE_PPM,
                  label: t("detail.riseLine", { v: RISE_PPM }),
                }}
                hoverAt={hoverAt}
                onHover={setHoverAt}
              />
              <SimChart
                title={t("detail.chanceChart")}
                points={pPts}
                t0={t0}
                t1={sim.t}
                yMax={1}
                yTicks={[0, 0.5, 1]}
                fmtY={(v) => f.pct(v)}
                fmtTime={fmtTime}
                refLine={{
                  v: MODEL.threshold,
                  label: t("detail.alertLine", {
                    v: f.pct(MODEL.threshold),
                  }),
                }}
                hoverAt={hoverAt}
                onHover={setHoverAt}
                height={110}
              />
              <div>
                <h3 className="text-sm font-medium text-canopy">
                  {t("detail.why")}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {t("detail.whyNote")}
                </p>
                <ul className="mt-3 space-y-2">
                  {why.map((w) => {
                    const pts = Math.round(w.delta * 100);
                    const width = (Math.abs(w.delta) / whyScale) * 50;
                    return (
                      <li
                        key={w.key}
                        className="grid grid-cols-[minmax(0,1fr)_minmax(80px,140px)_5.5rem] items-center gap-3 text-sm"
                      >
                        <span className="min-w-0">{t(`groups.${w.key}`)}</span>
                        <span
                          className="relative h-2 rounded-full bg-muted"
                          aria-hidden
                        >
                          <span className="absolute top-[-3px] left-1/2 h-3.5 w-px bg-canopy/40" />
                          <span
                            className="absolute top-0 h-2 rounded-full"
                            style={{
                              left: w.delta >= 0 ? "50%" : `${50 - width}%`,
                              width: `${width}%`,
                              background: w.delta >= 0 ? "#B45309" : "#1F4A5C",
                            }}
                          />
                        </span>
                        <span className="text-right font-mono text-xs">
                          {t(pts >= 0 ? "detail.up" : "detail.down", {
                            v: f.num(Math.abs(pts)),
                          })}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </>
          )}
        </section>

        <section className="min-w-0 space-y-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-heading text-base font-semibold text-canopy">
              {t("tally.title")}
            </h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
              {(
                [
                  ["warnings", f.num(sim.tally.warnings)],
                  ["rises", f.num(sim.tally.rises)],
                  [
                    "warned",
                    `${f.num(sim.tally.warned)} / ${f.num(sim.tally.rises)}`,
                  ],
                  [
                    "lead",
                    leadMedian === null
                      ? "—"
                      : t("tally.minutes", { n: f.num(leadMedian) }),
                  ],
                  ["noRise", f.num(sim.tally.noRise)],
                ] as const
              ).map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-muted-foreground">
                    {t(`tally.${k}`)}
                  </dt>
                  <dd className="font-mono text-lg text-canopy">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-heading text-base font-semibold text-canopy">
              {t("log.title")}
            </h2>
            {sim.events.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("log.empty")}
              </p>
            ) : (
              <ol
                role="log"
                className="mt-3 max-h-80 space-y-2.5 overflow-y-auto pr-1"
              >
                {sim.events
                  .slice(-40)
                  .reverse()
                  .map((e) => (
                    <li
                      key={`${e.at}-${e.kind}-${"code" in e ? e.code : ""}`}
                      className="flex gap-3 text-sm"
                    >
                      <span className="w-11 shrink-0 font-mono text-xs leading-5 text-muted-foreground">
                        {fmtTime(e.at)}
                      </span>
                      <span
                        className={`mt-1.5 size-2 shrink-0 rounded-full ${eventDot(e)}`}
                        aria-hidden
                      />
                      <span className="min-w-0">{eventText(e)}</span>
                    </li>
                  ))}
              </ol>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
