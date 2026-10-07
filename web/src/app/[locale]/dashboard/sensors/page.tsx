import "server-only";

import { getLocale, getTranslations } from "next-intl/server";
import { notFound } from "next/navigation";
import {
  AddLiveNode,
  SensorAlerts,
  SiteNetwork,
} from "@/components/sensors/SensorNetwork";
import { Link } from "@/i18n/navigation";
import { getViewer } from "@/lib/dashboard-data";
import { makeFormat, placeName } from "@/lib/format";
import { getSensorNetwork } from "@/lib/sensor-data";
import { createClient } from "@/lib/supabase/server";

// Per-user data (session cookie): never prerender.
export const dynamic = "force-dynamic";

export async function generateMetadata() {
  const t = await getTranslations("Sensors");
  return { title: t("title") };
}

/** The ground sensor network: nodes per landfill, early warnings, alerts and the model's record. */
export default async function SensorsPage() {
  const supabase = await createClient();
  const [viewer, net] = await Promise.all([
    getViewer(supabase),
    getSensorNetwork(supabase),
  ]);
  if (!viewer) notFound();
  const t = await getTranslations("Sensors");
  const tp = await getTranslations("Places");
  const f = makeFormat(await getLocale());
  const canAct = viewer.role === "officer" || viewer.role === "admin";
  const now = Date.now();
  const anySimulated = net.sites.some((s) =>
    s.nodes.some((n) => n.mode === "simulated"),
  );
  const m = net.model.metrics as Record<string, number | string>;
  const r = net.record;
  const { data: siteRows } = await supabase
    .from("site_locations")
    .select("id,slug,name")
    .eq("kind", "landfill")
    .order("name");

  return (
    <div className="space-y-8">
      <header className="space-y-2">
        <h1 className="font-heading text-3xl font-semibold">{t("title")}</h1>
        <p className="max-w-3xl text-sm text-foreground/80">
          {t("intro", { h: net.model.horizonH })}
        </p>
        {anySimulated && (
          <p className="max-w-3xl rounded-lg border border-methane-mid/40 bg-methane-mid/10 p-3 text-sm text-foreground/90">
            {t("simulatedNote")}
          </p>
        )}
      </header>

      <section
        aria-labelledby="record-title"
        className="grid gap-4 lg:grid-cols-2"
      >
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 id="record-title" className="font-heading text-lg font-semibold">
            {t("record.title")}
          </h2>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-sm">
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("record.warnings")}
              </dt>
              <dd className="font-mono text-xl text-canopy">
                {f.num(r.warnings)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("record.cameTrue")}
              </dt>
              <dd className="font-mono text-xl text-canopy">
                {r.warnings ? f.pct(r.cameTrue / r.warnings) : "—"}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">
                {t("record.lead")}
              </dt>
              <dd className="font-mono text-xl text-canopy">
                {r.medianLeadMin !== null
                  ? t("minutes", { n: f.num(r.medianLeadMin) })
                  : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs text-muted-foreground">
            {t("record.rises", { rises: r.rises, warned: r.risesWarned })}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="font-heading text-lg font-semibold">
            {t("model.title")}
          </h2>
          <p className="mt-2 text-sm text-foreground/85">
            {t("model.summary", {
              weights: net.model.weights,
              h: net.model.horizonH,
              auc: f.num(Number(m.test_roc_auc), 3),
              warned: f.pct(Number(m.warned_share)),
              lead: f.num(Number(m.median_lead_min)),
              baseWarned: f.pct(Number(m.baseline_warned_share)),
              baseLead: f.num(Number(m.baseline_median_lead_min)),
              fw: f.num(Number(m.false_warnings_per_node_week), 1),
            })}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {t("model.honest")}
          </p>
          <p className="mt-2 font-mono text-xs text-muted-foreground">
            {net.model.version} ·{" "}
            {t("model.levels", {
              rise: net.levels.risePpm,
              p: f.pct(net.levels.alertP),
            })}
          </p>
        </div>
      </section>

      <section
        aria-labelledby="alerts-title"
        className="rounded-xl border border-border bg-card p-5"
      >
        <h2 id="alerts-title" className="font-heading text-lg font-semibold">
          {t("alertsTitle")}
        </h2>
        <div className="mt-3">
          <SensorAlerts alerts={net.alerts} canAct={canAct} />
        </div>
      </section>

      {net.sites.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        net.sites.map((site) => {
          const name = placeName(tp as never, "sites", site.slug, site.name);
          return (
            <section
              key={site.slug}
              id={site.slug}
              aria-labelledby={`${site.slug}-net`}
              className="scroll-mt-20 space-y-3"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2
                  id={`${site.slug}-net`}
                  className="font-heading text-xl font-semibold"
                >
                  {name}
                </h2>
                <Link
                  href={`/dashboard/sites/${site.slug}`}
                  className="text-sm text-leaf hover:underline"
                >
                  {t("siteLink")}
                </Link>
              </div>
              <SiteNetwork
                site={{ slug: site.slug, name }}
                nodes={site.nodes}
                rise={net.levels.risePpm}
                now={now}
              />
            </section>
          );
        })
      )}

      <section className="space-y-3">
        <p className="text-xs text-muted-foreground">
          {t("chartNote", { rise: net.levels.risePpm })} {t("ingestNote")}
        </p>
        {viewer.role === "admin" && (
          <AddLiveNode
            sites={(siteRows ?? []).map((s) => ({ id: s.id, name: s.name }))}
          />
        )}
      </section>
    </div>
  );
}
