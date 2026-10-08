"""Work orders: fix -> owner -> deadline -> closed only when the readings drop.

Nobody closes an order by hand. When the owner marks it fixed, the readings check compares the
methane excess downwind of the problem before and after the fix. Only readings taken while the
wind blew from the problem towards the node (and was not calm) count, so a windy week after the
fix cannot pass for a repaired leak. The order closes when the median excess has fallen by at
least orders.required_drop; otherwise it is marked check_failed for a person to look at.
"""

from __future__ import annotations

import bisect
import json
import sqlite3
import statistics
from datetime import date
from typing import Any

from . import geo
from .config import Config

STATUSES = ("open", "in_progress", "fixed", "check_failed", "closed")
ALLOWED = {
    "open": {"in_progress", "fixed"},
    "in_progress": {"open", "fixed"},
    "fixed": {"in_progress"},
    "check_failed": {"in_progress", "fixed"},
    "closed": {"in_progress"},  # reopen
}
EXTEND_FACTOR = 3  # wait up to 3 after-windows for enough comparable readings


def create_order(conn: sqlite3.Connection, area_id: str, title: str, owner: str, deadline: str,
                 now: int, event_id: int | None = None, fix: str = "",
                 created_by: str = "") -> int:
    if not title.strip():
        raise ValueError("title is required")
    if not owner.strip():
        raise ValueError("owner is required")
    try:
        date.fromisoformat(deadline)
    except ValueError as e:
        raise ValueError("deadline must be a date, YYYY-MM-DD") from e
    cur = conn.execute(
        "INSERT INTO work_orders (area_id, event_id, title, fix, owner, deadline, created_by,"
        " created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (area_id, event_id, title.strip(), fix.strip(), owner.strip(), deadline, created_by,
         now, now))
    return cur.lastrowid


def set_status(conn: sqlite3.Connection, order_id: int, status: str, now: int) -> None:
    row = conn.execute("SELECT status FROM work_orders WHERE id = ?", (order_id,)).fetchone()
    if row is None:
        raise ValueError(f"no work order {order_id}")
    if status == "closed":
        raise ValueError("closed is set only by the readings check, after the fix")
    if status not in ALLOWED.get(row["status"], set()):
        raise ValueError(f"cannot go from {row['status']} to {status}")
    if status == "fixed":
        conn.execute("UPDATE work_orders SET status = 'fixed', fixed_at = ?, check_result = NULL,"
                     " updated_at = ?, dirty = 1 WHERE id = ?", (now, now, order_id))
    else:
        conn.execute("UPDATE work_orders SET status = ?, closed_at = NULL, updated_at = ?,"
                     " dirty = 1 WHERE id = ?", (status, now, order_id))


def _wind_series(conn: sqlite3.Connection, cfg: Config, t_from: int,
                 t_to: int) -> list[tuple[int, float, float]]:
    rows = conn.execute(
        "SELECT s.at, s.value AS ms, d.value AS frm FROM observations s"
        " JOIN observations d ON d.node_id = s.node_id AND d.at = s.at"
        " AND d.variable = 'wind_from_deg'"
        " JOIN nodes n ON n.id = s.node_id AND n.role = 'head' AND n.area_id = ?"
        " WHERE s.variable = 'wind_ms' AND s.at BETWEEN ? AND ? ORDER BY s.at",
        (cfg.area.id, t_from, t_to)).fetchall()
    return [(r["at"], r["ms"], r["frm"]) for r in rows]


def _downwind_samples(conn: sqlite3.Connection, cfg: Config, ref: tuple[float, float],
                      t_from: int, t_to: int) -> list[float]:
    """Excess readings in (t_from, t_to] taken while the node was downwind of ref."""
    d = cfg.detect
    age = d.wind_max_age_min * 60
    winds = _wind_series(conn, cfg, t_from - age, t_to + age)
    times = [w[0] for w in winds]
    out: list[float] = []
    for n in conn.execute("SELECT * FROM nodes WHERE area_id = ? AND role != 'background'",
                          (cfg.area.id,)).fetchall():
        bearing = geo.bearing_deg(ref[0], ref[1], n["lat"], n["lon"])
        for r in conn.execute(
                "SELECT at, value FROM observations WHERE node_id = ?"
                " AND variable = 'ch4_excess_ppm' AND at > ? AND at <= ?",
                (n["id"], t_from, t_to)):
            i = bisect.bisect_left(times, r["at"])
            near = [winds[j] for j in (i - 1, i) if 0 <= j < len(winds)
                    and abs(winds[j][0] - r["at"]) <= age]
            if not near:
                continue
            _, ms, frm = min(near, key=lambda w: abs(w[0] - r["at"]))
            if ms >= d.calm_ms and geo.angle_diff(bearing, (frm + 180) % 360) <= d.downwind_deg:
                out.append(r["value"])
    return out


def _reference(conn: sqlite3.Connection, cfg: Config, order: sqlite3.Row) -> tuple[float, float]:
    if order["event_id"] is not None:
        ev = conn.execute("SELECT source_lat, source_lon FROM events WHERE id = ?",
                          (order["event_id"],)).fetchone()
        if ev and ev["source_lat"] is not None:
            return ev["source_lat"], ev["source_lon"]
    area = conn.execute("SELECT center_lat, center_lon FROM areas WHERE id = ?",
                        (cfg.area.id,)).fetchone()
    return area["center_lat"], area["center_lon"]


def check_order(conn: sqlite3.Connection, cfg: Config, order: sqlite3.Row,
                now: int) -> tuple[str, dict[str, Any]]:
    o = cfg.orders
    fixed = order["fixed_at"]
    after_end = fixed + o.after_days * 86400
    if now < after_end:
        return "waiting", {"reason": "after_window_running", "checked_at": now}
    ref = _reference(conn, cfg, order)
    before = _downwind_samples(conn, cfg, ref, fixed - o.before_days * 86400, fixed)
    after = _downwind_samples(conn, cfg, ref, fixed,
                              min(now, fixed + EXTEND_FACTOR * o.after_days * 86400))
    result: dict[str, Any] = {"before_n": len(before), "after_n": len(after), "checked_at": now,
                              "reference": [round(ref[0], 6), round(ref[1], 6)]}
    if len(before) < o.min_samples or len(after) < o.min_samples:
        if now < fixed + EXTEND_FACTOR * o.after_days * 86400 and len(before) >= o.min_samples:
            return "waiting", {**result, "reason": "waiting_for_downwind_readings"}
        return "check_failed", {**result, "reason": "not_enough_comparable_readings"}
    b, a = statistics.median(before), statistics.median(after)
    result.update(before_median=b, after_median=a)
    if b < 0.5 * cfg.detect.rise_ppm:
        return "check_failed", {**result, "reason": "no_signal_before"}
    result["drop_share"] = 1 - a / b
    if result["drop_share"] >= o.required_drop:
        return "closed", {**result, "reason": "readings_dropped"}
    return "check_failed", {**result, "reason": "readings_did_not_drop"}


def check_orders(conn: sqlite3.Connection, cfg: Config, now: int) -> list[tuple[int, str]]:
    """Run the readings check on every order marked fixed."""
    results = []
    for order in conn.execute("SELECT * FROM work_orders WHERE area_id = ? AND status = 'fixed'"
                              " ORDER BY id", (cfg.area.id,)).fetchall():
        outcome, detail = check_order(conn, cfg, order, now)
        if outcome == "waiting":
            conn.execute("UPDATE work_orders SET check_result = ? WHERE id = ?",
                         (json.dumps(detail), order["id"]))
        else:
            conn.execute(
                "UPDATE work_orders SET status = ?, check_result = ?, updated_at = ?, dirty = 1,"
                " closed_at = ? WHERE id = ?",
                (outcome, json.dumps(detail), now, now if outcome == "closed" else None,
                 order["id"]))
        results.append((order["id"], outcome))
    return results
