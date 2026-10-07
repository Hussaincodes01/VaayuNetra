import "server-only";

import { getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import { CitizenReports } from "@/components/sustainability/CitizenReports";
import { DiversionTracker } from "@/components/sustainability/DiversionTracker";
import { MonthNav } from "@/components/sustainability/MonthNav";
import { ScorecardGrid } from "@/components/sustainability/ScorecardGrid";
import { Link } from "@/i18n/navigation";
import { getAssignees, getViewer } from "@/lib/dashboard-data";
import { createClient } from "@/lib/supabase/server";
import { monthParam } from "@/lib/sustainability";
import { getSustainabilityOverview } from "@/lib/sustainability-data";

// Per-user data (session cookie): never prerender.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("Sustain.page");
  return { title: t("title") };
}

/** Every landfill's scorecard for a month, the wet-waste diversion tracker and the report queue. */
export default async function SustainabilityPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const month = monthParam((await searchParams).month);
  const supabase = await createClient();
  const [viewer, data, assignees] = await Promise.all([
    getViewer(supabase),
    getSustainabilityOverview(supabase, month),
    getAssignees(supabase),
  ]);
  if (!viewer) notFound();
  const t = await getTranslations("Sustain.page");
  const canAct = viewer.role === "officer" || viewer.role === "admin";
  const cities = [...new Set(data.scorecard.map((r) => r.city))];

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold">{t("title")}</h1>
        <p className="max-w-3xl text-sm text-foreground/80">{t("intro")}</p>
        <div className="flex flex-wrap items-center gap-4">
          <MonthNav path="/dashboard/sustainability" month={month} />
          <Link
            href={`/scorecard?month=${month}`}
            className="text-sm text-leaf hover:underline"
          >
            {t("publicLink")}
          </Link>
        </div>
      </header>

      <ScorecardGrid
        rows={data.scorecard}
        siteHref={(slug) => `/dashboard/sites/${slug}#ledger`}
      />

      <CitizenReports
        reports={data.openReports}
        assignees={assignees}
        canAct={canAct}
        showSite
        slaHours={data.assumptions.reportSlaHours}
      />

      <DiversionTracker
        rows={data.diversion}
        cities={cities}
        assumptions={data.assumptions.diversion}
        canAct={canAct}
      />
    </div>
  );
}
