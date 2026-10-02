"use client";

import { ArrowRight, Plane, Satellite, Scale } from "lucide-react";
import { useTranslations } from "next-intl";
import { BENCHMARK, FIELD_TEST } from "@/content/facts";
import type { Site, SiteStat } from "@/lib/landing-types";
import { useFormat, usePlaces } from "./format";
import { Kicker, SectionTitle } from "./ui";

export function Honest({ stats, sites }: { stats: SiteStat[]; sites: Site[] }) {
  const t = useTranslations("Honest");
  const tc = useTranslations("Common");
  const f = useFormat();
  const places = usePlaces();
  const names = new Map(
    sites.map((s) => [s.slug, places.site(s.slug, s.name)]),
  );
  const bounds = stats
    .filter((s) => s.persistentUpperTph !== null)
    .sort((a, b) => (a.persistentUpperTph ?? 0) - (b.persistentUpperTph ?? 0));
  const max = Math.max(...bounds.map((b) => b.persistentUpperTph ?? 0), 1);
  const limits = [
    t("limits.perPass", {
      share: FIELD_TEST.perPassDetection,
      tph: f.num(FIELD_TEST.perPassDetectionMinTph),
    }),
    t("limits.small", { recall: f.pct(BENCHMARK.recallByRate[0].vayunetra) }),
    t("limits.finetune", { auc: f.num(FIELD_TEST.fineTuneAuc, 2) }),
    t("limits.truth", {
      ratio: f.num(FIELD_TEST.knownTruthRatio, 2),
      tph: f.num(FIELD_TEST.knownTruthTph),
    }),
    t("limits.deonar"),
    t("limits.screening"),
  ];

  return (
    <section
      id="honest"
      aria-labelledby="honest-title"
      className="relative z-10 bg-background py-28 md:py-36"
    >
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle id="honest-title" className="mt-4 max-w-3xl">
          {t("title")}
        </SectionTitle>

        <div className="mt-12 grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr_auto_0.8fr]">
          <div className="rounded-xl border border-signal/40 bg-signal/[0.06] p-6">
            <Satellite className="size-6 text-signal" aria-hidden />
            <h3 className="mt-4 font-heading text-xl font-semibold">
              {t("tier1")}
            </h3>
            <p className="mt-2 text-sm text-foreground/80">{t("tier1Text")}</p>
          </div>
          <ArrowRight
            className="mx-auto hidden size-6 self-center text-muted-foreground lg:block"
            aria-hidden
          />
          <div className="rounded-xl border border-tier-2/50 bg-tier-2/[0.06] p-6">
            <Plane className="size-6 text-[#D8B4FE]" aria-hidden />
            <h3 className="mt-4 font-heading text-xl font-semibold">
              {t("tier2")}
            </h3>
            <p className="mt-2 text-sm text-foreground/80">{t("tier2Text")}</p>
          </div>
          <ArrowRight
            className="mx-auto hidden size-6 self-center text-muted-foreground lg:block"
            aria-hidden
          />
          <div className="flex flex-col justify-center rounded-xl border border-white/10 bg-card p-6">
            <Scale className="size-6 text-foreground/80" aria-hidden />
            <p className="mt-4 font-heading text-lg font-semibold">
              {t("outcome")}
            </p>
          </div>
        </div>

        <div className="mt-16 grid gap-12 lg:grid-cols-2">
          <div>
            <h3 className="font-heading text-xl font-semibold">
              {t("boundsTitle")}
            </h3>
            <p className="mt-2 text-sm text-foreground/75">
              {t("boundsMeaning")}
            </p>
            <ul className="mt-6 space-y-3">
              {bounds.map((b) => (
                <li
                  key={b.slug}
                  className="grid grid-cols-[6.5rem_1fr_6rem] items-center gap-3 text-sm"
                >
                  <span>{names.get(b.slug) ?? b.slug}</span>
                  <span
                    className="h-2.5 overflow-hidden rounded-full bg-white/10"
                    aria-hidden
                  >
                    <span
                      className="block h-full rounded-full bg-gradient-to-r from-methane-low via-methane-mid to-methane-high"
                      style={{
                        width: `${((b.persistentUpperTph ?? 0) / max) * 100}%`,
                      }}
                    />
                  </span>
                  <span className="text-right font-mono">
                    ≤ {tc("tph", { value: f.num(b.persistentUpperTph ?? 0) })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="font-heading text-xl font-semibold">
              {t("limitsTitle")}
            </h3>
            <ul className="mt-6 space-y-3 text-sm leading-relaxed text-foreground/85">
              {limits.map((l) => (
                <li key={l} className="flex gap-3">
                  <span
                    aria-hidden
                    className="mt-2 size-1.5 shrink-0 rounded-full bg-methane-mid"
                  />
                  <span className="text-pretty">{l}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
