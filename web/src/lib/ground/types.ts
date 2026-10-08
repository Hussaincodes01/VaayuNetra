// Shapes of the JSON in public/ground/data, written by Vayu-server/tools/export_web.py.

import type { Role } from "./sim";

export type LabNode = {
  id: string;
  role: Role;
  lat: number;
  lon: number;
  x: number;
  y: number;
  radio_id: string;
  has_wind: boolean;
  has_pms: boolean;
};

export type PlanLink = {
  a: string;
  b: string;
  distance_m: number;
  margin_db: number;
  quality: "good" | "fair" | "poor";
};

export type SiteBundle = {
  site: {
    slug: string;
    name: string;
    city: string;
    point: [number, number];
    outline: { type: "Polygon"; coordinates: [number, number][][] };
    outline_source: { area_m2: number; name: string };
    sensitive_sites: {
      name: string;
      kind: string;
      lat: number;
      lon: number;
      distance_m: number;
    }[];
    wind: {
      prevailing_from_deg: number;
      calm_share: number;
      mean_ms: number;
      source: string;
    };
    satellite_flags: {
      date: string;
      tier: string;
      lat: number;
      lon: number;
      rate_kgph?: number;
    }[];
  };
  plan: {
    center: [number, number];
    gateway: { lat: number; lon: number; assumed: boolean };
    links: PlanLink[];
    hops: Record<string, number | null>;
    spacing_m: number;
    notes: string[];
  };
  lab: {
    nodes: LabNode[];
    outline_xy: [number, number][];
    hotspots: {
      x: number;
      y: number;
      tier: string;
      label: string;
      lat: number;
      lon: number;
    }[];
    utc_offset_h: number;
    local_midnight_unix: number;
    detection: { rise_ppm: number; lel_ppm: number };
  };
};

export type SiteIndex = {
  slug: string;
  name: string;
  city: string;
  point: [number, number];
  area_m2: number;
}[];

export type ReplayEvent = {
  kind: string;
  node_id: string | null;
  status: string;
  opened_minute: number;
  closed_minute: number | null;
  peak: number | null;
  nodes: string[];
  wind_check: string | null;
  source_lat: number | null;
  source_lon: number | null;
  source_radius_m: number | null;
};

export type ReplayResult = {
  lines: number;
  accepted: number;
  skipped: number;
  status_lines: number;
  unknown_radios: string[];
  events: ReplayEvent[];
  sms: { to: string; role: string; language: string; text: string }[];
  timeline: { minute: number; t: number; text: string; sms?: boolean }[];
};

export type Score = {
  n: number;
  vector_rmse: number;
  speed_mae: number;
  n_dir: number;
  dir_mae_deg: number;
  within_45: number;
  band_cover?: number;
};

export type WindLead = {
  h: number;
  t: number;
  u: number;
  v: number;
  ms: number;
  from: number;
  spread: number | null;
  u_band: [number, number] | null;
  v_band: [number, number] | null;
  calm: boolean;
};
export type WindObs = {
  t: number;
  u: number;
  v: number;
  ms: number;
  from: number;
};

export type WindBacktest = {
  made: string;
  model: { name: string; context_h: number };
  truth: string;
  test_period: [string, string];
  every_h: number;
  horizon_h: number;
  models: string[];
  pooled_cells: string[];
  pooled_by_lead: ({ lead_h: number } & Record<string, Score | number>)[];
  pooled_turning: Record<string, Score>;
  sites: Record<
    string,
    {
      name: string;
      city: string;
      grid: [number, number];
      same_cell_as: string | null;
      origins: number;
      by_lead: ({ lead_h: number } & Record<string, Score | number>)[];
      examples: {
        issued: number;
        history: WindObs[];
        truth: WindObs[];
        model: WindLead[];
        persistence: WindLead[];
      }[];
    }
  >;
};

export type WindLive = {
  fetched: string;
  sites: Record<
    string,
    {
      name: string;
      city: string;
      issued: number;
      model: string;
      note: string;
      forecast: WindLead[];
      weather_service: WindObs[];
    }
  >;
};

export type SatPass = {
  kind: "landfill" | "control";
  date: string;
  scene_score: number;
  detected: boolean;
  detected_india: boolean;
  tier: string;
  plume_px: number;
  u: number | null;
  v: number | null;
  q_med?: number | null;
  q_lo?: number | null;
  q_hi?: number | null;
  spectral_ok: boolean;
  aligned: boolean;
  surface_kind: string;
  figure?: string;
  window: [string, string];
};

export type SatScan = {
  model: {
    version: string;
    threshold: number;
    threshold_india: number;
    device: string;
  };
  windows: [string, string][];
  summary: {
    landfill_passes: number;
    control_passes: number;
    landfill_detected: number;
    control_detected: number;
    tiers: Record<string, number>;
    control_detected_india: number;
  };
  passes: SatPass[];
  recorded: {
    date: string;
    tier: string;
    rate_kgph: number;
    rate_low_kgph: number;
    rate_high_kgph: number;
    wind_u: number;
    wind_v: number;
  }[];
};

export type HardwareData = {
  recorded: {
    mesh: Record<string, string | number>[];
    mesh_alarm_retry: Record<string, string | number>[];
    energy: Record<string, string | number>[];
    energy_stress: Record<string, string | number>[];
    thermal: Record<string, string | number>[];
    spice: Record<string, unknown>;
    wiring: Record<string, string>[];
  };
  pins: { signal: string; pad: string; pin: string; to: string }[];
  findings: { kind: "ok" | "fixed" | "note"; key: string }[];
  firmware: {
    checks: number;
    node_flash_kb: number;
    gateway_flash_kb: number;
    ram_kb: number;
    wasm_kb: number;
  };
};

export async function getJson<T>(path: string): Promise<T> {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
  return (await r.json()) as T;
}
