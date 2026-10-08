"""Confirmation labels: what a drone, laser or ground check found for an event.

Labels flow to the cloud with the next sync and retrain the satellite and mesh models. Only
flagged events get checked, so labels measure precision, never missed plumes; random audits of
unflagged periods are needed for that.
"""

from __future__ import annotations

import sqlite3

RESULTS = ("confirmed", "rejected")
METHODS = ("drone_laser", "handheld_laser", "ogi", "thermal", "ground_survey", "other")


def add_label(conn: sqlite3.Connection, event_id: int, result: str, method: str,
              labelled_by: str, now: int, notes: str = "") -> int:
    if result not in RESULTS:
        raise ValueError(f"result must be one of {', '.join(RESULTS)}")
    if method not in METHODS:
        raise ValueError(f"method must be one of {', '.join(METHODS)}")
    if conn.execute("SELECT 1 FROM events WHERE id = ?", (event_id,)).fetchone() is None:
        raise ValueError(f"no event {event_id}")
    return conn.execute(
        "INSERT INTO labels (event_id, result, method, labelled_by, at, notes)"
        " VALUES (?,?,?,?,?,?)",
        (event_id, result, method, labelled_by.strip(), now, notes.strip())).lastrowid
