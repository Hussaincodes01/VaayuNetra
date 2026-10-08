"""Read helpers over the observations table: latest value, windows, area wind and pressure."""

from __future__ import annotations

import sqlite3
import statistics

from . import geo
from .config import Config


def latest(conn: sqlite3.Connection, node_id: str, variable: str, t: int,
           max_age_s: int) -> tuple[int, float] | None:
    """Most recent (at, value) with t - max_age_s <= at <= t."""
    r = conn.execute(
        "SELECT at, value FROM observations WHERE node_id = ? AND variable = ?"
        " AND at BETWEEN ? AND ? ORDER BY at DESC LIMIT 1",
        (node_id, variable, t - max_age_s, t)).fetchone()
    return (r["at"], r["value"]) if r else None


def nearest(conn: sqlite3.Connection, node_id: str, variable: str, t: int,
            window_s: int) -> float | None:
    r = conn.execute(
        "SELECT value FROM observations WHERE node_id = ? AND variable = ?"
        " AND at BETWEEN ? AND ? ORDER BY ABS(at - ?) LIMIT 1",
        (node_id, variable, t - window_s, t + window_s, t)).fetchone()
    return r["value"] if r else None


def between(conn: sqlite3.Connection, node_id: str, variable: str, t_from: int,
            t_to: int) -> list[tuple[int, float]]:
    """(at, value) with t_from < at <= t_to, oldest first."""
    return [(r["at"], r["value"]) for r in conn.execute(
        "SELECT at, value FROM observations WHERE node_id = ? AND variable = ?"
        " AND at > ? AND at <= ? ORDER BY at", (node_id, variable, t_from, t_to))]


def active_nodes(conn: sqlite3.Connection, area_id: str) -> list[sqlite3.Row]:
    return conn.execute("SELECT * FROM nodes WHERE area_id = ? AND active = 1 ORDER BY id",
                        (area_id,)).fetchall()


def area_wind(conn: sqlite3.Connection, cfg: Config, t: int) -> tuple[float, float] | None:
    """Vector mean of the latest (speed, from-direction) at every head node, if recent enough."""
    winds = []
    for node in conn.execute("SELECT id FROM nodes WHERE area_id = ? AND role = 'head'"
                             " AND active = 1", (cfg.area.id,)):
        speed = latest(conn, node["id"], "wind_ms", t, cfg.detect.wind_max_age_min * 60)
        if speed is None:
            continue
        frm = conn.execute(
            "SELECT value FROM observations WHERE node_id = ? AND variable = 'wind_from_deg'"
            " AND at = ?", (node["id"], speed[0])).fetchone()
        if frm is not None:
            winds.append((speed[1], frm["value"]))
    return geo.mean_wind(winds)


def area_median_latest(conn: sqlite3.Connection, area_id: str, variable: str, t: int,
                       max_age_s: int) -> float | None:
    values = [v[1] for n in active_nodes(conn, area_id)
              if (v := latest(conn, n["id"], variable, t, max_age_s)) is not None]
    return statistics.median(values) if values else None


def area_pressure_change(conn: sqlite3.Connection, area_id: str, t: int, hours: float,
                         window_s: int = 1800) -> float | None:
    """Median over nodes of each node's own pressure change across the last `hours` (hPa).
    Differencing per node first cancels the offsets between low-cost pressure sensors."""
    diffs = []
    for n in active_nodes(conn, area_id):
        now = latest(conn, n["id"], "pressure_hpa", t, window_s)
        then = nearest(conn, n["id"], "pressure_hpa", int(t - hours * 3600), window_s)
        if now is not None and then is not None:
            diffs.append(now[1] - then)
    return statistics.median(diffs) if diffs else None
