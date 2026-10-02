"use client";

import { useLocale, useTranslations } from "next-intl";
import { useState, useTransition } from "react";
import {
  inviteUser,
  saveSettings,
  type Result,
} from "@/app/[locale]/dashboard/actions";
import { useRouter } from "@/i18n/navigation";

const field =
  "mt-1 block w-full rounded-md border border-white/15 bg-background px-2 py-1.5 text-sm";

function useAction(
  fn: (form: FormData) => Promise<Result>,
  okMessage: (form: FormData) => string,
) {
  const t = useTranslations("Dash.settings");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(
    null,
  );
  const action = (form: FormData) =>
    start(async () => {
      const r = await fn(form);
      setMessage(
        r.ok
          ? { ok: true, text: okMessage(form) }
          : { ok: false, text: t("error", { reason: r.error }) },
      );
      if (r.ok) router.refresh();
    });
  return { pending, message, action };
}

function Status({
  message,
}: {
  message: { ok: boolean; text: string } | null;
}) {
  if (!message) return null;
  return (
    <p
      role="status"
      className={
        message.ok ? "text-sm text-[#86EFAC]" : "text-sm text-[#FCA5A5]"
      }
    >
      {message.text}
    </p>
  );
}

const NUMERIC = [
  "capture_eff",
  "flare_destruction",
  "gwp100",
  "gwp20",
  "ch4_lhv_mj_per_kg",
  "engine_eff",
  "power_price_inr_per_kwh",
  "carbon_price_usd_per_t",
] as const;

export function SettingsForm({
  settings,
}: {
  settings: Record<string, unknown>;
}) {
  const t = useTranslations("Dash.settings");
  const { pending, message, action } = useAction(saveSettings, () =>
    t("saved"),
  );
  const mode = String(settings.threshold_mode ?? "model_card");
  return (
    <form action={action} className="space-y-6">
      <fieldset className="rounded-xl border border-white/10 bg-card p-5">
        <legend className="px-1 font-heading text-lg font-semibold">
          {t("threshold")}
        </legend>
        <div className="mt-2 space-y-2 text-sm">
          {(["model_card", "india_calibrated"] as const).map((m) => (
            <label key={m} className="flex items-center gap-2">
              <input
                type="radio"
                name="threshold_mode"
                value={m}
                defaultChecked={mode === m}
                className="accent-[#2DD4BF]"
              />
              {t(m === "model_card" ? "modelCard" : "india")}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("thresholdNote")}
        </p>
      </fieldset>
      <fieldset className="rounded-xl border border-white/10 bg-card p-5">
        <legend className="px-1 font-heading text-lg font-semibold">
          {t("assumptions")}
        </legend>
        <div className="mt-2 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {NUMERIC.map((k) => (
            <label key={k} className="text-xs">
              {t(`fields.${k}`)}
              <input
                name={k}
                type="number"
                step="any"
                min={0}
                defaultValue={String(settings[k] ?? "")}
                className={field}
              />
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          {t("assumptionsNote")}
        </p>
      </fieldset>
      <fieldset className="rounded-xl border border-white/10 bg-card p-5">
        <legend className="px-1 font-heading text-lg font-semibold">
          {t("recipients")}
        </legend>
        <label className="block text-xs">
          {t("recipientsHint")}
          <textarea
            name="alert_recipients"
            rows={6}
            spellCheck={false}
            defaultValue={JSON.stringify(
              settings.alert_recipients ?? {},
              null,
              2,
            )}
            className={`${field} font-mono`}
          />
        </label>
        <label className="mt-4 block text-xs">
          {t("phonesHint")}
          <textarea
            name="alert_phones"
            rows={4}
            spellCheck={false}
            defaultValue={JSON.stringify(settings.alert_phones ?? {}, null, 2)}
            className={`${field} font-mono`}
          />
        </label>
      </fieldset>
      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
        >
          {t("save")}
        </button>
        <Status message={message} />
      </div>
    </form>
  );
}

export function InviteForm({
  preset,
}: {
  preset?: { email: string; name: string; org: string; state: string | null };
}) {
  const t = useTranslations("Dash.settings");
  const locale = useLocale();
  const { pending, message, action } = useAction(inviteUser, (f) =>
    t("invited", { email: String(f.get("email")) }),
  );
  return (
    <form
      action={action}
      className={
        preset ? "flex flex-wrap items-end gap-2" : "grid gap-3 sm:grid-cols-3"
      }
    >
      <input type="hidden" name="locale" value={locale} />
      {preset ? (
        <>
          <input type="hidden" name="email" value={preset.email} />
          <input type="hidden" name="full_name" value={preset.name} />
          <input type="hidden" name="org" value={preset.org} />
          <input type="hidden" name="state" value={preset.state ?? ""} />
        </>
      ) : (
        <>
          <label className="text-xs">
            {t("email")}
            <input name="email" type="email" required className={field} />
          </label>
          <label className="text-xs">
            {t("name")}
            <input name="full_name" className={field} />
          </label>
          <label className="text-xs">
            {t("org")}
            <input name="org" className={field} />
          </label>
          <label className="text-xs">
            {t("state")}
            <input name="state" className={field} />
          </label>
        </>
      )}
      <label className="text-xs">
        {t("role")}
        <select name="role" defaultValue="viewer" className={field}>
          <option value="viewer">{t("roles.viewer")}</option>
          <option value="officer">{t("roles.officer")}</option>
          <option value="admin">{t("roles.admin")}</option>
        </select>
      </label>
      <button
        type="submit"
        disabled={pending}
        className="h-fit self-end rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {t("inviteSubmit")}
      </button>
      <div className={preset ? "w-full" : "sm:col-span-3"}>
        <Status message={message} />
      </div>
    </form>
  );
}
