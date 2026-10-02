"use client";

import {
  Check,
  FileDown,
  FileSpreadsheet,
  Link2,
  MapPinned,
  Sparkles,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";

/** Exports: scans CSV, tasking GeoJSON, dossier PDF and the public share link. */
export function ExportsBar({
  slug,
  dossierUrl,
}: {
  slug: string;
  dossierUrl: string | null;
}) {
  const t = useTranslations("Dash.exports");
  const locale = useLocale();
  const [copied, setCopied] = useState(false);
  const share = () => {
    const url = `${window.location.origin}${locale === "hi" ? "/hi" : ""}/map/${slug}`;
    void navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    });
  };
  const btn =
    "inline-flex items-center gap-2 rounded-md border border-input px-3 py-2 text-sm transition-colors hover:bg-muted";
  return (
    <nav aria-label={t("label")} className="flex flex-wrap gap-2">
      {dossierUrl ? (
        <a
          href={dossierUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={`${btn} border-signal/50 text-signal`}
        >
          <FileDown className="size-4" aria-hidden /> {t("pdf")}
        </a>
      ) : (
        <span
          className={`${btn} cursor-not-allowed text-muted-foreground`}
          title={t("noPdfHint")}
        >
          <FileDown className="size-4" aria-hidden /> {t("noPdf")}
        </span>
      )}
      <a href={`/api/export/scans?site=${slug}`} className={btn}>
        <FileSpreadsheet className="size-4" aria-hidden /> {t("csv")}
      </a>
      <a href={`/api/export/tasking?site=${slug}`} className={btn}>
        <MapPinned className="size-4" aria-hidden /> {t("geojson")}
      </a>
      <button type="button" onClick={share} className={btn}>
        {copied ? (
          <Check className="size-4 text-tier-clear-ink" aria-hidden />
        ) : (
          <Link2 className="size-4" aria-hidden />
        )}
        <span aria-live="polite">{copied ? t("copied") : t("share")}</span>
      </button>
    </nav>
  );
}

type Briefing = {
  lang: "en" | "hi";
  briefing: string;
  model: string;
  created_at: string;
};

/** "Explain this site": a 150-word AI briefing from the site's JSON, cached per model version. */
export function ExplainSite({
  slug,
  cached,
  enabled,
}: {
  slug: string;
  cached: Briefing[];
  /** False when GROQ_API_KEY is not set on the server. */
  enabled: boolean;
}) {
  const t = useTranslations("Dash.explain");
  const locale = useLocale() as "en" | "hi";
  const [briefing, setBriefing] = useState<Briefing | null>(
    cached.find((b) => b.lang === locale) ?? null,
  );
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [reason, setReason] = useState("");

  const explain = async () => {
    setState("loading");
    try {
      const res = await fetch("/api/explain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, lang: locale }),
      });
      const json = (await res.json()) as {
        briefing?: Briefing;
        error?: string;
      };
      if (!res.ok || !json.briefing) {
        setReason(
          res.status === 429
            ? t("rateLimited")
            : (json.error ?? String(res.status)),
        );
        setState("error");
        return;
      }
      setBriefing(json.briefing);
      setState("idle");
    } catch (e) {
      setReason((e as Error).message);
      setState("error");
    }
  };

  return (
    <section
      aria-labelledby="explain-title"
      className="rounded-xl border border-border bg-card p-5"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="explain-title"
          className="flex items-center gap-2 font-heading text-lg font-semibold"
        >
          <Sparkles className="size-4 text-signal" aria-hidden /> {t("title")}
        </h2>
        {!briefing && enabled && (
          <button
            type="button"
            onClick={explain}
            disabled={state === "loading"}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {state === "loading" ? t("loading") : t("run")}
          </button>
        )}
      </div>
      {briefing && (
        <div className="mt-3">
          <p className="inline-block rounded-full border border-tier-3/40 bg-[#FEF3C7] px-2.5 py-0.5 text-xs text-tier-3-ink">
            {t("label")}
          </p>
          <p
            className="mt-3 text-sm leading-relaxed whitespace-pre-line text-foreground/90"
            lang={briefing.lang}
          >
            {briefing.briefing}
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {t("model", { model: briefing.model })}
          </p>
        </div>
      )}
      {state === "error" && (
        <p role="alert" className="mt-3 text-sm text-tier-1-ink">
          {t("error", { reason })}
        </p>
      )}
      {!briefing && !enabled && (
        <p className="mt-2 text-sm text-muted-foreground">
          {t("notConfigured")}
        </p>
      )}
      {!briefing && enabled && state !== "error" && (
        <p className="mt-2 text-sm text-muted-foreground">{t("intro")}</p>
      )}
    </section>
  );
}
