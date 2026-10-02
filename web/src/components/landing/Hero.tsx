"use client";

import { ArrowDown, Play } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import { STATUS_COLOUR } from "@/components/dashboard/status";
import { Link } from "@/i18n/navigation";
import type { LandingData, Site } from "@/lib/landing-types";
import { useFormat } from "./format";
import type { EarthPin } from "./HeroEarth";
import { EARTH_LIFT } from "./earth-frame";
import { setMapScene } from "./map-bus";
import { useAfterFirstInteraction, useIsNarrow } from "./motion";
import { useScrollProgress } from "./useScrollProgress";

const HeroEarth = dynamic(() => import("./HeroEarth"), { ssr: false });

type Props = {
  data: Pick<LandingData, "scenes" | "worker" | "source" | "stats">;
  sites: Site[];
  hasFilm: boolean;
  reducedMotion: boolean;
};

// Cumulus puffs along the top of the cloud bank: x and width in % of the hero width, top in % of the
// bank height. White tops (warmed slightly by the low sun) with pale blue-grey undersides.
const PUFFS = [
  { x: -6, w: 26, top: 30 },
  { x: 12, w: 22, top: 44 },
  { x: 26, w: 30, top: 34 },
  { x: 47, w: 24, top: 18 },
  { x: 60, w: 30, top: 6 },
  { x: 80, w: 26, top: 14 },
  { x: 93, w: 22, top: 30 },
];

/** Cloud bank the Earth rises out of; drifts slowly sideways unless motion is reduced. */
function CloudBank() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 bottom-0 h-[36svh]"
    >
      <div className="vayu-drift absolute inset-0">
        {PUFFS.map((p, i) => (
          <div
            key={i}
            className="absolute aspect-[5/3] rounded-[50%] blur-[3px]"
            style={{
              left: `${p.x}%`,
              top: `${p.top}%`,
              width: `${p.w}%`,
              background:
                "radial-gradient(ellipse 50% 50% at 46% 42%, #fffdf8 0%, #ffffff 42%, #eef4f3 62%, rgb(221 233 235 / 0.9) 72%, rgb(221 233 235 / 0) 76%)",
            }}
          />
        ))}
      </div>
      {/* The body of the bank, fading into the page below. */}
      <div className="absolute inset-x-0 top-[48%] bottom-0 bg-[linear-gradient(180deg,rgb(255_255_255/0)_0%,#ffffff_30%,#f6f8f3_100%)]" />
    </div>
  );
}

export function Hero({ data, sites, hasFilm, reducedMotion }: Props) {
  const t = useTranslations("Hero");
  const f = useFormat();
  const section = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  const [earthReady, setEarthReady] = useState(false);
  // Render the WebGL layer only while some of the hero is on screen.
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const idle = useAfterFirstInteraction();
  // Phones: a smaller globe, centred above the headline; desktop: lower, rising out of the clouds.
  const narrow = useIsNarrow();

  useScrollProgress(
    section,
    (p) => {
      setMapScene({ kind: "hero", progress: p });
      if (copy.current)
        copy.current.style.opacity = String(
          1 - Math.max(0, (p - 0.55) / 0.45) * 0.8,
        );
    },
    !reducedMotion,
  );
  useEffect(() => {
    if (reducedMotion) setMapScene({ kind: "hero", progress: 0 });
  }, [reducedMotion]);

  // Pins in status colours; the highest-priority sites are drawn last so they sit on top.
  const pins: EarthPin[] = useMemo(() => {
    const rank = ["no_large_events", "surface_activity", "watch", "priority"];
    return sites
      .map((s) => {
        const status =
          data.stats.find((x) => x.slug === s.slug)?.status ??
          "no_large_events";
        return {
          slug: s.slug,
          lat: s.lat,
          lon: s.lon,
          colour: STATUS_COLOUR[status],
          pulse: status === "priority",
          rank: rank.indexOf(status),
        };
      })
      .sort((a, b) => a.rank - b.rank);
  }, [sites, data.stats]);

  const scenes = data.scenes;
  return (
    <section
      id="top"
      ref={section}
      aria-labelledby="hero-title"
      className={reducedMotion ? "relative h-[100svh]" : "relative h-[200svh]"}
    >
      <div className="sticky top-0 h-[100svh] overflow-hidden bg-[linear-gradient(180deg,#D3E8EF_0%,#E6F1F0_48%,#F6F8F3_100%)]">
        {/* Low sun in the upper left, as in late-afternoon light above the clouds. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_6%,rgb(255_241_214/0.75),transparent_42%)]"
        />

        <div
          data-earth-stage
          className="absolute inset-x-0 top-14 h-[32svh] md:inset-y-0 md:top-0 md:-right-[12%] md:left-[44%] md:h-auto"
        >
          {/* Static render of the first frame (desktop and phone framing), shown until the WebGL Earth has drawn. */}
          <picture>
            <source
              media="(min-width: 768px)"
              srcSet="/hero/earth-poster.webp"
            />
            <img
              src="/hero/earth-poster-phone.webp"
              alt=""
              aria-hidden
              fetchPriority="high"
              decoding="async"
              className={
                "pointer-events-none absolute top-0 left-1/2 aspect-square h-full max-w-none -translate-x-1/2 transition-opacity duration-700 " +
                (earthReady ? "opacity-0" : "opacity-100")
              }
            />
          </picture>
          {idle && (
            <HeroEarth
              pins={pins}
              active={inView}
              reducedMotion={reducedMotion}
              lift={narrow ? 0 : EARTH_LIFT}
              onReady={() => setEarthReady(true)}
            />
          )}
        </div>
        <span className="sr-only" role="img" aria-label={t("globeLabel")} />
        <CloudBank />

        <div
          ref={copy}
          className="relative mx-auto flex h-full max-w-7xl flex-col justify-end px-4 pt-14 pb-52 md:justify-center md:px-8 md:pb-24"
        >
          <p className="text-sm font-medium text-leaf md:text-base">
            {t("eyebrow")}
          </p>
          <h1
            id="hero-title"
            className="mt-3 max-w-2xl font-heading text-[2.15rem] leading-[1.04] font-medium tracking-tight text-balance text-canopy sm:text-6xl md:mt-4 xl:text-7xl"
          >
            {t("title")}
          </h1>
          <p className="mt-4 max-w-xl text-base text-pretty text-foreground/85 md:mt-6 md:text-xl">
            {t("subtitle")}
          </p>
          <div className="mt-6 flex flex-wrap gap-3 md:mt-8">
            {hasFilm && (
              <a
                href="#film"
                className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-canopy"
              >
                <Play className="size-4" aria-hidden /> {t("watchFilm")}
              </a>
            )}
            <Link
              href="/dashboard"
              prefetch={false}
              className={
                hasFilm
                  ? "inline-flex items-center rounded-full border border-canopy/25 bg-white/70 px-5 py-3 text-sm font-semibold text-canopy backdrop-blur transition-colors hover:bg-white"
                  : "inline-flex items-center rounded-full bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-canopy"
              }
            >
              {t("openDashboard")}
            </Link>
          </div>
        </div>

        <div className="absolute inset-x-0 bottom-0">
          <div className="mx-auto max-w-7xl px-4 pb-6 md:px-8">
            <dl
              aria-label={t("stripLabel")}
              className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-canopy/10 bg-canopy/10 text-sm md:grid-cols-4 [&>div]:bg-white/90 [&>div]:backdrop-blur-md"
            >
              <div className="px-4 py-3">
                <dt className="text-xs text-muted-foreground">{t("scenes")}</dt>
                <dd className="font-mono text-lg text-canopy">
                  {f.num(scenes.total)}
                </dd>
              </div>
              <div className="px-4 py-3">
                <dt className="text-xs text-muted-foreground">
                  {t("controlFalseAlarms")}
                </dt>
                <dd className="font-mono text-lg text-canopy">
                  {t("controlValue", {
                    flags: f.num(scenes.controlFlags),
                    passes: f.num(scenes.control),
                  })}
                </dd>
              </div>
              <div className="px-4 py-3">
                <dt className="text-xs text-muted-foreground">
                  {t("lastScan")}
                </dt>
                <dd className="font-mono text-lg text-canopy">
                  {f.date(scenes.lastPassDate, "short")}
                </dd>
              </div>
              <div className="px-4 py-3">
                {data.worker ? (
                  <>
                    <dt className="text-xs text-muted-foreground">
                      {t("worker")}
                    </dt>
                    <dd className="flex items-center gap-2 font-mono text-lg text-canopy">
                      <span
                        aria-hidden
                        className={
                          data.worker.online
                            ? "size-2 rounded-full bg-tier-clear"
                            : "size-2 rounded-full bg-muted-foreground"
                        }
                      />
                      {data.worker.online ? t("online") : t("offline")}
                    </dd>
                  </>
                ) : (
                  <>
                    <dt className="text-xs text-muted-foreground">
                      {t("stripLabel")}
                    </dt>
                    <dd className="text-xs leading-snug text-foreground/85">
                      {t("sourceSeed")}
                    </dd>
                  </>
                )}
              </div>
            </dl>
            {data.source === "supabase" && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t("sourceLive")}
              </p>
            )}
            <p
              className="mt-3 hidden items-center gap-2 text-xs text-muted-foreground md:flex"
              aria-hidden
            >
              <ArrowDown className="size-3.5 animate-bounce motion-reduce:animate-none" />{" "}
              {t("scroll")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
