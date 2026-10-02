"use client";

import { CodeXml, Landmark, Leaf, Target, Users } from "lucide-react";
import { useTranslations } from "next-intl";
import { CONTEXT, SOURCES } from "@/content/facts";
import { useFormat } from "./format";
import { Kicker, SectionTitle } from "./ui";

export function Initiative() {
  const t = useTranslations("Initiative");
  const f = useFormat();
  const road = ["now", "next", "then"] as const;

  return (
    <section
      id="initiative"
      aria-labelledby="initiative-title"
      className="relative z-10 bg-background py-28 md:py-36"
    >
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle id="initiative-title" className="mt-4 max-w-3xl">
          {t("title")}
        </SectionTitle>
        <p className="mt-6 max-w-3xl text-lg leading-relaxed text-pretty text-foreground/85">
          {t("why", { days: f.num(CONTEXT.revisitDays) })}
        </p>

        <div className="mt-14 grid gap-6 md:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-card p-6">
            <Users className="size-5 text-signal" aria-hidden />
            <h3 className="mt-4 font-heading text-lg font-semibold">
              {t("team")}
            </h3>
            <p className="mt-2 text-sm text-foreground/80">{t("teamText")}</p>
          </div>
          <div className="rounded-xl border border-white/10 bg-card p-6">
            <CodeXml className="size-5 text-signal" aria-hidden />
            <h3 className="mt-4 font-heading text-lg font-semibold">
              {t("open")}
            </h3>
            <p className="mt-2 text-sm text-foreground/80">{t("openText")}</p>
            <a
              href={SOURCES.github}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-block text-sm text-signal underline-offset-4 hover:underline"
            >
              {t("github")}
            </a>
          </div>
          <div className="rounded-xl border border-white/10 bg-card p-6">
            <Landmark className="size-5 text-signal" aria-hidden />
            <h3 className="mt-4 font-heading text-lg font-semibold">
              {t("alignment")}
            </h3>
            <ul className="mt-2 space-y-2 text-sm text-foreground/80">
              <li className="flex gap-2">
                <Leaf
                  className="mt-0.5 size-4 shrink-0 text-tier-clear"
                  aria-hidden
                />{" "}
                {t("sbm")}
              </li>
              <li className="flex gap-2">
                <Target
                  className="mt-0.5 size-4 shrink-0 text-tier-clear"
                  aria-hidden
                />
                {t("netZero", { year: String(CONTEXT.netZeroYear) })}
              </li>
            </ul>
          </div>
        </div>

        <h3 className="mt-16 font-heading text-xl font-semibold">
          {t("roadmap")}
        </h3>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {road.map((k, i) => (
            <li
              key={k}
              className="relative rounded-xl border border-white/10 p-6"
            >
              <span className="font-mono text-xs text-muted-foreground">
                0{i + 1}
              </span>
              <p className="mt-2 font-heading text-2xl font-semibold text-signal">
                {t(`road.${k}`)}
              </p>
              <p className="mt-2 text-sm text-foreground/75">
                {t(`road.${k}Text`)}
              </p>
            </li>
          ))}
        </ol>

        <div className="mt-16 flex flex-col items-start gap-5 rounded-2xl border border-signal/30 bg-gradient-to-br from-signal/10 to-transparent p-8 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="font-heading text-2xl font-semibold">
              {t("partner")}
            </h3>
            <p className="mt-2 max-w-2xl text-foreground/80">
              {t("partnerText")}
            </p>
          </div>
          <a
            href="#request"
            className="shrink-0 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            {t("partnerCta")}
          </a>
        </div>
      </div>
    </section>
  );
}
