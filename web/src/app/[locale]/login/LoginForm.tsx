"use client";

import { useLocale, useTranslations } from "next-intl";
import { useActionState, useEffect, useState } from "react";
import { useRouter } from "@/i18n/navigation";
import { getBrowserClient } from "@/lib/supabase/client";
import { sendMagicLink, type LoginState } from "./actions";

export function LoginForm({ next }: { next: string }) {
  const t = useTranslations("Login");
  const locale = useLocale();
  const router = useRouter();
  const [state, action, pending] = useActionState<LoginState, FormData>(
    sendMagicLink,
    { status: "idle" },
  );
  const [finishing, setFinishing] = useState(false);

  // Invite links carry the session in the URL fragment (#access_token=...), which never reaches the server.
  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const access_token = hash.get("access_token");
    const refresh_token = hash.get("refresh_token");
    if (!access_token || !refresh_token) return;
    setFinishing(true);
    void getBrowserClient()
      .auth.setSession({ access_token, refresh_token })
      .then(({ error }) => {
        window.history.replaceState(null, "", window.location.pathname);
        if (error) setFinishing(false);
        else router.replace("/dashboard");
      });
  }, [router]);

  if (finishing) {
    return (
      <p role="status" className="mt-6 text-sm text-signal">
        {t("invited")}
      </p>
    );
  }
  if (state.status === "sent") {
    return (
      <p
        role="status"
        className="mt-6 rounded-md border border-tier-clear/40 bg-tier-clear/10 p-4 text-sm"
      >
        {t("sent", { email: state.email ?? "" })}
      </p>
    );
  }
  return (
    <form action={action} className="mt-6 space-y-4">
      <input
        type="hidden"
        name="next"
        value={locale === "hi" && !next.startsWith("/hi") ? `/hi${next}` : next}
      />
      <label className="block text-sm">
        {t("email")}
        <input
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-md border border-white/15 bg-background px-3 py-2 outline-none focus-visible:border-signal focus-visible:ring-2 focus-visible:ring-signal/40"
        />
      </label>
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {pending ? t("sending") : t("submit")}
      </button>
      <p role="status" aria-live="polite" className="text-sm text-[#FCA5A5]">
        {state.status === "not_invited"
          ? t("notInvited")
          : state.status === "error"
            ? t("error")
            : state.status === "invalid"
              ? t("invalid")
              : ""}
      </p>
    </form>
  );
}
