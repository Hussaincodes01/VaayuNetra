"use client";

import {
  ArrowRight,
  BellRing,
  Cpu,
  MapPinned,
  RadioTower,
  Satellite,
  SearchCheck,
  Server,
  Wind,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";

const STAGES = [
  { key: "satellite", icon: Satellite, href: "/dashboard/ground/satellite" },
  { key: "wind", icon: Wind, href: "/dashboard/ground/wind" },
  { key: "plan", icon: MapPinned, href: "/dashboard/ground/simulation" },
  { key: "nodes", icon: Cpu, href: "/dashboard/ground/hardware" },
  { key: "mesh", icon: RadioTower, href: "/dashboard/ground/simulation" },
  { key: "pi", icon: Server, href: "/dashboard/ground/simulation" },
  { key: "sms", icon: BellRing, href: "/dashboard/ground/simulation" },
  { key: "confirm", icon: SearchCheck, href: null },
] as const;

/** The eight steps from a satellite flag to a confirmed fix; selecting one shows how it is checked. */
export function FlowDiagram() {
  const t = useTranslations("Ground.flow");
  const tabs = useTranslations("Ground.tabs");
  const [sel, setSel] = useState<(typeof STAGES)[number]["key"]>("satellite");
  const stage = STAGES.find((s) => s.key === sel)!;
  const tabFor = (href: string) =>
    href.endsWith("satellite")
      ? tabs("satellite")
      : href.endsWith("wind")
        ? tabs("wind")
        : href.endsWith("hardware")
          ? tabs("hardware")
          : tabs("simulation");

  return (
    <section className="space-y-4" aria-labelledby="flow-title">
      <div className="space-y-1">
        <h2
          id="flow-title"
          className="font-heading text-xl font-semibold text-canopy"
        >
          {t("title")}
        </h2>
        <p className="max-w-3xl text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {STAGES.map((s, i) => {
          const Icon = s.icon;
          const active = s.key === sel;
          return (
            <li key={s.key} className="relative">
              <button
                type="button"
                onClick={() => setSel(s.key)}
                aria-pressed={active}
                className={cn(
                  "flex h-full w-full flex-col gap-2 rounded-xl border p-4 text-left transition-colors",
                  active
                    ? "border-[1.5px] border-leaf bg-[#EAF7E4]"
                    : "border-border bg-card hover:border-leaf/50",
                )}
              >
                <span className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
                  <span className="grid size-6 place-items-center rounded-full bg-sprout font-semibold text-canopy">
                    {i + 1}
                  </span>
                  <Icon className="size-4 text-leaf" aria-hidden />
                </span>
                <span className="font-heading text-base font-semibold text-canopy">
                  {t(`stages.${s.key}.title`)}
                </span>
                <span className="text-xs text-muted-foreground">
                  {t(`stages.${s.key}.runs`)}
                </span>
                <span className="mt-auto rounded-full bg-sky px-2 py-0.5 text-xs font-medium text-[#1F4A5C]">
                  {t(`stages.${s.key}.checked`)}
                </span>
              </button>
              {i < STAGES.length - 1 && i % 4 !== 3 && (
                <ArrowRight
                  aria-hidden
                  className="absolute top-1/2 -right-3 z-10 hidden size-4 -translate-y-1/2 text-leaf lg:block"
                />
              )}
            </li>
          );
        })}
      </ol>
      <article
        aria-live="polite"
        className="rounded-xl border border-border bg-card p-5"
      >
        <h3 className="font-heading text-lg font-semibold text-canopy">
          {STAGES.findIndex((s) => s.key === sel) + 1}.{" "}
          {t(`stages.${sel}.title`)}
        </h3>
        <dl className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[max-content_1fr]">
          <dt className="text-muted-foreground">{t("runs")}</dt>
          <dd>{t(`stages.${sel}.runs`)}</dd>
          <dt className="text-muted-foreground">{t("checked")}</dt>
          <dd>{t(`stages.${sel}.checked`)}</dd>
        </dl>
        <p className="mt-3 max-w-3xl text-sm text-foreground/85">
          {t(`stages.${sel}.text`)}
        </p>
        {stage.href && (
          <Link
            href={stage.href}
            className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-leaf px-3 py-1.5 text-sm font-medium text-white hover:bg-leaf/90"
          >
            {t("open")}: {tabFor(stage.href)}
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        )}
      </article>
      <aside className="rounded-xl border border-border bg-cloud p-4 text-sm">
        <p className="font-medium text-canopy">{t("files")}</p>
        <p className="mt-1 text-foreground/80">{t("filesText")}</p>
      </aside>
    </section>
  );
}
