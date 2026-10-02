"use client";

import {
  Coins,
  FileDown,
  Flame,
  ScanSearch,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import type { Assumptions } from "@/content/facts";
import type { SiteStat } from "@/lib/landing-types";
import { useFormat } from "./format";
import { Kicker, ScreeningNote, SectionTitle } from "./ui";

/** The ops notebook's action-plan economics (Cell 12) from the site's minimum mean rate. */
export function actionPlan(minMeanKgph: number, a: Assumptions) {
  const captured = minMeanKgph * a.capture_eff; // kg/h
  const avoided = captured * 8.76 * a.flare_destruction * a.gwp100; // t CO2e / yr
  const mw = ((captured * a.ch4_lhv_mj_per_kg) / 3600) * a.engine_eff; // MW electric
  const inr = mw * 8760 * 1000 * a.power_price_inr_per_kwh; // ₹ / yr
  const usd = avoided * a.carbon_price_usd_per_t; // $ / yr
  return { avoided, mw, inr, usd };
}

const round = (v: number, step: number) => Math.round(v / step) * step;

export function Action({
  stat,
  assumptions,
  dossierPdfUrl,
}: {
  stat: SiteStat;
  assumptions: Assumptions;
  dossierPdfUrl: string;
}) {
  const t = useTranslations("Action");
  const f = useFormat();
  const minMean = stat.minMeanKgph ?? 0;
  const plan = actionPlan(minMean, assumptions);
  const tco2e = stat.tco2e100Yr ?? minMean * 8.76 * assumptions.gwp100;
  const a = assumptions;

  const steps: {
    key: "confirm" | "capture" | "power" | "credits";
    icon: LucideIcon;
    text: string;
  }[] = [
    { key: "confirm", icon: ScanSearch, text: t("steps.confirm.text") },
    {
      key: "capture",
      icon: Flame,
      text: t("steps.capture.text", {
        capture: f.pct(a.capture_eff),
        avoided: f.num(round(plan.avoided, 100)),
      }),
    },
    {
      key: "power",
      icon: Zap,
      text: t("steps.power.text", {
        mw: f.num(plan.mw, 1),
        crore: f.num(plan.inr / 1e7, 1),
      }),
    },
    {
      key: "credits",
      icon: Coins,
      text: t("steps.credits.text", { usd: f.usd(round(plan.usd, 1000)) }),
    },
  ];
  const chips = [
    t("chips.rate", { value: f.num(minMean) }),
    t("chips.capture", { value: f.pct(a.capture_eff) }),
    t("chips.destruction", { value: f.pct(a.flare_destruction) }),
    t("chips.gwp", { value: f.num(a.gwp100) }),
    t("chips.lhv", { value: f.num(a.ch4_lhv_mj_per_kg) }),
    t("chips.engine", { value: f.pct(a.engine_eff) }),
    t("chips.tariff", { value: f.num(a.power_price_inr_per_kwh) }),
    t("chips.carbon", { value: f.num(a.carbon_price_usd_per_t) }),
  ];

  return (
    <section
      id="action"
      aria-labelledby="action-title"
      className="relative z-10 bg-background py-28 md:py-36"
    >
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle id="action-title" className="mt-4 max-w-3xl">
          {t("title")}
        </SectionTitle>
        <p className="mt-5 max-w-3xl text-lg text-pretty text-foreground/85">
          {t("intro", {
            kgph: f.num(minMean),
            tco2e: f.num(round(tco2e, 1000)),
            gwp: f.num(a.gwp100),
          })}
        </p>

        <ol className="mt-12 grid gap-4 md:grid-cols-4">
          {steps.map(({ key, icon: Icon, text }, i) => (
            <li
              key={key}
              className="relative rounded-xl border border-white/10 bg-card p-5"
            >
              <div className="flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-full bg-signal/10 text-signal">
                  <Icon className="size-4" aria-hidden />
                </span>
                <span className="font-mono text-xs text-muted-foreground">
                  0{i + 1}
                </span>
              </div>
              <h3 className="mt-4 font-heading text-lg font-semibold">
                {t(`steps.${key}.title`)}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-pretty text-foreground/80">
                {text}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-8 rounded-xl border border-dashed border-white/15 p-5">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("assumptions")}
          </p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {chips.map((c) => (
              <li
                key={c}
                className="rounded-full border border-white/15 bg-white/[0.03] px-3 py-1 font-mono text-xs"
              >
                {c}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{t("editable")}</p>
        </div>

        <div className="mt-8 flex flex-wrap items-center gap-6">
          <a
            href={dossierPdfUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <FileDown className="size-4" aria-hidden /> {t("openDossier")}
          </a>
          <ScreeningNote className="max-w-xl" />
        </div>
      </div>
    </section>
  );
}
