import { type Locale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { SitesTable } from "@/components/dashboard/Overview";
import { SitesMap } from "@/components/dashboard/SitesMap";
import { ScreeningNote } from "@/components/landing/ui";
import { LastUpdated } from "@/components/LastUpdated";
import { Link } from "@/i18n/navigation";
import { pageAlternates } from "@/lib/format";
import { getSites } from "@/lib/dashboard-data";
import { getLastUpdated } from "@/lib/last-updated";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

// Reads Supabase through the cookie-aware client; anon visitors get the public rows.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "PublicMap",
  });
  return {
    title: t("title"),
    description: t("intro"),
    alternates: pageAlternates(locale, "/map"),
  };
}

/** Read-only public map of every monitored site (anon access, RLS-protected). */
export default async function PublicMapPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations("PublicMap");
  const sites = supabaseConfigured ? await getSites(await createClient()) : [];
  return (
    <main id="main" className="min-h-dvh bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-8">
          <Link href="/" className="font-heading text-lg font-semibold">
            Vayu<span className="text-signal">Netra</span>
          </Link>
          <Link
            href="/dashboard"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("signIn")}
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-10 md:px-8">
        <div>
          <h1 className="font-heading text-3xl font-semibold">{t("title")}</h1>
          <p className="mt-2 max-w-2xl text-foreground/80">{t("intro")}</p>
          <LastUpdated at={await getLastUpdated()} className="mt-2" />
        </div>
        {sites.length ? (
          <>
            <SitesMap
              hrefBase="/map"
              height={480}
              sites={sites.map((s) => ({
                slug: s.slug,
                name: s.name,
                city: s.city,
                lat: s.lat,
                lon: s.lon,
                status: s.status,
              }))}
            />
            <SitesTable sites={sites} hrefBase="/map" />
          </>
        ) : (
          <p className="text-muted-foreground">{t("unavailable")}</p>
        )}
        <ScreeningNote />
      </div>
    </main>
  );
}
