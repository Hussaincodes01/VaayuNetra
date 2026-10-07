// Accuracy building blocks for /system: paired-bar metric tables and rate-based accuracy matrices.
// Server components (no client JS). Colours: the validated VayuNetra / comparison pair from the Proof
// section (dataviz validate_palette.js: CVD ΔE 19.5, normal 21.5, both >= 3:1 on white).

export const OURS = "#1E7B45";
export const THEIRS = "#4A86CF";

export type PairRow = {
  label: string;
  ours: number;
  theirs: number | null;
  /** Scale end for the bars (1 for shares and AUC). */
  max: number;
  fmt: (v: number) => string;
  /** True where a lower value is better (false alarms), stated beside the label. */
  lowerBetter?: boolean;
};

function Bar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="h-2.5 w-full rounded-full bg-muted" aria-hidden>
      <div
        className="h-full rounded-full"
        style={{ width: `${pct}%`, background: color }}
      />
    </div>
  );
}

/** A comparison table: one row per measure, a bar and a value for each side. */
export function PairTable({
  caption,
  rows,
  oursLabel,
  theirsLabel,
  metricLabel,
  lowerBetterNote,
}: {
  caption: string;
  rows: PairRow[];
  oursLabel: string;
  theirsLabel: string;
  metricLabel: string;
  lowerBetterNote: string;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="w-[38%] py-2 pr-4 font-medium">
              {metricLabel}
            </th>
            <th scope="col" className="py-2 pr-4 font-medium">
              <span className="inline-flex items-center gap-2">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: OURS }}
                  aria-hidden
                />
                {oursLabel}
              </span>
            </th>
            <th scope="col" className="py-2 font-medium">
              <span className="inline-flex items-center gap-2">
                <span
                  className="size-2.5 rounded-full"
                  style={{ background: THEIRS }}
                  aria-hidden
                />
                {theirsLabel}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label} className="border-t border-border align-middle">
              <th scope="row" className="py-3 pr-4 font-normal">
                {r.label}
                {r.lowerBetter && (
                  <span className="block text-xs text-muted-foreground">
                    {lowerBetterNote}
                  </span>
                )}
              </th>
              <td className="py-3 pr-4">
                <div className="flex items-center gap-3">
                  <span className="w-16 shrink-0 font-mono">
                    {r.fmt(r.ours)}
                  </span>
                  <Bar value={r.ours} max={r.max} color={OURS} />
                </div>
              </td>
              <td className="py-3">
                {r.theirs === null ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <div className="flex items-center gap-3">
                    <span className="w-16 shrink-0 font-mono">
                      {r.fmt(r.theirs)}
                    </span>
                    <Bar value={r.theirs} max={r.max} color={THEIRS} />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * A 2x2 accuracy matrix in rates: of the cases where the event was present, the share caught and
 * missed (recall, 1 - recall); of the cases where it was absent, the share falsely flagged and
 * correctly left quiet (false-alarm rate, 1 - it). Rates, not counts.
 */
export function RateMatrix({
  title,
  recall,
  falseAlarm,
  labels,
  fmt,
}: {
  title: string;
  recall: number;
  falseAlarm: number;
  labels: {
    present: string;
    absent: string;
    flagged: string;
    notFlagged: string;
    caught: string;
    missed: string;
    falseAlarm: string;
    quiet: string;
  };
  fmt: (v: number) => string;
}) {
  const cell = (v: number, word: string, good: boolean) => (
    <td
      className="h-24 w-1/2 rounded-lg p-3 text-center align-middle"
      style={{
        background: good
          ? `rgba(30, 123, 69, ${0.08 + 0.42 * v})`
          : `rgba(180, 83, 9, ${0.06 + 0.3 * v})`,
      }}
    >
      <span className="block font-mono text-2xl text-canopy">{fmt(v)}</span>
      <span className="text-xs text-foreground/80">{word}</span>
    </td>
  );
  return (
    <figure className="min-w-0 rounded-xl border border-border bg-card p-4">
      <figcaption className="font-heading text-base font-semibold text-canopy">
        {title}
      </figcaption>
      <table className="mt-3 w-full border-separate border-spacing-1.5 text-sm">
        <caption className="sr-only">{title}</caption>
        <thead>
          <tr>
            <td />
            <th
              scope="col"
              className="pb-1 text-xs font-medium text-muted-foreground"
            >
              {labels.flagged}
            </th>
            <th
              scope="col"
              className="pb-1 text-xs font-medium text-muted-foreground"
            >
              {labels.notFlagged}
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th
              scope="row"
              className="w-24 pr-2 text-left text-xs font-medium text-muted-foreground"
            >
              {labels.present}
            </th>
            {cell(recall, labels.caught, true)}
            {cell(1 - recall, labels.missed, false)}
          </tr>
          <tr>
            <th
              scope="row"
              className="w-24 pr-2 text-left text-xs font-medium text-muted-foreground"
            >
              {labels.absent}
            </th>
            {cell(falseAlarm, labels.falseAlarm, false)}
            {cell(1 - falseAlarm, labels.quiet, true)}
          </tr>
        </tbody>
      </table>
    </figure>
  );
}
