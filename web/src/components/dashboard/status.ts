import type { SiteStatus } from "@/lib/landing-types";

/** Map and badge colours per site status (CLAUDE.md: T1 red, T2 purple, surface activity amber, clear green). */
export const STATUS_COLOUR: Record<SiteStatus, string> = {
  priority: "#DC2626",
  watch: "#A855F7",
  surface_activity: "#F59E0B",
  no_large_events: "#22C55E",
};

/** Darker shades for text on white and the page ground (WCAG AA). */
export const STATUS_TEXT: Record<SiteStatus, string> = {
  priority: "#B91C1C",
  watch: "#7E22CE",
  surface_activity: "#B45309",
  no_large_events: "#15803D",
};
