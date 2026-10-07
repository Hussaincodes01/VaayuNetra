"use client";

import { useLocale, useTranslations } from "next-intl";
import { updateFire } from "@/app/[locale]/dashboard/sustainability-actions";
import { makeFormat } from "@/lib/format";
import type { FireRow } from "@/lib/sustainability";
import { Chip, Panel, Status, quietButton, useSubmit } from "./shared";

const tone = { open: "alert", out: "good", not_fire: "neutral" } as const;

function FireItem({ fire, canAct }: { fire: FireRow; canAct: boolean }) {
  const t = useTranslations("Sustain.fires");
  const f = makeFormat(useLocale());
  const { pending, message, run } = useSubmit();
  const next =
    fire.status === "open"
      ? (["out", "not_fire"] as const)
      : (["open"] as const);
  return (
    <li className="rounded-lg border border-border p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <Chip tone={tone[fire.status]}>{t(`status.${fire.status}`)}</Chip>
        <span className="font-mono text-xs">{f.dateTime(fire.acqAt)}</span>
        <span className="ml-auto text-xs text-muted-foreground">
          {t("meta", {
            source: fire.source.replace(/_/g, " "),
            m: f.num(fire.distM),
          })}
          {fire.frpMw !== null && (
            <> · {t("frp", { mw: f.num(fire.frpMw, 1) })}</>
          )}
        </span>
      </div>
      {fire.note && (
        <p className="mt-1 text-xs text-foreground/80">{fire.note}</p>
      )}
      {canAct && (
        <div className="mt-2 flex flex-wrap gap-2">
          {next.map((s) => (
            <form key={s} action={run(updateFire)}>
              <input type="hidden" name="id" value={fire.id} />
              <input type="hidden" name="status" value={s} />
              <button type="submit" disabled={pending} className={quietButton}>
                {t(`set.${s}`)}
              </button>
            </form>
          ))}
        </div>
      )}
      <Status message={message} />
    </li>
  );
}

/** NASA FIRMS fire detections within 1 km of the site point, and what the agency did about each. */
export function FireLog({
  fires,
  canAct,
  configured,
}: {
  fires: FireRow[];
  canAct: boolean;
  configured: boolean;
}) {
  const t = useTranslations("Sustain.fires");
  const f = makeFormat(useLocale());
  const days = new Set(
    fires
      .filter((x) => x.status !== "not_fire")
      .map((x) => f.date(x.acqAt.slice(0, 10), "short")),
  ).size;
  return (
    <Panel id="fires" title={t("title")} intro={t("intro")}>
      {fires.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          {configured ? t("none") : t("notConfigured")}
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm">{t("days", { days })}</p>
          <ul className="mt-3 space-y-2">
            {fires.map((x) => (
              <FireItem key={x.id} fire={x} canAct={canAct} />
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}
