"use client";

import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { makeFormat } from "@/lib/format";
import type { Flag } from "@/lib/landing-types";

/** Locale-aware number and date formatting (Latin digits in both English and Hindi). */
export function useFormat() {
  const locale = useLocale();
  return useMemo(() => makeFormat(locale), [locale]);
}

/** Localised site, city and state names, falling back to the database value for new sites. */
export function usePlaces() {
  const t = useTranslations("Places");
  return useMemo(
    () => ({
      site: (slug: string, fallback: string) =>
        t.has(`sites.${slug}` as never)
          ? t(`sites.${slug}` as never)
          : fallback,
      region: (name: string) =>
        t.has(`regions.${name}` as never)
          ? t(`regions.${name}` as never)
          : name,
    }),
    [t],
  );
}

export const TIER_COLOUR = {
  T1: "#DC2626",
  T2: "#A855F7",
  T3: "#F59E0B",
} as const;
// Lighter tints of the tier colours for text on the dark background (WCAG AA).
export const TIER_TEXT = {
  T1: "#FCA5A5",
  T2: "#D8B4FE",
  T3: "#FCD34D",
} as const;

/** Message key (Common.surfaceKind.*) for why a flag landed in its tier. */
export type ReasonKey =
  "spectral" | "nearMiss" | "burn" | "freshWaste" | "moisture";

export function reasonKey(flag: Pick<Flag, "tier" | "surfaceKind">): ReasonKey {
  if (flag.tier === "T1") return "spectral";
  if (flag.tier === "T2") return "nearMiss";
  const k = flag.surfaceKind ?? "";
  if (k.includes("burn")) return "burn";
  if (k.includes("fresh waste")) return "freshWaste";
  return "moisture";
}
