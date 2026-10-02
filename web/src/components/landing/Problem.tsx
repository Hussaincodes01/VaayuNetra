"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { CONTEXT, SOURCES } from "@/content/facts";
import { useFormat } from "./format";
import { Kicker, SectionTitle, Source } from "./ui";
import { useInView } from "./useScrollProgress";

/** Counts from 0 to `to` once visible. Renders the final value on the server and for reduced motion. */
function useCountUp(
  to: number,
  run: boolean,
  reducedMotion: boolean,
  ms = 1600,
): number {
  const [value, setValue] = useState(to);
  useEffect(() => {
    if (!run || reducedMotion) {
      setValue(to);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      setValue(to * (1 - (1 - k) ** 3));
      if (k < 1) raf = requestAnimationFrame(step);
    };
    setValue(0);
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [to, run, reducedMotion, ms]);
  return value;
}

export function Problem({ reducedMotion }: { reducedMotion: boolean }) {
  const t = useTranslations("Problem");
  const f = useFormat();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useInView(ref);
  const warming = useCountUp(CONTEXT.warming20yr, seen, reducedMotion);
  const low = useCountUp(CONTEXT.maasakkers.low, seen, reducedMotion);
  const high = useCountUp(CONTEXT.maasakkers.high, seen, reducedMotion);

  return (
    <section
      id="problem"
      aria-labelledby="problem-title"
      className="relative z-10 bg-background py-28 md:py-40"
    >
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle id="problem-title" className="mt-4 max-w-3xl">
          {t("title")}
        </SectionTitle>
        <div ref={ref} className="mt-14 grid gap-6 md:grid-cols-3">
          <article className="rounded-xl border border-white/10 bg-card p-6">
            <p
              className="font-mono text-5xl text-methane-mid tabular-nums md:text-6xl"
              aria-hidden
            >
              {t("warmingValue", { value: f.num(Math.round(warming)) })}
            </p>
            <p className="mt-4 text-pretty">
              {t("warming", { value: f.num(CONTEXT.warming20yr) })}
            </p>
            <Source href={SOURCES.ipcc}>
              {t("warmingSource", { gwp20: f.num(CONTEXT.gwp20, 1) })}
            </Source>
          </article>
          <article className="rounded-xl border border-white/10 bg-card p-6">
            <p
              className="font-mono text-5xl text-methane-mid tabular-nums md:text-6xl"
              aria-hidden
            >
              {t("maasakkersValue", {
                low: f.num(low, 1),
                high: f.num(high, 1),
              })}
            </p>
            <p className="mt-4 text-pretty">
              {t("maasakkers", {
                low: f.num(CONTEXT.maasakkers.low, 1),
                high: f.num(CONTEXT.maasakkers.high, 1),
              })}
            </p>
            <Source href={SOURCES.maasakkers}>{t("maasakkersSource")}</Source>
          </article>
          <article className="rounded-xl border border-white/10 bg-card p-6">
            <p
              className="font-mono text-5xl text-methane-high md:text-6xl"
              aria-hidden
            >
              {t("fireValue")}
            </p>
            <p className="mt-4 text-pretty">{t("fire")}</p>
            <Source>{t("fireSource")}</Source>
          </article>
        </div>
        <p className="mt-20 max-w-4xl font-heading text-3xl leading-tight font-medium text-balance md:text-5xl">
          {t("line")}
        </p>
      </div>
    </section>
  );
}
