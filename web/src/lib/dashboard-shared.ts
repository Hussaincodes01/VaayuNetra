// Types and constants shared by the dashboard's server loaders and client components.

import type { PlumeGeoJSON, SiteStatus, Tier } from "./landing-types";

export type Role = "viewer" | "officer" | "admin";
export type ActionStatus =
  | "new"
  | "verification_requested"
  | "confirmed"
  | "not_methane"
  | "mitigation_planned"
  | "in_progress"
  | "resolved";

export const ACTION_FLOW: Record<ActionStatus, ActionStatus[]> = {
  new: ["verification_requested"],
  verification_requested: ["confirmed", "not_methane"],
  confirmed: ["mitigation_planned"],
  not_methane: [],
  mitigation_planned: ["in_progress"],
  in_progress: ["resolved"],
  resolved: [],
};
export const CLOSED: ActionStatus[] = ["resolved", "not_methane"];
export const WORKER_ONLINE_MS = 3 * 60 * 1000;

export type Viewer = {
  id: string;
  email: string;
  name: string | null;
  role: Role;
  lang: "en" | "hi";
};

export type SiteRow = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
  status: SiteStatus;
  passes: number;
  flags: number;
  t1: number;
  t2: number;
  t3: number;
  controlPasses: number;
  controlFlags: number;
  pVsControl: number | null;
  minMeanKgph: number | null;
  tco2e100Yr: number | null;
  tco2e20Yr: number | null;
  persistentUpperTph: number | null;
  detectRates: {
    rates_kgph?: number[];
    pod?: number[];
    pod_confirmed?: number[];
  } | null;
  lastPassDate: string | null;
  modelVersion: string;
};

export type EvidenceRow = {
  rgb: string;
  mbmp: string;
  mask: string;
  panel: string | null;
  plume: PlumeGeoJSON | null;
  chipBounds: [number, number][];
};

export type ScanRow = {
  id: string;
  siteId: string;
  passDate: string;
  overpassUtc: string | null;
  satellite: string | null;
  sceneScore: number;
  detected: boolean;
  tier: Tier | "none";
  surfaceKind: string | null;
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
  elong: number | null;
  axisVsWind: number | null;
  srcDistM: number | null;
  thresholdUsed: number;
  modelVersion: string;
  evidence: EvidenceRow | null;
};

export type ActionRow = {
  id: string;
  siteId: string;
  scanId: string | null;
  status: ActionStatus;
  assignee: string | null;
  dueDate: string | null;
  note: string | null;
  attachmentUrl: string | null;
  createdBy: string | null;
  createdAt: string;
};

export type JobRow = {
  id: string;
  kind: "scan_site" | "monitor_all" | "rebuild_dossier";
  siteId: string | null;
  status: "queued" | "running" | "done" | "failed";
  log: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type Assignee = { userId: string; name: string; role: Role };
export type Heartbeat = {
  workerId: string;
  lastSeen: string;
  online: boolean;
  device: string | null;
} | null;

export type FeedItem =
  | {
      kind: "flag";
      at: string;
      slug: string;
      site: string;
      tier: Tier;
      scanDate: string;
    }
  | {
      kind: "action";
      at: string;
      slug: string;
      site: string;
      status: ActionStatus;
      change: "insert" | "update";
    }
  | {
      kind: "job";
      at: string;
      slug: string | null;
      site: string | null;
      jobKind: JobRow["kind"];
      status: JobRow["status"];
    };

export type OpenEvent = {
  scan: ScanRow;
  site: SiteRow;
  action: ActionRow | null;
};
