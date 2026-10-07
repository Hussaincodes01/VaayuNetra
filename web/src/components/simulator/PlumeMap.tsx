"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef } from "react";
import { plumeGrid, type NodeSim, type Sim } from "@/lib/sensor-sim";

/** Half-width of the map in metres: the perimeter (300 m) and community (900 m) nodes fit. */
export const HALF_M = 1500;
const GRID = 96;
// Methane ramp (plumes only): #FDE68A -> #F59E0B -> #DC2626.
const RAMP = [
  [253, 230, 138],
  [245, 158, 11],
  [220, 38, 38],
];
const LO_PPM = 0.5;
const HI_PPM = 200;

function ramp(ppm: number): [number, number, number, number] | null {
  if (ppm < LO_PPM) return null;
  const f = Math.min(1, Math.log(ppm / LO_PPM) / Math.log(HI_PPM / LO_PPM));
  const seg = f < 0.5 ? 0 : 1;
  const u = f < 0.5 ? f / 0.5 : (f - 0.5) / 0.5;
  const a = RAMP[seg];
  const b = RAMP[seg + 1];
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u,
    Math.round(255 * (0.22 + 0.63 * f)),
  ];
}

export type NodeStatus = "clear" | "warning" | "rise";
export const statusOf = (n: NodeSim): NodeStatus =>
  n.riseAt !== null ? "rise" : n.warnAt !== null ? "warning" : "clear";

const pctX = (x: number) => ((x + HALF_M) / (2 * HALF_M)) * 100;
const pctY = (y: number) => ((HALF_M - y) / (2 * HALF_M)) * 100;
const clamp = (v: number) => Math.max(-HALF_M + 60, Math.min(HALF_M - 60, v));

/**
 * The landfill from above: the simulated ground-level plume (canvas), range rings, and the sensor
 * nodes as buttons. Drag a node, or select it and move it with the arrow keys (Shift for 200 m).
 */
export function PlumeMap({
  sim,
  version,
  selected,
  onSelect,
  onMove,
  nodeLabel,
  windLabel,
}: {
  sim: Sim;
  version: number;
  selected: string;
  onSelect: (code: string) => void;
  onMove: (code: string, x: number, y: number) => void;
  nodeLabel: (n: NodeSim) => string;
  windLabel: string;
}) {
  const t = useTranslations("Simulator.map");
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<string | null>(null);
  const frame = useRef(0);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const grid = plumeGrid(sim, GRID, HALF_M);
    const small = document.createElement("canvas");
    small.width = GRID;
    small.height = GRID;
    const sctx = small.getContext("2d");
    if (!sctx) return;
    const img = sctx.createImageData(GRID, GRID);
    for (let i = 0; i < grid.length; i++) {
      const col = ramp(grid[i]);
      if (!col) continue;
      img.data.set(col, i * 4);
    }
    sctx.putImageData(img, 0, 0);
    const size = c.clientWidth * (window.devicePixelRatio || 1);
    if (c.width !== size) {
      c.width = size;
      c.height = size;
    }
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(small, 0, 0, size, size);
  }, [sim, version]);

  const toMetres = (clientX: number, clientY: number) => {
    const r = box.current!.getBoundingClientRect();
    return {
      x: clamp(((clientX - r.left) / r.width) * 2 * HALF_M - HALF_M),
      y: clamp(HALF_M - ((clientY - r.top) / r.height) * 2 * HALF_M),
    };
  };

  const w = sim.weather[sim.weather.length - 1];
  const toDeg = (w.windFromDeg + 180) % 360;
  const bg = sim.nodes.find((n) => n.role === "background");
  // The background node is 3 km out: pin it to the map edge in its direction.
  const bgEdge = bg
    ? (() => {
        const d = Math.hypot(bg.x, bg.y) || 1;
        const k =
          (HALF_M - 40) / Math.max(Math.abs(bg.x / d), Math.abs(bg.y / d)) / d;
        return { x: bg.x * k, y: bg.y * k };
      })()
    : null;

  return (
    <figure className="space-y-2">
      <div
        ref={box}
        className="relative aspect-square w-full touch-none overflow-hidden rounded-xl border border-border bg-[#EEF5EF] select-none"
        role="group"
        aria-label={t("label")}
      >
        <canvas
          ref={canvas}
          className="absolute inset-0 h-full w-full"
          aria-hidden
        />
        <svg
          viewBox={`${-HALF_M} ${-HALF_M} ${2 * HALF_M} ${2 * HALF_M}`}
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden
        >
          {[500, 1000].map((r) => (
            <circle
              key={r}
              r={r}
              fill="none"
              stroke="#0E3B2A"
              strokeOpacity="0.14"
              strokeDasharray="12 14"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <circle
            r={250}
            fill="#E7DFC8"
            fillOpacity="0.85"
            stroke="#A8976F"
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
          <g transform={`translate(${-HALF_M + 90} ${HALF_M - 90})`}>
            <line
              x1="0"
              x2="500"
              y1="0"
              y2="0"
              stroke="#0E3B2A"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1="0"
              x2="0"
              y1="-30"
              y2="30"
              stroke="#0E3B2A"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
            <line
              x1="500"
              x2="500"
              y1="-30"
              y2="30"
              stroke="#0E3B2A"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        </svg>

        <span className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-xs font-medium text-[#6B5A35]">
          {t("landfill")}
        </span>
        <span className="pointer-events-none absolute bottom-[4%] left-[3%] font-mono text-[11px] text-canopy">
          {t("scale")}
        </span>
        <span
          className="pointer-events-none absolute top-3 right-3 flex flex-col items-center font-mono text-[11px] text-canopy"
          aria-hidden
        >
          <svg width="14" height="18" viewBox="0 0 14 18">
            <path d="M7 1 L13 17 L7 13 L1 17 Z" fill="#0E3B2A" />
          </svg>
          N
        </span>
        <span className="pointer-events-none absolute top-3 left-3 flex items-center gap-2 rounded-lg bg-card/90 px-2.5 py-1.5 text-xs text-foreground shadow-sm">
          <svg
            width="22"
            height="22"
            viewBox="-11 -11 22 22"
            style={{ transform: `rotate(${toDeg}deg)` }}
            aria-hidden
          >
            <path
              d="M0 -9 L5 -2 L1.5 -2 L1.5 9 L-1.5 9 L-1.5 -2 L-5 -2 Z"
              fill="#1F4A5C"
            />
          </svg>
          {windLabel}
        </span>

        {bg && bgEdge && (
          <span
            className="pointer-events-none absolute rounded-full border border-border bg-card px-2 py-0.5 text-[11px] whitespace-nowrap text-muted-foreground shadow-sm"
            style={{
              left: `${pctX(bgEdge.x)}%`,
              top: `${pctY(bgEdge.y)}%`,
              // Keep the label inside the map: anchor it on the side it sits.
              transform: `translate(${bgEdge.x < -HALF_M / 2 ? "0%" : bgEdge.x > HALF_M / 2 ? "-100%" : "-50%"}, ${bgEdge.y > HALF_M / 2 ? "0%" : bgEdge.y < -HALF_M / 2 ? "-100%" : "-50%"})`,
            }}
          >
            {t("background", { code: bg.code })}
          </span>
        )}

        {sim.nodes
          .filter((n) => n.role !== "background")
          .map((n) => {
            const s = statusOf(n);
            const isSel = n.code === selected;
            return (
              <button
                key={n.code}
                type="button"
                aria-label={nodeLabel(n)}
                aria-pressed={isSel}
                className="group absolute flex size-11 -translate-x-1/2 -translate-y-1/2 cursor-grab items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-leaf active:cursor-grabbing"
                style={{ left: `${pctX(n.x)}%`, top: `${pctY(n.y)}%` }}
                onClick={() => onSelect(n.code)}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  drag.current = n.code;
                  onSelect(n.code);
                }}
                onPointerMove={(e) => {
                  if (drag.current !== n.code) return;
                  const { clientX, clientY } = e;
                  cancelAnimationFrame(frame.current);
                  frame.current = requestAnimationFrame(() => {
                    const m = toMetres(clientX, clientY);
                    onMove(n.code, m.x, m.y);
                  });
                }}
                onPointerUp={() => {
                  drag.current = null;
                }}
                onKeyDown={(e) => {
                  const d = e.shiftKey ? 200 : 50;
                  const moves: Record<string, [number, number]> = {
                    ArrowLeft: [-d, 0],
                    ArrowRight: [d, 0],
                    ArrowUp: [0, d],
                    ArrowDown: [0, -d],
                  };
                  const m = moves[e.key];
                  if (!m) return;
                  e.preventDefault();
                  onSelect(n.code);
                  onMove(n.code, clamp(n.x + m[0]), clamp(n.y + m[1]));
                }}
              >
                {s !== "clear" && (
                  <span
                    className={`absolute inset-1.5 rounded-full motion-safe:animate-ping ${s === "rise" ? "bg-[#DC2626]/40" : "bg-[#F59E0B]/45"}`}
                    aria-hidden
                  />
                )}
                <span
                  className={`relative size-5 rounded-full border-2 border-white shadow ${
                    s === "rise"
                      ? "bg-[#DC2626]"
                      : s === "warning"
                        ? "bg-[#F59E0B]"
                        : "bg-leaf"
                  } ${isSel ? "ring-2 ring-canopy ring-offset-1" : ""}`}
                  aria-hidden
                />
                <span
                  className="absolute top-full -mt-1 rounded bg-card/90 px-1 font-mono text-[11px] font-medium text-canopy"
                  aria-hidden
                >
                  {n.code}
                </span>
              </button>
            );
          })}
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-2">
          {t("legend")}
          <span
            className="inline-block h-2.5 w-24 rounded-full"
            style={{
              background:
                "linear-gradient(90deg, rgba(253,230,138,0.4), #F59E0B, #DC2626)",
            }}
            aria-hidden
          />
          <span className="font-mono">{t("legendRange")}</span>
        </span>
        <span>{t("dragHint")}</span>
      </figcaption>
    </figure>
  );
}
