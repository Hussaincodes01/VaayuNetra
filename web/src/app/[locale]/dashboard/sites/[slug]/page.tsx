import "server-only";

import type { Locale } from "next-intl";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ActionPanel } from "@/components/dashboard/ActionPanel";
import { EvidenceViewer } from "@/components/dashboard/EvidenceViewer";
import { JobsPanel } from "@/components/dashboard/JobsPanel";
import { ScoreTimeline } from "@/components/dashboard/ScoreTimeline";
import { DetectionCard, EmissionsCard } from "@/components/dashboard/SiteCards";
import { ExplainSite, ExportsBar } from "@/components/dashboard/SiteTools";
import { StatusBadge } from "@/components/dashboard/StatusBadge";
import { GroundView } from "@/components/landing/GroundView";
import { Link } from "@/i18n/navigation";
import {
  getHeartbeat,
  getSiteDetail,
  getViewer,
  resolveDossier,
} from "@/lib/dashboard-data";
import { placeName } from "@/lib/format";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ locale: string; slug: string }> };

// Per-user data (session cookie): never prerender.
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Params) {
  const { locale, slug } = await params;
  const t = await getTranslations({
    locale: locale as Locale,
    namespace: "Places",
  });
  return { title: placeName(t as never, "sites", slug, slug) };
}

export default async function SitePage({ params }: Params) {
  const { slug } = await params;
  const supabase = await createClient();
  const [viewer, detail, heartbeat, dossier] = await Promise.all([
    getViewer(supabase),
    getSiteDetail(supabase, slug),
    getHeartbeat(supabase),
    resolveDossier(slug),
  ]);
  if (!detail || !viewer) notFound();
  const { site, scans, actions, jobs, assignees, control, briefings } = detail;
  const { data: gwpRows } = await supabase
    .from("settings")
    .select("key,value")
    .in("key", ["gwp100", "gwp20"]);
  const gwp = {
    g100: Number(gwpRows?.find((r) => r.key === "gwp100")?.value ?? 27),
    g20: Number(gwpRows?.find((r) => r.key === "gwp20")?.value ?? 79.7),
  };
  const t = await getTranslations("Dash.site");
  const tp = await getTranslations("Places");
  const name = placeName(tp as never, "sites", site.slug, site.name);
  const canAct = viewer.role === "officer" || viewer.role === "admin";
  const flagged = scans
    .filter((s) => s.tier !== "none")
    .sort(
      (a, b) =>
        a.tier.localeCompare(b.tier) || b.passDate.localeCompare(a.passDate),
    );
  const latestAction = (scanId: string) =>
    actions.find((a) => a.scanId === scanId) ?? null;
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
    <div className="space-y-6">
      <nav
        aria-label={t("breadcrumb")}
        className="text-sm text-muted-foreground"
      >
        <Link href="/dashboard" className="hover:text-foreground">
          {t("back")}
        </Link>
      </nav>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="font-heading text-3xl font-semibold">{name}</h1>
            <StatusBadge status={site.status} />
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {placeName(tp as never, "regions", site.city, site.city)},{" "}
            {placeName(tp as never, "regions", site.state, site.state)} ·{" "}
            <span className="font-mono">
              {site.lat.toFixed(4)}, {site.lon.toFixed(4)}
            </span>
          </p>
          <p className="mt-2 font-mono text-sm">
            {t("counts", {
              passes: site.passes,
              flags: site.flags,
              t1: site.t1,
              t2: site.t2,
              t3: site.t3,
            })}
          </p>
        </div>
        <ExportsBar slug={site.slug} dossierUrl={dossier} />
      </header>

      <section
        aria-labelledby="timeline-title"
        className="rounded-xl border border-white/10 bg-card p-5"
      >
        <h2 id="timeline-title" className="font-heading text-lg font-semibold">
          {t("timeline")}
        </h2>
        <div className="mt-3">
          <ScoreTimeline scans={scans} />
        </div>
      </section>

      <section aria-labelledby="evidence-title" className="space-y-4">
        <h2 id="evidence-title" className="font-heading text-xl font-semibold">
          {t("evidence", { count: flagged.length })}
        </h2>
        {flagged.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noFlags")}</p>
        ) : (
          flagged.map((s) => (
            <EvidenceViewer
              key={s.id}
              scan={s}
              site={siteInfo}
              control={control}
              canAct={canAct}
              assignees={assignees}
              action={latestAction(s.id)}
            />
          ))
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <EmissionsCard site={site} scans={scans} gwp={gwp} />
        <DetectionCard site={site} />
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <ActionPanel
          site={siteInfo}
          actions={actions}
          scans={scans}
          assignees={assignees}
          canAct={canAct}
        />
        <div className="space-y-6">
          <JobsPanel
            siteId={site.id}
            initialJobs={jobs}
            heartbeat={heartbeat}
            canAct={canAct}
          />
          {process.env.NEXT_PUBLIC_MAPILLARY_TOKEN && (
            <section className="rounded-xl border border-white/10 bg-card p-5">
              <h2 className="font-heading text-lg font-semibold">
                {t("ground")}
              </h2>
              <div className="mt-3">
                <GroundView
                  token={process.env.NEXT_PUBLIC_MAPILLARY_TOKEN}
                  site={{ ...siteInfo, control }}
                />
              </div>
            </section>
          )}
        </div>
      </div>

      <ExplainSite
        slug={site.slug}
        cached={briefings}
        enabled={Boolean(process.env.GROQ_API_KEY)}
      />
    </div>
  );
}
