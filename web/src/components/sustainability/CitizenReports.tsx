"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { updateReport } from "@/app/[locale]/dashboard/sustainability-actions";
import { Link } from "@/i18n/navigation";
import type { Assignee } from "@/lib/dashboard-shared";
import { makeFormat } from "@/lib/format";
import type { ReportRow } from "@/lib/sustainability";
import {
  Chip,
  Panel,
  Status,
  field,
  primaryButton,
  quietButton,
  useSubmit,
} from "./shared";

function ReportItem({
  r,
  assignees,
  canAct,
  showSite,
  now,
}: {
  r: ReportRow;
  assignees: Assignee[];
  canAct: boolean;
  showSite: boolean;
  now: number;
}) {
  const t = useTranslations("Sustain.reports");
  const tp = useTranslations("Places");
  const f = makeFormat(useLocale());
  const { pending, message, run } = useSubmit();
  const [closing, setClosing] = useState(false);
  const overdue = r.status === "open" && Date.parse(r.dueAt) < now;
  const who = assignees.find((a) => a.userId === r.assignee)?.name;
  const site = r.siteSlug
    ? tp.has(`sites.${r.siteSlug}` as never)
      ? tp(`sites.${r.siteSlug}` as never)
      : r.siteSlug
    : null;
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          tone={r.status === "closed" ? "good" : overdue ? "alert" : "warn"}
        >
          {r.status === "closed"
            ? t("closed")
            : overdue
              ? t("overdue")
              : t("open")}
        </Chip>
        <span className="font-medium">{t(`kinds.${r.kind}`)}</span>
        <span className="font-mono text-xs text-muted-foreground">
          {f.dateTime(r.reportedAt)}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {r.status === "closed" && r.closedAt
            ? t("closedAt", { date: f.dateTime(r.closedAt) })
            : t("due", { date: f.dateTime(r.dueAt) })}
        </span>
      </div>
      {showSite && (
        <p className="mt-1 text-xs text-muted-foreground">
          {site && r.siteSlug ? (
            <Link
              href={`/dashboard/sites/${r.siteSlug}#reports`}
              className="text-leaf hover:underline"
            >
              {t("near", { site, m: f.num(r.distM ?? 0) })}
            </Link>
          ) : (
            t("unrouted")
          )}
        </p>
      )}
      {!showSite && r.distM !== null && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("distance", { m: f.num(r.distM) })}
        </p>
      )}
      {r.description && (
        <p className="mt-2 whitespace-pre-line">{r.description}</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {t("source", { source: r.source })} ·{" "}
        {who ? t("assignee", { name: who }) : t("notAssigned")}
        {r.photoUrl && (
          <>
            {" · "}
            <a
              href={r.photoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-leaf underline"
            >
              {t("photo")}
            </a>
          </>
        )}
      </p>
      {r.closingNote && (
        <p className="mt-2 text-xs">{t("done", { note: r.closingNote })}</p>
      )}
      {canAct && r.status === "open" && (
        <div className="mt-3 space-y-3">
          <form
            action={run(updateReport)}
            className="flex flex-wrap items-end gap-2"
          >
            <input type="hidden" name="id" value={r.id} />
            <label className="text-xs">
              {t("assignTo")}
              <select
                name="assignee"
                defaultValue={r.assignee ?? ""}
                className={field}
              >
                <option value="">{t("unassigned")}</option>
                {assignees.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" disabled={pending} className={quietButton}>
              {t("assign")}
            </button>
            <button
              type="button"
              aria-expanded={closing}
              onClick={() => setClosing((v) => !v)}
              className={quietButton}
            >
              {t("close")}
            </button>
          </form>
          {closing && (
            <form
              action={run(updateReport, () => setClosing(false))}
              className="grid gap-2"
            >
              <input type="hidden" name="id" value={r.id} />
              <input type="hidden" name="status" value="closed" />
              <label className="text-xs">
                {t("closingNote")}
                <textarea
                  name="closingNote"
                  rows={2}
                  required
                  maxLength={2000}
                  className={field}
                />
              </label>
              <label className="text-xs">
                {t("closingPhoto")}
                <input
                  type="file"
                  name="closingPhoto"
                  accept="image/*"
                  className={field}
                />
              </label>
              <button
                type="submit"
                disabled={pending}
                className={primaryButton}
              >
                {t("confirmClose")}
              </button>
            </form>
          )}
        </div>
      )}
      <Status message={message} />
    </li>
  );
}

/** Citizen reports from partners (EcoSathi), with a deadline and the agency's closing note. */
export function CitizenReports({
  reports,
  assignees,
  canAct,
  showSite = false,
  slaHours,
}: {
  reports: ReportRow[];
  assignees: Assignee[];
  canAct: boolean;
  showSite?: boolean;
  slaHours: number;
}) {
  const t = useTranslations("Sustain.reports");
  // Rendered once per request; the deadline badge does not need a ticking clock.
  const [now] = useState(() => Date.now());
  return (
    <Panel
      id="reports"
      title={t("title")}
      intro={t("intro", { hours: slaHours })}
    >
      {reports.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {reports.map((r) => (
            <ReportItem
              key={r.id}
              r={r}
              assignees={assignees}
              canAct={canAct}
              showSite={showSite}
              now={now}
            />
          ))}
        </ul>
      )}
    </Panel>
  );
}
