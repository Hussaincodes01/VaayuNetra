"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { makeFormat } from "@/lib/format";
import { captureEstimate, type CaptureAssumptions } from "@/lib/sustainability";
import { Panel } from "./shared";

/**
 * What gas capture is worth at a site: the dossier's action plan with the capture share on a slider.
 * Only a site with a minimum time-averaged rate gets figures; one with only an upper bound gets none.
 */
export function CaptureCalculator({
  minMeanKgph,
  passes,
  upperTph,
  capture,
  defaultShare,
}: {
  minMeanKgph: number | null;
  passes: number;
  upperTph: number | null;
  capture: CaptureAssumptions;
  defaultShare: number;
}) {
  const t = useTranslations("Sustain.calculator");
  const tc = useTranslations("Common");
  const f = makeFormat(useLocale());
  const id = useId();
  const [pct, setPct] = useState(Math.round(defaultShare * 100));
  const q = minMeanKgph ?? 0;
  const e = captureEstimate(q, pct / 100, capture);

  return (
    <Panel id="calculator" title={t("title")} intro={t("intro")}>
      {q > 0 ? (
        <>
          <p className="mt-3 text-sm">
            {t("rate", { kgph: f.num(q), passes: f.num(passes) })}{" "}
            <span className="text-muted-foreground">
              ({tc("minimumEstimate")})
            </span>
          </p>
          <label
            htmlFor={`${id}-share`}
            className="mt-4 block text-sm font-medium"
          >
            {t("share", { pct })}
          </label>
          <input
            id={`${id}-share`}
            type="range"
            min={10}
            max={95}
            step={5}
            value={pct}
            onChange={(ev) => setPct(Number(ev.target.value))}
            className="mt-2 w-full accent-leaf"
          />
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg bg-muted p-3">
              <dt className="text-xs text-muted-foreground">{t("annual")}</dt>
              <dd className="font-mono text-lg">{f.num(e.annualTco2e)}</dd>
            </div>
            <div className="rounded-lg bg-sprout/60 p-3">
              <dt className="text-xs text-canopy">{t("avoided", { pct })}</dt>
              <dd className="font-mono text-lg text-canopy">
                {f.num(e.avoidedTco2eYr)}
              </dd>
            </div>
            <div className="rounded-lg bg-muted p-3">
              <dt className="text-xs text-muted-foreground">{t("power")}</dt>
              <dd className="font-mono text-lg">{f.num(e.powerMw, 2)}</dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("assumptions", {
              gwp: f.num(capture.gwp100),
              flare: f.pct(capture.flareDestruction),
              lhv: f.num(capture.lhvMjPerKg),
              eff: f.pct(capture.engineEff),
            })}
          </p>
        </>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">
          {upperTph !== null
            ? t("boundOnly", { tph: f.num(upperTph) })
            : t("noRate")}
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">{tc("screening")}</p>
    </Panel>
  );
}
