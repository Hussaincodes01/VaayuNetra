"""One packet from the radio bridge -> stored observations.

The bridge publishes each node's packet as JSON on vn/{area}/{radio_id}/raw:

    {"readings": [{"at": "2025-10-08T05:10:00Z" | 1759900200, "rs_ratio": 0.82, "temp_c": 29.4,
                   "rh_pct": 71, "pressure_hpa": 1007.9, "battery_v": 3.96, ...}],
     "radio": {"rssi": -97, "snr": 6.5, "hops": 1}}

Every numeric field except "at" is stored as one observation. Implausible values are dropped (the
rest of the reading is kept). Then the methane reading is calibrated to ppm and its excess above
baseline is stored: against the background node when it reported within a few minutes, otherwise
against the node's own 10th percentile over the last day (VayuNetra's rule).
"""

from __future__ import annotations

import json
import logging
import math
import re
import sqlite3
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any

from . import db
from .calibrate import CalibrationError, calibrate
from .config import Config

log = logging.getLogger(__name__)

MAX_READINGS = 500
MAX_AGE_S = 30 * 86_400  # a node may send a backlog after being out of range
MAX_FUTURE_S = 300

UNITS = {
    "rs_ratio": "1", "ndir_ppm": "ppm", "ch4_ppm": "ppm", "ch4_excess_ppm": "ppm",
    "temp_c": "degC", "rh_pct": "%", "pressure_hpa": "hPa", "pm25_ugm3": "ug/m3",
    "co_ppm": "ppm", "wind_ms": "m/s", "wind_from_deg": "deg", "battery_v": "V", "solar_v": "V",
}
RANGES = {
    "rs_ratio": (1e-4, 1e3), "ndir_ppm": (0, 1e6), "ch4_ppm": (0, 1e6), "temp_c": (-40, 85),
    "rh_pct": (0, 100), "pressure_hpa": (300, 1100), "pm25_ugm3": (0, 5000), "co_ppm": (0, 2000),
    "wind_ms": (0, 75), "wind_from_deg": (0, 360), "battery_v": (0, 6), "solar_v": (0, 30),
}
NAME = re.compile(r"^[a-z][a-z0-9_]{0,31}$")


@dataclass
class IngestResult:
    node_id: str | None = None
    accepted: int = 0
    rejected: list[tuple[int, str]] = field(default_factory=list)
    times: list[int] = field(default_factory=list)
    error: str = ""


def _parse_time(value: Any, now: int) -> int | None:
    if value is None:
        return now  # node without a clock: the bridge's receive time
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        t = int(value)
    elif isinstance(value, str):
        try:
            t = int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())
        except ValueError:
            return None
    else:
        return None
    return t if now - MAX_AGE_S <= t <= now + MAX_FUTURE_S else None


def _values(r: dict, index: int, rejected: list[tuple[int, str]]) -> dict[str, float]:
    out: dict[str, float] = {}
    for key, value in r.items():
        if key == "at" or not NAME.match(key):
            continue
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            rejected.append((index, f"{key} not a number"))
            continue
        lo, hi = RANGES.get(key, (-math.inf, math.inf))
        if not math.isfinite(value) or not lo <= value <= hi:
            rejected.append((index, f"{key} out of range"))
            continue
        out[key] = float(value)
    return out


def _percentile(values: list[float], pct: float) -> float:
    s = sorted(values)
    return s[min(len(s) - 1, int(len(s) * pct / 100))]


def _excess(conn: sqlite3.Connection, cfg: Config, node: sqlite3.Row, at: int,
            ppm: float) -> tuple[float, str] | None:
    d = cfg.detect
    bg = conn.execute(
        "SELECT id FROM nodes WHERE area_id = ? AND role = 'background' AND active = 1"
        " ORDER BY id LIMIT 1", (node["area_id"],)).fetchone()
    if bg is not None:
        window = d.background_match_min * 60
        near = conn.execute(
            "SELECT value FROM observations WHERE node_id = ? AND variable = 'ch4_ppm'"
            " AND at BETWEEN ? AND ? ORDER BY ABS(at - ?) LIMIT 1",
            (bg["id"], at - window, at + window, at)).fetchone()
        if near is not None:
            return ppm - near["value"], f"excess:background:{bg['id']}"
    recent = [r["value"] for r in conn.execute(
        "SELECT value FROM observations WHERE node_id = ? AND variable = 'ch4_ppm'"
        " AND at BETWEEN ? AND ?", (node["id"], at - d.baseline_hours * 3600, at))]
    if len(recent) < d.baseline_min_points:
        return None
    floor = _percentile(recent, d.baseline_percentile)
    return ppm - floor, f"excess:p{d.baseline_percentile:g}-{d.baseline_hours}h"


def _insert(conn: sqlite3.Connection, area: str, node: str, at: int, variable: str,
            value: float, source: str) -> None:
    conn.execute(
        "INSERT OR IGNORE INTO observations (area_id, node_id, at, variable, value, unit,"
        " uncertainty, source, grade) VALUES (?,?,?,?,?,?,NULL,?,'screening')",
        (area, node, at, variable, value, UNITS.get(variable, ""), source),
    )


def ingest(conn: sqlite3.Connection, cfg: Config, radio_id: str, payload: bytes | str,
           now: int) -> IngestResult:
    try:
        body = json.loads(payload)
        if not isinstance(body, dict):
            raise ValueError
    except ValueError:
        return IngestResult(error=f"payload from {radio_id} is not a JSON object")
    readings = body.get("readings")
    if not isinstance(readings, list) or not 0 < len(readings) <= MAX_READINGS:
        return IngestResult(error=f"payload from {radio_id} needs 1-{MAX_READINGS} readings")

    node = conn.execute(
        "SELECT * FROM nodes WHERE radio_id = ? AND area_id = ? AND active = 1",
        (radio_id, cfg.area.id)).fetchone()
    if node is None:
        conn.execute(
            "INSERT INTO unknown_radios (radio_id, first_seen, last_seen, packets)"
            " VALUES (?, ?, ?, 1) ON CONFLICT (radio_id) DO UPDATE SET"
            " last_seen = excluded.last_seen, packets = packets + 1",
            (radio_id, now, now))
        return IngestResult()

    result = IngestResult(node_id=node["id"])
    calibration = json.loads(node["calibration"])
    is_background = node["role"] == "background"
    latest: tuple[int, dict[str, float]] | None = None
    with db.tx(conn):
        for i, r in enumerate(readings):
            if not isinstance(r, dict):
                result.rejected.append((i, "reading is not an object"))
                continue
            at = _parse_time(r.get("at"), now)
            if at is None:
                result.rejected.append((i, "at: ISO time or Unix seconds within the last 30 days"))
                continue
            values = _values(r, i, result.rejected)
            node_ppm = values.pop("ch4_ppm", None)
            if not values and node_ppm is None:
                result.rejected.append((i, "no usable values"))
                continue
            for variable, value in values.items():
                _insert(conn, node["area_id"], node["id"], at, variable, value,
                        f"node:{node['id']}")
            try:
                cal = calibrate(calibration, {**values, "ch4_ppm": node_ppm})
            except CalibrationError as e:
                log.warning("node %s: %s", node["id"], e)
                cal = None
            if cal is not None:
                ppm, source = cal
                _insert(conn, node["area_id"], node["id"], at, "ch4_ppm", ppm, source)
                excess = None if is_background else _excess(conn, cfg, node, at, ppm)
                if excess is not None:
                    _insert(conn, node["area_id"], node["id"], at, "ch4_excess_ppm", *excess)
            result.accepted += 1
            result.times.append(at)
            if latest is None or at >= latest[0]:
                latest = (at, values)

        if latest is not None:
            radio = body.get("radio") if isinstance(body.get("radio"), dict) else {}
            conn.execute(
                "UPDATE nodes SET last_seen = MAX(IFNULL(last_seen, 0), ?),"
                " battery_v = COALESCE(?, battery_v), rssi = COALESCE(?, rssi),"
                " snr = COALESCE(?, snr), hops = COALESCE(?, hops) WHERE id = ?",
                (latest[0], latest[1].get("battery_v"), radio.get("rssi"), radio.get("snr"),
                 radio.get("hops"), node["id"]))
    return result
