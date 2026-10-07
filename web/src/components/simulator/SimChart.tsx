"use client";

const W = 560;
const PAD = { l: 40, r: 10, t: 10, b: 20 };

/**
 * One series over the last hours, with a dashed reference line. Two of these stack on the node
 * panel (methane, then chance of a rise): one axis each, and a shared hover time across both.
 */
export function SimChart({
  title,
  points,
  t0,
  t1,
  yMax,
  yTicks,
  fmtY,
  fmtTime,
  refLine,
  hoverAt,
  onHover,
  height = 130,
}: {
  title: string;
  points: { at: number; v: number }[];
  t0: number;
  t1: number;
  yMax: number;
  yTicks: number[];
  fmtY: (v: number) => string;
  fmtTime: (t: number) => string;
  refLine: { v: number; label: string };
  hoverAt: number | null;
  onHover: (t: number | null) => void;
  height?: number;
}) {
  const H = height;
  const x = (t: number) => PAD.l + ((t - t0) / (t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (v: number) =>
    PAD.t + (1 - Math.min(v, yMax) / yMax) * (H - PAD.t - PAD.b);
  const path = points
    .map(
      (p, i) =>
        `${i ? "L" : "M"}${x(p.at).toFixed(1)} ${y(Math.max(0, p.v)).toFixed(1)}`,
    )
    .join("");
  const hourTicks: number[] = [];
  for (let t = Math.ceil(t0 / 7_200_000) * 7_200_000; t <= t1; t += 7_200_000)
    hourTicks.push(t);
  const hp =
    hoverAt === null
      ? null
      : points.reduce<{ at: number; v: number } | null>(
          (best, p) =>
            !best || Math.abs(p.at - hoverAt) < Math.abs(best.at - hoverAt)
              ? p
              : best,
          null,
        );
  const last = points[points.length - 1];

  return (
    <figure className="min-w-0">
      <figcaption className="text-sm font-medium text-canopy">
        {title}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="mt-1 w-full"
        role="img"
        aria-label={`${title}: ${last ? fmtY(last.v) : "—"}`}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD.l}
              x2={W - PAD.r}
              y1={y(v)}
              y2={y(v)}
              stroke="#0E3B2A"
              strokeOpacity="0.1"
            />
            <text
              x={PAD.l - 6}
              y={y(v) + 4}
              textAnchor="end"
              fontSize="11"
              fill="#4A6355"
              fontFamily="var(--font-mono)"
            >
              {fmtY(v)}
            </text>
          </g>
        ))}
        {hourTicks.map((t) => (
          <text
            key={t}
            x={x(t)}
            y={H - 4}
            textAnchor="middle"
            fontSize="11"
            fill="#4A6355"
            fontFamily="var(--font-mono)"
          >
            {fmtTime(t)}
          </text>
        ))}
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={y(refLine.v)}
          y2={y(refLine.v)}
          stroke="#B45309"
          strokeDasharray="5 4"
        />
        <text
          x={W - PAD.r}
          y={y(refLine.v) - 5}
          textAnchor="end"
          fontSize="11"
          fill="#B45309"
        >
          {refLine.label}
        </text>
        <path
          d={path}
          fill="none"
          stroke="#1E7B45"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {last && (
          <circle
            cx={x(last.at)}
            cy={y(Math.max(0, last.v))}
            r="4"
            fill="#1E7B45"
            stroke="#fff"
            strokeWidth="2"
          />
        )}
        {hp && (
          <g>
            <line
              x1={x(hp.at)}
              x2={x(hp.at)}
              y1={PAD.t}
              y2={H - PAD.b}
              stroke="#0E3B2A"
              strokeOpacity="0.35"
            />
            <circle
              cx={x(hp.at)}
              cy={y(Math.max(0, hp.v))}
              r="4"
              fill="#1E7B45"
              stroke="#fff"
              strokeWidth="2"
            />
            <text
              x={Math.min(x(hp.at) + 6, W - 120)}
              y={PAD.t + 12}
              fontSize="12"
              fill="#0E3B2A"
              fontFamily="var(--font-mono)"
            >
              {fmtTime(hp.at)} · {fmtY(hp.v)}
            </text>
          </g>
        )}
        <rect
          x={PAD.l}
          y={0}
          width={W - PAD.l - PAD.r}
          height={H}
          fill="transparent"
          onPointerMove={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            onHover(t0 + ((e.clientX - r.left) / r.width) * (t1 - t0));
          }}
          onPointerLeave={() => onHover(null)}
        />
      </svg>
    </figure>
  );
}
