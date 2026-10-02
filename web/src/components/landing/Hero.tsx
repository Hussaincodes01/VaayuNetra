"use client";

import { ArrowDown, Play } from "lucide-react";
import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { Link } from "@/i18n/navigation";
import type { LandingData, Site } from "@/lib/landing-types";
import { useFormat } from "./format";
import { setMapScene } from "./map-bus";
import { useAfterFirstInteraction } from "./motion";
import { useScrollProgress } from "./useScrollProgress";

const HeroParticles = dynamic(() => import("./HeroParticles"), { ssr: false });

type Props = {
  data: Pick<LandingData, "scenes" | "worker" | "source">;
  sites: Site[];
  hasFilm: boolean;
  mapMode: "mapbox" | "globe";
  reducedMotion: boolean;
};

export function Hero({ data, sites, hasFilm, mapMode, reducedMotion }: Props) {
  const t = useTranslations("Hero");
  const f = useFormat();
  const section = useRef<HTMLElement>(null);
  const copy = useRef<HTMLDivElement>(null);
  const [inView, setInView] = useState(true);
  // Render the WebGL layer only while some of the hero is on screen.
  useEffect(() => {
    const el = section.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting));
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const idle = useAfterFirstInteraction();

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
    if (reducedMotion) setMapScene({ kind: "hero", progress: 0.5 });
  }, [reducedMotion]);

  const scenes = data.scenes;
  return (
    <section
      id="top"
      ref={section}
      aria-labelledby="hero-title"
      className={reducedMotion ? "relative h-[100svh]" : "relative h-[200svh]"}
    >
      <div className="sticky top-0 h-[100svh] overflow-hidden">
        {mapMode === "globe" && (
          <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_70%_45%,#0d1a2e_0%,#05070d_60%)]" />
        )}
        {/* Lightweight poster of the night globe, shown until the WebGL layer mounts. */}
        <div
          aria-hidden
          className={
            "pointer-events-none absolute inset-0 transition-opacity duration-1000 " +
            (mapMode === "globe" ? "md:left-[30%] " : "") +
            (mapMode === "mapbox" && idle ? "opacity-0" : "opacity-100")
          }
        >
          <div className="absolute top-1/2 left-1/2 aspect-square h-[87%] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle_at_40%_35%,#0c1a30_0%,#081120_60%)] shadow-[0_0_70px_6px_rgba(45,212,191,0.28),inset_0_0_36px_rgba(45,212,191,0.18)]" />
        </div>
        {idle && (
          <div
            className={
              mapMode === "globe"
                ? "absolute inset-0 md:left-[30%]"
                : "absolute inset-0 opacity-60"
            }
          >
            <HeroParticles
              mode={mapMode === "globe" ? "globe" : "haze"}
              sites={sites}
              active={inView}
              reducedMotion={reducedMotion}
            />
          </div>
        )}
        <span className="sr-only" role="img" aria-label={t("globeLabel")} />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-background/90 via-background/40 to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-48 bg-gradient-to-t from-background to-transparent" />

        <div
          ref={copy}
          className="relative mx-auto flex h-full max-w-7xl flex-col justify-center px-4 pt-14 md:px-8"
        >
          <p className="font-mono text-xs tracking-[0.22em] text-signal uppercase [&:lang(hi)]:tracking-normal">
            {t("eyebrow")}
          </p>
          <h1
            id="hero-title"
            className="mt-5 max-w-3xl font-heading text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-6xl lg:text-7xl"
          >
            {t("title")}
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-pretty text-foreground/80 md:text-xl">
            {t("subtitle")}
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            {hasFilm && (
              <a
                href="#film"
                className="inline-flex items-center gap-2 rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                <Play className="size-4" aria-hidden /> {t("watchFilm")}
              </a>
            )}
            <Link
              href="/dashboard"
              prefetch={false}
              className={
                hasFilm
                  ? "inline-flex items-center rounded-md border border-white/20 px-5 py-3 text-sm font-semibold transition-colors hover:bg-white/5"
                  : "inline-flex items-center rounded-md bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
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
              className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-white/10 bg-white/10 text-sm md:grid-cols-4"
            >
              <div className="bg-background/85 px-4 py-3 backdrop-blur">
                <dt className="text-xs text-muted-foreground">{t("scenes")}</dt>
                <dd className="font-mono text-lg">{f.num(scenes.total)}</dd>
              </div>
              <div className="bg-background/85 px-4 py-3 backdrop-blur">
                <dt className="text-xs text-muted-foreground">
                  {t("controlFalseAlarms")}
                </dt>
                <dd className="font-mono text-lg">
                  {t("controlValue", {
                    flags: f.num(scenes.controlFlags),
                    passes: f.num(scenes.control),
                  })}
                </dd>
              </div>
              <div className="bg-background/85 px-4 py-3 backdrop-blur">
                <dt className="text-xs text-muted-foreground">
                  {t("lastScan")}
                </dt>
                <dd className="font-mono text-lg">
                  {f.date(scenes.lastPassDate, "short")}
                </dd>
              </div>
              <div className="bg-background/85 px-4 py-3 backdrop-blur">
                {data.worker ? (
                  <>
                    <dt className="text-xs text-muted-foreground">
                      {t("worker")}
                    </dt>
                    <dd className="flex items-center gap-2 font-mono text-lg">
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
                    <dd className="text-xs leading-snug text-foreground/80">
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
