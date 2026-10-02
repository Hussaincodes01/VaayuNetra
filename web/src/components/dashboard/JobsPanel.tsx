"use client";

import { RefreshCw } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useState, useTransition } from "react";
import { requestJob } from "@/app/[locale]/dashboard/actions";
import {
  WORKER_ONLINE_MS,
  type Heartbeat,
  type JobRow,
} from "@/lib/dashboard-shared";
import { makeFormat } from "@/lib/format";
import { getBrowserClient } from "@/lib/supabase/client";

type Row = Record<string, unknown>;
const toJob = (r: Row): JobRow => ({
  id: String(r.id),
  kind: r.kind as JobRow["kind"],
  siteId: (r.site_id as string) ?? null,
  status: r.status as JobRow["status"],
  log: (r.log as string) ?? null,
  createdAt: String(r.created_at),
  startedAt: (r.started_at as string) ?? null,
  finishedAt: (r.finished_at as string) ?? null,
});

/** "Request scan" with live job status (Supabase Realtime). Disabled while the worker is offline. */
export function JobsPanel({
  siteId,
  initialJobs,
  heartbeat,
  canAct,
}: {
  siteId: string;
  initialJobs: JobRow[];
  heartbeat: Heartbeat;
  canAct: boolean;
}) {
  const t = useTranslations("Dash.jobs");
  const f = makeFormat(useLocale());
  const [jobs, setJobs] = useState(initialJobs);
  const [lastSeen, setLastSeen] = useState(heartbeat?.lastSeen ?? null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const online =
    lastSeen !== null && now - new Date(lastSeen).getTime() < WORKER_ONLINE_MS;

  useEffect(() => {
    const supabase = getBrowserClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;
    // Join as the signed-in user: Realtime checks column privileges with the token's role, and an
    // anon join (session not yet read from cookies) is refused for jobs.
    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) supabase.realtime.setAuth(data.session.access_token);
      channel = subscribe();
    });
    // Re-read once the subscription is live and every 30 s. This catches changes made before the
    // channel joined, or while Realtime was still starting its replication (it drops those).
    const refresh = async () => {
      const [jobRows, beat] = await Promise.all([
        supabase
          .from("jobs")
          .select(
            "id, kind, site_id, status, log, created_at, started_at, finished_at",
          )
          .eq("site_id", siteId)
          .order("created_at", { ascending: false })
          .limit(5),
        supabase
          .from("worker_heartbeat")
          .select("last_seen")
          .order("last_seen", { ascending: false })
          .limit(1),
      ]);
      if (cancelled) return;
      if (jobRows.data) setJobs(jobRows.data.map((r) => toJob(r as Row)));
      const seen = beat.data?.[0]?.last_seen;
      if (seen) setLastSeen(String(seen));
    };
    const subscribe = () =>
      supabase
        .channel(`site-jobs-${siteId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "jobs",
            filter: `site_id=eq.${siteId}`,
          },
          (payload) => {
            const job = toJob(payload.new as Row);
            setJobs((list) =>
              [job, ...list.filter((j) => j.id !== job.id)].slice(0, 5),
            );
          },
        )
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "worker_heartbeat" },
          (payload) => {
            const seen = (payload.new as Row)?.last_seen;
            if (seen) setLastSeen(String(seen));
          },
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") void refresh();
        });
    const tick = window.setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(tick);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [siteId]);

  const request = (kind: "scan_site" | "rebuild_dossier") =>
    start(async () => {
      setError(null);
      const r = await requestJob(siteId, kind);
      if (!r.ok) setError(r.error);
      else if (r.job) {
        const job = toJob(r.job);
        setJobs((list) =>
          [job, ...list.filter((j) => j.id !== job.id)].slice(0, 5),
        );
      }
    });

  return (
    <section
      aria-labelledby="jobs-title"
      className="rounded-xl border border-white/10 bg-card p-5"
    >
      <h2 id="jobs-title" className="font-heading text-lg font-semibold">
        {t("title")}
      </h2>
      <p className="mt-1 flex items-center gap-2 text-sm">
        <span
          aria-hidden
          className={
            online
              ? "size-2 rounded-full bg-tier-clear"
              : "size-2 rounded-full bg-muted-foreground"
          }
        />
        {online ? t("online") : t("offline")}
        {lastSeen && (
          <span className="text-xs text-muted-foreground">
            · {t("seen", { when: f.dateTime(lastSeen) })}
          </span>
        )}
      </p>
      {canAct && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!online || pending}
            onClick={() => request("scan_site")}
            aria-describedby={!online ? "worker-offline-note" : undefined}
            className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <RefreshCw className="size-4" aria-hidden />{" "}
            {pending ? t("requesting") : t("requestScan")}
          </button>
          <button
            type="button"
            disabled={!online || pending}
            onClick={() => request("rebuild_dossier")}
            className="rounded-md border border-white/15 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("rebuild")}
          </button>
        </div>
      )}
      {canAct && !online && (
        <p id="worker-offline-note" className="mt-2 text-xs text-[#FCD34D]">
          {t("offlineNote")}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-xs text-[#FCA5A5]">
          {error}
        </p>
      )}
      <ul className="mt-4 space-y-2 text-sm" aria-live="polite">
        {jobs.length === 0 && (
          <li className="text-muted-foreground">{t("none")}</li>
        )}
        {jobs.map((j) => (
          <li
            key={j.id}
            className="rounded-md border border-white/10 px-3 py-2"
          >
            <div className="flex items-center justify-between gap-2">
              <span>{t(`kind.${j.kind}`)}</span>
              <span className="font-mono text-xs">
                {t(`status.${j.status}`)}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {f.dateTime(j.finishedAt ?? j.startedAt ?? j.createdAt)}
            </p>
            {j.log && j.status !== "queued" && (
              <pre className="mt-1 max-h-24 overflow-auto rounded bg-black/40 p-2 text-[11px] whitespace-pre-wrap text-foreground/70">
                {j.log.trim().split("\n").slice(-4).join("\n")}
              </pre>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
