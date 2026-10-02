"use client";

import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";
import type { Flag, Site, Tier } from "@/lib/landing-types";
import { cn } from "@/lib/utils";
import {
  reasonKey,
  TIER_COLOUR,
  TIER_TEXT,
  useFormat,
  usePlaces,
} from "./format";
import { Kicker, SectionTitle } from "./ui";
import { useScrollProgress } from "./useScrollProgress";

const TIERS: Tier[] = ["T1", "T2", "T3"];

function Card({
  flag,
  site,
  order,
  flipped,
}: {
  flag: Flag;
  site: string;
  order: number;
  flipped: boolean;
}) {
  const t = useTranslations("Gate");
  const tc = useTranslations("Common");
  const f = useFormat();
  return (
    <li className="[perspective:900px]">
      <div
        className={cn(
          "relative h-[3.6rem] transition-[transform,opacity] duration-700 ease-out [transform-style:preserve-3d] motion-reduce:transition-none",
          flipped
            ? "[transform:rotateY(0deg)] opacity-100"
            : "[transform:rotateY(180deg)_translateY(10px)] opacity-100",
        )}
      >
        <div
          className="absolute inset-0 flex flex-col justify-center rounded-lg border bg-card px-3 [backface-visibility:hidden]"
          style={{ borderColor: `${TIER_COLOUR[flag.tier]}aa` }}
        >
          <p className="truncate text-sm font-medium">
            {t("card", { site, date: f.date(flag.date, "short") })}
          </p>
          <p className="truncate text-xs text-foreground/75">
            <span style={{ color: TIER_TEXT[flag.tier] }}>{flag.tier}</span> ·{" "}
            {tc(`surfaceKind.${reasonKey(flag)}`)}
          </p>
        </div>
        <div
          aria-hidden
          className="absolute inset-0 flex [transform:rotateY(180deg)] items-center justify-between rounded-lg border border-white/10 bg-white/[0.03] px-3 [backface-visibility:hidden]"
        >
          <span className="font-mono text-xs text-muted-foreground">
            #{String(order + 1).padStart(2, "0")}
          </span>
          <span className="font-mono text-xs text-muted-foreground">
            {f.num(flag.sceneScore, 3)}
          </span>
        </div>
      </div>
    </li>
  );
}

export function PhysicsGate({
  flags,
  sites,
  still,
}: {
  flags: Flag[];
  sites: Site[];
  still: boolean;
}) {
  const t = useTranslations("Gate");
  const section = useRef<HTMLElement>(null);
  const places = usePlaces();
  const names = useMemo(
    () => new Map(sites.map((s) => [s.slug, places.site(s.slug, s.name)])),
    [sites, places],
  );
  // Cards flip in the order the passes were taken.
  const order = useMemo(() => {
    const byDate = [...flags].sort((a, b) => a.date.localeCompare(b.date));
    return new Map(byDate.map((fl, i) => [`${fl.slug}|${fl.date}`, i]));
  }, [flags]);
  const [flippedCount, setFlippedCount] = useState(still ? flags.length : 0);

  useScrollProgress(
    section,
    (p) => setFlippedCount(Math.floor(Math.min(1, p * 1.12) * flags.length)),
    !still,
  );
  const count = still ? flags.length : flippedCount;

  const pile = (tier: Tier) => (
    <div key={tier} className={tier === "T3" ? "md:col-span-2" : ""}>
      <div
        className="flex items-baseline justify-between border-b pb-2"
        style={{ borderColor: TIER_COLOUR[tier] }}
      >
        <h3 className="font-heading text-sm font-semibold md:text-base">
          {t(`pile.${tier}`)}
        </h3>
        <span className="font-mono text-sm text-muted-foreground">
          {
            flags.filter(
              (fl) =>
                fl.tier === tier &&
                (order.get(`${fl.slug}|${fl.date}`) ?? 0) < count,
            ).length
          }
        </span>
      </div>
      <ul className={cn("mt-3 grid gap-2", tier === "T3" && "sm:grid-cols-2")}>
        {flags
          .filter((fl) => fl.tier === tier)
          .map((fl) => {
            const o = order.get(`${fl.slug}|${fl.date}`) ?? 0;
            return (
              <Card
                key={`${fl.slug}|${fl.date}`}
                flag={fl}
                site={names.get(fl.slug) ?? fl.slug}
                order={o}
                flipped={o < count}
              />
            );
          })}
      </ul>
    </div>
  );

  return (
    <section
      id="gate"
      ref={section}
      aria-labelledby="gate-title"
      className={cn(
        "relative z-10 bg-background",
        still ? "py-28" : "h-[260svh]",
      )}
    >
      <div
        className={
          still
            ? ""
            : "sticky top-0 flex h-[100svh] items-center overflow-hidden"
        }
      >
        <div className="mx-auto w-full max-w-7xl px-4 pt-14 md:px-8">
          <Kicker>{t("kicker")}</Kicker>
          <SectionTitle id="gate-title" className="mt-4 max-w-3xl">
            {t("title")}
          </SectionTitle>
          <p className="mt-4 max-w-2xl font-heading text-xl text-signal md:text-2xl">
            {t("line")}
          </p>
          <p className="mt-3 max-w-2xl text-sm text-foreground/75">
            {t("intro")}
          </p>
          <div className="mt-8 grid gap-6 md:grid-cols-4">
            {TIERS.map(pile)}
          </div>
        </div>
      </div>
    </section>
  );
}
