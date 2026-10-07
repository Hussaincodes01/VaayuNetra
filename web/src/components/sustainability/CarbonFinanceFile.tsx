"use client";

import { Check, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { addMeterReading } from "@/app/[locale]/dashboard/sustainability-actions";
import { makeFormat } from "@/lib/format";
import {
  CAPTURE_KINDS,
  type MeasureRow,
  type MeterRow,
} from "@/lib/sustainability";
import {
  AttachmentButton,
  Panel,
  Status,
  field,
  primaryButton,
  useSubmit,
} from "./shared";

const ACM0001 =
  "https://cdm.unfccc.int/methodologies/DB/D44X8FH8SFCXREE6037AXJSBGGFVDO/view.html";

function Step({
  done,
  children,
}: {
  done: boolean;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-2 text-sm">
      {done ? (
        <Check
          className="mt-0.5 size-4 shrink-0 text-tier-clear-ink"
          aria-hidden
        />
      ) : (
        <X
          className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          aria-hidden
        />
      )}
      <span>{children}</span>
    </li>
  );
}

/**
 * What a carbon-finance file needs at this site, and the metered readings it holds. Metered methane
 * is the only verified reduction; the database refuses readings until an emission is confirmed.
 */
export function CarbonFinanceFile({
  siteId,
  confirmed,
  minMeanKgph,
  measures,
  meters,
  gwp100,
  canAct,
}: {
  siteId: string;
  confirmed: boolean;
  minMeanKgph: number | null;
  measures: MeasureRow[];
  meters: MeterRow[];
  gwp100: number;
  canAct: boolean;
}) {
  const t = useTranslations("Sustain.finance");
  const f = makeFormat(useLocale());
  const { pending, message, run } = useSubmit();
  const capture = measures.filter((m) => CAPTURE_KINDS.includes(m.kind));
  const metered = meters.reduce((s, m) => s + m.ch4DestroyedT, 0);
  return (
    <Panel id="finance" title={t("title")} intro={t("intro")}>
      <ul className="mt-4 space-y-2">
        <Step done={confirmed}>
          {confirmed ? t("confirmed") : t("notConfirmed")}
        </Step>
        <Step done={(minMeanKgph ?? 0) > 0}>
          {(minMeanKgph ?? 0) > 0
            ? t("baseline", { kgph: f.num(minMeanKgph ?? 0) })
            : t("noBaseline")}
        </Step>
        <Step done={capture.length > 0}>
          {capture.length > 0
            ? t("captureMeasure", { n: capture.length })
            : t("noCapture")}
        </Step>
        <Step done={meters.length > 0}>
          {meters.length > 0
            ? t("metered", {
                n: meters.length,
                ch4: f.num(metered, 1),
                co2e: f.num(metered * gwp100),
              })
            : t("noMeter")}
        </Step>
        <li className="text-xs text-muted-foreground">
          {t.rich("methodology", {
            link: (chunks) => (
              <a
                href={ACM0001}
                target="_blank"
                rel="noopener"
                className="text-leaf underline"
              >
                {chunks}
              </a>
            ),
          })}
        </li>
      </ul>

      {meters.length > 0 && (
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{t("readings")}</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">{t("period")}</th>
                <th className="py-1 pr-3 font-medium">{t("ch4")}</th>
                <th className="py-1 pr-3 font-medium">{t("co2e")}</th>
                <th className="py-1 pr-3 font-medium">{t("meter")}</th>
                <th className="py-1 font-medium">{t("document")}</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {meters.map((m) => (
                <tr key={m.id} className="border-t border-border">
                  <td className="py-1 pr-3">
                    {f.date(m.periodStart, "short")} –{" "}
                    {f.date(m.periodEnd, "short")}
                  </td>
                  <td className="py-1 pr-3">{f.num(m.ch4DestroyedT, 1)}</td>
                  <td className="py-1 pr-3">
                    {f.num(m.ch4DestroyedT * gwp100)}
                  </td>
                  <td className="py-1 pr-3">
                    {m.meterId}
                    {m.verifiedBy ? ` · ${m.verifiedBy}` : ""}
                  </td>
                  <td className="py-1 font-sans">
                    {m.documentUrl && canAct ? (
                      <AttachmentButton path={m.documentUrl} />
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canAct && confirmed && (
        <details className="mt-5 rounded-lg border border-dashed border-input p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {t("add")}
          </summary>
          <form
            action={run(addMeterReading)}
            className="mt-4 grid gap-3 sm:grid-cols-2"
          >
            <input type="hidden" name="siteId" value={siteId} />
            <label className="text-xs">
              {t("from")}
              <input
                type="date"
                name="periodStart"
                required
                className={field}
              />
            </label>
            <label className="text-xs">
              {t("to")}
              <input type="date" name="periodEnd" required className={field} />
            </label>
            <label className="text-xs">
              {t("ch4Field")}
              <input
                type="number"
                name="ch4DestroyedT"
                min={0.001}
                step="any"
                required
                className={field}
              />
            </label>
            <label className="text-xs">
              {t("meterField")}
              <input
                name="meterId"
                required
                maxLength={100}
                className={field}
              />
            </label>
            <label className="text-xs">
              {t("measure")}
              <select name="measureId" defaultValue="" className={field}>
                <option value="">—</option>
                {capture.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.title}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              {t("verifiedBy")}
              <input name="verifiedBy" maxLength={200} className={field} />
            </label>
            <label className="text-xs sm:col-span-2">
              {t("document")}
              <input
                type="file"
                name="document"
                accept=".pdf,image/*,.xlsx,.csv"
                className={field}
              />
            </label>
            <button type="submit" disabled={pending} className={primaryButton}>
              {t("save")}
            </button>
            <div className="sm:col-span-2">
              <Status message={message} />
            </div>
          </form>
        </details>
      )}
    </Panel>
  );
}
