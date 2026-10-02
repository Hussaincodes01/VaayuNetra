"use client";

// visx charts for the Proof section. Loaded with next/dynamic when the section nears the viewport.

import { Group } from "@visx/group";
import { scaleBand, scaleLinear } from "@visx/scale";
import { Bar } from "@visx/shape";
import { BENCHMARK } from "@/content/facts";

const TEAL = "#2DD4BF";
const GREY = "#5B6478";
const W = 360;

type ChartProps = {
  animate: boolean;
  label: string;
  fmt: (v: number, digits?: number) => string;
};

function grow(animate: boolean, delay = 0): React.CSSProperties {
  return {
    transformBox: "fill-box",
    transformOrigin: "left center",
    transform: animate ? "scaleX(1)" : "scaleX(0)",
    transition: `transform 1100ms cubic-bezier(.2,.7,.2,1) ${delay}ms`,
  };
}

function growUp(animate: boolean, delay = 0): React.CSSProperties {
  return {
    ...grow(animate, delay),
    transformOrigin: "center bottom",
    transform: animate ? "scaleY(1)" : "scaleY(0)",
  };
}

/** Two horizontal bars on a 0–1 axis, optional reference line. */
function PairBars({
  animate,
  label,
  fmt,
  values,
  names,
  reference,
  referenceLabel,
  max = 1,
}: ChartProps & {
  values: [number, number];
  names: [string, string];
  reference?: number;
  referenceLabel?: string;
  max?: number;
}) {
  const h = 150;
  const left = 0;
  const x = scaleLinear({ domain: [0, max], range: [0, W - 56] });
  const y = scaleBand({ domain: names, range: [24, h - 18], padding: 0.35 });
  return (
    <svg
      viewBox={`0 0 ${W} ${h}`}
      role="img"
      aria-label={label}
      className="h-auto w-full"
    >
      <Group left={left}>
        {names.map((n, i) => {
          const bw = x(values[i]);
          const by = y(n) ?? 0;
          return (
            <g key={n}>
              <text
                x={0}
                y={by - 6}
                className="fill-muted-foreground text-[11px]"
              >
                {n}
              </text>
              <rect
                x={0}
                y={by}
                width={W - 56}
                height={y.bandwidth()}
                rx={4}
                fill="#ffffff0d"
              />
              <Bar
                x={0}
                y={by}
                width={bw}
                height={y.bandwidth()}
                rx={4}
                fill={i === 0 ? TEAL : GREY}
                style={grow(animate, i * 150)}
              />
              <text
                x={bw + 8}
                y={by + y.bandwidth() / 2 + 5}
                className="fill-foreground font-mono text-[14px]"
              >
                {fmt(values[i], 3)}
              </text>
            </g>
          );
        })}
        {reference !== undefined && (
          <g>
            <line
              x1={x(reference)}
              x2={x(reference)}
              y1={14}
              y2={h - 10}
              stroke="#E8ECF4"
              strokeDasharray="3 4"
              strokeOpacity={0.6}
            />
            <text
              x={x(reference) + 4}
              y={12}
              className="fill-muted-foreground text-[10px]"
            >
              {referenceLabel}
            </text>
          </g>
        )}
      </Group>
    </svg>
  );
}

export function AucChart(
  props: ChartProps & { names: [string, string]; chance: string },
) {
  const { rocAuc } = BENCHMARK;
  return (
    <PairBars
      {...props}
      values={[rocAuc.vayunetra, rocAuc.mbmp]}
      reference={0.5}
      referenceLabel={props.chance}
    />
  );
}

export function IouChart(props: ChartProps & { names: [string, string] }) {
  const { pixelIoU } = BENCHMARK;
  return (
    <PairBars
      {...props}
      values={[pixelIoU.vayunetra, pixelIoU.mbmp]}
      max={0.4}
    />
  );
}

export function RecallChart({
  animate,
  label,
  fmt,
  names,
}: ChartProps & { names: [string, string] }) {
  const h = 190;
  const bins = BENCHMARK.recallByRate;
  const x = scaleBand({
    domain: bins.map((b) => b.bin),
    range: [28, W - 4],
    padding: 0.28,
  });
  const inner = scaleBand({
    domain: ["v", "m"],
    range: [0, x.bandwidth()],
    padding: 0.12,
  });
  const y = scaleLinear({ domain: [0, 0.4], range: [h - 26, 18] });
  return (
    <svg
      viewBox={`0 0 ${W} ${h}`}
      role="img"
      aria-label={label}
      className="h-auto w-full"
    >
      {[0, 0.1, 0.2, 0.3, 0.4].map((v) => (
        <g key={v}>
          <line x1={28} x2={W - 4} y1={y(v)} y2={y(v)} stroke="#ffffff14" />
          <text
            x={0}
            y={y(v) + 4}
            className="fill-muted-foreground font-mono text-[10px]"
          >
            {fmt(v, 1)}
          </text>
        </g>
      ))}
      {bins.map((b, i) => {
        const x0 = x(b.bin) ?? 0;
        return (
          <g key={b.bin}>
            {(["v", "m"] as const).map((k) => {
              const value = k === "v" ? b.vayunetra : b.mbmp;
              const bx = x0 + (inner(k) ?? 0);
              return (
                <g key={k}>
                  <Bar
                    x={bx}
                    y={y(value)}
                    width={inner.bandwidth()}
                    height={y(0) - y(value)}
                    rx={3}
                    fill={k === "v" ? TEAL : GREY}
                    style={growUp(animate, i * 120 + (k === "m" ? 60 : 0))}
                  />
                  <text
                    x={bx + inner.bandwidth() / 2}
                    y={y(value) - 5}
                    textAnchor="middle"
                    className="fill-foreground font-mono text-[10px]"
                  >
                    {fmt(value, 2)}
                  </text>
                </g>
              );
            })}
            <text
              x={x0 + x.bandwidth() / 2}
              y={h - 8}
              textAnchor="middle"
              className="fill-muted-foreground font-mono text-[11px]"
            >
              {b.bin}
            </text>
          </g>
        );
      })}
      <g transform={`translate(34, 2)`}>
        <rect width={10} height={10} rx={2} fill={TEAL} />
        <text x={14} y={9} className="fill-muted-foreground text-[10px]">
          {names[0]}
        </text>
        <rect x={78} width={10} height={10} rx={2} fill={GREY} />
        <text x={92} y={9} className="fill-muted-foreground text-[10px]">
          {names[1]}
        </text>
      </g>
    </svg>
  );
}

/** 10 x 10 waffle: share of plumes whose estimated rate is within ±50% of the published rate. */
export function AccuracyChart({
  animate,
  label,
  share,
  inside,
  outside,
}: Omit<ChartProps, "fmt"> & {
  share: number;
  inside: string;
  outside: string;
}) {
  const filled = Math.round(share * 100);
  const cell = 15;
  const gap = 4;
  const size = 10 * cell + 9 * gap;
  return (
    <svg
      viewBox={`0 0 ${W} ${size + 4}`}
      role="img"
      aria-label={label}
      className="h-auto w-full"
    >
      {Array.from({ length: 100 }, (_, i) => {
        const r = Math.floor(i / 10);
        const c = i % 10;
        const on = i < filled;
        return (
          <rect
            key={i}
            x={c * (cell + gap)}
            y={r * (cell + gap)}
            width={cell}
            height={cell}
            rx={3}
            fill={on ? TEAL : "#ffffff14"}
            style={{
              opacity: animate || !on ? 1 : 0.15,
              transition: `opacity 400ms ease ${i * 12}ms`,
            }}
          />
        );
      })}
      <g transform={`translate(${size + 18}, ${size / 2 - 24})`}>
        <rect width={10} height={10} rx={2} fill={TEAL} />
        <text x={16} y={9} className="fill-muted-foreground text-[11px]">
          {inside}
        </text>
        <rect y={22} width={10} height={10} rx={2} fill="#ffffff26" />
        <text x={16} y={31} className="fill-muted-foreground text-[11px]">
          {outside}
        </text>
      </g>
    </svg>
  );
}
