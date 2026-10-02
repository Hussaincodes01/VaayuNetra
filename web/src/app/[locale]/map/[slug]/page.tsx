import { notFound } from "next/navigation";
import { type Locale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { EvidenceViewer } from "@/components/dashboard/EvidenceViewer";
import { ScoreTimeline } from "@/components/dashboard/ScoreTimeline";
import { DetectionCard, EmissionsCard } from "@/components/dashboard/SiteCards";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { ScreeningNote } from "@/components/landing/ui";
import { LastUpdated } from "@/components/LastUpdated";
import { Link } from "@/i18n/navigation";
import { getSiteDetail } from "@/lib/dashboard-data";
import { pageAlternates, placeName } from "@/lib/format";
import { getLastUpdated } from "@/lib/last-updated";
import { createClient, supabaseConfigured } from "@/lib/supabase/server";

// Reads Supabase through the cookie-aware client; anon visitors get the public rows.
export const dynamic = "force-dynamic";
type Params = { params: Promise<{ locale: string; slug: string }> };

export async function generateMetadata({ params }: Params) {
  const { locale, slug } = await params;
  const tp = await getTranslations({
    locale: locale as Locale,
    namespace: "Places",
  });
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "PublicMap",
  });
  return {
    title: `${placeName(tp as never, "sites", slug, slug)} · ${t("title")}`,
    alternates: pageAlternates(locale, `/map/${slug}`),
  };
}

/** Shareable, read-only site page: status, timeline, evidence, emissions. No actions or names. */
export default async function PublicSitePage({ params }: Params) {
  const { locale, slug } = await params;
  setRequestLocale(locale as Locale);
  if (!supabaseConfigured) notFound();
  const supabase = await createClient();
  const detail = await getSiteDetail(supabase, slug);
  if (!detail) notFound();
  const { site, scans, control } = detail;
  const { data: gwpRows } = await supabase
    .from("settings")
    .select("key,value")
    .in("key", ["gwp100", "gwp20"]);
  const gwp = {
    g100: Number(gwpRows?.find((r) => r.key === "gwp100")?.value ?? 27),
    g20: Number(gwpRows?.find((r) => r.key === "gwp20")?.value ?? 79.7),
  };
  const t = await getTranslations("PublicMap");
  const td = await getTranslations("Dash.site");
  const tp = await getTranslations("Places");
  const name = placeName(tp as never, "sites", site.slug, site.name);
  const flagged = scans
    .filter((s) => s.tier !== "none")
    .sort(
      (a, b) =>
        a.tier.localeCompare(b.tier) || b.passDate.localeCompare(a.passDate),
    );
  const siteInfo = {
    id: site.id,
    slug: site.slug,
    name,
    city: site.city,
    state: site.state,
    lat: site.lat,
    lon: site.lon,
  };

  return (
    <main id="main" className="min-h-dvh bg-background">
      <header className="border-b border-white/10">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 md:px-8">
          <Link
            href="/map"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {t("back")}
          </Link>
          <Link href="/" className="font-heading text-lg font-semibold">
            Vayu<span className="text-signal">Netra</span>
          </Link>
        </div>
      </header>
      <div className="mx-auto max-w-7xl space-y-6 px-4 py-10 md:px-8">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-3xl font-semibold">{name}</h1>
          <StatusBadge status={site.status} />
        </div>
        <LastUpdated at={await getLastUpdated()} />
        <p className="font-mono text-sm">
          {td("counts", {
            passes: site.passes,
            flags: site.flags,
            t1: site.t1,
            t2: site.t2,
            t3: site.t3,
          })}
        </p>
        <section className="rounded-xl border border-white/10 bg-card p-5">
          <h2 className="font-heading text-lg font-semibold">
            {td("timeline")}
          </h2>
          <div className="mt-3">
            <ScoreTimeline scans={scans} />
          </div>
        </section>
        {flagged.map((s) => (
          <EvidenceViewer
            key={s.id}
            scan={s}
            site={siteInfo}
            control={control}
            canAct={false}
            assignees={[]}
            action={null}
          />
        ))}
        <div className="grid gap-6 lg:grid-cols-2">
          <EmissionsCard site={site} scans={scans} gwp={gwp} />
          <DetectionCard site={site} />
        </div>
        <ScreeningNote />
      </div>
    </main>
  );
}
