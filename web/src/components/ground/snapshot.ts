import { S, type Role } from "@/lib/ground/sim";

/** What the views draw: one frame of the simulated site. */
export type Snapshot = {
  simMs: number;
  states: Float64Array[];
  packets: {
    src: number;
    type: number;
    relay: boolean;
    heard: number[];
    born: number;
  }[];
  plume: { x: number; y: number; ex: number }[];
  plumeCell: number;
  leak: { x: number; y: number };
  wind: { from: number; ms: number };
};

/** Packet types: data, alarm, ACK, command, time beacon. */
export const PACKET_COLOUR: Record<number, string> = {
  1: "#1E7B45",
  2: "#DC2626",
  3: "#7E22CE",
  4: "#B45309",
  5: "#4A86CF",
};

export function statusColour(s: Float64Array, role: Role): string {
  if (!s[S.alive] || !s[S.on] || s[S.brownout]) return "#94A3B8";
  if (s[S.ev] >= 2) return "#7F1D1D";
  if (s[S.ev] >= 1) return "#DC2626";
  return role === "gateway" ? "#0E3B2A" : "#1E7B45";
}
