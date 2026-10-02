// Shapes shared by the landing-page data loader (server) and the sections (client).

import type { Assumptions } from "@/content/facts";

export type Tier = "T1" | "T2" | "T3";
export type SiteStatus =
  "priority" | "watch" | "surface_activity" | "no_large_events";

export type Site = {
  slug: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  control: { lat: number; lon: number } | null;
};

export type SiteStat = {
  slug: string;
  passes: number;
  flags: number;
  t1: number;
  t2: number;
  t3: number;
  burnLike: number;
  controlPasses: number;
  controlFlags: number;
  pVsControl: number | null;
  minMeanKgph: number | null;
  tco2e100Yr: number | null;
  persistentUpperTph: number | null;
  status: SiteStatus;
  lastPassDate: string | null;
};

export type PlumeGeoJSON = {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    geometry: { type: "Polygon"; coordinates: number[][][] };
    properties: Record<string, unknown>;
  }[];
};

export type Evidence = {
  rgb: string;
  mbmp: string;
  mask: string;
  /** [lon, lat] of the chip's top-left, top-right, bottom-right, bottom-left corners. */
  chipBounds: [number, number][];
  plume: PlumeGeoJSON | null;
};

export type Flag = {
  slug: string;
  date: string;
  tier: Tier;
  surfaceKind: string | null;
  sceneScore: number;
  qKgph: number | null;
  qMed: number | null;
  qLo: number | null;
  qHi: number | null;
  u10: number | null;
  windU: number | null;
  windV: number | null;
  dB12: number | null;
  dB11: number | null;
  dVisNir: number | null;
  evidence: Evidence | null;
};

export type LandingData = {
  source: "supabase" | "seed";
  modelVersion: string;
  scenes: {
    total: number;
    landfill: number;
    control: number;
    controlFlags: number;
    lastPassDate: string;
  };
  sites: Site[];
  stats: SiteStat[];
  flags: Flag[];
  worker: { online: boolean; lastSeen: string } | null;
  /** When the newest scan row was written to Supabase; null for the bundled seed copy. */
  lastUpdated: string | null;
  assumptions: Assumptions;
  dossierPdfUrl: string;
};
