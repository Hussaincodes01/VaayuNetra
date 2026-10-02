import {
  Activity,
  AlertTriangle,
  CalendarClock,
  MapPin,
  ScanLine,
  Server,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { TierBadge } from "@/components/landing/ui";
import { Link } from "@/i18n/navigation";
import type {
  FeedItem,
  Heartbeat,
  OpenEvent,
  SiteRow,
} from "@/lib/dashboard-shared";
import { makeFormat, placeName } from "@/lib/format";
import { StatusBadge } from "./StatusBadge";

type Kpis = {
  sites: number;
  scansThisMonth: number;
  open: number;
  lastScan: string;
  heartbeat: Heartbeat;
};

export function KpiCards({ k }: { k: Kpis }) {
  const t = useTranslations("Dash.overview.kpi");
  const f = makeFormat(useLocale());
  const cards = [
    { icon: MapPin, label: t("sites"), value: f.num(k.sites) },
    { icon: ScanLine, label: t("month"), value: f.num(k.scansThisMonth) },
    {
      icon: AlertTriangle,
      label: t("open"),
      value: f.num(k.open),
      accent: k.open > 0,
    },
    {
      icon: CalendarClock,
      label: t("last"),
      value: k.lastScan ? f.date(k.lastScan, "short") : "—",
    },
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {cards.map(({ icon: Icon, label, value, accent }) => (
        <div
          key={label}
          className="rounded-xl border border-white/10 bg-card p-4"
        >
          <dt className="flex items-center gap-2 text-xs text-muted-foreground">
            <Icon className="size-3.5" aria-hidden /> {label}
          </dt>
          <dd
            className={`mt-2 font-mono text-2xl ${accent ? "text-[#FCA5A5]" : ""}`}
          >
            {value}
          </dd>
        </div>
      ))}
      <div className="col-span-2 rounded-xl border border-white/10 bg-card p-4 lg:col-span-1">
        <dt className="flex items-center gap-2 text-xs text-muted-foreground">
          <Server className="size-3.5" aria-hidden /> {t("worker")}
        </dt>
        <dd className="mt-2 flex items-center gap-2 font-mono text-2xl">
          <span
            aria-hidden
            className={
              k.heartbeat?.online
                ? "size-2.5 rounded-full bg-tier-clear"
                : "size-2.5 rounded-full bg-muted-foreground"
            }
          />
          {k.heartbeat?.online ? t("online") : t("offline")}
        </dd>
        <p className="mt-1 text-xs text-muted-foreground">
          {k.heartbeat
            ? t("seen", { when: f.dateTime(k.heartbeat.lastSeen) })
            : t("never")}
        </p>
      </div>
    </dl>
  );
}

export function OpenEvents({ open }: { open: OpenEvent[] }) {
  const t = useTranslations("Dash.overview");
  const ta = useTranslations("Dash.action.status");
  const tp = useTranslations("Places");
  const f = makeFormat(useLocale());
  return (
    <section
      aria-labelledby="open-title"
      className="rounded-xl border border-white/10 bg-card p-5"
    >
      <h2 id="open-title" className="font-heading text-lg font-semibold">
        {t("openTitle")}
      </h2>
      {open.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("openEmpty")}</p>
      ) : (
        <ul className="mt-3 divide-y divide-white/5">
          {open.map(({ scan, site, action }) => (
            <li key={scan.id}>
              <Link
                href={`/dashboard/sites/${site.slug}#pass-${scan.passDate}`}
                className="-mx-2 flex items-center gap-3 rounded-md px-2 py-3 transition-colors hover:bg-white/5"
              >
                <TierBadge tier={scan.tier as "T1" | "T2"} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {placeName(tp, "sites", site.slug, site.name)}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {f.date(scan.passDate)}
                    {scan.qMed !== null && (
                      <> · {t("rate", { tph: f.tph(scan.qMed) })}</>
                    )}
                  </span>
                </span>
                <span className="text-xs text-muted-foreground">
                  {action ? ta(action.status) : t("noAction")}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function EventFeed({
  feed,
  sites,
}: {
  feed: FeedItem[];
  sites: SiteRow[];
}) {
  const t = useTranslations("Dash.overview.feed");
  const ta = useTranslations("Dash.action.status");
  const tj = useTranslations("Dash.jobs");
  const tp = useTranslations("Places");
  const f = makeFormat(useLocale());
  const name = (slug: string | null, fallback: string | null) => {
    const site = sites.find((s) => s.slug === slug);
    return slug && site
      ? placeName(tp, "sites", slug, site.name)
      : (fallback ?? "");
  };
  return (
    <section
      aria-labelledby="feed-title"
      className="rounded-xl border border-white/10 bg-card p-5"
    >
      <h2
        id="feed-title"
        className="flex items-center gap-2 font-heading text-lg font-semibold"
      >
        <Activity className="size-4 text-signal" aria-hidden /> {t("title")}
      </h2>
      {feed.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ol className="mt-3 space-y-3 text-sm">
          {feed.map((e, i) => {
            const when =
              e.at.length > 10 ? f.dateTime(e.at) : f.date(e.at, "short");
            const body =
              e.kind === "flag"
                ? t("flag", {
                    tier: e.tier,
                    site: name(e.slug, e.site),
                    date: f.date(e.scanDate, "short"),
                  })
                : e.kind === "action"
                  ? t(e.change === "insert" ? "actionInsert" : "actionUpdate", {
                      site: name(e.slug, e.site),
                      status: ta(e.status),
                    })
                  : t("job", {
                      kind: tj(`kind.${e.jobKind}`),
                      status: tj(`status.${e.status}`),
                      site: e.site ? name(e.slug, e.site) : "",
                    });
            return (
              <li key={`${e.kind}-${i}`} className="flex gap-3">
                <time
                  className="w-44 shrink-0 font-mono text-xs whitespace-nowrap text-muted-foreground"
                  dateTime={e.at}
                >
                  {when}
                </time>
                {e.slug ? (
                  <Link
                    href={`/dashboard/sites/${e.slug}`}
                    className="hover:underline"
                  >
                    {body}
                  </Link>
                ) : (
                  <span>{body}</span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function SitesTable({
  sites,
  hrefBase = "/dashboard/sites",
}: {
  sites: SiteRow[];
  hrefBase?: string;
}) {
  const t = useTranslations("Dash.overview.table");
  const tp = useTranslations("Places");
  const f = makeFormat(useLocale());
  return (
    <section
      aria-labelledby="sites-title"
      className="overflow-x-auto rounded-xl border border-white/10 bg-card"
    >
      <h2
        id="sites-title"
        className="px-5 pt-5 font-heading text-lg font-semibold"
      >
        {t("title")}
      </h2>
      <table className="mt-3 w-full min-w-[720px] text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr className="border-b border-white/10">
            <th className="px-5 py-2 font-medium">{t("site")}</th>
            <th className="px-3 py-2 font-medium">{t("status")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("passes")}</th>
            <th className="px-3 py-2 text-right font-medium">{t("flags")}</th>
            <th className="px-3 py-2 text-right font-medium">T1 · T2 · T3</th>
            <th className="px-3 py-2 text-right font-medium">{t("control")}</th>
            <th className="px-5 py-2 text-right font-medium">{t("last")}</th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => (
            <tr
              key={s.slug}
              className="border-b border-white/5 last:border-0 hover:bg-white/[0.03]"
            >
              <td className="px-5 py-3">
                <Link
                  href={`${hrefBase}/${s.slug}`}
                  className="font-medium hover:underline"
                >
                  {placeName(tp, "sites", s.slug, s.name)}
                </Link>
                <span className="block text-xs text-muted-foreground">
                  {placeName(tp, "regions", s.city, s.city)}
                </span>
              </td>
              <td className="px-3 py-3">
                <StatusBadge status={s.status} />
              </td>
              <td className="px-3 py-3 text-right font-mono">
                {f.num(s.passes)}
              </td>
              <td className="px-3 py-3 text-right font-mono">
                {f.num(s.flags)}
              </td>
              <td className="px-3 py-3 text-right font-mono">
                {s.t1} · {s.t2} · {s.t3}
              </td>
              <td className="px-3 py-3 text-right font-mono">
                {s.controlFlags}/{s.controlPasses}
              </td>
              <td className="px-5 py-3 text-right font-mono text-xs">
                {s.lastPassDate ? f.date(s.lastPassDate, "short") : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
