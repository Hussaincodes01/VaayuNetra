"use client";

import { useEffect, useRef } from "react";
import { S } from "@/lib/ground/sim";
import type { SiteBundle } from "@/lib/ground/types";
import { PACKET_COLOUR, statusColour, type Snapshot } from "./snapshot";

const W = 900;
const H = 640;

function ramp(f: number): string {
  const a = [253, 230, 138];
  const b = [245, 158, 11];
  const c = [220, 38, 38];
  const [u, v, g] = f < 0.5 ? [a, b, f * 2] : [b, c, (f - 0.5) * 2];
  return u.map((x, i) => Math.round(x + (v[i] - x) * g)).join(",");
}

/**
 * The site seen from above, drawn on a canvas: fence line, methane above background, packets,
 * nodes with their battery bars, the leak and the wind. Works without a map token or WebGL.
 */
export function PlanView({
  bundle,
  snap,
  selected,
  onSelect,
  onPick,
  label,
}: {
  bundle: SiteBundle;
  snap: Snapshot | null;
  selected: number;
  onSelect: (i: number) => void;
  onPick: (x: number, y: number) => void;
  label: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const view = useRef({ cx: 0, cy: 0, scale: 0.5 });

  useEffect(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const [x, y] of bundle.lab.outline_xy) {
      xs.push(x);
      ys.push(y);
    }
    for (const n of bundle.lab.nodes) {
      if (n.role === "background") continue; // 2.5 km away: it would shrink the site to a dot
      xs.push(n.x);
      ys.push(n.y);
    }
    const minx = Math.min(...xs);
    const maxx = Math.max(...xs);
    const miny = Math.min(...ys);
    const maxy = Math.max(...ys);
    view.current = {
      cx: (minx + maxx) / 2,
      cy: (miny + maxy) / 2,
      scale: Math.min(
        W / ((maxx - minx) * 1.3 || 1),
        H / ((maxy - miny) * 1.3 || 1),
      ),
    };
  }, [bundle]);

  const toPx = (x: number, y: number) => {
    const v = view.current;
    return [W / 2 + (x - v.cx) * v.scale, H / 2 - (y - v.cy) * v.scale];
  };

  useEffect(() => {
    const ctx = ref.current?.getContext("2d");
    if (!ctx || !snap) return;
    ctx.fillStyle = "#F6F8F3";
    ctx.fillRect(0, 0, W, H);
    const half = snap.plumeCell / 2;
    for (const c of snap.plume) {
      const f = Math.min(1, Math.log10(Math.max(1, c.ex)) / Math.log10(200));
      const [x0, y0] = toPx(c.x - half, c.y + half);
      const [x1, y1] = toPx(c.x + half, c.y - half);
      ctx.fillStyle = `rgba(${ramp(f)},${(0.25 + 0.5 * f).toFixed(2)})`;
      ctx.fillRect(x0, y0, x1 - x0 + 1, y1 - y0 + 1);
    }
    ctx.beginPath();
    bundle.lab.outline_xy.forEach(([x, y], i) => {
      const [px, py] = toPx(x, y);
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    });
    ctx.closePath();
    ctx.strokeStyle = "#0E3B2A";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    const nodes = bundle.lab.nodes;
    const now = performance.now();
    for (const p of snap.packets) {
      const age = Math.min(1, (now - p.born) / 900);
      const s = snap.states[p.src];
      if (!s) continue;
      const [fx, fy] = toPx(s[S.x], s[S.y]);
      ctx.strokeStyle = PACKET_COLOUR[p.type] ?? "#64748B";
      ctx.globalAlpha = (1 - age) * (p.relay ? 0.35 : 0.75);
      ctx.lineWidth = p.relay ? 1 : 2.5;
      for (const j of p.heard) {
        const t = snap.states[j];
        if (!t) continue;
        const [tx, ty] = toPx(t[S.x], t[S.y]);
        ctx.beginPath();
        ctx.moveTo(fx, fy);
        ctx.lineTo(tx, ty);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    const [lx, ly] = toPx(snap.leak.x, snap.leak.y);
    ctx.strokeStyle = "#DC2626";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(lx - 7, ly - 7);
    ctx.lineTo(lx + 7, ly + 7);
    ctx.moveTo(lx + 7, ly - 7);
    ctx.lineTo(lx - 7, ly + 7);
    ctx.stroke();
    nodes.forEach((n, i) => {
      const s = snap.states[i];
      if (!s) return;
      const [px, py] = toPx(s[S.x], s[S.y]);
      const r = n.role === "gateway" ? 9 : 8;
      ctx.fillStyle = statusColour(s, n.role);
      ctx.beginPath();
      if (n.role === "gateway") ctx.rect(px - r, py - r, 2 * r, 2 * r);
      else ctx.arc(px, py, r, 0, 2 * Math.PI);
      ctx.fill();
      if (i === selected) {
        ctx.strokeStyle = "#0E3B2A";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(px, py, r + 5, 0, 2 * Math.PI);
        ctx.stroke();
      }
      if (n.role !== "gateway") {
        const soc = Math.max(0, Math.min(1, s[S.soc]));
        ctx.fillStyle = "#CBD5CF";
        ctx.fillRect(px - 10, py + r + 3, 20, 4);
        ctx.fillStyle =
          soc < 0.2 ? "#DC2626" : soc < 0.4 ? "#F59E0B" : "#1E7B45";
        ctx.fillRect(px - 10, py + r + 3, 20 * soc, 4);
      }
      ctx.fillStyle = "#15301F";
      ctx.font = "12px Inter, system-ui, sans-serif";
      ctx.fillText(n.id, px + r + 4, py - 4);
    });
    const a = ((snap.wind.from + 180) * Math.PI) / 180;
    const cx = W - 54;
    const cy = 54;
    ctx.strokeStyle = "#0E3B2A";
    ctx.fillStyle = "#0E3B2A";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(cx - Math.sin(a) * 30, cy + Math.cos(a) * 30);
    ctx.lineTo(cx + Math.sin(a) * 30, cy - Math.cos(a) * 30);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx + Math.sin(a) * 30, cy - Math.cos(a) * 30, 5, 0, 2 * Math.PI);
    ctx.fill();
    ctx.font = "12px Inter, system-ui, sans-serif";
    ctx.fillText(
      `${Math.round(snap.wind.from)}° · ${snap.wind.ms.toFixed(1)} m/s`,
      W - 120,
      104,
    );
    const v = view.current;
    let bar = 200 * v.scale;
    let txt = "200 m";
    if (bar > 160) [bar, txt] = [100 * v.scale, "100 m"];
    else if (bar < 40) [bar, txt] = [1000 * v.scale, "1 km"];
    ctx.fillRect(16, H - 20, bar, 3);
    ctx.fillText(txt, 16, H - 26);
  });

  const click = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const py = ((e.clientY - r.top) / r.height) * H;
    let best = -1;
    let bd = 16;
    bundle.lab.nodes.forEach((n, i) => {
      const [x, y] = toPx(n.x, n.y);
      const d = Math.hypot(x - px, y - py);
      if (d < bd) [bd, best] = [d, i];
    });
    if (best >= 0) return onSelect(best);
    const v = view.current;
    onPick((px - W / 2) / v.scale + v.cx, -(py - H / 2) / v.scale + v.cy);
  };

  return (
    <canvas
      ref={ref}
      width={W}
      height={H}
      onClick={click}
      aria-label={label}
      className="block h-auto w-full cursor-crosshair rounded-lg border border-border"
    />
  );
}
