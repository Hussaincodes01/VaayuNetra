"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useState } from "react";
import { saveMeasure } from "@/app/[locale]/dashboard/sustainability-actions";
import { makeFormat } from "@/lib/format";
import {
  CAPTURE_KINDS,
  MEASURE_KINDS,
  MEASURE_STATUSES,
  type MeasureKind,
  type MeasureRow,
} from "@/lib/sustainability";
import {
  AttachmentButton,
  Chip,
  Panel,
  Status,
  field,
  primaryButton,
  quietButton,
  useSubmit,
} from "./shared";

type SiteInfo = { id: string; slug: string; name: string };

const statusTone = {
  planned: "neutral",
  in_progress: "warn",
  done: "good",
  stopped: "alert",
} as const;

function MeasureForm({
  site,
  measure,
  defaultSharePct,
  onDone,
}: {
  site: SiteInfo;
  measure?: MeasureRow;
  defaultSharePct: number;
  onDone?: () => void;
}) {
  const t = useTranslations("Sustain.ledger");
  const id = useId();
  const { pending, message, run } = useSubmit();
  const [kind, setKind] = useState<MeasureKind>(
    measure?.kind ?? "gas_collection",
  );
  const capture = CAPTURE_KINDS.includes(kind);
  return (
    <form
      action={run(saveMeasure, onDone)}
      className="mt-4 grid gap-3 sm:grid-cols-2"
    >
      <input type="hidden" name="siteId" value={site.id} />
      {measure && <input type="hidden" name="id" value={measure.id} />}
      <label className="text-xs">
        {t("kind")}
        <select
          name="kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as MeasureKind)}
          className={field}
        >
          {MEASURE_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`kinds.${k}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        {t("status")}
        <select
          name="status"
          defaultValue={measure?.status ?? "planned"}
          className={field}
        >
          {MEASURE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs sm:col-span-2">
        {t("titleField")}
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={measure?.title}
          placeholder={t("titlePlaceholder")}
          className={field}
        />
      </label>
      <label className="text-xs">
        {t("agency")}
        <input
          name="agency"
          required
          maxLength={200}
          defaultValue={measure?.agency}
          placeholder={t("agencyPlaceholder")}
          className={field}
        />
      </label>
      <label className="text-xs">
        {t("start")}
        <input
          type="date"
          name="startDate"
          defaultValue={measure?.startDate ?? ""}
          className={field}
        />
      </label>
      {capture && (
        <label className="text-xs" htmlFor={`${id}-share`}>
          {t("captureShare")}
          <input
            id={`${id}-share`}
            type="number"
            name="captureSharePct"
            min={1}
            max={100}
            step={1}
            defaultValue={
              measure?.captureShare != null
                ? Math.round(measure.captureShare * 100)
                : defaultSharePct
            }
            className={field}
          />
        </label>
      )}
      <label className={`text-xs ${capture ? "" : "sm:col-span-2"}`}>
        {t("otherProgrammes")}
        <input
          name="otherProgrammes"
          maxLength={500}
          defaultValue={measure?.otherProgrammes ?? ""}
          placeholder={t("otherProgrammesPlaceholder")}
          className={field}
        />
      </label>
      <label className="text-xs sm:col-span-2">
        {t("note")}
        <textarea
          name="note"
          rows={2}
          maxLength={2000}
          defaultValue={measure?.note ?? ""}
          className={field}
        />
      </label>
      <label className="text-xs sm:col-span-2">
        {t("evidence")}
        <input
          type="file"
          name="evidence"
          accept=".pdf,image/*,.doc,.docx,.xlsx,.csv"
          className={field}
        />
      </label>
      <button type="submit" disabled={pending} className={primaryButton}>
        {measure ? t("save") : t("add")}
      </button>
      <div className="sm:col-span-2">
        <Status message={message} />
      </div>
    </form>
  );
}

function Effect({ m }: { m: MeasureRow }) {
  const t = useTranslations("Sustain.ledger");
  const f = makeFormat(useLocale());
  const e = m.effect;
  if (!e) return null;
  return (
    <div className="mt-3 rounded-md bg-muted p-3 text-xs">
      <p className="font-medium">{t("effectTitle")}</p>
      <p className="mt-1 font-mono">
        {t("effect", {
          bf: e.beforeFlags,
          bp: e.beforePasses,
          af: e.afterFlags,
          ap: e.afterPasses,
        })}
        {e.pValue !== null && <> · {t("p", { p: f.num(e.pValue, 3) })}</>}
      </p>
      <p className="mt-1 text-muted-foreground">{t("effectCaveat")}</p>
    </div>
  );
}

function MeasureItem({
  m,
  site,
  canAct,
  defaultSharePct,
}: {
  m: MeasureRow;
  site: SiteInfo;
  canAct: boolean;
  defaultSharePct: number;
}) {
  const t = useTranslations("Sustain.ledger");
  const f = makeFormat(useLocale());
  const [editing, setEditing] = useState(false);
  const capture = CAPTURE_KINDS.includes(m.kind);
  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={statusTone[m.status]}>{t(`statuses.${m.status}`)}</Chip>
        <span className="text-xs text-muted-foreground">
          {t(`kinds.${m.kind}`)}
        </span>
        {m.startDate && (
          <span className="ml-auto text-xs text-muted-foreground">
            {t("since", { date: f.date(m.startDate, "short") })}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm font-medium">{m.title}</p>
      <p className="text-xs text-muted-foreground">
        {t("by", { agency: m.agency })}
      </p>
      {capture && (
        <p className="mt-2 text-sm">
          {m.expectedTco2eYr !== null ? (
            <>
              <span className="font-mono text-canopy">
                {t("expected", { t: f.num(m.expectedTco2eYr) })}
              </span>{" "}
              <span className="text-xs text-muted-foreground">
                {t("expectedNote", {
                  pct: Math.round((m.captureShare ?? 0) * 100),
                })}
              </span>
            </>
          ) : (
            <span className="text-xs text-muted-foreground">
              {t("noExpected")}
            </span>
          )}
        </p>
      )}
      {m.otherProgrammes && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("alsoClaimed", { programmes: m.otherProgrammes })}
        </p>
      )}
      {m.note && (
        <p className="mt-2 text-sm whitespace-pre-line text-foreground/85">
          {m.note}
        </p>
      )}
      <Effect m={m} />
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {m.evidenceUrl && canAct && <AttachmentButton path={m.evidenceUrl} />}
        {canAct && (
          <button
            type="button"
            aria-expanded={editing}
            onClick={() => setEditing((v) => !v)}
            className={quietButton}
          >
            {t("edit")}
          </button>
        )}
      </div>
      {canAct && editing && (
        <MeasureForm
          site={site}
          measure={m}
          defaultSharePct={defaultSharePct}
          onDone={() => setEditing(false)}
        />
      )}
    </li>
  );
}

/** The mitigation ledger: what each agency committed to at this site, with expected and checked effects. */
export function MeasuresLedger({
  site,
  measures,
  canAct,
  defaultShare,
}: {
  site: SiteInfo;
  measures: MeasureRow[];
  canAct: boolean;
  defaultShare: number;
}) {
  const t = useTranslations("Sustain.ledger");
  const pct = Math.round(defaultShare * 100);
  return (
    <Panel id="ledger" title={t("title")} intro={t("intro")}>
      {measures.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {measures.map((m) => (
            <MeasureItem
              key={m.id}
              m={m}
              site={site}
              canAct={canAct}
              defaultSharePct={pct}
            />
          ))}
        </ul>
      )}
      {canAct && (
        <details className="mt-5 rounded-lg border border-dashed border-input p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {t("new")}
          </summary>
          <MeasureForm site={site} defaultSharePct={pct} />
        </details>
      )}
    </Panel>
  );
}
