"use client";

import { Battery, Radio } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import {
  acknowledgeSensorAlert,
  createLiveNode,
} from "@/app/[locale]/dashboard/sensor-actions";
import {
  Chip,
  Status,
  field,
  primaryButton,
  quietButton,
  useSubmit,
} from "@/components/sustainability/shared";
import { makeFormat } from "@/lib/format";
import type { SensorAlertView, SensorNodeView } from "@/lib/sensor-data";
import { SensorSparkline } from "./SensorSparkline";

const tone = {
  rise: "alert",
  warning: "warn",
  normal: "good",
  quiet: "neutral",
} as const;

function NodeCard({
  n,
  rise,
  now,
}: {
  n: SensorNodeView;
  rise: number;
  now: number;
}) {
  const t = useTranslations("Sensors");
  const f = makeFormat(useLocale());
  const bg = n.role === "background";
  return (
    <li className="rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-sm font-medium">{n.code}</span>
        <span className="text-xs text-muted-foreground">
          {t(`roles.${n.role}`)}
        </span>
        {n.mode === "simulated" && <Chip>{t("simulated")}</Chip>}
        <span className="ml-auto">
          <Chip tone={tone[n.status]}>{t(`status.${n.status}`)}</Chip>
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <dt className="text-muted-foreground">
            {bg ? t("level") : t("excess")}
          </dt>
          <dd className="font-mono text-sm">
            {bg
              ? n.latestPpm !== null
                ? `${f.num(n.latestPpm, 1)} ppm`
                : "—"
              : n.excessNow !== null
                ? `${f.num(n.excessNow, 1)} ppm`
                : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">
            {bg ? t("role") : t("max24")}
          </dt>
          <dd className="font-mono text-sm">
            {bg
              ? t("baseline")
              : n.max24h !== null
                ? `${f.num(n.max24h, 1)} ppm`
                : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("pRise")}</dt>
          <dd className="font-mono text-sm">
            {bg || n.pRise === null ? "—" : f.pct(n.pRise)}
          </dd>
        </div>
      </dl>
      <div className="mt-2">
        <SensorSparkline
          points={n.series}
          rise={bg ? null : rise}
          now={now}
          label={t("chartLabel", { code: n.code })}
        />
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <Radio className="size-3.5" aria-hidden />
          {n.lastSeen
            ? t("seen", { when: f.dateTime(n.lastSeen) })
            : t("neverSeen")}
        </span>
        {n.batteryV !== null && (
          <span className="inline-flex items-center gap-1">
            <Battery className="size-3.5" aria-hidden />
            {f.num(n.batteryV, 2)} V
          </span>
        )}
      </p>
    </li>
  );
}

export function SiteNetwork({
  site,
  nodes,
  rise,
  now,
}: {
  site: { slug: string; name: string };
  nodes: SensorNodeView[];
  rise: number;
  now: number;
}) {
  return (
    <ul
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3"
      aria-label={site.name}
    >
      {nodes.map((n) => (
        <NodeCard key={n.id} n={n} rise={rise} now={now} />
      ))}
    </ul>
  );
}

function AlertItem({ a, canAct }: { a: SensorAlertView; canAct: boolean }) {
  const t = useTranslations("Sensors");
  const f = makeFormat(useLocale());
  const { pending, message, run } = useSubmit();
  const kindTone = {
    forecast_rise: "warn",
    threshold: "alert",
    lel: "alert",
    offline: "neutral",
  } as const;
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={a.closedAt ? "neutral" : kindTone[a.kind]}>
          {t(`kinds.${a.kind}`)}
        </Chip>
        <span className="font-mono text-xs">{a.node}</span>
        {a.mode === "simulated" && <Chip>{t("simulated")}</Chip>}
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {f.dateTime(a.openedAt)}
        </span>
      </div>
      <p className="mt-1 text-xs text-foreground/85">
        {a.kind === "forecast_rise" &&
          t("warnText", { p: f.pct(a.pRise ?? 0) }) +
            (a.outcome
              ? ` ${t(`outcome.${a.outcome === "rise" ? "rise" : "noRise"}`)}`
              : "")}
        {a.kind === "threshold" &&
          t("riseText", { ppm: f.num(a.peakPpm ?? 0, 1) }) +
            ` ${a.leadMin !== null ? t("warnedAhead", { min: f.num(a.leadMin) }) : t("notWarned")}`}
        {a.kind === "lel" && t("lelText", { ppm: f.num(a.peakPpm ?? 0) })}
        {a.kind === "offline" && t("offlineText")}
        {a.closedAt && ` ${t("closed", { when: f.dateTime(a.closedAt) })}`}
      </p>
      {canAct && !a.closedAt && !a.acknowledgedAt && (
        <form action={run(acknowledgeSensorAlert)} className="mt-2">
          <input type="hidden" name="id" value={a.id} />
          <button type="submit" disabled={pending} className={quietButton}>
            {t("acknowledge")}
          </button>
        </form>
      )}
      {a.acknowledgedAt && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("acknowledged", { when: f.dateTime(a.acknowledgedAt) })}
        </p>
      )}
      <Status message={message} />
    </li>
  );
}

export function SensorAlerts({
  alerts,
  canAct,
}: {
  alerts: SensorAlertView[];
  canAct: boolean;
}) {
  const t = useTranslations("Sensors");
  const [all, setAll] = useState(false);
  const shown = all
    ? alerts
    : alerts
        .filter((a) => !a.closedAt)
        .concat(alerts.filter((a) => a.closedAt).slice(0, 5));
  return (
    <div>
      {alerts.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("noAlerts")}</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((a) => (
            <AlertItem key={a.id} a={a} canAct={canAct} />
          ))}
        </ul>
      )}
      {alerts.length > shown.length && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className={`mt-3 ${quietButton}`}
        >
          {t("showAll", { n: alerts.length })}
        </button>
      )}
    </div>
  );
}

export function AddLiveNode({
  sites,
}: {
  sites: { id: string; name: string }[];
}) {
  const t = useTranslations("Sensors.add");
  const { pending, message, run } = useSubmit();
  const [key, setKey] = useState<string | null>(null);
  return (
    <details className="rounded-lg border border-dashed border-input p-4">
      <summary className="cursor-pointer text-sm font-medium">
        {t("title")}
      </summary>
      <p className="mt-2 text-xs text-muted-foreground">{t("intro")}</p>
      <form
        action={run(async (form) => {
          const r = await createLiveNode(form);
          if (r.ok && r.message?.startsWith("key:")) setKey(r.message.slice(4));
          return r.ok ? { ok: true } : r;
        })}
        className="mt-3 grid gap-3 sm:grid-cols-3"
      >
        <label className="text-xs">
          {t("site")}
          <select name="siteId" className={field}>
            {sites.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs">
          {t("code")}
          <input
            name="code"
            required
            placeholder="DEO-L1"
            maxLength={24}
            className={field}
          />
        </label>
        <label className="text-xs">
          {t("role")}
          <select name="role" className={field}>
            <option value="perimeter">{t("roles.perimeter")}</option>
            <option value="community">{t("roles.community")}</option>
            <option value="background">{t("roles.background")}</option>
          </select>
        </label>
        <label className="text-xs">
          {t("lat")}
          <input
            name="lat"
            type="number"
            step="any"
            required
            className={field}
          />
        </label>
        <label className="text-xs">
          {t("lon")}
          <input
            name="lon"
            type="number"
            step="any"
            required
            className={field}
          />
        </label>
        <label className="text-xs">
          {t("sensor")}
          <input
            name="sensor"
            defaultValue="TGS2611-E00"
            maxLength={60}
            className={field}
          />
        </label>
        <button type="submit" disabled={pending} className={primaryButton}>
          {t("create")}
        </button>
        <div className="sm:col-span-3">
          <Status message={message} />
        </div>
      </form>
      {key && (
        <div className="mt-3 rounded-md bg-sprout p-3 text-sm text-canopy">
          <p className="font-medium">{t("keyOnce")}</p>
          <code className="mt-1 block font-mono break-all">{key}</code>
        </div>
      )}
    </details>
  );
}
