"use client";

import {
  BrainCircuit,
  FileText,
  Gauge,
  Layers,
  Satellite,
  ShieldCheck,
  type LucideIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { CONTEXT, MODEL } from "@/content/facts";
import { cn } from "@/lib/utils";
import { useFormat } from "./format";
import { Kicker, SectionTitle } from "./ui";
import { useScrollProgress } from "./useScrollProgress";

const STEPS: {
  key: "pass" | "mbmp" | "ai" | "gate" | "rate" | "dossier";
  icon: LucideIcon;
}[] = [
  { key: "pass", icon: Satellite },
  { key: "mbmp", icon: Layers },
  { key: "ai", icon: BrainCircuit },
  { key: "gate", icon: ShieldCheck },
  { key: "rate", icon: Gauge },
  { key: "dossier", icon: FileText },
];

/** `still`: reduced motion or a narrow screen, so no sticky panel and every step shown. */
export function HowItWorks({ still }: { still: boolean }) {
  const t = useTranslations("How");
  const f = useFormat();
  const section = useRef<HTMLElement>(null);
  const line = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(still ? STEPS.length : 1);

  useScrollProgress(
    section,
    (p) => {
      setShown(
        Math.max(
          1,
          Math.min(STEPS.length, Math.floor(p * STEPS.length * 1.05) + 1),
        ),
      );
      line.current?.style.setProperty("--p", String(Math.min(1, p * 1.08)));
    },
    !still,
  );

  const values = {
    days: f.num(CONTEXT.revisitDays),
    encoder: MODEL.encoder,
    pretraining: MODEL.pretraining,
    plumes: f.num(MODEL.realPlumes),
  };
  const visible = still ? STEPS.length : shown;

  return (
    <section
      id="how"
      ref={section}
      aria-labelledby="how-title"
      className={cn(
        "relative z-10 bg-background",
        still ? "py-28" : "h-[280svh]",
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
          <SectionTitle id="how-title" className="mt-4 max-w-3xl">
            {t("title")}
          </SectionTitle>
          <div className="relative mt-10 md:mt-14">
            <div
              aria-hidden
              className="absolute top-6 right-0 left-0 hidden h-px bg-white/10 lg:block"
            >
              <div
                ref={line}
                className="h-full origin-left bg-signal"
                style={{
                  transform: "scaleX(var(--p, 0))",
                  ["--p" as string]: still ? 1 : 0,
                }}
              />
            </div>
            <ol className="grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-6">
              {STEPS.map(({ key, icon: Icon }, i) => {
                const on = i < visible;
                return (
                  <li
                    key={key}
                    className={cn(
                      "relative transition-all duration-700 ease-out motion-reduce:transition-none",
                      on
                        ? "translate-y-0 opacity-100"
                        : "translate-y-6 opacity-0",
                    )}
                  >
                    <div
                      className={cn(
                        "relative z-10 flex size-12 items-center justify-center rounded-full border bg-background transition-colors duration-700",
                        on
                          ? "border-signal text-signal"
                          : "border-white/15 text-muted-foreground",
                      )}
                    >
                      <Icon className="size-5" aria-hidden />
                    </div>
                    <p className="mt-4 font-mono text-xs text-muted-foreground">
                      0{i + 1}
                    </p>
                    <h3 className="mt-1 font-heading text-lg font-semibold">
                      {t(`steps.${key}.title`)}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-pretty text-foreground/75">
                      {t(`steps.${key}.text`, values)}
                    </p>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}
