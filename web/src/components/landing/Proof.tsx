"use client";

import dynamic from "next/dynamic";
import { useTranslations } from "next-intl";
import { useRef, type ReactNode } from "react";
import { BENCHMARK } from "@/content/facts";
import { useFormat } from "./format";
import { Kicker, SectionTitle } from "./ui";
import { useInView } from "./useScrollProgress";

const load = () => import("./ProofCharts");
const AucChart = dynamic(() => load().then((m) => m.AucChart), { ssr: false });
const RecallChart = dynamic(() => load().then((m) => m.RecallChart), {
  ssr: false,
});
const IouChart = dynamic(() => load().then((m) => m.IouChart), { ssr: false });
const AccuracyChart = dynamic(() => load().then((m) => m.AccuracyChart), {
  ssr: false,
});

function ChartCard({
  title,
  meaning,
  minH,
  children,
}: {
  title: string;
  meaning: string;
  minH: string;
  children: ReactNode;
}) {
  return (
    <figure className="flex flex-col rounded-xl border border-white/10 bg-card p-6">
      <h3 className="font-heading text-lg font-semibold">{title}</h3>
      <div className="mt-4 flex-1" style={{ minHeight: minH }}>
        {children}
      </div>
      <figcaption className="mt-4 text-sm leading-relaxed text-pretty text-foreground/80">
        {meaning}
      </figcaption>
    </figure>
  );
}

export function Proof({ reducedMotion }: { reducedMotion: boolean }) {
  const t = useTranslations("Proof");
  const tc = useTranslations("Common");
  const f = useFormat();
  const grid = useRef<HTMLDivElement>(null);
  const near = useInView(grid, "0px 0px 60% 0px");
  const seen = useInView(grid, "0px 0px -20% 0px");
  const animate = reducedMotion || seen;
  const names: [string, string] = [tc("vayunetra"), tc("mbmp")];
  const fmt = (v: number, d = 2) => f.num(v, d);
  const {
    rocAuc,
    pixelIoU,
    recallByRate,
    rateAccuracy,
    operatingPoint: op,
  } = BENCHMARK;
  const low = recallByRate[0];

  return (
    <section
      id="proof"
      aria-labelledby="proof-title"
      className="relative z-10 bg-background py-28 md:py-36"
    >
      <div className="mx-auto max-w-7xl px-4 md:px-8">
        <Kicker>{t("kicker")}</Kicker>
        <SectionTitle id="proof-title" className="mt-4 max-w-3xl">
          {t("title")}
        </SectionTitle>
        <p className="mt-5 max-w-2xl text-foreground/80">{t("intro")}</p>

        <div ref={grid} className="mt-12 grid gap-6 md:grid-cols-2">
          <ChartCard
            title={t("auc.title")}
            minH="150px"
            meaning={t("auc.meaning", {
              vayunetra: fmt(rocAuc.vayunetra, 3),
              mbmp: fmt(rocAuc.mbmp, 3),
            })}
          >
            {near && (
              <AucChart
                animate={animate}
                fmt={fmt}
                names={names}
                chance="0.5"
                label={t("chartLabel", {
                  title: t("auc.title"),
                  vayunetra: fmt(rocAuc.vayunetra, 3),
                  mbmp: fmt(rocAuc.mbmp, 3),
                })}
              />
            )}
          </ChartCard>
          <ChartCard
            title={t("recall.title")}
            minH="190px"
            meaning={t("recall.meaning", {
              low: fmt(low.vayunetra),
              lowMbmp: fmt(low.mbmp),
            })}
          >
            {near && (
              <RecallChart
                animate={animate}
                fmt={fmt}
                names={names}
                label={`${t("recall.title")}: ${recallByRate
                  .map(
                    (b) =>
                      `${b.bin}: ${names[0]} ${fmt(b.vayunetra)}, ${names[1]} ${fmt(b.mbmp)}`,
                  )
                  .join("; ")}`}
              />
            )}
          </ChartCard>
          <ChartCard
            title={t("iou.title")}
            minH="150px"
            meaning={t("iou.meaning", {
              vayunetra: fmt(pixelIoU.vayunetra, 3),
              mbmp: fmt(pixelIoU.mbmp, 3),
            })}
          >
            {near && (
              <IouChart
                animate={animate}
                fmt={fmt}
                names={names}
                label={t("chartLabel", {
                  title: t("iou.title"),
                  vayunetra: fmt(pixelIoU.vayunetra, 3),
                  mbmp: fmt(pixelIoU.mbmp, 3),
                })}
              />
            )}
          </ChartCard>
          <ChartCard
            title={t("accuracy.title")}
            minH="190px"
            meaning={t("accuracy.meaning", {
              share: f.pct(rateAccuracy.withinHalf),
              plumes: f.num(rateAccuracy.plumes),
              ratio: fmt(rateAccuracy.medianRatio),
            })}
          >
            {near && (
              <AccuracyChart
                animate={animate}
                share={rateAccuracy.withinHalf}
                inside={t("accuracy.inside")}
                outside={t("accuracy.outside")}
                label={t("accuracy.meaning", {
                  share: f.pct(rateAccuracy.withinHalf),
                  plumes: f.num(rateAccuracy.plumes),
                  ratio: fmt(rateAccuracy.medianRatio),
                })}
              />
            )}
          </ChartCard>
        </div>
        <p className="mt-8 font-mono text-xs text-muted-foreground">
          {t("operating", {
            pV: fmt(op.precision.vayunetra, 3),
            pM: fmt(op.precision.mbmp, 3),
            rV: fmt(op.recall.vayunetra, 3),
            rM: fmt(op.recall.mbmp, 3),
            fV: f.pct(op.falseAlarm.vayunetra, 1),
            fM: f.pct(op.falseAlarm.mbmp, 1),
          })}
        </p>
      </div>
    </section>
  );
}
