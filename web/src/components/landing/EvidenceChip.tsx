"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import type { Flag } from "@/lib/landing-types";
import { TIER_COLOUR, useFormat } from "./format";

type LonLat = [number, number];

/** Chip coordinates (0..1, origin top-left) of a lon/lat point, from the chip's four corners. */
function toChip(p: LonLat, [tl, tr, , bl]: LonLat[]): [number, number] {
  const e1 = [tr[0] - tl[0], tr[1] - tl[1]];
  const e2 = [bl[0] - tl[0], bl[1] - tl[1]];
  const d = [p[0] - tl[0], p[1] - tl[1]];
  const det = e1[0] * e2[1] - e1[1] * e2[0];
  return [
    (d[0] * e2[1] - d[1] * e2[0]) / det,
    (e1[0] * d[1] - e1[1] * d[0]) / det,
  ];
}

function metres([a, b]: [LonLat, LonLat]): number {
  const r = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * toRad) * Math.cos(b[1] * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
}

type Props = {
  flag: Flag;
  siteName: string;
  controlKm: number;
  className?: string;
  priority?: boolean;
};

/** The flagged pass as a static evidence board: true-colour chip, plume outline, wind, tier. */
export function EvidenceChip({ flag, siteName, controlKm, className }: Props) {
  const t = useTranslations("Field");
  const tc = useTranslations("Common");
  const f = useFormat();
  const gid = useId().replace(/:/g, "");
  const ev = flag.evidence;
  if (!ev) return null;
  const S = 1000;
  const corners = ev.chipBounds as LonLat[];
  const paths =
    ev.plume?.features.map((feat) =>
      feat.geometry.coordinates
        .map(
          (ring) =>
            ring
              .map(([lon, lat], i) => {
                const [u, v] = toChip([lon, lat], corners);
                return `${i ? "L" : "M"}${(u * S).toFixed(1)},${(v * S).toFixed(1)}`;
              })
              .join("") + "Z",
        )
        .join(""),
    ) ?? [];
  const widthM = metres([corners[0], corners[1]]);
  const bar = (500 / widthM) * S;
  const hasWind = flag.windU !== null && flag.windV !== null;
  const speed = hasWind ? Math.hypot(flag.windU!, flag.windV!) : 0;
  const dir =
    hasWind && speed > 0 ? [flag.windU! / speed, -flag.windV! / speed] : [0, 0];
  const wc = [140, 140];
  const label = t("boardLabel", {
    site: siteName,
    date: f.date(flag.date),
    tier: tc(`tier.${flag.tier}`),
  });

  return (
    <svg
      viewBox={`0 0 ${S} ${S}`}
      role="img"
      aria-label={label}
      className={className}
    >
      <defs>
        <radialGradient id={`ramp-${gid}`} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#DC2626" />
          <stop offset="55%" stopColor="#F59E0B" />
          <stop offset="100%" stopColor="#FDE68A" />
        </radialGradient>
        <filter id={`glow-${gid}`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>
      <image
        href={ev.rgb}
        x={0}
        y={0}
        width={S}
        height={S}
        preserveAspectRatio="none"
      />
      {paths.map((d, i) => (
        <g key={i}>
          <path
            d={d}
            fill="#F59E0B"
            opacity={0.35}
            filter={`url(#glow-${gid})`}
          />
          <path
            d={d}
            fill={`url(#ramp-${gid})`}
            fillOpacity={0.78}
            stroke="#DC2626"
            strokeWidth={3}
            fillRule="evenodd"
          />
        </g>
      ))}
      <circle
        cx={S / 2}
        cy={S / 2}
        r={9}
        fill="none"
        stroke="#E8ECF4"
        strokeWidth={3}
        opacity={0.8}
      />

      {hasWind && (
        <g>
          <circle
            cx={wc[0]}
            cy={wc[1]}
            r={78}
            fill="#05070DB3"
            stroke="#2DD4BF55"
          />
          {speed > 0 && (
            <g
              stroke="#2DD4BF"
              strokeWidth={7}
              strokeLinecap="round"
              fill="#2DD4BF"
            >
              <line
                x1={wc[0] - dir[0] * 48}
                y1={wc[1] - dir[1] * 48}
                x2={wc[0] + dir[0] * 38}
                y2={wc[1] + dir[1] * 38}
              />
              <path
                d={`M${wc[0] + dir[0] * 58},${wc[1] + dir[1] * 58} L${wc[0] + dir[0] * 30 - dir[1] * 18},${wc[1] + dir[1] * 30 + dir[0] * 18} L${wc[0] + dir[0] * 30 + dir[1] * 18},${wc[1] + dir[1] * 30 - dir[0] * 18}Z`}
                strokeWidth={2}
              />
            </g>
          )}
          <text
            x={wc[0]}
            y={wc[1] + 120}
            textAnchor="middle"
            fill="#E8ECF4"
            fontSize={30}
            className="font-mono"
          >
            {t("wind", { wind: f.num(speed, 1) })}
          </text>
        </g>
      )}

      <g transform={`translate(${S - 24}, 30)`}>
        <rect
          x={-340}
          y={0}
          width={340}
          height={56}
          rx={28}
          fill="#05070DCC"
          stroke={TIER_COLOUR[flag.tier]}
          strokeWidth={3}
        />
        <circle cx={-308} cy={28} r={11} fill={TIER_COLOUR[flag.tier]} />
        <text
          x={-286}
          y={38}
          fill="#E8ECF4"
          fontSize={28}
          className="font-mono"
        >
          {flag.tier} · {f.date(flag.date, "short")}
        </text>
      </g>

      <g transform={`translate(${S - 30}, ${S - 40})`} opacity={0.9}>
        <rect
          x={-372}
          y={-30}
          width={384}
          height={46}
          rx={10}
          fill="#05070DB3"
        />
        <text textAnchor="end" y={2} fill="#C2C8D4" fontSize={24}>
          ↑ {t("controlArrow", { km: f.num(controlKm) })}
        </text>
      </g>

      <g transform={`translate(40, ${S - 50})`}>
        <rect
          x={-12}
          y={-34}
          width={bar + 24}
          height={52}
          rx={8}
          fill="#05070DB3"
        />
        <line x1={0} x2={bar} y1={0} y2={0} stroke="#E8ECF4" strokeWidth={5} />
        <line x1={0} x2={0} y1={-10} y2={6} stroke="#E8ECF4" strokeWidth={4} />
        <line
          x1={bar}
          x2={bar}
          y1={-10}
          y2={6}
          stroke="#E8ECF4"
          strokeWidth={4}
        />
        <text
          x={bar / 2}
          y={-12}
          textAnchor="middle"
          fill="#E8ECF4"
          fontSize={24}
          className="font-mono"
        >
          500 m
        </text>
      </g>
    </svg>
  );
}
