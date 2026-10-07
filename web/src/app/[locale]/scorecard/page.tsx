import { type Locale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ScreeningNote } from "@/components/landing/ui";
import { DiversionTracker } from "@/components/sustainability/DiversionTracker";
import { MonthNav } from "@/components/sustainability/MonthNav";
import { ScorecardGrid } from "@/components/sustainability/ScorecardGrid";
import { Link } from "@/i18n/navigation";
import { makeFormat, pageAlternates } from "@/lib/format";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";
import { monthParam } from "@/lib/sustainability";
import { getPublicScorecard } from "@/lib/sustainability-data";

// Reads Supabase through the cookie-aware client; anon visitors get aggregates only.
export const dynamic = "force-dynamic";

type Props = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ month?: string }>;
};

export async function generateMetadata({ params }: Props) {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "Scorecard",
  });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: pageAlternates(locale, "/scorecard"),
  };
}

/** Public monthly scorecard: what was flagged, confirmed, done and verified at every landfill. */
export default async function ScorecardPage({ params, searchParams }: Props) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const month = monthParam((await searchParams).month);
  const t = await getTranslations("Scorecard");
  const f = makeFormat(locale);
  const data = supabaseConfigured
    ? await getPublicScorecard(await createClient(), month)
    : null;
  const totals = data
    ? data.scorecard.reduce(
        (a, r) => ({
          open: a.open + r.confirmationsOpen,
          measures:
            a.measures +
            r.measuresPlanned +
            r.measuresInProgress +
            r.measuresDone,
          fireDays: a.fireDays + r.fireDaysMonth,
          verified: a.verified + (r.verifiedTco2eTotal ?? 0),
        }),
        { open: 0, measures: 0, fireDays: 0, verified: 0 },
      )
    : null;
  const a = data?.assumptions;

  return (
    <main id="main" className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-8">
          <Link href="/" className="font-heading text-lg font-semibold">
            Vayu<span className="text-signal">Netra</span>
          </Link>
          <nav className="flex items-center gap-4 text-sm text-muted-foreground">
            <Link href="/map" className="hover:text-foreground">
              {t("map")}
            </Link>
            <Link href="/dashboard" className="hover:text-foreground">
              {t("signIn")}
            </Link>
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-8 px-4 py-10 md:px-8">
        <div className="space-y-3">
          <h1 className="font-heading text-3xl font-semibold text-canopy">
            {t("title")}
          </h1>
          <p className="max-w-3xl text-foreground/80">{t("intro")}</p>
          <MonthNav path="/scorecard" month={month} />
          <p className="text-sm">
            <Link href="/verify" className="text-leaf hover:underline">
              {t("ledgerLink")}
            </Link>
          </p>
        </div>

        {data && totals ? (
          <>
            <dl className="grid gap-3 sm:grid-cols-4">
              {[
                [t("totals.open"), f.num(totals.open)],
                [t("totals.measures"), f.num(totals.measures)],
                [t("totals.fireDays"), f.num(totals.fireDays)],
                [t("totals.verified"), f.num(totals.verified)],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-border bg-card p-4"
                >
                  <dt className="text-xs text-muted-foreground">{label}</dt>
                  <dd className="mt-1 font-mono text-2xl text-canopy">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>

            <section aria-labelledby="sites-title" className="space-y-4">
              <h2
                id="sites-title"
                className="font-heading text-xl font-semibold"
              >
                {t("sitesTitle")}
              </h2>
              <ScorecardGrid
                rows={data.scorecard}
                measures={data.measures}
                siteHref={(slug) => `/map/${slug}`}
              />
            </section>

            <DiversionTracker
              rows={data.diversion}
              cities={[]}
              assumptions={data.assumptions.diversion}
              canAct={false}
            />

            <section
              aria-labelledby="assumptions-title"
              className="rounded-xl border border-border bg-card p-5"
            >
              <h2
                id="assumptions-title"
                className="font-heading text-lg font-semibold"
              >
                {t("assumptionsTitle")}
              </h2>
              <ul className="mt-3 space-y-1 text-sm text-foreground/85">
                <li>{t("assume.grades")}</li>
                <li>
                  {t("assume.capture", {
                    gwp: f.num(a!.capture.gwp100),
                    flare: f.pct(a!.capture.flareDestruction),
                    lhv: f.num(a!.capture.lhvMjPerKg),
                    eff: f.pct(a!.capture.engineEff),
                  })}
                </li>
                <li>{t("assume.diversion")}</li>
                <li>{t("assume.fires")}</li>
                <li>{t("assume.reports", { hours: a!.reportSlaHours })}</li>
              </ul>
            </section>

            <section aria-labelledby="open-data-title" className="space-y-2">
              <h2
                id="open-data-title"
                className="font-heading text-lg font-semibold"
              >
                {t("openData")}
              </h2>
              <p className="text-sm text-foreground/80">{t("openDataText")}</p>
              <ul className="flex flex-wrap gap-4 text-sm">
                <li>
                  <a
                    href={`/api/open/scorecard?month=${month}&format=csv`}
                    className="text-leaf underline"
                  >
                    {t("downloadCsv")}
                  </a>
                </li>
                <li>
                  <a
                    href={`/api/open/scorecard?month=${month}`}
                    className="text-leaf underline"
                  >
                    {t("downloadJson")}
                  </a>
                </li>
                <li>
                  <a
                    href={`/api/open/sites?month=${month}`}
                    className="text-leaf underline"
                  >
                    {t("downloadGeojson")}
                  </a>
                </li>
              </ul>
            </section>
          </>
        ) : (
          <p className="text-muted-foreground">{t("unavailable")}</p>
        )}
        <ScreeningNote />
      </div>
    </main>
  );
}
