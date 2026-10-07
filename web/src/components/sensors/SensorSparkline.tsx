"use client";

import { useLocale } from "next-intl";
import { useId, useState } from "react";

const W = 320;
const H = 88;
const PAD = { l: 30, r: 6, t: 8, b: 16 };

/**
 * 24 hours of one node's excess over background (ppm), with the rise level as a dashed reference and
 * a hover readout. A single series: no legend, the card around it names the node.
 */
export function SensorSparkline({
  points,
  rise,
  now,
  label,
}: {
  points: { t: number; v: number }[];
  rise: number | null;
  now: number;
  label: string;
}) {
  const locale = useLocale();
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const t0 = now - 86_400_000;
  const vals = points.map((p) => p.v);
  const hi = Math.max(rise ? rise * 1.25 : 1, ...vals, 1);
  const lo = Math.min(0, ...vals);
  const x = (t: number) =>
    PAD.l + ((t - t0) / 86_400_000) * (W - PAD.l - PAD.r);
  const y = (v: number) =>
    PAD.t + (1 - (v - lo) / (hi - lo)) * (H - PAD.t - PAD.b);
  const path = points
    .map((p, i) => `${i ? "L" : "M"}${x(p.t).toFixed(1)} ${y(p.v).toFixed(1)}`)
    .join("");
  const fmtTime = (t: number) =>
    new Intl.DateTimeFormat(locale === "hi" ? "hi-IN" : "en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(new Date(t));
  const nf = new Intl.NumberFormat(locale === "hi" ? "hi-IN" : "en-IN", {
    maximumFractionDigits: 1,
  });
  const h = hover !== null ? points[hover] : null;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    const t = t0 + ((e.clientX - box.left) / box.width) * 86_400_000;
    let best = -1;
    let gap = Infinity;
    points.forEach((p, i) => {
      const d = Math.abs(p.t - t);
      if (d < gap) {
        gap = d;
        best = i;
      }
    });
    setHover(best >= 0 && gap < 30 * 60_000 ? best : null);
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full"
        role="img"
        aria-labelledby={id}
      >
        <title id={id}>{label}</title>
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(0)}
          y2={y(0)}
          stroke="var(--color-canopy)"
          strokeOpacity="0.15"
        />
        <text
          x={PAD.l - 4}
          y={y(hi) + 4}
          textAnchor="end"
          fontSize="9"
          fill="var(--color-muted-foreground)"
        >
          {nf.format(hi)}
        </text>
        <text
          x={PAD.l - 4}
          y={y(0) + 3}
          textAnchor="end"
          fontSize="9"
          fill="var(--color-muted-foreground)"
        >
          0
        </text>
        {rise !== null && (
          <line
            x1={PAD.l}
            x2={W - PAD.r}
            y1={y(rise)}
            y2={y(rise)}
            stroke="var(--color-tier-3-ink)"
            strokeDasharray="4 3"
            strokeWidth="1"
          />
        )}
        <text
          x={PAD.l}
          y={H - 3}
          fontSize="9"
          fill="var(--color-muted-foreground)"
        >
          −24 h
        </text>
        <text
          x={W - PAD.r}
          y={H - 3}
          textAnchor="end"
          fontSize="9"
          fill="var(--color-muted-foreground)"
        >
          {fmtTime(now)}
        </text>
        <path
          d={path}
          fill="none"
          stroke="var(--color-leaf)"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {h && (
          <>
            <line
              x1={x(h.t)}
              x2={x(h.t)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="var(--color-canopy)"
              strokeOpacity="0.35"
            />
            <circle
              cx={x(h.t)}
              cy={y(h.v)}
              r="4"
              fill="var(--color-leaf)"
              stroke="white"
              strokeWidth="2"
            />
          </>
        )}
        <rect
          x={PAD.l}
          y={0}
          width={W - PAD.l - PAD.r}
          height={H}
          fill="transparent"
          onPointerMove={onMove}
          onPointerLeave={() => setHover(null)}
        />
      </svg>
      {h && (
        <div className="pointer-events-none absolute top-0 right-0 rounded-md border border-border bg-card px-2 py-1 text-xs shadow-sm">
          <span className="font-mono">{fmtTime(h.t)}</span> ·{" "}
          <span className="font-mono">{nf.format(h.v)} ppm</span>
        </div>
      )}
    </div>
  );
}
