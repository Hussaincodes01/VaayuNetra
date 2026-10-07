import { ArrowDown, ArrowRight } from "lucide-react";
import { type Locale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ScreeningNote } from "@/components/landing/ui";
import {
  PairTable,
  RateMatrix,
  type PairRow,
} from "@/components/system/Accuracy";
import { BENCHMARK, FIELD_TEST, MODEL } from "@/content/facts";
import { Link } from "@/i18n/navigation";
import { makeFormat, pageAlternates } from "@/lib/format";
import sensorModel from "@/lib/sensor-model.json";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

// Live ledger counts come from Supabase (public tables); everything else is fixed.
export const dynamic = "force-dynamic";

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "System",
  });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: pageAlternates(locale, "/system"),
  };
}

const card = "min-w-0 rounded-xl border border-border bg-card p-4";

function SysCard({
  name,
  text,
  chip,
  highlight,
}: {
  name: string;
  text: string;
  chip?: { label: string; tone: "planned" | "simulated" };
  highlight?: boolean;
}) {
  return (
    <li
      className={
        highlight
          ? "rounded-xl border-[1.5px] border-leaf bg-[#EAF7E4] p-4"
          : card
      }
    >
      <p className="flex flex-wrap items-center gap-2 font-heading text-base font-semibold text-canopy">
        {name}
        {chip && (
          <span
            className={
              chip.tone === "planned"
                ? "rounded-full bg-[#FDE68A] px-2 py-0.5 font-sans text-xs font-semibold text-[#6B4205]"
                : "rounded-full bg-sky px-2 py-0.5 font-sans text-xs font-semibold text-[#1F4A5C]"
            }
          >
            {chip.label}
          </span>
        )}
      </p>
      <p className="mt-1 text-sm text-foreground/85">{text}</p>
    </li>
  );
}

/** How the whole system fits together, and every accuracy figure behind it. */
export default async function SystemPage({ params }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("System");
  const f = makeFormat(locale);
  const pct = (v: number) => f.pct(v, v < 0.1 ? 1 : 0);
  const dec = (d: number) => (v: number) => f.num(v, d);
  const sm = sensorModel.metrics;
  const weights = sensorModel.layers.reduce(
    (n, l) => n + l.W.length * l.W[0].length + l.b.length,
    0,
  );

  let ledger = {
    entries: 0,
    anchors: 0,
    confirmed: 0,
    block: null as number | null,
  };
  if (supabaseConfigured) {
    const s = await createClient();
    const [e, a, c] = await Promise.all([
      s.from("ledger_entries").select("id", { count: "exact", head: true }),
      s.from("ledger_anchors").select("id", { count: "exact", head: true }),
      s
        .from("ledger_anchors")
        .select("bitcoin_block", { count: "exact" })
        .eq("status", "confirmed")
        .order("bitcoin_block", { ascending: false })
        .limit(1),
    ]);
    ledger = {
      entries: e.count ?? 0,
      anchors: a.count ?? 0,
      confirmed: c.count ?? 0,
      block: (c.data?.[0]?.bitcoin_block as number | undefined) ?? null,
    };
  }

  const B = BENCHMARK;
  const op = B.operatingPoint;
  const globalRows: PairRow[] = [
    {
      label: t("acc.global.rocAuc"),
      ours: B.rocAuc.vayunetra,
      theirs: B.rocAuc.mbmp,
      max: 1,
      fmt: dec(3),
    },
    ...B.recallAtFalseAlarm.map((r) => ({
      label: t("acc.global.recallAt", { far: f.pct(r.falseAlarm) }),
      ours: r.vayunetra,
      theirs: r.mbmp,
      max: 1,
      fmt: dec(2),
    })),
    {
      label: t("acc.global.precision"),
      ours: op.precision.vayunetra,
      theirs: op.precision.mbmp,
      max: 1,
      fmt: dec(3),
    },
    {
      label: t("acc.global.recall"),
      ours: op.recall.vayunetra,
      theirs: op.recall.mbmp,
      max: 1,
      fmt: dec(3),
    },
    {
      label: t("acc.global.far"),
      ours: op.falseAlarm.vayunetra,
      theirs: op.falseAlarm.mbmp,
      max: 0.2,
      fmt: (v) => f.pct(v, 1),
      lowerBetter: true,
    },
    {
      label: t("acc.global.iou"),
      ours: B.pixelIoU.vayunetra,
      theirs: B.pixelIoU.mbmp,
      max: 1,
      fmt: dec(3),
    },
    ...B.recallByRate.map((r) => ({
      label: t("acc.global.byRate", { bin: r.bin }),
      ours: r.vayunetra,
      theirs: r.mbmp,
      max: 1,
      fmt: dec(2),
    })),
  ];
  const sensorRows: PairRow[] = [
    {
      label: t("acc.sensor.warned"),
      ours: Number(sm.warned_share),
      theirs: Number(sm.baseline_warned_share),
      max: 1,
      fmt: pct,
    },
    {
      label: t("acc.sensor.lead"),
      ours: Number(sm.median_lead_min),
      theirs: Number(sm.baseline_median_lead_min),
      max: 180,
      fmt: (v) => t("acc.sensor.minutes", { n: f.num(v) }),
    },
    {
      label: t("acc.sensor.far"),
      ours: Number(sm.false_alarm_rate_at_threshold),
      theirs: Number(sm.baseline_false_alarm_rate),
      max: 0.1,
      fmt: (v) => f.pct(v, 1),
      lowerBetter: true,
    },
  ];
  const sensorOnly: PairRow[] = [
    {
      label: t("acc.sensor.rocAuc"),
      ours: Number(sm.test_roc_auc),
      theirs: null,
      max: 1,
      fmt: dec(3),
    },
    ...([5, 10, 20] as const).map((far) => ({
      label: t("acc.global.recallAt", { far: `${far}%` }),
      ours: Number(sm[`recall_at_far_${far}` as const]),
      theirs: null,
      max: 1,
      fmt: dec(2),
    })),
    {
      label: t("acc.sensor.precision"),
      ours: Number(sm.precision_at_threshold),
      theirs: null,
      max: 1,
      fmt: dec(2),
    },
  ];
  const matrixLabels = {
    present: t("acc.matrix.present"),
    absent: t("acc.matrix.absent"),
    flagged: t("acc.matrix.flagged"),
    notFlagged: t("acc.matrix.notFlagged"),
    caught: t("acc.matrix.caught"),
    missed: t("acc.matrix.missed"),
    falseAlarm: t("acc.matrix.falseAlarm"),
    quiet: t("acc.matrix.quiet"),
  };
  const sensorMatrixLabels = {
    ...matrixLabels,
    present: t("acc.matrix.risePresent"),
    absent: t("acc.matrix.riseAbsent"),
    flagged: t("acc.matrix.warned"),
    notFlagged: t("acc.matrix.notWarned"),
  };
  const ft = FIELD_TEST;
  const steps = ["detect", "confirm", "act", "verify", "report"] as const;

  return (
    <main id="main" className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-8">
          <Link href="/" className="font-heading text-lg font-semibold">
            Vayu<span className="text-signal">Netra</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/scorecard" className="hover:text-foreground">
              {t("nav.scorecard")}
            </Link>
            <Link href="/verify" className="hover:text-foreground">
              {t("nav.verify")}
            </Link>
            <Link href="/map" className="hover:text-foreground">
              {t("nav.map")}
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl space-y-16 px-4 py-10 md:px-8">
        <div className="space-y-3">
          <h1 className="font-heading text-3xl font-semibold text-canopy md:text-4xl">
            {t("title")}
          </h1>
          <p className="max-w-3xl text-foreground/80">{t("intro")}</p>
          <ul className="flex flex-wrap gap-4 text-sm">
            <li>
              <a href="#system" className="text-leaf hover:underline">
                {t("system.title")}
              </a>
            </li>
            <li>
              <a href="#loop" className="text-leaf hover:underline">
                {t("loop.title")}
              </a>
            </li>
            <li>
              <a href="#accuracy" className="text-leaf hover:underline">
                {t("acc.title")}
              </a>
            </li>
            <li>
              <a href="#proof" className="text-leaf hover:underline">
                {t("proof.title")}
              </a>
            </li>
          </ul>
        </div>

        {/* ---------------------------------------------------------------- the system */}
        <section
          id="system"
          aria-labelledby="system-title"
          className="scroll-mt-20 space-y-5"
        >
          <h2
            id="system-title"
            className="font-heading text-2xl font-semibold text-canopy"
          >
            {t("system.title")}
          </h2>
          <div className="grid items-stretch gap-4 lg:grid-cols-[1fr_auto_1fr_auto_1fr]">
            <div>
              <h3 className="mb-2 text-sm font-semibold text-leaf">
                {t("system.sense")}
              </h3>
              <ul className="space-y-3">
                <SysCard
                  name={t("system.satellite.name")}
                  text={t("system.satellite.text", {
                    params: f.num(MODEL.parametersM, 1),
                    channels: MODEL.inputChannels,
                  })}
                />
                <SysCard
                  name={t("system.drone.name")}
                  text={t("system.drone.text")}
                  chip={{ label: t("system.planned"), tone: "planned" }}
                />
                <SysCard
                  name={t("system.sensors.name")}
                  text={t("system.sensors.text")}
                  chip={{ label: t("system.simulated"), tone: "simulated" }}
                />
              </ul>
            </div>
            <div
              className="flex items-center justify-center text-muted-foreground"
              aria-hidden
            >
              <ArrowRight className="hidden size-6 lg:block" />
              <ArrowDown className="size-6 lg:hidden" />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-leaf">
                {t("system.decide")}
              </h3>
              <ul className="space-y-3">
                <SysCard
                  name={t("system.gate.name")}
                  text={t("system.gate.text")}
                />
                <SysCard
                  name={t("system.confirm.name")}
                  text={t("system.confirm.text")}
                />
                <SysCard
                  name={t("system.warning.name")}
                  text={t("system.warning.text", {
                    weights,
                    h: sensorModel.horizon_h,
                  })}
                  chip={{ label: t("system.simulated"), tone: "simulated" }}
                />
              </ul>
            </div>
            <div
              className="flex items-center justify-center text-muted-foreground"
              aria-hidden
            >
              <ArrowRight className="hidden size-6 lg:block" />
              <ArrowDown className="size-6 lg:hidden" />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold text-leaf">
                {t("system.act")}
              </h3>
              <ul className="space-y-3">
                <SysCard
                  name={t("system.dashboard.name")}
                  text={t("system.dashboard.text")}
                />
                <SysCard
                  name={t("system.ledger.name")}
                  text={t("system.ledger.text")}
                />
                <SysCard
                  name={t("system.scorecard.name")}
                  text={t("system.scorecard.text")}
                />
                <SysCard
                  name={t("system.integrity.name")}
                  text={t("system.integrity.text")}
                  highlight
                />
              </ul>
            </div>
          </div>
          <p className="text-sm text-foreground/80">{t("system.audience")}</p>
        </section>

        {/* ---------------------------------------------------------------- the loop */}
        <section
          id="loop"
          aria-labelledby="loop-title"
          className="scroll-mt-20 space-y-5"
        >
          <h2
            id="loop-title"
            className="font-heading text-2xl font-semibold text-canopy"
          >
            {t("loop.title")}
          </h2>
          <ol className="grid gap-3 md:grid-cols-5">
            {steps.map((s, i) => (
              <li
                key={s}
                className={
                  s === "act"
                    ? "rounded-xl border-[1.5px] border-leaf bg-[#EAF7E4] p-4"
                    : card
                }
              >
                <p className="font-heading text-base font-semibold text-canopy">
                  {i + 1} {t(`loop.${s}.name`)}
                </p>
                <p className="mt-1 text-sm text-foreground/85">
                  {t(`loop.${s}.text`)}
                </p>
              </li>
            ))}
          </ol>
          <p className="text-sm text-muted-foreground">{t("loop.back")}</p>
        </section>

        {/* ---------------------------------------------------------------- accuracy */}
        <section
          id="accuracy"
          aria-labelledby="acc-title"
          className="scroll-mt-20 space-y-10"
        >
          <div className="space-y-2">
            <h2
              id="acc-title"
              className="font-heading text-2xl font-semibold text-canopy"
            >
              {t("acc.title")}
            </h2>
            <p className="max-w-3xl text-sm text-foreground/80">
              {t("acc.intro")}
            </p>
          </div>

          <div className="space-y-4">
            <h3 className="font-heading text-xl font-semibold text-canopy">
              {t("acc.global.title")}
            </h3>
            <p className="max-w-3xl text-sm text-foreground/80">
              {t("acc.global.intro")}
            </p>
            <div className={card}>
              <PairTable
                caption={t("acc.global.title")}
                rows={globalRows}
                oursLabel={t("acc.vayunetra")}
                theirsLabel={t("acc.mbmp")}
                metricLabel={t("acc.measure")}
                lowerBetterNote={t("acc.lowerBetter")}
              />
              <p className="mt-4 text-sm">
                {t("acc.global.rateWithin", {
                  share: f.pct(B.rateAccuracy.withinHalf),
                  plumes: f.num(B.rateAccuracy.plumes),
                })}{" "}
                {t("acc.global.rateRatio", {
                  ratio: f.num(B.rateAccuracy.medianRatio, 2),
                })}
              </p>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-heading text-xl font-semibold text-canopy">
              {t("acc.matrix.title")}
            </h3>
            <p className="max-w-3xl text-sm text-foreground/80">
              {t("acc.matrix.intro")}
            </p>
            <div className="grid gap-4 md:grid-cols-3">
              <RateMatrix
                title={t("acc.vayunetra")}
                recall={op.recall.vayunetra}
                falseAlarm={op.falseAlarm.vayunetra}
                labels={matrixLabels}
                fmt={(v) => f.pct(v, 1)}
              />
              <RateMatrix
                title={t("acc.mbmp")}
                recall={op.recall.mbmp}
                falseAlarm={op.falseAlarm.mbmp}
                labels={matrixLabels}
                fmt={(v) => f.pct(v, 1)}
              />
              <RateMatrix
                title={t("acc.matrix.sensors")}
                recall={Number(sm.recall_at_threshold)}
                falseAlarm={Number(sm.false_alarm_rate_at_threshold)}
                labels={sensorMatrixLabels}
                fmt={(v) => f.pct(v, 1)}
              />
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-heading text-xl font-semibold text-canopy">
              {t("acc.india.title")}
            </h3>
            <p className="max-w-3xl text-sm text-foreground/80">
              {t("acc.india.intro", { km: ft.controlDistanceKm })}
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={`${card} overflow-x-auto`}>
                <table className="w-full min-w-[420px] text-left text-sm">
                  <caption className="sr-only">{t("acc.india.title")}</caption>
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="py-2 pr-3 font-medium" />
                      <th scope="col" className="py-2 pr-3 font-medium">
                        {t("acc.india.scenes")}
                      </th>
                      <th scope="col" className="py-2 pr-3 font-medium">
                        {t("acc.india.atCard", {
                          thr: f.num(MODEL.sceneThreshold, 3),
                        })}
                      </th>
                      <th scope="col" className="py-2 font-medium">
                        {t("acc.india.atIndia", {
                          thr: f.num(ft.indiaCalibrated.threshold, 3),
                        })}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="font-mono">
                    <tr className="border-t border-border">
                      <th
                        scope="row"
                        className="py-2 pr-3 font-sans font-normal"
                      >
                        {t("acc.india.landfills")}
                      </th>
                      <td className="py-2 pr-3">{f.num(ft.scenes.landfill)}</td>
                      <td className="py-2 pr-3">{f.num(ft.flags.landfill)}</td>
                      <td className="py-2">
                        {f.num(ft.indiaCalibrated.landfill)}
                      </td>
                    </tr>
                    <tr className="border-t border-border">
                      <th
                        scope="row"
                        className="py-2 pr-3 font-sans font-normal"
                      >
                        {t("acc.india.controls")}
                      </th>
                      <td className="py-2 pr-3">{f.num(ft.scenes.control)}</td>
                      <td className="py-2 pr-3">{f.num(ft.flags.control)}</td>
                      <td className="py-2">
                        {f.num(ft.indiaCalibrated.control)}
                      </td>
                    </tr>
                    <tr className="border-t border-border text-muted-foreground">
                      <th
                        scope="row"
                        className="py-2 pr-3 font-sans font-normal"
                      >
                        {t("acc.india.pValue")}
                      </th>
                      <td className="py-2 pr-3" />
                      <td className="py-2 pr-3">{ft.flags.pValue}</td>
                      <td className="py-2">{ft.indiaCalibrated.pValue}</td>
                    </tr>
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("acc.india.flagsNote")}
                </p>
              </div>
              <ul className={`${card} space-y-2 text-sm`}>
                <li>
                  {t("acc.india.tiers", {
                    flags: ft.flags.landfill,
                    t1: ft.tiers.t1,
                    t2: ft.tiers.t2,
                    t3: ft.tiers.t3,
                    burn: ft.tiers.burnLikeGhazipur,
                  })}
                </li>
                <li>
                  {t("acc.india.perPass", {
                    share: ft.perPassDetection,
                    tph: ft.perPassDetectionMinTph,
                  })}
                </li>
                <li>
                  {t("acc.india.knownTruth", {
                    ratio: f.num(ft.knownTruthRatio, 2),
                    tph: ft.knownTruthTph,
                  })}
                </li>
                <li>
                  {t("acc.india.bounds", {
                    g: ft.persistentUpperTph.ghazipur,
                    b: ft.persistentUpperTph.bhalswa,
                    d: ft.persistentUpperTph.deonar,
                    p: ft.persistentUpperTph.pirana,
                    o: ft.persistentUpperTph.okhla,
                  })}
                </li>
                <li className="text-foreground/80">
                  {t("acc.india.fineTune", { auc: f.num(ft.fineTuneAuc, 2) })}
                </li>
              </ul>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="font-heading text-xl font-semibold text-canopy">
              {t("acc.sensor.title")}
            </h3>
            <p className="max-w-3xl text-sm text-foreground/80">
              {t("acc.sensor.intro")}
            </p>
            <div className="grid gap-4 lg:grid-cols-2">
              <div className={card}>
                <PairTable
                  caption={t("acc.sensor.title")}
                  rows={sensorRows}
                  oursLabel={t("acc.sensor.model")}
                  theirsLabel={t("acc.sensor.baseline")}
                  metricLabel={t("acc.measure")}
                  lowerBetterNote={t("acc.lowerBetter")}
                />
              </div>
              <div className={card}>
                <PairTable
                  caption={t("acc.sensor.title")}
                  rows={sensorOnly}
                  oursLabel={t("acc.sensor.model")}
                  theirsLabel={t("acc.sensor.baseline")}
                  metricLabel={t("acc.measure")}
                  lowerBetterNote={t("acc.lowerBetter")}
                />
                <p className="mt-3 text-xs text-muted-foreground">
                  {t("acc.sensor.weights", {
                    n: weights,
                    week: f.num(Number(sm.false_warnings_per_node_week), 1),
                    other: String(sm.other_model),
                  })}
                </p>
              </div>
            </div>
          </div>

          <div className={`${card} space-y-2`}>
            <h3 className="font-heading text-lg font-semibold text-canopy">
              {t("acc.limits.title")}
            </h3>
            <ul className="list-disc space-y-1 pl-5 text-sm text-foreground/85">
              <li>{t("acc.limits.one")}</li>
              <li>{t("acc.limits.two")}</li>
              <li>{t("acc.limits.three")}</li>
              <li>{t("acc.limits.four")}</li>
            </ul>
          </div>
        </section>

        {/* ---------------------------------------------------------------- proof */}
        <section
          id="proof"
          aria-labelledby="proof-title"
          className="scroll-mt-20 space-y-4"
        >
          <h2
            id="proof-title"
            className="font-heading text-2xl font-semibold text-canopy"
          >
            {t("proof.title")}
          </h2>
          <p className="max-w-3xl text-sm text-foreground/80">
            {t("proof.intro")}
          </p>
          <dl className="grid gap-3 sm:grid-cols-3">
            {[
              [t("proof.entries"), f.num(ledger.entries)],
              [t("proof.anchors"), f.num(ledger.anchors)],
              [
                t("proof.bitcoin"),
                ledger.block ? `#${ledger.block}` : t("proof.waiting"),
              ],
            ].map(([label, value]) => (
              <div key={label} className={card}>
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd
                  className={`mt-1 text-2xl text-canopy ${/\d/.test(value) ? "font-mono" : "font-heading"}`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="flex flex-wrap gap-6 text-sm">
            <Link href="/verify" className="text-leaf hover:underline">
              {t("proof.verify")}
            </Link>
            <Link href="/scorecard" className="text-leaf hover:underline">
              {t("proof.scorecard")}
            </Link>
          </p>
        </section>

        <ScreeningNote />
      </div>
    </main>
  );
}
