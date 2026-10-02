import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import seed from "@/content/field-test.json";
import { sendMail } from "@/lib/email";
import { sendTwilio, twilioChannel } from "@/lib/sms";
import { claim, settle } from "./claim";
import {
  composeEventAlert,
  composeWorkerOffline,
  eventSms,
  type EventInfo,
} from "./compose";
import { loadStateLists, pace, type Directory } from "./people";

/** Only passes from the last N days count as new, so the first run does not re-announce the archive. */
const LOOKBACK_DAYS = Number(process.env.ALERT_LOOKBACK_DAYS || 30);
/** worker_heartbeat.last_seen older than this sends the offline alert. */
export const WORKER_OFFLINE_MS = 2 * 60 * 60 * 1000;

export type EventOutcome = {
  scanId: string;
  site: string;
  passDate: string;
  tier: string;
  channel: string;
  result: "sent" | "failed" | "skipped_claimed" | "no_recipients";
  delivered?: number;
  error?: string;
};

type ScanJoin = {
  id: string;
  site_id: string;
  pass_date: string;
  overpass_utc: string | null;
  tier: "T1" | "T2";
  q_med: number | null;
  q_lo: number | null;
  q_hi: number | null;
  q_kgph: number | null;
  u10: number | null;
  scene_score: number;
  threshold_used: number;
  sites: { slug: string; name: string; city: string; state: string };
  evidence: { mbmp_url: string | null; rgb_url: string | null } | null;
};

/** Notebook evidence (data/seed) for passes the worker has not uploaded images for; same as the dashboard. */
function seedEvidence(slug: string, passDate: string): string | null {
  return (
    seed.flags.find((f) => f.slug === slug && f.date === passDate)?.evidence
      ?.mbmp ?? null
  );
}

export async function runEventAlerts(
  admin: SupabaseClient,
  now: Date,
  dir: () => Promise<Directory>,
): Promise<EventOutcome[]> {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { data, error } = await admin
    .from("scans")
    .select(
      "id, site_id, pass_date, overpass_utc, tier, q_med, q_lo, q_hi, q_kgph, u10, scene_score, threshold_used," +
        " sites!inner(slug, name, city, state, kind), evidence(mbmp_url, rgb_url)",
    )
    .in("tier", ["T1", "T2"])
    .eq("sites.kind", "landfill")
    .gte("pass_date", since)
    .order("pass_date", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) throw new Error(`scans: ${error.message}`);
  const scans = (data ?? []) as unknown as ScanJoin[];
  if (!scans.length) return [];

  // A re-scan of the same pass with new weights is a new scans row but the same event: alert once.
  const { data: existing, error: aErr } = await admin
    .from("alerts")
    .select("scan_id, channel, status, scans!inner(site_id, pass_date)")
    .gte("scans.pass_date", since);
  if (aErr) throw new Error(`alerts: ${aErr.message}`);
  const done = new Map<string, string>(); // `${site}|${date}|${channel}` -> scan_id that owns it
  for (const a of (existing ?? []) as unknown as {
    scan_id: string;
    channel: string;
    scans: { site_id: string; pass_date: string };
  }[])
    done.set(`${a.scans.site_id}|${a.scans.pass_date}|${a.channel}`, a.scan_id);

  const emails = await loadStateLists(admin, "alert_recipients");
  const sms = twilioChannel();
  const phones = sms ? await loadStateLists(admin, "alert_phones") : {};
  let directory: Directory | null = null;
  const outcomes: EventOutcome[] = [];

  for (const s of scans) {
    const ev: EventInfo = {
      slug: s.sites.slug,
      siteName: s.sites.name,
      city: s.sites.city,
      state: s.sites.state,
      tier: s.tier,
      passDate: s.pass_date,
      overpassUtc: s.overpass_utc,
      qMed: s.q_med,
      qLo: s.q_lo,
      qHi: s.q_hi,
      qKgph: s.q_kgph,
      u10: s.u10,
      sceneScore: s.scene_score,
      threshold: s.threshold_used,
      evidenceUrl:
        s.evidence?.mbmp_url ??
        s.evidence?.rgb_url ??
        seedEvidence(s.sites.slug, s.pass_date),
    };
    const channels: ("email" | "sms" | "whatsapp")[] = sms
      ? ["email", sms]
      : ["email"];
    for (const channel of channels) {
      const owner = done.get(`${s.site_id}|${s.pass_date}|${channel}`);
      // Another scans row of this pass already owns the alert; retries continue on that row only.
      if (owner && owner !== s.id) continue;
      const base = {
        scanId: s.id,
        site: ev.slug,
        passDate: ev.passDate,
        tier: ev.tier,
        channel,
      };
      const to = (channel === "email" ? emails : phones)[ev.state] ?? [];
      if (!to.length) {
        if (!owner) outcomes.push({ ...base, result: "no_recipients" });
        continue;
      }
      const claimed = await claim(admin, "alerts", { scan_id: s.id, channel });
      if (!claimed) {
        if (!owner) outcomes.push({ ...base, result: "skipped_claimed" });
        continue;
      }
      done.set(`${s.site_id}|${s.pass_date}|${channel}`, s.id);
      const delivered = [...claimed.delivered];
      const errors: string[] = [];
      for (const address of to.filter((a) => !delivered.includes(a))) {
        if (channel === "email") {
          directory ??= await dir();
          const lang = directory.langOf(address);
          const mail = await composeEventAlert(ev, lang);
          const r = await sendMail({
            to: address,
            ...mail,
            idempotencyKey: `alert/${claimed.id}/${address}/${claimed.attempt}`,
          });
          if (r.ok) delivered.push(address);
          else errors.push(`${address}: ${r.error}`);
          await pace();
        } else {
          const r = await sendTwilio(address, eventSms(ev));
          if (r.ok) delivered.push(address);
          else errors.push(`${address}: ${r.error}`);
        }
      }
      await settle(admin, "alerts", claimed.id, delivered, errors);
      outcomes.push({
        ...base,
        result: errors.length ? "failed" : "sent",
        delivered: delivered.length,
        ...(errors.length ? { error: errors.join("; ") } : {}),
      });
    }
  }
  return outcomes;
}

export type OfflineOutcome = {
  workerId: string;
  lastSeen: string;
  result: "sent" | "failed" | "skipped_claimed" | "no_recipients";
  delivered?: number;
  error?: string;
};

/** Email admins once per outage when a worker's heartbeat is older than two hours. */
export async function runWorkerOffline(
  admin: SupabaseClient,
  now: Date,
  dir: () => Promise<Directory>,
): Promise<OfflineOutcome[]> {
  const cutoff = new Date(now.getTime() - WORKER_OFFLINE_MS).toISOString();
  const { data, error } = await admin
    .from("worker_heartbeat")
    .select("worker_id, last_seen")
    .lt("last_seen", cutoff);
  if (error) throw new Error(`worker_heartbeat: ${error.message}`);
  const outcomes: OfflineOutcome[] = [];
  for (const hb of data ?? []) {
    const base = {
      workerId: hb.worker_id as string,
      lastSeen: hb.last_seen as string,
    };
    const claimed = await claim(admin, "ops_alerts", {
      kind: "worker_offline",
      ref: `${base.workerId}@${new Date(base.lastSeen).toISOString()}`,
    });
    if (!claimed) continue; // already alerted for this outage
    const directory = await dir();
    if (!directory.adminEmails.length) {
      await admin
        .from("ops_alerts")
        .update({ status: "no_recipients" })
        .eq("id", claimed.id);
      outcomes.push({ ...base, result: "no_recipients" });
      continue;
    }
    const delivered = [...claimed.delivered];
    const errors: string[] = [];
    for (const address of directory.adminEmails.filter(
      (a) => !delivered.includes(a),
    )) {
      const mail = await composeWorkerOffline(
        base.workerId,
        base.lastSeen,
        now,
        directory.langOf(address),
      );
      const r = await sendMail({
        to: address,
        ...mail,
        idempotencyKey: `ops/${claimed.id}/${address}/${claimed.attempt}`,
      });
      if (r.ok) delivered.push(address);
      else errors.push(`${address}: ${r.error}`);
      await pace();
    }
    await settle(admin, "ops_alerts", claimed.id, delivered, errors);
    outcomes.push({
      ...base,
      result: errors.length ? "failed" : "sent",
      delivered: delivered.length,
      ...(errors.length ? { error: errors.join("; ") } : {}),
    });
  }
  return outcomes;
}
