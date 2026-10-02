import { useLocale, useTranslations } from "next-intl";
import { FIELD_TEST } from "@/content/facts";
import type { ScanRow, SiteRow } from "@/lib/dashboard-shared";
import { makeFormat } from "@/lib/format";
import { CALM_WIND_MS } from "@/lib/physics-checks";

/** Site emissions: the T1 rate with its 68% range and the minimum annual CO2e (GWP100 and GWP20). */
export function EmissionsCard({
  site,
  scans,
  gwp,
}: {
  site: SiteRow;
  scans: ScanRow[];
  gwp: { g100: number; g20: number };
}) {
  const t = useTranslations("Dash.emissions");
  const tc = useTranslations("Common");
  const f = makeFormat(useLocale());
  const events = scans
    .filter((s) => s.tier === "T1" || s.tier === "T2")
    .reverse();
  const hasAnnual = (site.minMeanKgph ?? 0) > 0;
  return (
    <section
      aria-labelledby="emissions-title"
      className="rounded-xl border border-white/10 bg-card p-5"
    >
      <h2 id="emissions-title" className="font-heading text-lg font-semibold">
        {t("title")}
      </h2>
      {events.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">{t("noEvents")}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {events.map((s) => (
            <li key={s.id} className="text-sm">
              <span className="font-mono text-xs text-muted-foreground">
                {s.tier} · {f.date(s.passDate, "short")}
              </span>
              {s.u10 !== null && s.u10 < CALM_WIND_MS ? (
                <p className="text-[#FCD34D]">
                  {t("calm", { wind: f.num(s.u10, 1) })}
                </p>
              ) : s.qMed !== null ? (
                <p>
                  <span className="font-mono text-lg text-methane-low">
                    {t("rate", { tph: f.tph(s.qMed) })}
                  </span>{" "}
                  {s.qLo !== null && s.qHi !== null && (
                    <span className="text-foreground/80">
                      ({tc("range68", { lo: f.tph(s.qLo), hi: f.tph(s.qHi) })})
                    </span>
                  )}
                </p>
              ) : (
                <p className="text-muted-foreground">{t("noRate")}</p>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 border-t border-white/10 pt-4">
        {hasAnnual ? (
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("annual100", { gwp: f.num(gwp.g100) })}
              </dt>
              <dd className="font-mono text-lg">
                {f.num(site.tco2e100Yr ?? 0)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("annual20", { gwp: f.num(gwp.g20, 1) })}
              </dt>
              <dd className="font-mono text-lg">
                {f.num(site.tco2e20Yr ?? 0)}
              </dd>
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">
              {t("minimum", {
                kgph: f.num(site.minMeanKgph ?? 0),
                passes: f.num(site.passes),
              })}
            </p>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground">{t("noAnnual")}</p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{tc("screening")}</p>
      </div>
    </section>
  );
}

/** Detection rate at this site and the persistent-emission bound. */
export function DetectionCard({ site }: { site: SiteRow }) {
  const t = useTranslations("Dash.detection");
  const f = makeFormat(useLocale());
  const rates = site.detectRates;
  return (
    <section
      aria-labelledby="detection-title"
      className="rounded-xl border border-white/10 bg-card p-5"
    >
      <h2 id="detection-title" className="font-heading text-lg font-semibold">
        {t("title")}
      </h2>
      {site.persistentUpperTph !== null ? (
        <p className="mt-3 text-sm">
          {t("bound", { tph: f.num(site.persistentUpperTph) })}
        </p>
      ) : (
        <p className="mt-3 text-sm text-muted-foreground">{t("noBound")}</p>
      )}
      {rates?.pod?.length && rates.rates_kgph?.length ? (
        <ul className="mt-3 grid grid-cols-5 gap-2 text-center text-xs">
          {rates.rates_kgph.map((q, i) => (
            <li key={q} className="rounded-md bg-white/5 p-2">
              <span className="block font-mono text-base">
                {f.pct(rates.pod![i])}
              </span>
              <span className="text-muted-foreground">
                {t("at", { tph: f.num(q / 1000) })}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-3 text-sm text-foreground/80">
          {t("generic", {
            share: FIELD_TEST.perPassDetection,
            tph: f.num(FIELD_TEST.perPassDetectionMinTph),
          })}
        </p>
      )}
      <p className="mt-3 text-xs text-muted-foreground">
        {t("control", {
          flags: f.num(site.controlFlags),
          passes: f.num(site.controlPasses),
        })}
        {site.pVsControl !== null && (
          <> · {t("p", { p: f.num(site.pVsControl, 3) })}</>
        )}
      </p>
    </section>
  );
}
