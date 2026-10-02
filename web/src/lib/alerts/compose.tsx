import "server-only";

import { render } from "@react-email/render";
import { createTranslator } from "next-intl";
import type { ReactElement } from "react";
import { EventAlert } from "@/emails/EventAlert";
import { MonthlyReportEmail } from "@/emails/MonthlyReport";
import { WorkerOffline } from "@/emails/WorkerOffline";
import { makeFormat, placeName } from "@/lib/format";
import { CALM_WIND_MS } from "@/lib/physics-checks";
import { SITE_URL } from "@/lib/site-url";
import en from "../../../messages/en.json";
import hi from "../../../messages/hi.json";

export type Lang = "en" | "hi";
export type Composed = { subject: string; html: string; text: string };

const prefix = (lang: Lang) => (lang === "hi" ? "/hi" : "");

function translators(lang: Lang) {
  const messages = lang === "hi" ? hi : en;
  return {
    t: createTranslator({ locale: lang, messages }),
    places: createTranslator({ locale: lang, messages, namespace: "Places" }),
    f: makeFormat(lang),
  };
}

async function finish(
  subject: string,
  element: ReactElement,
): Promise<Composed> {
  const [html, text] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
  ]);
  return { subject, html, text };
}

/** Absolute URL for an evidence image: worker uploads are absolute, notebook seed images live under /public. */
export function absoluteUrl(url: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//.test(url)
    ? url
    : `${SITE_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

// --- New T1/T2 event ----------------------------------------------------------------------------

export type EventInfo = {
  slug: string;
  siteName: string;
  city: string;
  state: string;
  tier: "T1" | "T2";
  passDate: string;
  overpassUtc: string | null;
  qMed: number | null;
  qLo: number | null;
  qHi: number | null;
  qKgph: number | null;
  u10: number | null;
  sceneScore: number;
  threshold: number;
  evidenceUrl: string | null;
};

export function eventLink(
  ev: Pick<EventInfo, "slug" | "passDate">,
  lang: Lang,
) {
  return `${SITE_URL}${prefix(lang)}/dashboard/sites/${ev.slug}#pass-${ev.passDate}`;
}

export function eventRateText(ev: EventInfo, lang: Lang): string {
  const { t, f } = translators(lang);
  const rate = ev.qMed ?? ev.qKgph;
  if (ev.qMed !== null && ev.qLo !== null && ev.qHi !== null)
    return t("Email.event.rateValue", {
      tph: f.tph(ev.qMed),
      lo: f.tph(ev.qLo),
      hi: f.tph(ev.qHi),
    });
  if (rate !== null) return t("Email.event.rateOnly", { tph: f.tph(rate) });
  return t("Email.event.rateNotEstimated");
}

export async function composeEventAlert(
  ev: EventInfo,
  lang: Lang,
): Promise<Composed> {
  const { t, places, f } = translators(lang);
  const site = placeName(places, "sites", ev.slug, ev.siteName);
  const city = placeName(places, "regions", ev.city, ev.city);
  const state = placeName(places, "regions", ev.state, ev.state);
  const date = f.date(ev.passDate);
  const tierLabel = t(`Common.tier.${ev.tier}`);
  const calm = ev.u10 !== null && ev.u10 < CALM_WIND_MS;
  const wind =
    ev.u10 === null
      ? "–"
      : t("Email.event.windValue", { value: f.num(ev.u10, 1) }) +
        (calm ? ` (${t("Email.event.calm")})` : "");
  const facts: [string, string][] = [
    [
      t("Email.event.pass"),
      ev.overpassUtc
        ? t("Email.event.passValue", {
            date,
            time: ev.overpassUtc.slice(11, 16),
          })
        : date,
    ],
    [t("Email.event.rate"), eventRateText(ev, lang)],
    [t("Email.event.wind"), wind],
    [
      t("Email.event.score"),
      t("Email.event.scoreValue", {
        score: f.num(ev.sceneScore, 3),
        threshold: f.num(ev.threshold, 3),
      }),
    ],
  ];
  const evidence = absoluteUrl(ev.evidenceUrl);
  return finish(
    t("Email.event.subject", { tier: tierLabel, site, date }),
    <EventAlert
      locale={lang}
      brand={t("Email.brand")}
      footer={t("Email.footer")}
      preview={t("Email.event.preview", { tier: tierLabel, site, date })}
      heading={t("Email.event.heading", { site })}
      tier={ev.tier}
      tierLabel={tierLabel}
      intro={t("Email.event.intro", {
        date,
        site,
        // "Mumbai, Maharashtra", but just "Delhi" for Delhi.
        place: city === state ? state : `${city}, ${state}`,
      })}
      meaning={t(
        ev.tier === "T1" ? "Email.event.meaningT1" : "Email.event.meaningT2",
      )}
      facts={facts}
      evidence={
        evidence
          ? {
              src: evidence,
              alt: t("Email.event.evidenceAlt", { site, date }),
              caption: t("Email.event.evidenceCaption"),
            }
          : null
      }
      noEvidence={t("Email.event.noEvidence")}
      screening={t("Common.screening")}
      cta={t("Email.event.cta")}
      href={eventLink(ev, lang)}
      next={t("Email.event.next")}
      why={t("Email.event.why", { state })}
    />,
  );
}

/** One-line WhatsApp/SMS version (English: SMS recipients have no language preference on file). */
export function eventSms(ev: EventInfo): string {
  const { t, f } = translators("en");
  return [
    `VayuNetra ${t(`Common.tier.${ev.tier}`)}: ${ev.siteName}, ${f.date(ev.passDate)}.`,
    `Rate ${eventRateText(ev, "en")}.`,
    "Screening-grade: confirm before enforcement or carbon crediting.",
    eventLink(ev, "en"),
  ].join(" ");
}

// --- Worker offline -----------------------------------------------------------------------------

export async function composeWorkerOffline(
  workerId: string,
  lastSeen: string,
  now: Date,
  lang: Lang,
): Promise<Composed> {
  const { t, f } = translators(lang);
  const since = f.dateTime(lastSeen);
  const hours = f.num(
    (now.getTime() - new Date(lastSeen).getTime()) / 3_600_000,
    1,
  );
  return finish(
    t("Email.offline.subject", { worker: workerId, since }),
    <WorkerOffline
      locale={lang}
      brand={t("Email.brand")}
      footer={t("Email.footer")}
      preview={t("Email.offline.preview", { worker: workerId, hours })}
      heading={t("Email.offline.heading")}
      body={t("Email.offline.body", { worker: workerId, since, hours })}
      fix={t("Email.offline.fix")}
      commands={[t("Email.offline.linux"), t("Email.offline.windows")]}
      cta={t("Email.offline.cta")}
      href={`${SITE_URL}${prefix(lang)}/dashboard`}
      why={t("Email.offline.why")}
    />,
  );
}

// --- Monthly report -----------------------------------------------------------------------------

/** Annual minimum estimates are shown to the nearest 1,000 t (as on the landing page), never to the tonne. */
export const roundCo2 = (t: number) =>
  t >= 1000 ? Math.round(t / 1000) * 1000 : Math.round(t / 10) * 10;

export type MonthlySummary = {
  state: string;
  period: string; // YYYY-MM
  passes: number;
  controlPasses: number;
  controlFlags: number;
  t1: number;
  t2: number;
  t3: number;
  actionsClosed: number;
  gwp100: number;
  /** Sum of the per-site minimum estimates (t CO2e/yr, GWP100); null when no site has one. */
  tco2e100Yr: number | null;
  sites: {
    slug: string;
    name: string;
    minMeanKgph: number | null;
    tco2e100Yr: number | null;
  }[];
  closed: {
    slug: string;
    siteName: string;
    status: "resolved" | "not_methane";
    at: string;
  }[];
  events: {
    slug: string;
    siteName: string;
    tier: "T1" | "T2";
    passDate: string;
    qMed: number | null;
    qLo: number | null;
    qHi: number | null;
    qKgph: number | null;
  }[];
};

export function monthLabel(period: string, lang: Lang): string {
  return new Intl.DateTimeFormat(lang === "hi" ? "hi-IN" : "en-IN", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${period}-01T00:00:00Z`));
}

export async function composeMonthlyReport(
  s: MonthlySummary,
  lang: Lang,
): Promise<Composed> {
  const { t, places, f } = translators(lang);
  const state = placeName(places, "regions", s.state, s.state);
  const month = monthLabel(s.period, lang);
  const events = s.events.map((e) => {
    const site = placeName(places, "sites", e.slug, e.siteName);
    const rate = eventRateText(
      {
        ...e,
        city: "",
        state: s.state,
        overpassUtc: null,
        u10: null,
        sceneScore: 0,
        threshold: 0,
        evidenceUrl: null,
      },
      lang,
    );
    return `${f.date(e.passDate)} · ${site} · ${t(`Common.tier.${e.tier}`)} · ${rate}`;
  });
  return finish(
    t("Email.monthly.subject", { state, month }),
    <MonthlyReportEmail
      locale={lang}
      brand={t("Email.brand")}
      footer={t("Email.footer")}
      preview={t("Email.monthly.preview", {
        passes: f.num(s.passes),
        events: f.num(s.t1 + s.t2),
        closed: f.num(s.actionsClosed),
      })}
      heading={t("Email.monthly.heading", { state, month })}
      intro={t("Email.monthly.intro", { state })}
      facts={[
        [t("Email.monthly.passes"), f.num(s.passes)],
        [
          t("Email.monthly.controls"),
          `${f.num(s.controlPasses)} (${f.num(s.controlFlags)})`,
        ],
        [t("Email.monthly.t1"), f.num(s.t1)],
        [t("Email.monthly.t2"), f.num(s.t2)],
        [t("Email.monthly.t3"), f.num(s.t3)],
        [t("Email.monthly.closed"), f.num(s.actionsClosed)],
        [
          t("Email.monthly.co2", {
            gwp: f.num(s.gwp100, Number.isInteger(s.gwp100) ? 0 : 1),
          }),
          s.tco2e100Yr === null
            ? t("Email.monthly.co2None")
            : t("Email.monthly.co2Value", {
                value: f.num(roundCo2(s.tco2e100Yr)),
              }),
        ],
      ]}
      co2Note={t("Email.monthly.co2Note")}
      eventsTitle={t("Email.monthly.events")}
      events={events}
      noEvents={t("Email.monthly.noEvents")}
      screening={t("Common.screening")}
      cta={t("Email.monthly.cta")}
      href={`${SITE_URL}${prefix(lang)}/dashboard`}
      why={t("Email.monthly.why", { state })}
    />,
  );
}
