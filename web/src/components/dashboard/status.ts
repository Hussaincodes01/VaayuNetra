import type { SiteStatus } from "@/lib/landing-types";

/** Map and badge colours per site status (CLAUDE.md: T1 red, T2 purple, surface activity amber, clear green). */
export const STATUS_COLOUR: Record<SiteStatus, string> = {
  priority: "#DC2626",
  watch: "#A855F7",
  surface_activity: "#F59E0B",
  no_large_events: "#22C55E",
};

/** Lighter tints for text on the dark background (WCAG AA). */
export const STATUS_TEXT: Record<SiteStatus, string> = {
  priority: "#FCA5A5",
  watch: "#D8B4FE",
  surface_activity: "#FCD34D",
  no_large_events: "#86EFAC",
};
