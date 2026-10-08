"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { ScreeningNote } from "@/components/landing/ui";
import { getJson, type SatScan } from "@/lib/ground/types";
import { LineChart } from "./LineChart";

const TIER_TEXT: Record<string, string> = {
  T1: "text-tier-1-ink",
  T2: "text-tier-2-ink",
  T3: "text-tier-3-ink",
};

export function SatelliteResults() {
  const t = useTranslations("Ground.sat");
  const [scan, setScan] = useState<SatScan | null>(null);
  useEffect(() => {
    getJson<SatScan>("/ground/data/satellite/deonar.json").then(
      setScan,
      () => undefined,
    );
  }, []);
  if (!scan) return <p className="text-sm text-muted-foreground">…</p>;
  const s = scan.summary;
  const card = "rounded-xl border border-border bg-card p-4";
  const h2 = "font-heading text-xl font-semibold text-canopy";
  const tier = (k: string) => t(`t.${k}` as Parameters<typeof t>[0]);
  const t1 = (v: number | null | undefined) =>
    v == null ? "–" : `${(v / 1000).toFixed(1)} t/h`;

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <h2 className={h2}>{t("title")}</h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("intro")}</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {[
            [t("version"), scan.model.version],
            [t("threshold"), scan.model.threshold.toFixed(3)],
            [t("thresholdIndia"), scan.model.threshold_india.toFixed(3)],
          ].map(([k, v]) => (
            <div
              key={k}
              className="rounded-lg border border-border bg-card px-3 py-2"
            >
              <p className="text-xs text-muted-foreground">{k}</p>
              <p className="font-mono text-lg font-semibold text-canopy">{v}</p>
            </div>
          ))}
        </div>
        <p className="font-medium text-canopy">
          {t("summary", {
            n: s.landfill_passes,
            d: s.landfill_detected,
            t1: s.tiers.T1 ?? 0,
            t2: s.tiers.T2 ?? 0,
            t3: s.tiers.T3 ?? 0,
            cd: s.control_detected,
            cn: s.control_passes,
          })}
        </p>
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className={h2}>{t("scores")}</h2>
        <p className="text-sm text-muted-foreground">{t("scoresHelp")}</p>
        {scan.windows.map((w) => {
          const rows = scan.passes.filter((p) => p.window[0] === w[0]);
          const dates = [...new Set(rows.map((p) => p.date))].sort();
          const score = (kind: string) =>
            dates.map(
              (d) =>
                rows.find((r) => r.date === d && r.kind === kind)
                  ?.scene_score ?? null,
            );
          const idx = dates.map((_, k) => k);
          return (
            <LineChart
              key={w[0]}
              label={`${t("scores")} ${w[0]} – ${w[1]}`}
              x={idx}
              xTicks={idx.filter((k) => k % 3 === 0)}
              xFormat={(k) => dates[Math.round(k)]?.slice(2) ?? ""}
              yLabel={`${w[0]} – ${w[1]}`}
              yMin={0}
              yMax={1}
              height={230}
              threshold={{
                value: scan.model.threshold,
                label: scan.model.threshold.toFixed(3),
              }}
              series={[
                {
                  name: t("landfill"),
                  color: "#DC2626",
                  width: 2.5,
                  values: score("landfill"),
                },
                {
                  name: t("control"),
                  color: "#64748B",
                  dash: "5 4",
                  values: score("control"),
                },
              ]}
            />
          );
        })}
      </section>

      <section className={`${card} space-y-6`}>
        <h2 className={h2}>{t("detections")}</h2>
        {scan.passes
          .filter((p) => p.detected)
          .map((p) => (
            <article
              key={`${p.kind}-${p.date}`}
              className="space-y-2 border-t border-border pt-4 first:border-t-0 first:pt-0"
            >
              <h3 className="font-heading text-lg font-semibold text-canopy">
                {p.date} ·{" "}
                <span className={TIER_TEXT[p.tier] ?? ""}>{tier(p.tier)}</span>
              </h3>
              <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
                <dt className="text-muted-foreground">{t("score")}</dt>
                <dd className="font-mono">
                  {p.scene_score.toFixed(3)} ({p.plume_px} px)
                </dd>
                <dt className="text-muted-foreground">{t("checks")}</dt>
                <dd>
                  {t("spectral")}: {p.spectral_ok ? t("yes") : t("no")} ·{" "}
                  {t("aligned")}: {p.aligned ? t("yes") : t("no")}
                </dd>
                {p.u != null && p.v != null && (
                  <>
                    <dt className="text-muted-foreground">{t("wind")}</dt>
                    <dd className="font-mono">
                      u {p.u.toFixed(2)}, v {p.v.toFixed(2)} m/s
                    </dd>
                  </>
                )}
                {(p.tier === "T1" || p.tier === "T2") && p.q_med != null && (
                  <>
                    <dt className="text-muted-foreground">{t("rate")}</dt>
                    <dd className="font-mono">
                      {t1(p.q_med)} ({t1(p.q_lo)}–{t1(p.q_hi)})
                    </dd>
                  </>
                )}
                {p.surface_kind && (
                  <>
                    <dt className="text-muted-foreground">{t("surface")}</dt>
                    <dd>{p.surface_kind}</dd>
                  </>
                )}
              </dl>
              {(p.tier === "T1" || p.tier === "T2") && <ScreeningNote />}
              {p.figure && (
                <Image
                  src={p.figure}
                  alt={t("evidenceAlt", { date: p.date })}
                  width={1100}
                  height={400}
                  className="h-auto w-full max-w-4xl rounded-lg border border-border bg-white"
                />
              )}
            </article>
          ))}
      </section>

      <section className={`${card} space-y-3`}>
        <h2 className={h2}>{t("compare")}</h2>
        <p className="text-sm text-muted-foreground">{t("compareHelp")}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr>
                <th className="py-1.5 pr-4 font-medium">{t("date")}</th>
                <th className="pr-4 font-medium" />
                <th className="pr-4 font-medium">{t("tier")}</th>
                <th className="pr-4 text-right font-medium">{t("rate")}</th>
                <th className="text-right font-medium">{t("wind")}</th>
              </tr>
            </thead>
            <tbody>
              {scan.recorded.flatMap((r) => {
                const mine = scan.passes.find(
                  (p) => p.date === r.date && p.kind === "landfill",
                );
                return [
                  <tr key={`${r.date}-rec`} className="border-t border-border">
                    <td className="py-1.5 pr-4">{r.date}</td>
                    <td className="pr-4">{t("recorded")}</td>
                    <td className="pr-4">{r.tier}</td>
                    <td className="pr-4 text-right font-mono">
                      {t1(r.rate_kgph)} ({t1(r.rate_low_kgph)}–
                      {t1(r.rate_high_kgph)})
                    </td>
                    <td className="text-right font-mono">
                      u {r.wind_u}, v {r.wind_v}
                    </td>
                  </tr>,
                  mine && (
                    <tr key={`${r.date}-run`}>
                      <td className="py-1.5 pr-4" />
                      <td className="pr-4">{t("thisRun")}</td>
                      <td className="pr-4">{mine.tier}</td>
                      <td className="pr-4 text-right font-mono">
                        {t1(mine.q_med)} ({t1(mine.q_lo)}–{t1(mine.q_hi)})
                      </td>
                      <td className="text-right font-mono">
                        {mine.u != null && mine.v != null
                          ? `u ${mine.u.toFixed(1)}, v ${mine.v.toFixed(1)}`
                          : "–"}
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
        <ScreeningNote />
        <h3 className="font-heading text-base font-semibold text-canopy">
          {t("toGround")}
        </h3>
        <p className="max-w-3xl text-sm">{t("toGroundText")}</p>
      </section>
    </div>
  );
}
