"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId } from "react";
import {
  importDiversionCsv,
  saveDiversion,
} from "@/app/[locale]/dashboard/sustainability-actions";
import { makeFormat } from "@/lib/format";
import {
  diversionPerTonne,
  type DiversionAssumptions,
  type DiversionRow,
} from "@/lib/sustainability";
import { Panel, Status, field, primaryButton, useSubmit } from "./shared";

/** Wet waste kept out of the landfills, by city and month, with the modelled avoided tonnes. */
export function DiversionTracker({
  rows,
  cities,
  assumptions,
  canAct,
}: {
  rows: DiversionRow[];
  cities: string[];
  assumptions: DiversionAssumptions;
  canAct: boolean;
}) {
  const t = useTranslations("Sustain.diversion");
  const f = makeFormat(useLocale());
  const id = useId();
  const one = useSubmit();
  const csv = useSubmit();
  const per = diversionPerTonne(assumptions);
  return (
    <Panel id="diversion" title={t("title")} intro={t("intro")}>
      <p className="mt-3 text-xs text-muted-foreground">
        {t("factors", {
          compost: f.num(per.composted, 2),
          biogas: f.num(per.biogas, 2),
          doc: f.num(assumptions.docFood, 2),
          docf: f.num(assumptions.docf, 1),
          mcf: f.num(assumptions.mcf, 1),
          fch4: f.num(assumptions.f, 1),
          ox: f.num(assumptions.ox, 1),
          cch4: f.num(assumptions.compostCh4KgPerT, 1),
          cn2o: f.num(assumptions.compostN2oKgPerT, 2),
          adch4: f.num(assumptions.adCh4KgPerT, 1),
        })}
      </p>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <caption className="sr-only">{t("title")}</caption>
            <thead className="text-muted-foreground">
              <tr>
                <th className="py-1 pr-3 font-medium">{t("city")}</th>
                <th className="py-1 pr-3 font-medium">{t("month")}</th>
                <th className="py-1 pr-3 text-right font-medium">
                  {t("composted")}
                </th>
                <th className="py-1 pr-3 text-right font-medium">
                  {t("biogas")}
                </th>
                <th className="py-1 pr-3 text-right font-medium">
                  {t("avoided")}
                </th>
                <th className="py-1 font-medium">{t("source")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.city}-${r.month}`}
                  className="border-t border-border"
                >
                  <td className="py-1 pr-3">{r.city}</td>
                  <td className="py-1 pr-3 font-mono">{r.month.slice(0, 7)}</td>
                  <td className="py-1 pr-3 text-right font-mono">
                    {f.num(r.compostedT)}
                  </td>
                  <td className="py-1 pr-3 text-right font-mono">
                    {f.num(r.biogasT)}
                  </td>
                  <td className="py-1 pr-3 text-right font-mono text-canopy">
                    {f.num(r.avoidedTco2e)}
                  </td>
                  <td className="py-1">{r.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="mt-2 text-xs text-muted-foreground">{t("modelled")}</p>
      {canAct && (
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <details className="rounded-lg border border-dashed border-input p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t("addMonth")}
            </summary>
            <form
              action={one.run(saveDiversion)}
              className="mt-4 grid gap-3 sm:grid-cols-2"
            >
              <label className="text-xs">
                {t("city")}
                <input
                  name="city"
                  required
                  list={`${id}-cities`}
                  maxLength={100}
                  className={field}
                />
              </label>
              <label className="text-xs">
                {t("month")}
                <input type="month" name="month" required className={field} />
              </label>
              <label className="text-xs">
                {t("composted")}
                <input
                  type="number"
                  name="compostedT"
                  min={0}
                  step="any"
                  className={field}
                />
              </label>
              <label className="text-xs">
                {t("biogas")}
                <input
                  type="number"
                  name="biogasT"
                  min={0}
                  step="any"
                  className={field}
                />
              </label>
              <label className="text-xs sm:col-span-2">
                {t("source")}
                <input
                  name="source"
                  required
                  maxLength={200}
                  placeholder={t("sourcePlaceholder")}
                  className={field}
                />
              </label>
              <button
                type="submit"
                disabled={one.pending}
                className={primaryButton}
              >
                {t("save")}
              </button>
              <div className="sm:col-span-2">
                <Status message={one.message} />
              </div>
            </form>
          </details>
          <details className="rounded-lg border border-dashed border-input p-4">
            <summary className="cursor-pointer text-sm font-medium">
              {t("importCsv")}
            </summary>
            <form
              action={csv.run(importDiversionCsv)}
              className="mt-4 grid gap-3"
            >
              <p className="text-xs text-muted-foreground">{t("csvFormat")}</p>
              <label className="text-xs">
                {t("city")}
                <input
                  name="city"
                  required
                  list={`${id}-cities`}
                  maxLength={100}
                  className={field}
                />
              </label>
              <label className="text-xs">
                {t("source")}
                <input
                  name="source"
                  required
                  maxLength={200}
                  placeholder={t("sourcePlaceholder")}
                  className={field}
                />
              </label>
              <label className="text-xs">
                {t("file")}
                <input
                  type="file"
                  name="file"
                  accept=".csv,text/csv"
                  required
                  className={field}
                />
              </label>
              <button
                type="submit"
                disabled={csv.pending}
                className={primaryButton}
              >
                {t("import")}
              </button>
              <Status message={csv.message} />
            </form>
          </details>
          <datalist id={`${id}-cities`}>
            {cities.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
        </div>
      )}
    </Panel>
  );
}
