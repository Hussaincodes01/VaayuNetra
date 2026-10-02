"use client";

import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import type { Tier } from "@/lib/landing-types";
import { cn } from "@/lib/utils";
import { TIER_COLOUR, TIER_TEXT } from "./format";

/** Section label: names the chapter (it matches the header navigation), in sentence case. */
export function Kicker({ children }: { children: ReactNode }) {
  return <p className="text-sm font-medium text-leaf">{children}</p>;
}

export function SectionTitle({
  id,
  children,
  className,
}: {
  id?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <h2
      id={id}
      className={cn(
        "font-heading text-3xl font-medium tracking-tight text-balance text-canopy md:text-5xl",
        className,
      )}
    >
      {children}
    </h2>
  );
}

export function TierBadge({
  tier,
  long = false,
  className,
}: {
  tier: Tier;
  long?: boolean;
  className?: string;
}) {
  const t = useTranslations("Common");
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 font-mono text-xs font-medium",
        className,
      )}
      style={{ borderColor: TIER_COLOUR[tier], color: TIER_TEXT[tier] }}
    >
      <span
        aria-hidden
        className="size-2 rounded-full"
        style={{ background: TIER_COLOUR[tier] }}
      />
      {long ? t(`tier.${tier}`) : t(`tierShort.${tier}`)}
    </span>
  );
}

export function ScreeningNote({ className }: { className?: string }) {
  const t = useTranslations("Common");
  return (
    <p
      className={cn("text-xs leading-relaxed text-muted-foreground", className)}
    >
      {t("screening")}
    </p>
  );
}

export function Source({
  children,
  href,
}: {
  children: ReactNode;
  href?: string;
}) {
  const t = useTranslations("Common");
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      <span className="sr-only">{t("source")}: </span>
      {href ? (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline decoration-dotted underline-offset-4 hover:text-foreground"
        >
          {children}
        </a>
      ) : (
        children
      )}
    </p>
  );
}
