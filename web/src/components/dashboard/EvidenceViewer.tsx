"use client";

import { Check, X } from "lucide-react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import { createAction } from "@/app/[locale]/dashboard/actions";
import { EvidenceChip } from "@/components/landing/EvidenceChip";
import { reasonKey } from "@/components/landing/format";
import { TierBadge } from "@/components/landing/ui";
import { useRouter } from "@/i18n/navigation";
import type { ActionRow, Assignee, ScanRow } from "@/lib/dashboard-shared";
import { makeFormat } from "@/lib/format";
import type { Flag } from "@/lib/landing-types";
import {
  CALM_WIND_MS,
  physicsChecks,
  physicsSummary,
} from "@/lib/physics-checks";
import { cn } from "@/lib/utils";

const SiteEvidenceMap = dynamic(() => import("./SiteEvidenceMap"), {
  ssr: false,
});

type SiteInfo = {
  id: string;
  slug: string;
  name: string;
  city: string;
  state: string;
  lat: number;
  lon: number;
};
const TABS = ["rgb", "mbmp", "mask", "map"] as const;
type Tab = (typeof TABS)[number];

function WindBadge({
  u,
  v,
  speed,
  label,
}: {
  u: number;
  v: number;
  speed: string;
  label: string;
}) {
  const s = Math.hypot(u, v) || 1;
  const dx = u / s;
  const dy = -v / s;
  return (
    <div className="absolute top-3 right-3 flex items-center gap-2 rounded-full bg-background/80 py-1 pr-3 pl-1 text-xs backdrop-blur">
      <svg
        viewBox="-12 -12 24 24"
        className="size-7"
        role="img"
        aria-label={label}
      >
        <circle r={11} fill="#FFFFFF" stroke="#1E7B4555" />
        <line
          x1={-dx * 7}
          y1={-dy * 7}
          x2={dx * 5}
          y2={dy * 5}
          stroke="#1E7B45"
          strokeWidth={2}
          strokeLinecap="round"
        />
        <path
          d={`M${dx * 8},${dy * 8} L${dx * 3 - dy * 3},${dy * 3 + dx * 3} L${dx * 3 + dy * 3},${dy * 3 - dx * 3}Z`}
          fill="#1E7B45"
        />
      </svg>
      <span className="font-mono">{speed}</span>
    </div>
  );
}

export function PhysicsChips({ scan }: { scan: ScanRow }) {
  const t = useTranslations("Dash.physics");
  const f = makeFormat(useLocale());
  const checks = physicsChecks(scan);
  const summary = physicsSummary(scan);
  const fmt = (values: Record<string, number>) =>
    Object.fromEntries(
      Object.entries(values).map(([k, v]) => [
        k,
        k === "deg" ? f.num(v) : k === "elong" ? f.num(v, 1) : f.pct(v, 1),
      ]),
    );
  return (
    <div>
      {summary && (
        <p className="text-sm">
          {t(summary.message as never, fmt(summary.values) as never)}
        </p>
      )}
      <ul className="mt-2 flex flex-wrap gap-2">
        {checks.map((c) => (
          <li
            key={c.key}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
              c.pass
                ? "border-tier-clear/40 bg-tier-clear/10"
                : "border-tier-3/40 bg-tier-3/10",
            )}
          >
            {c.pass ? (
              <Check
                className="size-3.5 text-tier-clear-ink"
                aria-label={t("pass")}
              />
            ) : (
              <X className="size-3.5 text-tier-3-ink" aria-label={t("fail")} />
            )}
            {t(c.message as never, fmt(c.values) as never)}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function PassEmissions({ scan }: { scan: ScanRow }) {
  const t = useTranslations("Dash.emissions");
  const tc = useTranslations("Common");
  const f = makeFormat(useLocale());
  if (scan.tier === "T3")
    return <p className="text-sm text-muted-foreground">{t("t3")}</p>;
  if (scan.u10 !== null && scan.u10 < CALM_WIND_MS) {
    return (
      <p className="text-sm text-tier-3-ink">
        {t("calm", { wind: f.num(scan.u10, 1) })}
      </p>
    );
  }
  if (scan.qMed !== null) {
    return (
      <div>
        <p className="font-mono text-xl text-canopy">
          {t("rate", { tph: f.tph(scan.qMed) })}
        </p>
        {scan.qLo !== null && scan.qHi !== null && (
          <p className="text-sm text-foreground/80">
            {tc("range68", { lo: f.tph(scan.qLo), hi: f.tph(scan.qHi) })}
          </p>
        )}
        <p className="mt-1 text-xs text-muted-foreground">{tc("screening")}</p>
      </div>
    );
  }
  return <p className="text-sm text-muted-foreground">{t("noRate")}</p>;
}

function QuickVerification({
  site,
  scan,
  assignees,
}: {
  site: SiteInfo;
  scan: ScanRow;
  assignees: Assignee[];
}) {
  const t = useTranslations("Dash.action");
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const id = useId();
  return (
    <form
      className="mt-4 flex flex-wrap items-end gap-3 rounded-lg border border-signal/30 bg-signal/[0.05] p-3"
      action={(form) =>
        start(async () => {
          const r = await createAction(form);
          setMessage(
            r.ok
              ? r.message === "mailed"
                ? t("mailed")
                : t("saved")
              : t("error", { reason: r.error }),
          );
          if (r.ok) router.refresh();
        })
      }
    >
      <input type="hidden" name="siteId" value={site.id} />
      <input type="hidden" name="scanId" value={scan.id} />
      <input type="hidden" name="status" value="verification_requested" />
      <input type="hidden" name="slug" value={site.slug} />
      <input type="hidden" name="siteName" value={site.name} />
      <input type="hidden" name="locale" value={locale} />
      <label className="text-xs" htmlFor={`${id}-assignee`}>
        {t("assignee")}
        <select
          id={`${id}-assignee`}
          name="assignee"
          defaultValue=""
          className="mt-1 block w-48 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
        >
          <option value="">{t("unassigned")}</option>
          {assignees.map((a) => (
            <option key={a.userId} value={a.userId}>
              {a.name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs" htmlFor={`${id}-due`}>
        {t("due")}
        <input
          id={`${id}-due`}
          type="date"
          name="dueDate"
          className="mt-1 block rounded-md border border-input bg-background px-2 py-1 text-sm"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {t("requestVerification")}
      </button>
      {message && (
        <p role="status" className="w-full text-xs text-foreground/80">
          {message}
        </p>
      )}
    </form>
  );
}

export function EvidenceViewer({
  scan,
  site,
  control,
  canAct,
  assignees,
  action,
}: {
  scan: ScanRow;
  site: SiteInfo;
  control: { lat: number; lon: number } | null;
  canAct: boolean;
  assignees: Assignee[];
  action: ActionRow | null;
}) {
  const t = useTranslations("Dash.evidence");
  const tc = useTranslations("Common");
  const ta = useTranslations("Dash.action.status");
  const tf = useTranslations("Field");
  const f = makeFormat(useLocale());
  const [tab, setTab] = useState<Tab>(scan.tier === "T3" ? "rgb" : "mask");
  const [opacity, setOpacity] = useState(0.85);
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;
  const ev = scan.evidence;
  const wind =
    scan.windU !== null && scan.windV !== null
      ? { u: scan.windU, v: scan.windV }
      : null;
  const uid = useId();
  const flag: Flag = {
    slug: site.slug,
    date: scan.passDate,
    tier: scan.tier as Flag["tier"],
    surfaceKind: scan.surfaceKind,
    sceneScore: scan.sceneScore,
    qKgph: scan.qKgph,
    qMed: scan.qMed,
    qLo: scan.qLo,
    qHi: scan.qHi,
    u10: scan.u10,
    windU: scan.windU,
    windV: scan.windV,
    dB12: scan.dB12,
    dB11: scan.dB11,
    dVisNir: scan.dVisNir,
    evidence: ev
      ? {
          rgb: ev.rgb,
          mbmp: ev.mbmp,
          mask: ev.mask,
          chipBounds: ev.chipBounds,
          plume: ev.plume,
        }
      : null,
  };
  const open = action && !["resolved", "not_methane"].includes(action.status);

  return (
    <article
      id={`pass-${scan.passDate}`}
      className="scroll-mt-20 rounded-xl border border-border bg-card p-5"
    >
      <header className="flex flex-wrap items-center gap-3">
        <TierBadge tier={scan.tier as "T1" | "T2" | "T3"} long />
        <h3 className="font-heading text-lg font-semibold">
          {f.date(scan.passDate)}
        </h3>
        <span className="text-sm text-muted-foreground">
          {tc(`surfaceKind.${reasonKey(flag)}`)} ·{" "}
          {t("score", { score: f.num(scan.sceneScore, 3) })}
          {scan.satellite && <> · {scan.satellite}</>}
        </span>
        {action && (
          <a
            href="#actions"
            className="ml-auto rounded-full border border-input px-2.5 py-0.5 text-xs hover:bg-muted"
          >
            {ta(action.status)}
          </a>
        )}
      </header>

      <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,460px)_1fr]">
        <div>
          <div
            role="tablist"
            aria-label={t("tabsLabel")}
            className="flex gap-1 rounded-lg bg-muted p-1 text-xs"
          >
            {TABS.map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                id={`${uid}-${k}`}
                aria-selected={tab === k}
                aria-controls={`${uid}-panel`}
                onClick={() => setTab(k)}
                className={cn(
                  "flex-1 rounded-md px-2 py-1.5 transition-colors",
                  tab === k
                    ? "bg-background text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t(`tabs.${k}`)}
              </button>
            ))}
          </div>
          <div
            id={`${uid}-panel`}
            role="tabpanel"
            aria-labelledby={`${uid}-${tab}`}
            className="relative mt-2 aspect-square overflow-hidden rounded-lg border border-border bg-muted"
          >
            {!ev ? (
              <p className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
                {t("none")}
              </p>
            ) : tab === "map" ? (
              token ? (
                <SiteEvidenceMap
                  token={token}
                  site={site}
                  evidence={ev}
                  wind={wind}
                  control={control}
                  controlLabel={tf("controlShort")}
                  label={t("mapLabel", {
                    site: site.name,
                    date: f.date(scan.passDate),
                  })}
                />
              ) : (
                <EvidenceChip
                  flag={flag}
                  siteName={site.name}
                  controlKm={5}
                  className="size-full"
                />
              )
            ) : (
              <>
                <Image
                  src={tab === "mbmp" ? ev.mbmp : ev.rgb}
                  alt={t(tab === "mbmp" ? "alt.mbmp" : "alt.rgb", {
                    site: site.name,
                    date: f.date(scan.passDate),
                  })}
                  fill
                  unoptimized
                  sizes="460px"
                  className="object-cover"
                />
                {tab === "mask" && (
                  <Image
                    src={ev.mask}
                    alt={t("alt.mask", {
                      site: site.name,
                      date: f.date(scan.passDate),
                    })}
                    fill
                    unoptimized
                    sizes="460px"
                    className="object-cover"
                    style={{ opacity }}
                  />
                )}
                {wind && (
                  <WindBadge
                    u={wind.u}
                    v={wind.v}
                    speed={tf("wind", { wind: f.num(scan.u10 ?? 0, 1) })}
                    label={t("windLabel", { wind: f.num(scan.u10 ?? 0, 1) })}
                  />
                )}
              </>
            )}
          </div>
          {tab === "mask" && ev && (
            <label className="mt-3 flex items-center gap-3 text-xs text-muted-foreground">
              {t("opacity")}
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="flex-1 accent-[#1E7B45]"
              />
              <span className="w-10 text-right font-mono">
                {f.pct(opacity)}
              </span>
            </label>
          )}
        </div>

        <div className="space-y-5">
          <section>
            <h4 className="text-sm font-medium text-muted-foreground">
              {t("physics")}
            </h4>
            <div className="mt-2">
              <PhysicsChips scan={scan} />
            </div>
          </section>
          <section>
            <h4 className="text-sm font-medium text-muted-foreground">
              {t("emissions")}
            </h4>
            <div className="mt-2">
              <PassEmissions scan={scan} />
            </div>
          </section>
          {canAct && (scan.tier === "T1" || scan.tier === "T2") && !open && (
            <QuickVerification site={site} scan={scan} assignees={assignees} />
          )}
        </div>
      </div>
    </article>
  );
}
