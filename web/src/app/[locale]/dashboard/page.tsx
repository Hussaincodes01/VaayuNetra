import type { Locale } from "next-intl";
import { getTranslations } from "next-intl/server";
import {
  EventFeed,
  KpiCards,
  OpenEvents,
  SitesTable,
} from "@/components/dashboard/Overview";
import { SitesMap } from "@/components/dashboard/SitesMap";
import { getOverview } from "@/lib/dashboard-data";
import { createClient } from "@/lib/supabase/server";

// Per-user data (session cookie): never prerender.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "Dash.overview",
  });
  return { title: t("title") };
}

export default async function OverviewPage() {
  const supabase = await createClient();
  const o = await getOverview(supabase);
  const t = await getTranslations("Dash.overview");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-heading text-3xl font-semibold">{t("title")}</h1>
        <p className="font-mono text-xs text-muted-foreground">
          {t("model", { version: o.modelVersion })}
        </p>
      </div>
      <KpiCards
        k={{
          sites: o.sites.length,
          scansThisMonth: o.scansThisMonth,
          open: o.open.length,
          lastScan: o.lastScan,
          heartbeat: o.heartbeat,
        }}
      />
      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <SitesMap
          hrefBase="/dashboard/sites"
          sites={o.sites.map((s) => ({
            slug: s.slug,
            name: s.name,
            city: s.city,
            lat: s.lat,
            lon: s.lon,
            status: s.status,
          }))}
        />
        <OpenEvents open={o.open} />
      </div>
      <SitesTable sites={o.sites} />
      <EventFeed feed={o.feed} sites={o.sites} />
    </div>
  );
}
