"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import {
  getJson,
  type Score,
  type WindBacktest,
  type WindLead,
  type WindLive,
} from "@/lib/ground/types";
import { BarChart, LineChart, type Series } from "./LineChart";

const COLOUR: Record<string, string> = {
  persistence: "#64748B",
  diurnal: "#B45309",
  "chronos-2": "#1E7B45",
  truth: "#0E3B2A",
  service: "#4A86CF",
};
const SECTORS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
const sector = (deg: number) =>
  SECTORS[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
const ist = (unix: number) =>
  new Date((unix + 5.5 * 3600) * 1000)
    .toISOString()
    .slice(0, 16)
    .replace("T", " ");

type Point = {
  h: number;
  from: number;
  ms: number;
  spread?: number | null;
  calm: boolean;
};

/** Wind-from directions by hour ahead: rings are hours, dots the direction, wedges the 10-90 % range. */
function Compass({
  sets,
  horizon,
  label,
}: {
  sets: { name: string; color: string; wedge?: boolean; points: Point[] }[];
  horizon: number;
  label: string;
}) {
  const S = 300;
  const c = S / 2;
  const R = 120;
  const at = (deg: number, r: number) => [
    c + Math.sin((deg * Math.PI) / 180) * r,
    c - Math.cos((deg * Math.PI) / 180) * r,
  ];
  return (
    <figure className="m-0 max-w-sm">
      <svg
        viewBox={`0 0 ${S} ${S}`}
        role="img"
        aria-label={label}
        className="block h-auto w-full"
      >
        {Array.from(
          { length: Math.floor(horizon / 3) },
          (_, i) => (i + 1) * 3,
        ).map((h) => (
          <circle
            key={h}
            cx={c}
            cy={c}
            r={(R * h) / horizon}
            fill="none"
            stroke="#0E3B2A"
            strokeOpacity={0.15}
          />
        ))}
        {["N", "E", "S", "W"].map((l, i) => {
          const [x, y] = at(i * 90, R + 16);
          return (
            <text
              key={l}
              x={x}
              y={y + 4}
              textAnchor="middle"
              className="fill-muted-foreground font-mono text-[12px] font-semibold"
            >
              {l}
            </text>
          );
        })}
        {sets.map((set) =>
          set.points.map((p) => {
            const r = (R * p.h) / horizon;
            const [x, y] = at(p.from, r);
            let wedge = null;
            if (set.wedge && p.spread != null && p.spread < 180) {
              const ri = (R * (p.h - 0.45)) / horizon;
              const ro = (R * (p.h + 0.45)) / horizon;
              const large = p.spread > 90 ? 1 : 0;
              const [a0x, a0y] = at(p.from - p.spread, ri);
              const [b0x, b0y] = at(p.from - p.spread, ro);
              const [b1x, b1y] = at(p.from + p.spread, ro);
              const [a1x, a1y] = at(p.from + p.spread, ri);
              wedge = (
                <path
                  d={`M${a0x},${a0y} L${b0x},${b0y} A${ro},${ro} 0 ${large} 1 ${b1x},${b1y} L${a1x},${a1y} A${ri},${ri} 0 ${large} 0 ${a0x},${a0y}Z`}
                  fill={set.color}
                  fillOpacity={0.15}
                />
              );
            }
            return (
              <g key={`${set.name}-${p.h}`}>
                {wedge}
                <circle
                  cx={x}
                  cy={y}
                  r={p.calm ? 3 : 5}
                  fill={p.calm ? "#FFFFFF" : set.color}
                  stroke={set.color}
                  strokeWidth={2}
                >
                  <title>{`${set.name}, +${p.h} h: ${Math.round(p.from)}°, ${p.ms.toFixed(1)} m/s`}</title>
                </circle>
              </g>
            );
          }),
        )}
      </svg>
      <figcaption className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {sets.map((s) => (
          <span key={s.name} className="flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2.5 rounded-full"
              style={{ background: s.color }}
            />
            {s.name}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}

export function WindResults() {
  const t = useTranslations("Ground.wind");
  const [bt, setBt] = useState<WindBacktest | null>(null);
  const [live, setLive] = useState<WindLive | null>(null);
  const [site, setSite] = useState("deonar");
  const [ex, setEx] = useState(0);
  useEffect(() => {
    getJson<WindBacktest>("/ground/data/wind/backtest.json").then(
      setBt,
      () => undefined,
    );
    getJson<WindLive>("/ground/data/wind/live.json").then(
      setLive,
      () => undefined,
    );
  }, []);
  if (!bt) return <p className="text-sm text-muted-foreground">…</p>;

  const NAMES: Record<string, string> = {
    persistence: t("persistence"),
    diurnal: t("diurnal"),
    "chronos-2": t("chronos"),
  };
  const main = bt.model.name;
  const leads = bt.pooled_by_lead;
  const x = leads.map((r) => r.lead_h);
  const score = (r: (typeof leads)[number], m: string) => r[m] as Score;
  const series = (key: keyof Score, scale = 1): Series[] =>
    bt.models.map((m) => ({
      name: NAMES[m] ?? m,
      color: COLOUR[m] ?? "#64748B",
      width: m === main ? 3 : 2,
      values: leads.map((r) => (score(r, m)[key] as number) * scale),
    }));
  const xf = (v: number) => `${v} h`;
  const l6 = leads[Math.min(5, leads.length - 1)];
  const p6 = score(l6, "persistence");
  const c6 = score(l6, main);
  const card = "rounded-xl border border-border bg-card p-4";
  const h3 = "font-heading text-base font-semibold text-canopy";
  const siteData = bt.sites[site];
  const example = siteData.examples[Math.min(ex, siteData.examples.length - 1)];
  const hist = example.history.slice(-24);
  const ux = [
    ...hist.map((_, i) => i - hist.length + 1),
    ...example.model.map((m) => m.h),
  ];
  const uv = (k: "u" | "v") => ({
    obs: [...hist.map((o) => o[k]), ...example.truth.map((o) => o[k])],
    med: [...hist.map(() => null), ...example.model.map((m) => m[k])],
    per: [...hist.map(() => null), ...example.persistence.map((m) => m[k])],
    lo: [
      ...hist.map((o) => o[k]),
      ...example.model.map((m) => (k === "u" ? m.u_band![0] : m.v_band![0])),
    ],
    hi: [
      ...hist.map((o) => o[k]),
      ...example.model.map((m) => (k === "u" ? m.u_band![1] : m.v_band![1])),
    ],
  });
  const leadPoints = (ls: WindLead[]): Point[] =>
    ls.map((m) => ({
      h: m.h,
      from: m.from,
      ms: m.ms,
      spread: m.spread,
      calm: m.calm,
    }));

  return (
    <div className="space-y-8">
      <section className="space-y-2">
        <h2 className="font-heading text-xl font-semibold text-canopy">
          {t("title")}
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("intro")}</p>
      </section>

      <section className={`${card} space-y-4`}>
        <h2 className="font-heading text-xl font-semibold text-canopy">
          {t("backtest")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("backtestHelp", {
            n: score(leads[0], main).n,
            every: bt.every_h,
            ctx: bt.model.context_h,
            cells: bt.pooled_cells.length,
            start: bt.test_period[0],
            end: bt.test_period[1],
          })}
        </p>
        <p className="font-medium text-canopy">
          {t("summary", {
            h: l6.lead_h,
            p: p6.vector_rmse.toFixed(2),
            c: c6.vector_rmse.toFixed(2),
            pct: Math.round(100 * (1 - c6.vector_rmse / p6.vector_rmse)),
            pd: p6.dir_mae_deg.toFixed(1),
            cd: c6.dir_mae_deg.toFixed(1),
          })}
        </p>
        <div className="grid gap-4 lg:grid-cols-2">
          <div>
            <h3 className={h3}>{t("rmse")}</h3>
            <LineChart
              label={t("rmse")}
              x={x}
              series={series("vector_rmse")}
              yLabel="m/s"
              xLabel={t("lead")}
              xFormat={xf}
              yMin={0}
            />
          </div>
          <div>
            <h3 className={h3}>{t("dir")}</h3>
            <LineChart
              label={t("dir")}
              x={x}
              series={series("dir_mae_deg")}
              yLabel="deg"
              xLabel={t("lead")}
              xFormat={xf}
              yMin={0}
            />
          </div>
          <div>
            <h3 className={h3}>{t("within45")}</h3>
            <LineChart
              label={t("within45")}
              x={x}
              series={series("within_45", 100)}
              yLabel="%"
              xLabel={t("lead")}
              xFormat={xf}
              yMin={50}
              yMax={100}
            />
          </div>
          <div>
            <h3 className={h3}>{t("turning")}</h3>
            <p className="text-xs text-muted-foreground">
              {t("turningHelp", { n: bt.pooled_turning[main].n })}
            </p>
            <BarChart
              label={t("turning")}
              categories={bt.models.map((m) => NAMES[m] ?? m)}
              series={[
                {
                  name: t("dir"),
                  color: "#1E7B45",
                  values: bt.models.map(
                    (m) => bt.pooled_turning[m].dir_mae_deg,
                  ),
                },
              ]}
              yLabel="deg"
            />
          </div>
        </div>
        <div className="max-w-2xl">
          <h3 className={h3}>{t("band")}</h3>
          <p className="text-xs text-muted-foreground">{t("bandHelp")}</p>
          <LineChart
            label={t("band")}
            x={x}
            series={[
              {
                name: NAMES[main] ?? main,
                color: COLOUR[main],
                values: leads.map(
                  (r) => 100 * (score(r, main).band_cover ?? 0),
                ),
              },
            ]}
            threshold={{ value: 64, label: "64 %" }}
            yLabel="%"
            xLabel={t("lead")}
            xFormat={xf}
            yMin={40}
            yMax={100}
            height={200}
          />
        </div>
        <h3 className={h3}>{t("perSite")}</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-4 font-medium">{t("site")}</th>
                <th className="pr-4 font-medium">{t("cell")}</th>
                {[1, 6, 12].flatMap((h) => [
                  <th key={`p${h}`} className="pr-4 text-right font-medium">
                    {h} h · {t("persistence")}
                  </th>,
                  <th key={`c${h}`} className="pr-4 text-right font-medium">
                    {h} h · {t("chronos")}
                  </th>,
                ])}
              </tr>
            </thead>
            <tbody>
              {Object.entries(bt.sites).map(([slug, s]) => (
                <tr key={slug} className="border-t border-border">
                  <td className="py-1.5 pr-4">
                    {s.name}, {s.city}
                  </td>
                  <td className="pr-4 font-mono text-xs">
                    {s.grid[0].toFixed(2)}, {s.grid[1].toFixed(2)}
                  </td>
                  {[1, 6, 12].flatMap((h) => {
                    const r = s.by_lead[h - 1];
                    const p = (r.persistence as Score).vector_rmse;
                    const c = (r[main] as Score).vector_rmse;
                    return [
                      <td key={`p${h}`} className="pr-4 text-right font-mono">
                        {p.toFixed(2)}
                      </td>,
                      <td key={`c${h}`} className="pr-4 text-right font-mono">
                        {c.toFixed(2)} (−{Math.round(100 * (1 - c / p))} %)
                      </td>,
                    ];
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          {Object.values(bt.sites)
            .filter((s) => s.same_cell_as)
            .map((s) =>
              t("sameCell", { a: bt.sites[s.same_cell_as!].name, b: s.name }),
            )
            .join(" ")}{" "}
          {bt.truth}.
        </p>
      </section>

      <section className={`${card} space-y-4`}>
        <h2 className="font-heading text-xl font-semibold text-canopy">
          {t("examples")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("examplesHelp")}</p>
        <div className="flex flex-wrap gap-3 text-sm">
          <label className="grid gap-1">
            {t("site")}
            <select
              value={site}
              onChange={(e) => {
                setSite(e.target.value);
                setEx(0);
              }}
              className="rounded-md border border-border bg-card px-2 py-1.5"
            >
              {Object.entries(bt.sites).map(([slug, s]) => (
                <option key={slug} value={slug}>
                  {s.name}, {s.city}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            {t("example")}
            <select
              value={ex}
              onChange={(e) => setEx(Number(e.target.value))}
              className="rounded-md border border-border bg-card px-2 py-1.5"
            >
              {siteData.examples.map((e, i) => (
                <option key={e.issued} value={i}>
                  {ist(e.issued)} IST
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
          <Compass
            label={t("compass")}
            horizon={example.model.length}
            sets={[
              {
                name: t("observed"),
                color: COLOUR.truth,
                points: example.truth.map((o, i) => ({
                  h: i + 1,
                  from: o.from,
                  ms: o.ms,
                  calm: o.ms < 1,
                })),
              },
              {
                name: t("median"),
                color: COLOUR["chronos-2"],
                wedge: true,
                points: leadPoints(example.model),
              },
            ]}
          />
          <div className="space-y-2">
            {(["u", "v"] as const).map((k) => {
              const d = uv(k);
              return (
                <LineChart
                  key={k}
                  label={t(k)}
                  x={ux}
                  xFormat={(v) => `${v > 0 ? "+" : ""}${v} h`}
                  marker={0}
                  height={200}
                  yLabel={t(k)}
                  band={{ lo: d.lo, hi: d.hi }}
                  series={[
                    { name: t("observed"), color: COLOUR.truth, values: d.obs },
                    {
                      name: t("median"),
                      color: COLOUR["chronos-2"],
                      width: 3,
                      values: d.med,
                    },
                    {
                      name: t("persistence"),
                      color: COLOUR.persistence,
                      dash: "5 4",
                      values: d.per,
                    },
                  ]}
                />
              );
            })}
          </div>
        </div>
      </section>

      {live && (
        <section className={`${card} space-y-4`}>
          <h2 className="font-heading text-xl font-semibold text-canopy">
            {t("live")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("liveHelp", { when: live.fetched.replace("T", " ") })}
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Object.entries(live.sites).map(([slug, s]) => {
              const first = s.forecast[0];
              return (
                <article
                  key={slug}
                  className="space-y-2 rounded-lg border border-border bg-cloud p-3"
                >
                  <h3 className={h3}>
                    {s.name}, {s.city}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {NAMES[s.model] ?? s.model} · {ist(s.issued)} IST
                  </p>
                  <p className="text-sm">
                    <span className="font-medium">{t("downwind")}: </span>
                    {first.calm
                      ? t("calm")
                      : `${sector(first.from + 180)} (${t("from")} ${Math.round(first.from)}° ± ${Math.round(first.spread ?? 0)}°)`}
                  </p>
                  <Compass
                    label={t("compass")}
                    horizon={s.forecast.length}
                    sets={[
                      {
                        name: NAMES[s.model] ?? s.model,
                        color: COLOUR["chronos-2"],
                        wedge: true,
                        points: leadPoints(s.forecast),
                      },
                      {
                        name: t("weatherService"),
                        color: COLOUR.service,
                        points: s.weather_service.map((o, i) => ({
                          h: i + 1,
                          from: o.from,
                          ms: o.ms,
                          calm: o.ms < 1,
                        })),
                      },
                    ]}
                  />
                </article>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">{t("note")}</p>
        </section>
      )}
    </div>
  );
}
