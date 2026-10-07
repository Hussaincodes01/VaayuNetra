"use client";

import { useLocale, useTranslations } from "next-intl";
import { saveRemediation } from "@/app/[locale]/dashboard/sustainability-actions";
import { makeFormat } from "@/lib/format";
import type { RemediationRow } from "@/lib/sustainability";
import { Panel, Status, field, primaryButton, useSubmit } from "./shared";

/** Swachh Bharat Mission-Urban 2.0 biomining progress at the site, as reported by the city. */
export function RemediationCard({
  siteId,
  rows,
  canAct,
}: {
  siteId: string;
  rows: RemediationRow[];
  canAct: boolean;
}) {
  const t = useTranslations("Sustain.remediation");
  const f = makeFormat(useLocale());
  const { pending, message, run } = useSubmit();
  const latest = rows[0];
  const share =
    latest?.legacyTonnesTotal && latest.legacyTonnesTotal > 0
      ? latest.tonnesProcessed / latest.legacyTonnesTotal
      : null;
  return (
    <Panel id="remediation" title={t("title")} intro={t("intro")}>
      {latest ? (
        <div className="mt-3">
          <p className="text-sm">
            {t("processed", {
              done: f.num(latest.tonnesProcessed),
              total:
                latest.legacyTonnesTotal !== null
                  ? f.num(latest.legacyTonnesTotal)
                  : "—",
            })}
          </p>
          {share !== null && (
            <div
              role="meter"
              aria-label={t("progress")}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(share * 100)}
              className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted"
            >
              <div
                className="h-full bg-leaf"
                style={{ width: `${Math.min(100, share * 100)}%` }}
              />
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            {latest.areaReclaimedHa !== null &&
              `${t("area", { ha: f.num(latest.areaReclaimedHa, 1) })} · `}
            {t("asOf", {
              date: f.date(latest.asOf, "short"),
              source: latest.source,
            })}
          </p>
          {rows.length > 1 && (
            <ul className="mt-3 space-y-1 font-mono text-xs text-muted-foreground">
              {rows.slice(1, 6).map((r) => (
                <li key={r.id}>
                  {f.date(r.asOf, "short")}: {f.num(r.tonnesProcessed)} t
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{t("none")}</p>
      )}
      {canAct && (
        <details className="mt-4 rounded-lg border border-dashed border-input p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {t("add")}
          </summary>
          <form
            action={run(saveRemediation)}
            className="mt-4 grid gap-3 sm:grid-cols-2"
          >
            <input type="hidden" name="siteId" value={siteId} />
            <label className="text-xs">
              {t("asOfField")}
              <input type="date" name="asOf" required className={field} />
            </label>
            <label className="text-xs">
              {t("totalField")}
              <input
                type="number"
                name="legacyTonnesTotal"
                min={0}
                step="any"
                className={field}
              />
            </label>
            <label className="text-xs">
              {t("processedField")}
              <input
                type="number"
                name="tonnesProcessed"
                min={0}
                step="any"
                required
                className={field}
              />
            </label>
            <label className="text-xs">
              {t("areaField")}
              <input
                type="number"
                name="areaReclaimedHa"
                min={0}
                step="any"
                className={field}
              />
            </label>
            <label className="text-xs sm:col-span-2">
              {t("sourceField")}
              <input
                name="source"
                required
                maxLength={200}
                placeholder={t("sourcePlaceholder")}
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
