"use client";

import { Paperclip } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useId, useState, useTransition } from "react";
import {
  attachmentLink,
  createAction,
  updateAction,
} from "@/app/[locale]/dashboard/actions";
import { useRouter } from "@/i18n/navigation";
import {
  ACTION_FLOW,
  type ActionRow,
  type Assignee,
  type ScanRow,
} from "@/lib/dashboard-shared";
import { makeFormat } from "@/lib/format";

type SiteInfo = { id: string; slug: string; name: string };

const field =
  "mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";

function useSubmit() {
  const t = useTranslations("Dash.action");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run =
    (
      fn: (
        form: FormData,
      ) => Promise<{ ok: boolean; error?: string; message?: string }>,
    ) =>
    (form: FormData) =>
      start(async () => {
        const r = await fn(form);
        setMessage(
          r.ok
            ? r.message === "mailed"
              ? t("mailed")
              : t("saved")
            : r.error === "transition"
              ? t("transitionError")
              : t("error", { reason: r.error ?? "" }),
        );
        if (r.ok) router.refresh();
      });
  return { pending, message, run };
}

function Hidden({ site, locale }: { site: SiteInfo; locale: string }) {
  return (
    <>
      <input type="hidden" name="slug" value={site.slug} />
      <input type="hidden" name="siteName" value={site.name} />
      <input type="hidden" name="locale" value={locale} />
    </>
  );
}

function ActionItem({
  action,
  site,
  scans,
  assignees,
  canAct,
}: {
  action: ActionRow;
  site: SiteInfo;
  scans: ScanRow[];
  assignees: Assignee[];
  canAct: boolean;
}) {
  const t = useTranslations("Dash.action");
  const locale = useLocale();
  const f = makeFormat(locale);
  const id = useId();
  const { pending, message, run } = useSubmit();
  const [editing, setEditing] = useState(false);
  const scan = scans.find((s) => s.id === action.scanId);
  const who = assignees.find((a) => a.userId === action.assignee)?.name;
  const next = ACTION_FLOW[action.status];

  const openAttachment = async () => {
    if (!action.attachmentUrl) return;
    const url = await attachmentLink(action.attachmentUrl);
    if (url) window.open(url, "_blank", "noopener");
  };

  return (
    <li className="rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-signal/15 px-2.5 py-0.5 text-xs font-medium text-signal">
          {t(`status.${action.status}`)}
        </span>
        <span className="text-sm">
          {scan
            ? t("forPass", { date: f.date(scan.passDate), tier: scan.tier })
            : t("siteWide")}
        </span>
        <span className="ml-auto text-xs text-muted-foreground">
          {t("opened", { date: f.dateTime(action.createdAt) })}
        </span>
      </div>
      <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-xs text-muted-foreground">{t("assignee")}</dt>
          <dd>{who ?? t("unassigned")}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("due")}</dt>
          <dd className="font-mono">
            {action.dueDate ? f.date(action.dueDate, "short") : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">{t("attachment")}</dt>
          <dd>
            {action.attachmentUrl && canAct ? (
              <button
                type="button"
                onClick={openAttachment}
                className="inline-flex items-center gap-1 text-signal hover:underline"
              >
                <Paperclip className="size-3.5" aria-hidden />{" "}
                {t("openAttachment")}
              </button>
            ) : action.attachmentUrl ? (
              t("hasAttachment")
            ) : (
              "—"
            )}
          </dd>
        </div>
      </dl>
      {action.note && (
        <p className="mt-2 text-sm whitespace-pre-line text-foreground/85">
          {action.note}
        </p>
      )}

      {canAct && (
        <div className="mt-3 flex flex-wrap gap-2">
          {next.map((s) => (
            <form key={s} action={run(updateAction)}>
              <input type="hidden" name="id" value={action.id} />
              <input type="hidden" name="status" value={s} />
              <Hidden site={site} locale={locale} />
              <button
                type="submit"
                disabled={pending}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
              >
                {t("moveTo", { status: t(`status.${s}`) })}
              </button>
            </form>
          ))}
          <button
            type="button"
            aria-expanded={editing}
            aria-controls={`${id}-edit`}
            onClick={() => setEditing((v) => !v)}
            className="rounded-md border border-input px-3 py-1.5 text-xs hover:bg-muted"
          >
            {t("edit")}
          </button>
        </div>
      )}
      {canAct && editing && (
        <form
          id={`${id}-edit`}
          action={run(updateAction)}
          className="mt-3 grid gap-3 sm:grid-cols-2"
        >
          <input type="hidden" name="id" value={action.id} />
          <Hidden site={site} locale={locale} />
          <label className="text-xs">
            {t("assignee")}
            <select
              name="assignee"
              defaultValue={action.assignee ?? ""}
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
          <label className="text-xs">
            {t("due")}
            <input
              type="date"
              name="dueDate"
              defaultValue={action.dueDate ?? ""}
              className={field}
            />
          </label>
          <label className="text-xs sm:col-span-2">
            {t("note")}
            <textarea
              name="note"
              rows={3}
              defaultValue={action.note ?? ""}
              maxLength={2000}
              className={field}
            />
          </label>
          <label className="text-xs sm:col-span-2">
            {t("attachment")}
            <input
              type="file"
              name="attachment"
              accept=".pdf,image/*,.doc,.docx,.xlsx,.csv"
              className={field}
            />
          </label>
          <button
            type="submit"
            disabled={pending}
            className="w-fit rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
          >
            {t("save")}
          </button>
        </form>
      )}
      {message && (
        <p role="status" className="mt-2 text-xs text-foreground/80">
          {message}
        </p>
      )}
    </li>
  );
}

export function ActionPanel({
  site,
  actions,
  scans,
  assignees,
  canAct,
}: {
  site: SiteInfo;
  actions: ActionRow[];
  scans: ScanRow[];
  assignees: Assignee[];
  canAct: boolean;
}) {
  const t = useTranslations("Dash.action");
  const locale = useLocale();
  const f = makeFormat(locale);
  const { pending, message, run } = useSubmit();
  const flagged = scans
    .filter((s) => s.tier === "T1" || s.tier === "T2")
    .reverse();

  return (
    <section
      id="actions"
      aria-labelledby="actions-title"
      className="scroll-mt-20 rounded-xl border border-border bg-card p-5"
    >
      <h2 id="actions-title" className="font-heading text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">{t("flow")}</p>
      {!canAct && (
        <p className="mt-2 text-sm text-muted-foreground">{t("readOnly")}</p>
      )}
      {actions.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {actions.map((a) => (
            <ActionItem
              key={a.id}
              action={a}
              site={site}
              scans={scans}
              assignees={assignees}
              canAct={canAct}
            />
          ))}
        </ul>
      )}
      {canAct && (
        <details className="mt-5 rounded-lg border border-dashed border-input p-4">
          <summary className="cursor-pointer text-sm font-medium">
            {t("new")}
          </summary>
          <form
            action={run(createAction)}
            className="mt-4 grid gap-3 sm:grid-cols-2"
          >
            <input type="hidden" name="siteId" value={site.id} />
            <Hidden site={site} locale={locale} />
            <label className="text-xs">
              {t("pass")}
              <select
                name="scanId"
                defaultValue={flagged[0]?.id ?? ""}
                className={field}
              >
                <option value="">{t("siteWide")}</option>
                {flagged.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.tier} · {f.date(s.passDate)}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              {t("startAs")}
              <select
                name="status"
                defaultValue="verification_requested"
                className={field}
              >
                <option value="new">{t("status.new")}</option>
                <option value="verification_requested">
                  {t("status.verification_requested")}
                </option>
              </select>
            </label>
            <label className="text-xs">
              {t("assignee")}
              <select name="assignee" defaultValue="" className={field}>
                <option value="">{t("unassigned")}</option>
                {assignees.map((a) => (
                  <option key={a.userId} value={a.userId}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              {t("due")}
              <input type="date" name="dueDate" className={field} />
            </label>
            <label className="text-xs sm:col-span-2">
              {t("note")}
              <textarea
                name="note"
                rows={2}
                maxLength={2000}
                className={field}
              />
            </label>
            <label className="text-xs sm:col-span-2">
              {t("attachment")}
              <input
                type="file"
                name="attachment"
                accept=".pdf,image/*,.doc,.docx,.xlsx,.csv"
                className={field}
              />
            </label>
            <button
              type="submit"
              disabled={pending}
              className="w-fit rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {t("create")}
            </button>
            {message && (
              <p
                role="status"
                className="text-xs text-foreground/80 sm:col-span-2"
              >
                {message}
              </p>
            )}
          </form>
        </details>
      )}
    </section>
  );
}
