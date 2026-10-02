"""Worker entry points: scan, monitor, backfill, dossier and the long-running worker loop.

The worker makes outbound connections only (Earth Engine, Supabase). It never listens on a public
port; the optional health endpoint binds to 127.0.0.1.
"""

from __future__ import annotations

import datetime as dt
import io
import json
import logging
import threading
import traceback
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Any

from vayunetra import __version__
from vayunetra import earth_engine as gee
from vayunetra import outputs as out
from vayunetra.config import Settings
from vayunetra.model import VayuModel, find_model_zip, load_model
from vayunetra.physics import Lut
from vayunetra.pipeline import (
    END,
    START,
    Scanner,
    ScanResult,
    Site,
    builtin_sites,
    monitor_window,
    threshold_from_settings,
)
from vayunetra.sync import (
    DOSSIER_BUCKET,
    EVIDENCE_BUCKET,
    Supabase,
    evidence_path,
    scan_record,
)

log = logging.getLogger("vayunetra")

IST = dt.timezone(dt.timedelta(hours=5, minutes=30), "IST")

# Ops-notebook assumptions; Supabase settings override any key present there.
DEFAULT_ASSUMPTIONS: dict[str, float] = dict(
    gwp100=27.0, gwp20=79.7, capture_eff=0.60, flare_destruction=0.98, ch4_lhv_mj_per_kg=50.0,
    engine_eff=0.35, power_price_inr_per_kwh=5.0, carbon_price_usd_per_t=10.0, wind_rel_unc=0.30,
    calib_rel_unc=0.20,
)  # fmt: skip


@dataclass
class Runtime:
    settings: Settings
    model: VayuModel
    lut: Lut
    scanner: Scanner
    supabase: Supabase | None
    threshold_mode: str
    assumptions: dict[str, float]


def build_runtime(settings: Settings, offline: bool = False, need_supabase: bool = True) -> Runtime:
    model = load_model(find_model_zip(settings.model_zip), settings.cache_dir, settings.device)
    lut = Lut.load(model.lut_path)
    supa = None
    if settings.supabase_url and settings.supabase_service_role_key:
        supa = Supabase(settings.supabase_url, settings.supabase_service_role_key)
    elif need_supabase:
        raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set (or pass --no-upload)")
    db_settings = supa.settings() if supa else {}
    threshold, mode = threshold_from_settings(db_settings, model.threshold)
    assumptions = {**DEFAULT_ASSUMPTIONS,
                   **{k: float(v) for k, v in db_settings.items() if k in DEFAULT_ASSUMPTIONS}}  # fmt: skip
    if not offline:
        gee.initialize(settings.ee_project, settings.ee_service_account, settings.ee_key_file)
    scanner = Scanner(model=model, lut=lut, threshold=threshold, cache_dir=settings.cache_dir,
                      offline=offline, assumptions=assumptions)  # fmt: skip
    log.info("model %s on %s | threshold %.3f (%s) | U_eff = %.3f*U10 + %.3f",
             model.model_version, model.device, threshold, mode, model.a_cal, model.b_cal)  # fmt: skip
    return Runtime(settings, model, lut, scanner, supa, mode, assumptions)


# --- Sites ---------------------------------------------------------------------------------------


def load_sites(rt: Runtime) -> list[Site]:
    if rt.supabase is None:
        return builtin_sites()
    rows = rt.supabase.sites()
    return [
        Site(
            slug=r["slug"],
            name=r["name"],
            lat=float(r["lat"]),
            lon=float(r["lon"]),
            elev=float(r["elev_m"] or 100),
            city=r["city"],
            kind=r["kind"],
            id=r["id"],
            control_of=r.get("control_of"),
        )  # fmt: skip
        for r in rows
    ]


def site_with_control(sites: list[Site], slug: str) -> list[Site]:
    """A landfill and its control point (a control slug returns just that control)."""
    site = next((s for s in sites if s.slug == slug), None)
    if site is None:
        raise SystemExit(f"unknown site '{slug}'; known: {', '.join(s.slug for s in sites)}")
    if site.kind == "control":
        return [site]
    control = next((s for s in sites if s.kind == "control" and
                    (s.control_of == site.id if site.id else s.slug == f"{site.slug}-control")), None)  # fmt: skip
    return [site] + ([control] if control else [])


# --- Publishing ----------------------------------------------------------------------------------


def publish(rt: Runtime, site: Site, results: list[ScanResult]) -> int:
    """Upsert scans; for every detected pass upload the evidence images and plume polygon."""
    supa = rt.supabase
    if supa is None or not results:
        return 0
    if site.id is None:
        raise RuntimeError(f"site {site.slug} has no database id; seed the sites table first")
    mv = rt.model.model_version
    saved = supa.upsert_scans([scan_record(r.row, site.id, rt.scanner.threshold, mv) for r in results])
    ids = {s["pass_date"]: s["id"] for s in saved}
    for r in results:
        if r.evidence is None:
            continue
        ev, row = r.evidence, r.row
        date = str(row["date"])
        path = lambda name, d=date: evidence_path(site.slug, d, mv, name)  # noqa: E731
        urls = {
            "rgb_url": supa.upload(EVIDENCE_BUCKET, path("rgb.png"), out.rgb_png(ev.rgb), "image/png"),
            "mbmp_url": supa.upload(EVIDENCE_BUCKET, path("mbmp.png"), out.mbmp_png(ev.m), "image/png"),
            "mask_url": supa.upload(EVIDENCE_BUCKET, path("mask.png"),
                                    out.mask_png(ev.rgb, ev.prob, ev.u, ev.v), "image/png"),
            "panel_url": supa.upload(EVIDENCE_BUCKET, path("panel.png"),
                                     out.panel_png(site.name, date, ev.rgb, ev.m, ev.prob, ev.u, ev.v,
                                                   row["tier"], float(row.get("q_kgph", float("nan")))),
                                     "image/png"),
        }  # fmt: skip
        plume = out.plume_geojson(ev.prob, site.lat, site.lon)
        supa.upload(EVIDENCE_BUCKET, path("plume.geojson"), json.dumps(plume).encode(), "application/geo+json")
        supa.upsert_evidence({"scan_id": ids[date], **urls, "plume_geojson": plume,
                              "chip_bounds": out.chip_bounds(site.lat, site.lon)})  # fmt: skip
    return len(saved)


def _summarise(site: Site, results: list[ScanResult]) -> str:
    flags = [r.row for r in results if r.row["detected"]]
    tiers = ", ".join(f"{f['date']} {f['tier']}" for f in flags) or "none"
    return f"{site.name}: {len(results)} passes scanned, flags: {tiers}"


# --- Commands ------------------------------------------------------------------------------------


def scan(rt: Runtime, slug: str, start: str = START, end: str = END, upload: bool = True,
         echo: Callable[[str], None] = log.info) -> list[ScanResult]:  # fmt: skip
    """Scan a landfill and its control point over [start, end] and publish the results."""
    every: list[ScanResult] = []
    for site in site_with_control(load_sites(rt), slug):
        results = rt.scanner.scan_site(site, start=start, end=end)
        echo(_summarise(site, results))
        if upload:
            echo(f"{site.name}: {publish(rt, site, results)} scans upserted")
        every += results
    return every


def monitor(rt: Runtime, echo: Callable[[str], None] = log.info) -> list[ScanResult]:
    """Scan only passes newer than the last stored pass at every active site."""
    every: list[ScanResult] = []
    for site in load_sites(rt):
        last = rt.supabase.last_pass_date(site.id, rt.model.model_version) if rt.supabase and site.id else None
        start, end, after = monitor_window(last)
        results = rt.scanner.scan_site(site, start=start, end=end, target_after=after)
        echo(_summarise(site, results))
        if rt.supabase is not None:
            publish(rt, site, results)
        alerts = [r.row for r in results if site.kind == "landfill" and r.row["tier"] in ("T1", "T2")]
        for a in alerts:
            echo(f"ALERT {site.name} {a['date']} {a['tier']} q={a.get('q_kgph')} score={a['scene_score']}")
        every += results
    return every


def backfill(rt: Runtime, date_from: str, date_to: str | None = None,
             echo: Callable[[str], None] = log.info) -> list[ScanResult]:  # fmt: skip
    end = date_to or dt.date.today().isoformat()
    every: list[ScanResult] = []
    for site in load_sites(rt):
        results = rt.scanner.scan_site(site, start=date_from, end=end)
        echo(_summarise(site, results))
        if rt.supabase is not None:
            publish(rt, site, results)
        every += results
    return every


def rebuild_dossier(rt: Runtime, slug: str, echo: Callable[[str], None] = log.info) -> str:
    """Rebuild a landfill's dossier (HTML, and PDF when Playwright is available) in the dossiers bucket."""
    supa = rt.supabase
    if supa is None:
        raise SystemExit("rebuilding a dossier needs Supabase")
    stats = supa.select("site_stats", select="*", slug=f"eq.{slug}")
    if not stats:
        raise SystemExit(f"no site_stats row for '{slug}'")
    s = stats[0]
    scans = supa.select("scans", select="*", site_id=f"eq.{s['site_id']}",
                        model_version=f"eq.{rt.model.model_version}", order="pass_date.asc")  # fmt: skip
    flagged = [r["id"] for r in scans if r["detected"]]
    panels = {}
    if flagged:
        ev = supa.select("evidence", select="scan_id,panel_url", scan_id=f"in.({','.join(flagged)})")
        panels = {e["scan_id"]: e["panel_url"] for e in ev if e.get("panel_url")}
    window = (scans[0]["pass_date"], scans[-1]["pass_date"]) if scans else (START, END)
    html = out.dossier_html(s, scans, panels, rt.assumptions, rt.scanner.threshold, rt.model.a_cal,
                            rt.model.b_cal, window)  # fmt: skip
    url = supa.upload(DOSSIER_BUCKET, f"{slug}.html", html.encode("utf-8"), "text/html; charset=utf-8")
    echo(f"dossier → {url}")
    try:
        pdf = out.html_to_pdf(html, rt.settings.cache_dir / "dossiers" / f"{slug}.pdf")
        echo(f"dossier PDF → {supa.upload(DOSSIER_BUCKET, f'{slug}.pdf', pdf.read_bytes(), 'application/pdf')}")
    except Exception as e:  # Playwright/Chromium missing: the HTML dossier is still published
        echo(f"PDF skipped: {e!r}"[:200])
    return url


# --- Worker loop ---------------------------------------------------------------------------------


class _JobLog(logging.Handler):
    """Collects log lines for the job currently running."""

    def __init__(self) -> None:
        super().__init__(logging.INFO)
        self.buf = io.StringIO()

    def emit(self, record: logging.LogRecord) -> None:
        self.buf.write(f"{dt.datetime.now(IST):%H:%M:%S} {record.getMessage()}\n")

    def text(self) -> str:
        return self.buf.getvalue()[-60000:]


def run_job(rt: Runtime, job: Mapping[str, Any]) -> None:
    supa = rt.supabase
    assert supa is not None
    handler = _JobLog()
    log.addHandler(handler)
    status = "done"
    try:
        params = job.get("params") or {}
        kind = job["kind"]
        if kind == "monitor_all":
            monitor(rt)
        elif kind in ("scan_site", "rebuild_dossier"):
            site = next((s for s in load_sites(rt) if s.id == job.get("site_id")), None)
            if site is None:
                raise RuntimeError(f"job {job['id']}: unknown site_id {job.get('site_id')}")
            if kind == "scan_site":
                scan(rt, site.slug, params.get("start", START), params.get("end", dt.date.today().isoformat()))
            else:
                rebuild_dossier(rt, site.slug)
        else:
            raise RuntimeError(f"unknown job kind {kind}")
    except Exception:
        status = "failed"
        log.error(traceback.format_exc())
    finally:
        log.removeHandler(handler)
        supa.finish_job(job["id"], status, handler.text())
        log.info("job %s %s → %s", job["id"], job["kind"], status)


def _heartbeat_loop(rt: Runtime, stop: threading.Event, state: dict[str, Any]) -> None:
    supa = rt.supabase
    assert supa is not None
    while not stop.is_set():
        try:
            supa.heartbeat(rt.settings.worker_id, __version__, rt.model.device, int(state.get("queue_depth", 0)))
            state["last_heartbeat"] = dt.datetime.now(dt.UTC).isoformat()
        except Exception as e:
            log.warning("heartbeat failed: %r", e)
        stop.wait(60)


def run_worker(settings: Settings, health_port: int | None = None, poll_s: int = 30) -> None:
    from croniter import croniter

    rt = build_runtime(settings)
    assert rt.supabase is not None
    state: dict[str, Any] = {"queue_depth": 0, "busy": None, "started": dt.datetime.now(dt.UTC).isoformat()}
    stop = threading.Event()
    threading.Thread(target=_heartbeat_loop, args=(rt, stop, state), daemon=True).start()
    if health_port:
        from vayunetra.api import serve_health

        serve_health(state, rt.settings.worker_id, health_port)
    cron = croniter(settings.monitor_cron, dt.datetime.now(IST))
    next_monitor = cron.get_next(dt.datetime)
    log.info("worker %s up | polling jobs every %ss | next monitor %s", settings.worker_id, poll_s, next_monitor)
    try:
        while True:
            try:
                jobs = rt.supabase.queued_jobs()
                state["queue_depth"] = len(jobs)
                for job in jobs:
                    claimed = rt.supabase.claim_job(job["id"])
                    if claimed:
                        state["busy"] = job["id"]
                        run_job(rt, claimed)
                        state["busy"] = None
                if dt.datetime.now(IST) >= next_monitor:
                    # Scheduled runs go through the jobs table too, so they get status and logs.
                    rt.supabase.enqueue_job("monitor_all", params={"trigger": "cron"})
                    next_monitor = cron.get_next(dt.datetime)
                    log.info("monitor queued; next %s", next_monitor)
                    continue
            except Exception:
                log.error("worker loop error:\n%s", traceback.format_exc())
            stop.wait(poll_s)
    except KeyboardInterrupt:
        log.info("worker stopping")
    finally:
        stop.set()
