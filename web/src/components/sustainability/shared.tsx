"use client";

import { Paperclip } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState, useTransition, type ReactNode } from "react";
import { attachmentLink } from "@/app/[locale]/dashboard/actions";
import { useRouter } from "@/i18n/navigation";

type Result = { ok: true; message?: string } | { ok: false; error: string };

export const field =
  "mt-1 block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm";
export const primaryButton =
  "w-fit rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60";
export const quietButton =
  "rounded-md border border-input px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60";

/** Runs a server action from a form, shows "Saved" or the reason it failed, then refreshes the page. */
export function useSubmit() {
  const t = useTranslations("Sustain.form");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const run =
    (fn: (form: FormData) => Promise<Result>, after?: () => void) =>
    (form: FormData) =>
      start(async () => {
        const r = await fn(form);
        if (r.ok) {
          const rows = r.message?.startsWith("rows:")
            ? Number(r.message.slice(5))
            : null;
          setMessage(rows !== null ? t("imported", { rows }) : t("saved"));
          after?.();
          router.refresh();
        } else setMessage(t("error", { reason: r.error }));
      });
  return { pending, message, run };
}

export function Status({ message }: { message: string | null }) {
  return message ? (
    <p role="status" className="text-xs text-foreground/80">
      {message}
    </p>
  ) : null;
}

/** A dashboard card with a heading and an optional one-line explanation. */
export function Panel({
  id,
  title,
  intro,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-20 rounded-xl border border-border bg-card p-5"
    >
      <h2 id={`${id}-title`} className="font-heading text-lg font-semibold">
        {title}
      </h2>
      {intro && <p className="mt-1 text-xs text-muted-foreground">{intro}</p>}
      {children}
    </section>
  );
}

/** Opens a file from the private attachments bucket through a 10-minute signed link (officers). */
export function AttachmentButton({ path }: { path: string }) {
  const t = useTranslations("Sustain.form");
  const open = async () => {
    const url = await attachmentLink(path);
    if (url) window.open(url, "_blank", "noopener");
  };
  return (
    <button
      type="button"
      onClick={open}
      className="inline-flex items-center gap-1 text-xs text-leaf hover:underline"
    >
      <Paperclip className="size-3.5" aria-hidden /> {t("openFile")}
    </button>
  );
}

/** A small rounded label; tone picks the colour pair. */
export function Chip({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "good" | "warn" | "alert";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-muted text-foreground/80",
    good: "bg-sprout text-canopy",
    warn: "bg-amber-100 text-tier-3-ink",
    alert: "bg-red-100 text-tier-1-ink",
  } as const;
  return (
    <span
      className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
