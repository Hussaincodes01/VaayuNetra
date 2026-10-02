"use client";

import { scaleLinear, scaleTime } from "@visx/scale";
import { useLocale, useTranslations } from "next-intl";
import { TIER_COLOUR } from "@/components/landing/format";
import type { ScanRow } from "@/lib/dashboard-shared";
import { makeFormat } from "@/lib/format";

/** Scene score of every pass over time, flagged passes coloured by tier, with the detection threshold. */
export function ScoreTimeline({ scans }: { scans: ScanRow[] }) {
  const t = useTranslations("Dash.site");
  const f = makeFormat(useLocale());
  const W = 1000;
  const H = 220;
  const m = { l: 44, r: 12, t: 14, b: 28 };
  if (!scans.length)
    return <p className="text-sm text-muted-foreground">{t("noScans")}</p>;
  const dates = scans.map((s) => new Date(`${s.passDate}T00:00:00Z`));
  const x = scaleTime({
    domain: [dates[0], dates[dates.length - 1]],
    range: [m.l, W - m.r],
  });
  const y = scaleLinear({ domain: [0, 1], range: [H - m.b, m.t] });
  const threshold = scans[scans.length - 1].thresholdUsed;
  const years = Array.from(new Set(dates.map((d) => d.getUTCFullYear())));
  const ticks = years
    .flatMap((yr) => [0, 6].map((mo) => new Date(Date.UTC(yr, mo, 1))))
    .filter((d) => d >= dates[0] && d <= dates[dates.length - 1]);
  const flagged = scans.filter((s) => s.tier !== "none");

  return (
    <figure>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        // A labelled group, not an image: it holds links to each flagged pass.
        role="group"
        aria-label={t("timelineLabel", {
          passes: scans.length,
          flags: flagged.length,
          threshold: f.num(threshold, 3),
        })}
      >
        {[0, 0.25, 0.5, 0.75, 1].map((v) => (
          <g key={v}>
            <line
              x1={m.l}
              x2={W - m.r}
              y1={y(v)}
              y2={y(v)}
              stroke="#0E3B2A14"
            />
            <text
              x={m.l - 8}
              y={y(v) + 4}
              textAnchor="end"
              className="fill-muted-foreground font-mono text-[11px]"
            >
              {f.num(v, 2)}
            </text>
          </g>
        ))}
        {ticks.map((d) => (
          <text
            key={d.toISOString()}
            x={x(d)}
            y={H - 8}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[11px]"
          >
            {f.date(d.toISOString(), "short").replace(/^\d+\s/, "")}
          </text>
        ))}
        <line
          x1={m.l}
          x2={W - m.r}
          y1={y(threshold)}
          y2={y(threshold)}
          stroke="#0E3B2A"
          strokeDasharray="4 4"
          strokeOpacity={0.6}
        />
        <text
          x={W - m.r}
          y={y(threshold) - 6}
          textAnchor="end"
          className="fill-muted-foreground text-[11px]"
        >
          {t("threshold", { value: f.num(threshold, 3) })}
        </text>
        {scans
          .filter((s) => s.tier === "none")
          .map((s) => (
            <circle
              key={s.id}
              cx={x(new Date(`${s.passDate}T00:00:00Z`))}
              cy={y(s.sceneScore)}
              r={3}
              fill="#4A6355"
              opacity={0.55}
            >
              <title>{`${f.date(s.passDate)} · ${f.num(s.sceneScore, 3)}`}</title>
            </circle>
          ))}
        {flagged.map((s) => (
          <a
            key={s.id}
            href={`#pass-${s.passDate}`}
            aria-label={`${s.tier} ${f.date(s.passDate)}`}
          >
            <circle
              cx={x(new Date(`${s.passDate}T00:00:00Z`))}
              cy={y(s.sceneScore)}
              r={7}
              fill={TIER_COLOUR[s.tier as "T1" | "T2" | "T3"]}
              stroke="#FFFFFF"
              strokeWidth={2}
            >
              <title>{`${s.tier} · ${f.date(s.passDate)} · ${f.num(s.sceneScore, 3)}`}</title>
            </circle>
          </a>
        ))}
      </svg>
    </figure>
  );
}
