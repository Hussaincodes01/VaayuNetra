"use client";

import { useState } from "react";

export type Series = {
  name: string;
  values: (number | null)[];
  color: string;
  width?: number;
  dash?: string;
};

const W = 720;
const L = 56;
const R = 16;
const T = 34;
const B = 34;

function niceTicks(lo: number, hi: number, n: number): number[] {
  if (!(hi > lo)) hi = lo + 1;
  const span = hi - lo;
  let step = 10 ** Math.floor(Math.log10(span / n));
  const err = (n / span) * step;
  if (err <= 0.15) step *= 10;
  else if (err <= 0.35) step *= 5;
  else if (err <= 0.75) step *= 2;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step)
    out.push(+v.toFixed(10));
  return out;
}

export function fmtNum(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "–";
  const a = Math.abs(v);
  return a >= 100
    ? v.toFixed(0)
    : a >= 10
      ? v.toFixed(1)
      : a >= 1
        ? v.toFixed(2)
        : v.toFixed(3);
}

/**
 * Lines over a shared x axis, with an optional shaded band, a dashed threshold and a vertical
 * marker. Hovering shows every series at the nearest x. Light ground, faint canopy gridlines.
 */
export function LineChart({
  x,
  series,
  label,
  yLabel,
  xLabel,
  xFormat = (v) => fmtNum(v),
  xTicks,
  yMin,
  yMax,
  height = 240,
  band,
  threshold,
  marker,
}: {
  x: number[];
  series: Series[];
  label: string;
  yLabel?: string;
  xLabel?: string;
  xFormat?: (v: number) => string;
  xTicks?: number[];
  yMin?: number;
  yMax?: number;
  height?: number;
  band?: { lo: number[]; hi: number[]; color?: string };
  threshold?: { value: number; label?: string };
  marker?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const H = height;
  const pw = W - L - R;
  const ph = H - T - B;
  const all: number[] = [];
  series.forEach((s) =>
    s.values.forEach((v) => v !== null && Number.isFinite(v) && all.push(v)),
  );
  if (band) all.push(...band.lo, ...band.hi);
  if (threshold) all.push(threshold.value);
  let lo = yMin ?? Math.min(0, ...all);
  let hi = yMax ?? Math.max(lo + 1e-6, ...all);
  const yt = niceTicks(lo, hi, 5);
  lo = Math.min(lo, yt[0]);
  hi = Math.max(hi, yt[yt.length - 1]);
  const x0 = x[0] ?? 0;
  const x1 = x[x.length - 1] ?? 1;
  const sx = (v: number) => L + ((v - x0) / (x1 - x0 || 1)) * pw;
  const sy = (v: number) => T + ph - ((v - lo) / (hi - lo || 1)) * ph;
  const ticks = xTicks ?? niceTicks(x0, x1, 6);

  const path = (vals: (number | null)[]) => {
    let d = "";
    let pen = false;
    vals.forEach((v, k) => {
      if (v === null || !Number.isFinite(v)) {
        pen = false;
        return;
      }
      d += `${pen ? "L" : "M"}${sx(x[k]).toFixed(1)},${sy(v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    if (px < L || px > W - R) return setHover(null);
    let best = 0;
    let bd = Infinity;
    x.forEach((v, k) => {
      const d = Math.abs(sx(v) - px);
      if (d < bd) {
        bd = d;
        best = k;
      }
    });
    setHover(best);
  };

  let lx = L + 4;
  return (
    <figure className="relative m-0">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={label}
        className="block h-auto w-full"
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
      >
        {yt.map((v) => (
          <g key={v}>
            <line
              x1={L}
              x2={W - R}
              y1={sy(v)}
              y2={sy(v)}
              stroke="#0E3B2A"
              strokeOpacity={0.1}
            />
            <text
              x={L - 6}
              y={sy(v) + 4}
              textAnchor="end"
              className="fill-muted-foreground font-mono text-[11px]"
            >
              {fmtNum(v)}
            </text>
          </g>
        ))}
        {ticks.map((v) => (
          <text
            key={v}
            x={sx(v)}
            y={H - B + 16}
            textAnchor="middle"
            className="fill-muted-foreground font-mono text-[11px]"
          >
            {xFormat(v)}
          </text>
        ))}
        {yLabel && (
          <text x={4} y={12} className="fill-muted-foreground text-[12px]">
            {yLabel}
          </text>
        )}
        {xLabel && (
          <text
            x={W - R}
            y={H - 4}
            textAnchor="end"
            className="fill-muted-foreground text-[12px]"
          >
            {xLabel}
          </text>
        )}
        {band && (
          <polygon
            points={[
              ...x.map((v, i) => `${sx(v)},${sy(band.hi[i])}`),
              ...x.map((v, i) => `${sx(v)},${sy(band.lo[i])}`).reverse(),
            ].join(" ")}
            fill={band.color ?? "#CDEFC0"}
            opacity={0.8}
          />
        )}
        {threshold && (
          <g>
            <line
              x1={L}
              x2={W - R}
              y1={sy(threshold.value)}
              y2={sy(threshold.value)}
              stroke="#B91C1C"
              strokeDasharray="5 4"
            />
            {threshold.label && (
              <text
                x={W - R - 4}
                y={sy(threshold.value) - 5}
                textAnchor="end"
                className="fill-[#B91C1C] font-mono text-[11px]"
              >
                {threshold.label}
              </text>
            )}
          </g>
        )}
        {marker !== undefined && (
          <line
            x1={sx(marker)}
            x2={sx(marker)}
            y1={T}
            y2={T + ph}
            stroke="#4A6355"
            strokeDasharray="2 3"
          />
        )}
        {series.map((s) => (
          <path
            key={s.name}
            d={path(s.values)}
            fill="none"
            stroke={s.color}
            strokeWidth={s.width ?? 2}
            strokeDasharray={s.dash}
          />
        ))}
        {series.map((s) => {
          if (lx > W - 60) return null;
          const at = lx;
          lx += 24 + s.name.length * 6.4;
          return (
            <g key={`lg-${s.name}`}>
              <rect x={at} y={16} width={12} height={4} fill={s.color} />
              <text
                x={at + 16}
                y={22}
                className="fill-muted-foreground text-[12px]"
              >
                {s.name}
              </text>
            </g>
          );
        })}
        {hover !== null && (
          <line
            x1={sx(x[hover])}
            x2={sx(x[hover])}
            y1={T}
            y2={T + ph}
            stroke="#0E3B2A"
            strokeOpacity={0.35}
          />
        )}
      </svg>
      {hover !== null && (
        <figcaption
          className="pointer-events-none absolute top-8 rounded-lg border border-border bg-card px-2 py-1 font-mono text-xs shadow-sm"
          style={{
            left: `min(calc(100% - 11rem), ${(sx(x[hover]) / W) * 100}% + 8px)`,
          }}
        >
          <strong>{xFormat(x[hover])}</strong>
          {series.map((s) => (
            <span key={s.name} className="block">
              <span style={{ color: s.color }}>■</span> {s.name}{" "}
              {fmtNum(s.values[hover])}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

/** Grouped bars, one group per category. */
export function BarChart({
  categories,
  series,
  label,
  yLabel,
  height = 220,
  yMax,
}: {
  categories: string[];
  series: Series[];
  label: string;
  yLabel?: string;
  height?: number;
  yMax?: number;
}) {
  const H = height;
  const pw = W - L - R;
  const ph = H - T - B;
  const vals = series.flatMap((s) =>
    s.values.filter((v): v is number => v !== null),
  );
  const hi = yMax ?? Math.max(1e-6, ...vals);
  const yt = niceTicks(0, hi, 5);
  const top = Math.max(hi, yt[yt.length - 1]);
  const sy = (v: number) => T + ph - (v / top) * ph;
  const band = pw / categories.length;
  const bw = (band * 0.7) / series.length;
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={label}
      className="block h-auto w-full"
    >
      {yt.map((v) => (
        <g key={v}>
          <line
            x1={L}
            x2={W - R}
            y1={sy(v)}
            y2={sy(v)}
            stroke="#0E3B2A"
            strokeOpacity={0.1}
          />
          <text
            x={L - 6}
            y={sy(v) + 4}
            textAnchor="end"
            className="fill-muted-foreground font-mono text-[11px]"
          >
            {fmtNum(v)}
          </text>
        </g>
      ))}
      {yLabel && (
        <text x={4} y={12} className="fill-muted-foreground text-[12px]">
          {yLabel}
        </text>
      )}
      {categories.map((c, ci) => (
        <g key={c}>
          <text
            x={L + band * (ci + 0.5)}
            y={H - B + 16}
            textAnchor="middle"
            className="fill-muted-foreground text-[11px]"
          >
            {c}
          </text>
          {series.map((s, si) => {
            const v = s.values[ci] ?? 0;
            return (
              <rect
                key={s.name}
                x={L + band * ci + band * 0.15 + bw * si}
                y={sy(v)}
                width={bw - 2}
                height={T + ph - sy(v)}
                fill={s.color}
              >
                <title>{`${s.name}, ${c}: ${fmtNum(v)}`}</title>
              </rect>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
