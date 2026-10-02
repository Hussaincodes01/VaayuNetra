"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import type { Flag } from "@/lib/landing-types";
import { useFormat } from "./format";
import { useLenis } from "./SmoothScroll";
import { Kicker, ScreeningNote, SectionTitle, TierBadge } from "./ui";
import { useScrollProgress } from "./useScrollProgress";

const STAGES = ["rgb", "mbmp", "mask"] as const;
type Stage = (typeof STAGES)[number];

// Scroll progress -> wipe positions. 0-0.12 hold true colour, 0.12-0.48 wipe to MBMP,
// 0.52-0.88 wipe to the mask, then hold.
const wipeA = (p: number) => Math.min(1, Math.max(0, (p - 0.12) / 0.36));
const wipeB = (p: number) => Math.min(1, Math.max(0, (p - 0.52) / 0.36));
const stageOf = (p: number): Stage =>
  p < 0.3 ? "rgb" : p < 0.7 ? "mbmp" : "mask";
const progressOf: Record<Stage, number> = { rgb: 0.04, mbmp: 0.5, mask: 0.96 };

/** `still`: reduced motion or a narrow screen, so the three stages are shown side by side. */
export function Signal({ flag, still }: { flag: Flag; still: boolean }) {
  const t = useTranslations("Signal");
  const tc = useTranslations("Common");
  const f = useFormat();
  const lenis = useLenis();
  const section = useRef<HTMLElement>(null);
  const stack = useRef<HTMLDivElement>(null);
  const range = useRef<HTMLInputElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState<Stage>("rgb");
  const ev = flag.evidence;

  useScrollProgress(
    section,
    (p) => {
      const a = wipeA(p);
      const b = wipeB(p);
      stack.current?.style.setProperty("--a", String(a));
      stack.current?.style.setProperty("--b", String(b));
      if (handle.current) {
        const x = b > 0 ? b : a;
        handle.current.style.left = `${x * 100}%`;
        handle.current.style.opacity = x > 0.01 && x < 0.99 ? "1" : "0";
      }
      if (range.current) range.current.value = String(Math.round(p * 100));
      setStage(stageOf(p));
    },
    !still,
  );

  const scrollToProgress = (p: number) => {
    const el = section.current;
    if (!el) return;
    const top = el.getBoundingClientRect().top + window.scrollY;
    const y = top + p * (el.offsetHeight - window.innerHeight);
    if (lenis) lenis.scrollTo(y, { duration: 1.1 });
    else window.scrollTo({ top: y });
  };

  if (!ev) return null;
  const wind = f.num(flag.u10 ?? 0, 1);
  const result = t("result", {
    tier: tc(`tier.${flag.tier}`),
    tph: flag.qMed ? f.tph(flag.qMed) : "–",
    range:
      flag.qLo && flag.qHi
        ? tc("range68", { lo: f.tph(flag.qLo), hi: f.tph(flag.qHi) })
        : "",
    wind,
  });
  const text = {
    rgb: t("rgbText"),
    mbmp: t("mbmpText"),
    mask: t("maskText", { wind }),
  };
  const alt = { rgb: t("rgbAlt"), mbmp: t("mbmpAlt"), mask: t("maskAlt") };
  const src = { rgb: ev.rgb, mbmp: ev.mbmp, mask: ev.mask };

  if (still) {
    return (
      <section
        id="signal"
        aria-labelledby="signal-title"
        className="relative z-10 bg-background py-28"
      >
        <div className="mx-auto max-w-7xl px-4 md:px-8">
          <Kicker>{t("kicker")}</Kicker>
          <SectionTitle id="signal-title" className="mt-4">
            {t("title")}
          </SectionTitle>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {STAGES.map((s) => (
              <figure key={s}>
                <Image
                  src={src[s]}
                  alt={alt[s]}
                  width={552}
                  height={552}
                  unoptimized
                  className="w-full rounded-lg"
                />
                <figcaption className="mt-3 text-sm">
                  <span className="font-medium">{t(`stages.${s}`)}.</span>{" "}
                  {text[s]}
                </figcaption>
              </figure>
            ))}
          </div>
          <p className="mt-10 max-w-3xl text-xl">{t("caption")}</p>
          <p className="mt-4 text-sm text-foreground/80">{result}</p>
          <ScreeningNote className="mt-2" />
        </div>
      </section>
    );
  }

  return (
    <section
      id="signal"
      ref={section}
      aria-labelledby="signal-title"
      className="relative z-10 h-[300svh] bg-background"
    >
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-7xl items-center gap-8 px-4 pt-14 md:grid-cols-[1fr_minmax(0,560px)] md:gap-14 md:px-8">
          <div className="order-2 md:order-1">
            <Kicker>{t("kicker")}</Kicker>
            <SectionTitle
              id="signal-title"
              className="mt-4 text-2xl md:text-4xl"
            >
              {t("title")}
            </SectionTitle>
            <div
              className="mt-6 flex gap-2"
              role="group"
              aria-label={t("sliderLabel")}
            >
              {STAGES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={stage === s}
                  onClick={() => scrollToProgress(progressOf[s])}
                  className="rounded-full border border-white/15 px-3 py-1 text-xs transition-colors aria-pressed:border-signal aria-pressed:bg-signal/10 aria-pressed:text-signal"
                >
                  {t(`stages.${s}`)}
                </button>
              ))}
            </div>
            <p
              className="mt-5 min-h-[6.5rem] max-w-xl text-pretty text-foreground/85 md:text-lg"
              aria-live="polite"
            >
              {text[stage]}
            </p>
            <p className="mt-4 max-w-xl text-lg font-medium text-pretty">
              {t("caption")}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-foreground/80">
              <TierBadge tier={flag.tier} />
              <span>{result}</span>
            </div>
            <ScreeningNote className="mt-3 max-w-xl" />
          </div>

          <div className="order-1 md:order-2">
            <div
              ref={stack}
              className="relative mx-auto aspect-square w-full max-w-[min(560px,46svh)] overflow-hidden rounded-xl border border-white/10 md:max-w-[560px]"
              style={{ ["--a" as string]: 0, ["--b" as string]: 0 }}
            >
              <Image
                src={ev.rgb}
                alt={alt.rgb}
                fill
                unoptimized
                priority={false}
                sizes="560px"
                className="object-cover"
              />
              <div
                className="absolute inset-0"
                style={{ clipPath: "inset(0 calc((1 - var(--a)) * 100%) 0 0)" }}
              >
                <Image
                  src={ev.mbmp}
                  alt={alt.mbmp}
                  fill
                  unoptimized
                  sizes="560px"
                  className="object-cover"
                />
              </div>
              <div
                className="absolute inset-0"
                style={{ clipPath: "inset(0 calc((1 - var(--b)) * 100%) 0 0)" }}
              >
                <Image
                  src={ev.mask}
                  alt={alt.mask}
                  fill
                  unoptimized
                  sizes="560px"
                  className="object-cover"
                />
              </div>
              <div
                ref={handle}
                aria-hidden
                className="absolute inset-y-0 left-0 w-0.5 bg-signal opacity-0 shadow-[0_0_12px_#2DD4BF]"
              />
            </div>
            <label className="mx-auto mt-4 block max-w-[560px]">
              <span className="sr-only">{t("sliderLabel")}</span>
              <input
                ref={range}
                type="range"
                min={0}
                max={100}
                defaultValue={0}
                aria-valuetext={t(`stages.${stage}`)}
                onChange={(e) => scrollToProgress(Number(e.target.value) / 100)}
                className="w-full accent-[#2DD4BF]"
              />
            </label>
            <p className="mx-auto mt-1 max-w-[560px] text-xs text-muted-foreground">
              {t("dragHint")}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
