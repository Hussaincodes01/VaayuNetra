"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { FIELD_TEST } from "@/content/facts";
import type { LandingData, SiteStat } from "@/lib/landing-types";
import { cn } from "@/lib/utils";
import { EvidenceChip } from "./EvidenceChip";
import { reasonKey, useFormat, usePlaces } from "./format";
import { GroundView } from "./GroundView";
import type { TourStop } from "./MapboxStage";
import { setMapScene } from "./map-bus";
import { registerGsap, ScrollTrigger } from "./motion";
import { Kicker, ScreeningNote, SectionTitle, TierBadge } from "./ui";

type Props = {
  stops: TourStop[];
  stats: SiteStat[];
  scenes: LandingData["scenes"];
  mapMode: "mapbox" | "globe";
  mapillaryToken?: string;
  still: boolean;
};

function SiteCard({
  stop,
  stat,
  index,
  total,
  mapillaryToken,
  compact,
}: {
  stop: TourStop;
  stat: SiteStat | undefined;
  index: number;
  total: number;
  mapillaryToken?: string;
  compact?: boolean;
}) {
  const t = useTranslations("Field");
  const tc = useTranslations("Common");
  const f = useFormat();
  const places = usePlaces();
  const { site, flag } = stop;
  const rate =
    flag && (flag.tier === "T1" || flag.tier === "T2")
      ? flag.qMed !== null
        ? t("rate", {
            tph: f.tph(flag.qMed),
            range:
              flag.qLo !== null && flag.qHi !== null
                ? tc("range68", { lo: f.tph(flag.qLo), hi: f.tph(flag.qHi) })
                : "",
          })
        : flag.u10 !== null
          ? t("rateCalm", { wind: f.num(flag.u10, 1) })
          : null
      : null;

  return (
    <article className="rounded-xl border border-white/10 bg-background/85 p-5 shadow-2xl backdrop-blur-md md:p-6">
      <p className="font-mono text-xs text-muted-foreground">
        {t("step", { n: index + 1, total })} · {places.region(site.city)},{" "}
        {places.region(site.state)}
      </p>
      <h3 className="mt-1 font-heading text-2xl font-semibold md:text-3xl">
        {places.site(site.slug, site.name)}
      </h3>
      {stat && (
        <p className="mt-1 font-mono text-sm text-muted-foreground">
          {t("passes", {
            passes: f.num(stat.passes),
            flags: f.num(stat.flags),
          })}
        </p>
      )}
      {flag ? (
        <div className="mt-4 space-y-2">
          <p className="text-xs text-muted-foreground">{t("flagged")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <TierBadge tier={flag.tier} long />
          </div>
          <p className="text-sm">
            {f.date(flag.date)} · {tc(`surfaceKind.${reasonKey(flag)}`)}
            {flag.u10 !== null && (
              <>
                {" "}
                ·{" "}
                <span className="whitespace-nowrap">
                  {t("wind", { wind: f.num(flag.u10, 1) })}
                </span>
              </>
            )}
          </p>
          {rate && (
            <p className="font-mono text-base text-methane-low">{rate}</p>
          )}
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t("noFlag")}</p>
      )}
      {!compact && stat && (
        <ul className="mt-4 space-y-1.5 border-t border-white/10 pt-4 text-sm text-foreground/80">
          <li className="flex gap-2">
            <span
              aria-hidden
              className="mt-1.5 size-2 shrink-0 rounded-full bg-muted-foreground"
            />
            {t("control", {
              km: f.num(FIELD_TEST.controlDistanceKm),
              flags: f.num(stat.controlFlags),
              passes: f.num(stat.controlPasses),
            })}
          </li>
          {stat.persistentUpperTph !== null && (
            <li className="flex gap-2">
              <span
                aria-hidden
                className="mt-1.5 size-2 shrink-0 rounded-full bg-signal"
              />
              {t("bound", { tph: f.num(stat.persistentUpperTph) })}
            </li>
          )}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {mapillaryToken && <GroundView token={mapillaryToken} site={site} />}
      </div>
      {rate && !compact && <ScreeningNote className="mt-3" />}
    </article>
  );
}

export function FieldTest({
  stops,
  stats,
  scenes,
  mapMode,
  mapillaryToken,
  still,
}: Props) {
  const t = useTranslations("Field");
  const f = useFormat();
  const places = usePlaces();
  const tour = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const statBySlug = new Map(stats.map((s) => [s.slug, s]));
  const n = stops.length;
  const tiers = stats.reduce(
    (a, s) => ({ t1: a.t1 + s.t1, t2: a.t2 + s.t2, t3: a.t3 + s.t3 }),
    { t1: 0, t2: 0, t3: 0 },
  );
  const flags = stats.reduce((a, s) => a + s.flags, 0);

  useEffect(() => {
    if (still || !tour.current) return;
    registerGsap();
    const st = ScrollTrigger.create({
      trigger: tour.current,
      start: "top top",
      end: "bottom bottom",
      onUpdate: (self) => {
        const i = Math.min(n - 1, Math.floor(self.progress * n));
        setActive(i);
        setMapScene({ kind: "site", index: i });
      },
      onEnter: () => setMapScene({ kind: "site", index: 0 }),
      onLeaveBack: () => setMapScene({ kind: "hero", progress: 1 }),
    });
    return () => st.kill();
  }, [still, n]);

  const header = (
    <div className="relative z-10 bg-background pt-28 pb-14 md:pt-36">
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle id="field-title" className="mt-4 max-w-3xl">
          {t("title")}
        </SectionTitle>
        <p className="mt-5 max-w-2xl text-foreground/80">
          {t("intro", { km: f.num(FIELD_TEST.controlDistanceKm) })}
        </p>
        <dl className="mt-10 grid grid-cols-2 gap-6 md:grid-cols-4">
          <div>
            <dt className="text-sm text-muted-foreground">{t("statScenes")}</dt>
            <dd className="font-mono text-4xl">{f.num(scenes.total)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">
              {t("statControl")}
            </dt>
            <dd className="font-mono text-4xl">
              {f.num(scenes.controlFlags)}/{f.num(scenes.control)}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("statFlags")}</dt>
            <dd className="font-mono text-4xl">{f.num(flags)}</dd>
          </div>
          <div>
            <dt className="text-sm text-muted-foreground">{t("statTiers")}</dt>
            <dd className="font-mono text-4xl">
              <span className="text-tier-1">{tiers.t1}</span> ·{" "}
              <span className="text-[#C084FC]">{tiers.t2}</span> ·{" "}
              <span className="text-tier-3">{tiers.t3}</span>
            </dd>
          </div>
        </dl>
      </div>
    </div>
  );

  if (still) {
    return (
      <section
        id="field"
        aria-labelledby="field-title"
        className="relative z-10 bg-background pb-24"
      >
        {header}
        <div className="mx-auto grid max-w-7xl gap-10 px-4 md:px-8">
          {stops.map((stop, i) => (
            <div
              key={stop.site.slug}
              className="grid items-start gap-6 md:grid-cols-[minmax(0,420px)_1fr]"
            >
              <SiteCard
                stop={stop}
                stat={statBySlug.get(stop.site.slug)}
                index={i}
                total={n}
                mapillaryToken={mapillaryToken}
              />
              {stop.flag?.evidence && (
                <EvidenceChip
                  flag={stop.flag}
                  siteName={places.site(stop.site.slug, stop.site.name)}
                  controlKm={FIELD_TEST.controlDistanceKm}
                  className="w-full max-w-[640px] rounded-xl"
                />
              )}
            </div>
          ))}
        </div>
      </section>
    );
  }

  return (
    <section id="field" aria-labelledby="field-title" className="relative z-10">
      {header}
      <div ref={tour} className="relative" style={{ height: `${n * 100}svh` }}>
        <div className="sticky top-0 h-[100svh] overflow-hidden">
          {mapMode === "globe" ? (
            <div className="absolute inset-0 bg-background">
              <div className="absolute inset-x-0 top-14 flex h-[48svh] items-center justify-center md:inset-y-0 md:top-0 md:right-0 md:left-[40%] md:h-auto">
                {stops.map((stop, i) =>
                  stop.flag?.evidence ? (
                    <EvidenceChip
                      key={stop.site.slug}
                      flag={stop.flag}
                      siteName={places.site(stop.site.slug, stop.site.name)}
                      controlKm={FIELD_TEST.controlDistanceKm}
                      className={cn(
                        "absolute h-[44svh] w-auto max-w-[92vw] rounded-xl transition-opacity duration-700 md:h-[78svh]",
                        i === active ? "opacity-100" : "opacity-0",
                      )}
                    />
                  ) : null,
                )}
              </div>
            </div>
          ) : (
            <div className="sr-only" role="img" aria-label={t("mapLabel")} />
          )}
          <div className="absolute inset-x-0 bottom-0 px-4 pb-4 md:inset-y-0 md:left-0 md:flex md:w-[40%] md:max-w-[480px] md:items-center md:px-8 md:pb-0">
            <div className="w-full" aria-live="polite">
              <SiteCard
                stop={stops[active]}
                stat={statBySlug.get(stops[active].site.slug)}
                index={active}
                total={n}
                mapillaryToken={mapillaryToken}
              />
            </div>
          </div>
          <ol
            className="absolute top-20 right-4 flex gap-1.5 md:right-8"
            aria-hidden
          >
            {stops.map((s, i) => (
              <li
                key={s.site.slug}
                className={cn(
                  "h-1.5 w-6 rounded-full transition-colors",
                  i === active ? "bg-signal" : "bg-white/20",
                )}
              />
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
