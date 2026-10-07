import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { makeFormat, placeName } from "@/lib/format";
import type { PublicMeasure, ScorecardRow } from "@/lib/sustainability";

function Item({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 text-sm">{children}</dd>
    </div>
  );
}

/**
 * One card per landfill: screening this month, confirmation, fires, the ledger, verified tonnes,
 * remediation and citizen reports. Shared by the public scorecard and the dashboard.
 */
export function ScorecardGrid({
  rows,
  measures,
  siteHref,
}: {
  rows: ScorecardRow[];
  measures?: PublicMeasure[];
  siteHref: (slug: string) => string;
}) {
  const t = useTranslations("Scorecard.card");
  const tl = useTranslations("Sustain.ledger");
  const tp = useTranslations("Places");
  const tc = useTranslations("Common");
  const f = makeFormat(useLocale());
  const dash = "—";

  return (
    <ul className="grid gap-5 lg:grid-cols-2">
      {rows.map((r) => {
        const name = placeName(tp as never, "sites", r.slug, r.name);
        const own = measures?.filter((m) => m.slug === r.slug) ?? [];
        const share =
          r.legacyTonnesTotal && r.tonnesProcessed !== null
            ? r.tonnesProcessed / r.legacyTonnesTotal
            : null;
        return (
          <li
            key={r.slug}
            className="rounded-xl border border-border bg-card p-5"
            data-testid={`scorecard-${r.slug}`}
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-heading text-lg font-semibold">
                <Link href={siteHref(r.slug)} className="hover:text-leaf">
                  {name}
                </Link>
              </h3>
              <span className="text-xs text-muted-foreground">
                {placeName(tp as never, "regions", r.city, r.city)},{" "}
                {placeName(tp as never, "regions", r.state, r.state)}
              </span>
            </div>
            <dl className="mt-4 grid gap-x-6 gap-y-3 sm:grid-cols-2">
              <Item label={t("screening")}>
                <span className="font-mono">
                  {t("passes", { n: r.passesMonth })}
                  {r.passesMonth > 0 &&
                    ` · T1 ${r.t1Month} · T2 ${r.t2Month} · T3 ${r.t3Month}`}
                </span>
              </Item>
              <Item label={t("methane")}>
                {(r.minMeanKgph ?? 0) > 0 ? (
                  <span>
                    <span className="font-mono">
                      {f.num(r.tco2e100Yr ?? 0)}
                    </span>{" "}
                    {t("annual")}{" "}
                    <span className="text-xs text-muted-foreground">
                      ({tc("minimumEstimate")})
                    </span>
                  </span>
                ) : r.persistentUpperTph !== null ? (
                  t("bound", { tph: f.num(r.persistentUpperTph) })
                ) : (
                  dash
                )}
              </Item>
              <Item label={t("confirmation")}>
                {t("confirmCounts", {
                  open: r.confirmationsOpen,
                  confirmed: r.confirmationsConfirmed,
                  rejected: r.confirmationsNotMethane,
                })}
                {r.medianDaysToResult !== null && (
                  <span className="block text-xs text-muted-foreground">
                    {t("medianDays", { days: f.num(r.medianDaysToResult) })}
                  </span>
                )}
              </Item>
              <Item label={t("fires")}>
                {t("fireDays", { days: r.fireDaysMonth })}
                {r.firesOpen > 0 && (
                  <span className="block text-xs text-tier-1-ink">
                    {t("firesOpen", { n: r.firesOpen })}
                  </span>
                )}
              </Item>
              <Item label={t("measures")}>
                {t("measureCounts", {
                  planned: r.measuresPlanned,
                  progress: r.measuresInProgress,
                  done: r.measuresDone,
                })}
                {r.expectedTco2eYr !== null && (
                  <span className="block text-xs text-muted-foreground">
                    {t("expected", { t: f.num(r.expectedTco2eYr) })}
                  </span>
                )}
              </Item>
              <Item label={t("verified")}>
                {r.verifiedTco2eTotal !== null ? (
                  <span>
                    <span className="font-mono text-canopy">
                      {f.num(r.verifiedTco2eTotal)}
                    </span>{" "}
                    {t("verifiedUnit")}
                    {r.verifiedTco2eMonth !== null && (
                      <span className="block text-xs text-muted-foreground">
                        {t("verifiedMonth", { t: f.num(r.verifiedTco2eMonth) })}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {t("noneMetered")}
                  </span>
                )}
              </Item>
              <Item label={t("remediation")}>
                {r.tonnesProcessed !== null ? (
                  <span>
                    {t("remediated", {
                      done: f.num(r.tonnesProcessed),
                      total:
                        r.legacyTonnesTotal !== null
                          ? f.num(r.legacyTonnesTotal)
                          : dash,
                    })}
                    {share !== null && ` (${f.pct(share)})`}
                    <span className="block text-xs text-muted-foreground">
                      {r.areaReclaimedHa !== null &&
                        `${t("hectares", { ha: f.num(r.areaReclaimedHa, 1) })} · `}
                      {r.remediationAsOf &&
                        t("asOf", { date: f.date(r.remediationAsOf, "short") })}
                    </span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">
                    {t("noRemediation")}
                  </span>
                )}
              </Item>
              <Item label={t("reports")}>
                {t("reportCounts", {
                  n: r.reportsMonth,
                  closed: r.reportsClosedMonth,
                })}
                {r.medianHoursToClose !== null && (
                  <span className="block text-xs text-muted-foreground">
                    {t("medianHours", { hours: f.num(r.medianHoursToClose) })}
                  </span>
                )}
              </Item>
            </dl>
            {own.length > 0 && (
              <div className="mt-4 border-t border-border pt-3">
                <p className="text-xs font-medium">{t("commitments")}</p>
                <ul className="mt-2 space-y-1 text-xs">
                  {own.map((m, i) => (
                    <li key={`${m.title}-${i}`}>
                      <span className="font-medium">{m.title}</span>{" "}
                      <span className="text-muted-foreground">
                        · {m.agency} · {tl(`statuses.${m.status}`)}
                        {m.startDate && ` · ${f.date(m.startDate, "short")}`}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
