"use client";

import { useTranslations } from "next-intl";
import { LastUpdated } from "@/components/LastUpdated";
import { Link } from "@/i18n/navigation";
import { useActionState } from "react";
import { requestAccess, type RequestState } from "@/app/[locale]/actions";
import { SOURCES } from "@/content/facts";

const input =
  "mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-signal focus-visible:ring-2 focus-visible:ring-signal/40";

function RequestAccessForm() {
  const t = useTranslations("Footer");
  const [state, action, pending] = useActionState<RequestState, FormData>(
    requestAccess,
    { status: "idle" },
  );

  if (state.status === "sent") {
    return (
      <p
        role="status"
        className="rounded-lg border border-tier-clear/40 bg-tier-clear/10 p-4 text-sm"
      >
        {t("sent")}
      </p>
    );
  }
  return (
    <form
      action={action}
      className="grid gap-4 sm:grid-cols-2"
      noValidate={false}
    >
      <label className="text-sm">
        {t("name")}
        <input
          name="name"
          required
          maxLength={200}
          autoComplete="name"
          className={input}
        />
      </label>
      <label className="text-sm">
        {t("org")}
        <input
          name="org"
          required
          maxLength={200}
          autoComplete="organization"
          className={input}
        />
      </label>
      <label className="text-sm">
        {t("email")}
        <input
          name="email"
          type="email"
          required
          maxLength={320}
          autoComplete="email"
          className={input}
        />
      </label>
      <label className="text-sm">
        {t("state")}
        <input
          name="state"
          maxLength={100}
          autoComplete="address-level1"
          className={input}
        />
      </label>
      <label className="text-sm sm:col-span-2">
        {t("message")}
        <textarea name="message" rows={3} maxLength={2000} className={input} />
      </label>
      <div aria-hidden className="absolute -left-[9999px]">
        <label>
          Website
          <input name="website" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-4 sm:col-span-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? t("sending") : t("submit")}
        </button>
        <p role="status" aria-live="polite" className="text-sm text-tier-1-ink">
          {state.status === "error"
            ? t("error")
            : state.status === "invalid"
              ? t("invalid")
              : state.status === "limited"
                ? t("limited")
                : ""}
        </p>
      </div>
    </form>
  );
}

export function Footer({
  modelVersion,
  lastUpdated,
}: {
  modelVersion: string;
  lastUpdated: string | null;
}) {
  const t = useTranslations("Footer");
  return (
    <footer className="relative z-10 border-t border-border bg-[#EAF2E5]">
      <div className="mx-auto grid max-w-7xl gap-14 px-4 py-20 md:px-8 lg:grid-cols-[1.3fr_1fr]">
        <section
          id="request"
          aria-labelledby="request-title"
          className="relative scroll-mt-20"
        >
          <h2
            id="request-title"
            className="font-heading text-3xl font-semibold"
          >
            {t("requestTitle")}
          </h2>
          <p className="mt-2 mb-6 text-foreground/75">{t("requestText")}</p>
          <RequestAccessForm />
        </section>
        <div className="space-y-8 text-sm">
          <div>
            <h2 className="font-heading text-lg font-semibold">
              {t("credits")}
            </h2>
            <ul className="mt-3 space-y-1.5 text-foreground/75">
              <li>{t("creditS2")}</li>
              <li>{t("creditEra5")}</li>
              <li>{t("creditMethaneSet")}</li>
              <li>{t("creditMars")}</li>
            </ul>
          </div>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <Link
              href="/system"
              className="text-signal underline-offset-4 hover:underline"
            >
              {t("system")}
            </Link>
            <Link
              href="/simulator"
              className="text-signal underline-offset-4 hover:underline"
            >
              {t("simulator")}
            </Link>
            <Link
              href="/scorecard"
              className="text-signal underline-offset-4 hover:underline"
            >
              {t("scorecard")}
            </Link>
            <Link
              href="/verify"
              className="text-signal underline-offset-4 hover:underline"
            >
              {t("ledger")}
            </Link>
            <a
              href={SOURCES.github}
              target="_blank"
              rel="noopener noreferrer"
              className="text-signal underline-offset-4 hover:underline"
            >
              {t("github")}
            </a>
            <span className="text-foreground/75">{t("licence")}</span>
            <span className="font-mono text-muted-foreground">
              {t("model", { version: modelVersion })}
            </span>
          </div>
          <LastUpdated at={lastUpdated} className="text-muted-foreground" />
          <p className="rounded-lg border border-methane-mid/30 bg-methane-mid/[0.06] p-4 leading-relaxed text-foreground/85">
            {t("disclaimer")}
          </p>
          <p className="font-heading text-lg">
            Vayu<span className="text-signal">Netra</span>
          </p>
        </div>
      </div>
    </footer>
  );
}
