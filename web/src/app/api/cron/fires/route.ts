import "server-only";

import { NextResponse } from "next/server";
import { cronGuard } from "@/lib/alerts/cron";
import { loadStateLists, pace } from "@/lib/alerts/people";
import { emailConfigured, sendEmail } from "@/lib/email";
import {
  FIRMS_SOURCES,
  fetchDetections,
  firmsConfigured,
  isFirmsSource,
  type Detection,
} from "@/lib/firms";
import { SITE_URL } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Polls run at most this often; the GitHub Actions schedule calls the route every 15 minutes. */
const MIN_INTERVAL_MS = 55 * 60 * 1000;
/** Only detections this recent are emailed, so an archive replay never mails old fires. */
const ALERT_WINDOW_MS = 2 * 86_400_000;

type Site = {
  id: string;
  slug: string;
  name: string;
  state: string;
  lat: number;
  lon: number;
};

/**
 * NASA FIRMS fire detections within 1 km of each active landfill: stored in fire_detections and
 * emailed to the state's alert recipients. Optional query (admin replays): ?date=YYYY-MM-DD&days=1..5
 * &source=VIIRS_SNPP_SP&force=1.
 */
export async function GET(request: Request) {
  const denied = cronGuard(request);
  if (denied) return denied;
  if (!firmsConfigured())
    return NextResponse.json(
      { error: "FIRMS_MAP_KEY is not set" },
      { status: 503 },
    );

  const q = new URL(request.url).searchParams;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(q.get("date") ?? "")
    ? q.get("date")!
    : undefined;
  const days = Math.min(5, Math.max(1, Number(q.get("days") ?? 2) || 2));
  const sourceParam = q.get("source");
  if (sourceParam && !isFirmsSource(sourceParam))
    return NextResponse.json({ error: "unknown source" }, { status: 400 });
  const sources = sourceParam ? [sourceParam] : [...FIRMS_SOURCES];
  const admin = createAdminClient();
  const now = new Date();

  if (!date && q.get("force") !== "1") {
    const { data: last } = await admin
      .from("settings")
      .select("value")
      .eq("key", "firms_last_poll")
      .maybeSingle();
    const at = Date.parse(String(last?.value ?? ""));
    if (Number.isFinite(at) && now.getTime() - at < MIN_INTERVAL_MS)
      return NextResponse.json({
        ok: true,
        skipped: "polled recently",
        last: last?.value,
      });
  }

  const { data: siteRows, error } = await admin
    .from("site_locations")
    .select("id,slug,name,state,lat,lon")
    .eq("kind", "landfill")
    .eq("active", true);
  if (error)
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 },
    );
  const sites = (siteRows ?? []) as Site[];

  const inserted: { site: string; source: string; acqAt: string }[] = [];
  const failures: string[] = [];
  const fresh: { site: Site; d: Detection; id: string }[] = [];
  for (const site of sites) {
    for (const source of sources) {
      let found: Detection[] = [];
      try {
        found = await fetchDetections(site, source, days, date);
      } catch (e) {
        failures.push(`${site.slug} ${source}: ${(e as Error).message}`);
        continue;
      }
      if (!found.length) continue;
      const { data, error: insErr } = await admin
        .from("fire_detections")
        .upsert(
          found.map((d) => ({
            site_id: site.id,
            source: d.source,
            acq_at: d.acqAt,
            lat: d.lat,
            lon: d.lon,
            dist_m: d.distM,
            confidence: d.confidence,
            frp_mw: d.frpMw,
          })),
          {
            onConflict: "site_id,source,acq_at,lat,lon",
            ignoreDuplicates: true,
          },
        )
        .select("id,acq_at,source");
      if (insErr) {
        failures.push(`${site.slug} ${source}: ${insErr.message}`);
        continue;
      }
      for (const row of data ?? []) {
        inserted.push({
          site: site.slug,
          source: String(row.source),
          acqAt: String(row.acq_at),
        });
        const d = found.find(
          (x) => Date.parse(x.acqAt) === Date.parse(String(row.acq_at)),
        );
        if (d && now.getTime() - Date.parse(d.acqAt) < ALERT_WINDOW_MS)
          fresh.push({ site, d, id: String(row.id) });
      }
    }
  }

  // One email per site per run, to the state's recipients, for detections not yet alerted.
  let mailed = 0;
  if (fresh.length && emailConfigured) {
    const lists = await loadStateLists(admin, "alert_recipients");
    const bySite = new Map<string, { site: Site; items: typeof fresh }>();
    for (const f of fresh) {
      const entry = bySite.get(f.site.id) ?? { site: f.site, items: [] };
      entry.items.push(f);
      bySite.set(f.site.id, entry);
    }
    for (const { site, items } of bySite.values()) {
      const to = lists[site.state] ?? [];
      if (!to.length) continue;
      const link = `${SITE_URL}/dashboard/sites/${site.slug}#fires`;
      const rows = items
        .map(
          ({ d }) =>
            `<li>${d.acqAt.replace("T", " ").replace(":00Z", " UTC")} · ${d.source.replace(/_/g, " ")} · ${d.distM} m from the site point</li>`,
        )
        .join("");
      const html = `<p>NASA FIRMS reported <b>${items.length}</b> fire detection(s) within 1 km of <b>${site.name}</b>.</p>
        <ul>${rows}</ul>
        <p>NASA FIRMS ने <b>${site.name}</b> के 1 किमी के भीतर ${items.length} आग का पता लगाया है।</p>
        <p><a href="${link}">Open the fire log in the VayuNetra dashboard</a> to mark each one out or not a fire.</p>
        <p style="color:#4a6355">A satellite fire detection is a heat signal, not a confirmed fire; check on the ground.</p>`;
      let sent = false;
      for (const addr of to) {
        sent =
          (await sendEmail(
            addr,
            `VayuNetra: fire detected near ${site.name}`,
            html,
          )) || sent;
        await pace();
      }
      if (sent) {
        mailed++;
        await admin
          .from("fire_detections")
          .update({ alerted_at: now.toISOString() })
          .in(
            "id",
            items.map((i) => i.id),
          );
      }
    }
  }

  if (!date)
    await admin
      .from("settings")
      .upsert(
        { key: "firms_last_poll", value: now.toISOString(), is_public: false },
        { onConflict: "key" },
      );

  return NextResponse.json(
    {
      ok: failures.length === 0,
      at: now.toISOString(),
      inserted,
      mailed,
      failures,
    },
    { status: failures.length && !inserted.length ? 502 : 200 },
  );
}
