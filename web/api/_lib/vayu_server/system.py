"""What the System page shows: each server function's state, pipeline counters, Pi health.

States: ok, warn (works, but look at it), down (not working), off (switched off in the config).
Host figures come from /proc and /sys on the Pi; elsewhere they are None.
"""

from __future__ import annotations

import os
import shutil
import socket
import sqlite3
from collections.abc import Callable
from pathlib import Path
from typing import Any

from . import db
from .config import Config

CORE_OK_S, CORE_WARN_S = 180, 600
BRIDGE_OK_S = 600


def _read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        return None


def host_health(proc: Path | str = "/proc", sysfs: Path | str = "/sys",
                data_dir: Path | str = "/var/lib/vayu") -> dict[str, Any]:
    proc, sysfs = Path(proc), Path(sysfs)
    temp = _read(sysfs / "class" / "thermal" / "thermal_zone0" / "temp")
    load = _read(proc / "loadavg")
    mem = _read(proc / "meminfo")
    up = _read(proc / "uptime")
    meminfo = {}
    for line in (mem or "").splitlines():
        key, _, rest = line.partition(":")
        if rest.strip():
            meminfo[key] = int(rest.split()[0])  # kB
    disk = None
    for candidate in (Path(data_dir), Path(data_dir).parent, Path.cwd()):
        if candidate.exists():
            disk = shutil.disk_usage(candidate)
            break
    return {
        "cpu_temp_c": round(int(temp) / 1000, 1) if temp else None,
        "load_1m": float(load.split()[0]) if load else None,
        "cpus": os.cpu_count(),
        "mem_total_mb": round(meminfo["MemTotal"] / 1024) if "MemTotal" in meminfo else None,
        "mem_available_mb": (round(meminfo["MemAvailable"] / 1024)
                             if "MemAvailable" in meminfo else None),
        "uptime_h": round(float(up.split()[0]) / 3600, 1) if up else None,
        "disk_free_gb": round(disk.free / 2**30, 1) if disk else None,
        "disk_total_gb": round(disk.total / 2**30, 1) if disk else None,
    }


def tcp_ok(host: str, port: int, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def _age(conn: sqlite3.Connection, key: str, now: int) -> int | None:
    v = db.kv_get(conn, key)
    return None if v is None else now - int(v)


def _services(conn: sqlite3.Connection, cfg: Config, now: int,
              mqtt_ok: Callable[[], bool]) -> list[dict[str, Any]]:
    out = []
    core = _age(conn, "core_seen", now)
    out.append({"id": "core", "name": "Core: ingest, detection, SMS, work orders",
                "state": ("down" if core is None or core > CORE_WARN_S
                          else "ok" if core <= CORE_OK_S else "warn"),
                "detail": "never ran" if core is None else f"last tick {core} s ago"})
    state, seen = db.kv_get(conn, "bridge_state"), _age(conn, "bridge_seen", now)
    if state is None:
        bridge = ("warn", "not reported yet")
    elif state == "offline" or seen is None or seen > BRIDGE_OK_S:
        bridge = ("down", f"{state}, last heartbeat {seen} s ago")
    else:
        bridge = ("ok", f"online, heartbeat {seen} s ago")
    out.append({"id": "bridge", "name": "Radio bridge (LoRa radio on USB)", "state": bridge[0],
                "detail": bridge[1]})
    up = mqtt_ok()
    out.append({"id": "mqtt", "name": "MQTT broker (Mosquitto, localhost)",
                "state": "ok" if up else "down",
                "detail": f"{cfg.mqtt.host}:{cfg.mqtt.port} " + ("reachable" if up else
                                                                 "not reachable")})
    queued = conn.execute("SELECT COUNT(*) FROM alerts WHERE status = 'queued'").fetchone()[0]
    failed = conn.execute("SELECT COUNT(*) FROM alerts WHERE status = 'failed'").fetchone()[0]
    if cfg.sms.backend == "log":
        sms = ("warn", "log only: messages go to the outbox file (development)")
    elif shutil.which("mmcli") is None:
        sms = ("down", "mmcli (ModemManager) not installed")
    else:
        sms = ("warn" if failed else "ok", f"modem via ModemManager; {queued} queued, "
                                           f"{failed} failed")
    out.append({"id": "sms", "name": "SMS through the 4G modem", "state": sms[0],
                "detail": sms[1]})
    if not cfg.sync.url:
        sync = ("off", "no cloud URL set")
    else:
        last = _age(conn, "sync_last_ok", now)
        if last is None:
            sync = ("warn", "never uploaded")
        elif last <= 2 * cfg.sync.interval_s:
            sync = ("ok", f"last upload {last} s ago")
        else:
            sync = ("warn", f"last upload {last} s ago, overdue")
    out.append({"id": "sync", "name": "Cloud sync (background)", "state": sync[0],
                "detail": sync[1]})
    out.append({"id": "web", "name": "Dashboard", "state": "ok", "detail": "serving this page"})
    return out


def _pipeline(conn: sqlite3.Connection, cfg: Config, now: int) -> dict[str, Any]:
    def one(sql: str, *args: Any) -> Any:
        return conn.execute(sql, args).fetchone()[0]

    hour = now - 3600
    events = {r["kind"]: r["n"] for r in conn.execute(
        "SELECT kind, COUNT(*) AS n FROM events WHERE status = 'open' GROUP BY kind")}
    orders = {r["status"]: r["n"] for r in conn.execute(
        "SELECT status, COUNT(*) AS n FROM work_orders GROUP BY status")}
    db_bytes = sum(Path(cfg.paths.db + suffix).stat().st_size
                   for suffix in ("", "-wal") if Path(cfg.paths.db + suffix).exists())
    return {
        "packets_last_hour": one("SELECT COUNT(*) FROM (SELECT DISTINCT node_id, at FROM"
                                 " observations WHERE at > ?)", hour),
        "nodes_reporting": one("SELECT COUNT(DISTINCT node_id) FROM observations WHERE at > ?",
                               hour),
        "nodes_active": one("SELECT COUNT(*) FROM nodes WHERE active = 1"),
        "unknown_radios": one("SELECT COUNT(*) FROM unknown_radios"),
        "observations_total": one("SELECT COUNT(*) FROM observations"),
        "events_open": events,
        "events_24h": one("SELECT COUNT(*) FROM events WHERE opened_at > ?", now - 86400),
        "sms_sent_24h": one("SELECT COUNT(*) FROM alerts WHERE status = 'sent' AND sent_at > ?",
                            now - 86400),
        "sms_queued": one("SELECT COUNT(*) FROM alerts WHERE status = 'queued'"),
        "sms_failed": one("SELECT COUNT(*) FROM alerts WHERE status = 'failed'"),
        "recipients_active": one("SELECT COUNT(*) FROM recipients WHERE active = 1"),
        "work_orders": orders,
        "db_bytes": db_bytes,
    }


def status(conn: sqlite3.Connection, cfg: Config, now: int, proc: Path | str = "/proc",
           sysfs: Path | str = "/sys", mqtt_ok: Callable[[], bool] | None = None) -> dict:
    check = mqtt_ok or (lambda: tcp_ok(cfg.mqtt.host, cfg.mqtt.port))
    d = cfg.detect
    return {
        "now": now, "area": cfg.area.id,
        "services": _services(conn, cfg, now, check),
        "pipeline": _pipeline(conn, cfg, now),
        "host": host_health(proc, sysfs, Path(cfg.paths.db).parent),
        "detection": {"rise_ppm": d.rise_ppm, "min_nodes": d.min_nodes,
                      "sustain_readings": d.sustain_readings, "window_min": d.window_min,
                      "calm_ms": d.calm_ms, "lel_ppm": d.lel_ppm, "pm25_rise": d.pm25_rise,
                      "co_rise": d.co_rise, "offline_min": d.offline_min},
    }
