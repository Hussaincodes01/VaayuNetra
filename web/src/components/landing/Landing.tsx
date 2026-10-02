"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import type { LandingData } from "@/lib/landing-types";
import { Action } from "./Action";
import { FieldTest } from "./FieldTest";
import { Film } from "./Film";
import { Footer } from "./Footer";
import { Hero } from "./Hero";
import { Honest } from "./Honest";
import { HowItWorks } from "./HowItWorks";
import { Initiative } from "./Initiative";
import type { TourStop } from "./MapboxStage";
import {
  useAfterFirstInteraction,
  useIsNarrow,
  useReducedMotion,
} from "./motion";
import { PhysicsGate } from "./PhysicsGate";
import { Problem } from "./Problem";
import { Proof } from "./Proof";
import { Signal } from "./Signal";
import { SiteHeader } from "./SiteHeader";
import { SmoothScroll } from "./SmoothScroll";

const MapboxStage = dynamic(() => import("./MapboxStage"), { ssr: false });

// Geographic tour: on from the hero's Delhi close-up, then Ahmedabad, ending on the Deonar T1.
const TOUR = ["ghazipur", "okhla", "bhalswa", "pirana", "deonar"];

type Env = { mapboxToken?: string; mapillaryToken?: string; videoUrl?: string };

export function Landing({ data, env }: { data: LandingData; env: Env }) {
  const t = useTranslations("Field");
  const reduced = useReducedMotion();
  const narrow = useIsNarrow();
  const idle = useAfterFirstInteraction();
  const still = reduced || narrow;
  const mapMode = env.mapboxToken ? "mapbox" : "globe";

  const stops: TourStop[] = useMemo(() => {
    const bySlug = new Map(data.sites.map((s) => [s.slug, s]));
    const order = [
      ...TOUR.filter((s) => bySlug.has(s)),
      ...data.sites.map((s) => s.slug).filter((s) => !TOUR.includes(s)),
    ];
    // Flags arrive sorted by tier then score, so the first per site is the one to show.
    return order.map((slug) => ({
      site: bySlug.get(slug)!,
      flag: data.flags.find((f) => f.slug === slug) ?? null,
    }));
  }, [data.sites, data.flags]);

  const t1 =
    data.flags.find((f) => f.tier === "T1" && f.evidence) ??
    data.flags.find((f) => f.evidence);
  const deonar = data.stats.find((s) => s.slug === "deonar");

  return (
    <SmoothScroll>
      <SiteHeader hasFilm={Boolean(env.videoUrl)} />
      {env.mapboxToken && idle && (
        <div className="fixed inset-0 z-0">
          <MapboxStage
            token={env.mapboxToken}
            stops={stops}
            reducedMotion={reduced}
            narrow={narrow}
            controlLabel={t("controlShort")}
          />
        </div>
      )}
      <main id="main" className="relative">
        <Hero
          data={data}
          sites={stops.map((s) => s.site)}
          hasFilm={Boolean(env.videoUrl)}
          reducedMotion={reduced}
        />
        <Problem reducedMotion={reduced} />
        {t1 && <Signal flag={t1} still={still} />}
        <HowItWorks still={still} />
        <Proof reducedMotion={reduced} />
        <FieldTest
          stops={stops}
          stats={data.stats}
          scenes={data.scenes}
          mapMode={mapMode}
          mapillaryToken={env.mapillaryToken}
          still={reduced}
        />
        <PhysicsGate flags={data.flags} sites={data.sites} still={still} />
        {deonar && (
          <Action
            stat={deonar}
            assumptions={data.assumptions}
            dossierPdfUrl={data.dossierPdfUrl}
          />
        )}
        <Honest stats={data.stats} sites={data.sites} />
        {env.videoUrl && <Film url={env.videoUrl} />}
        <Initiative />
      </main>
      <Footer modelVersion={data.modelVersion} lastUpdated={data.lastUpdated} />
    </SmoothScroll>
  );
}
