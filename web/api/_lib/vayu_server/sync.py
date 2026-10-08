"""Background upload to the cloud whenever the 4G link is up. The Pi never waits on it.

Observations are append-only, so a cursor (last id sent) tracks them. Events, work orders and
labels change, so each carries a dirty flag; a row is marked clean only if it did not change
while it was being sent. Anything unsent simply goes with the next push.

POST {sync.url} with "Authorization: Bearer <token>" and a JSON body:
    {"format": "vayunetra-sync/1", "area": ..., "sent_at": ...,
     "observations": [{"id", "site", "node", "time", "variable", "value", "unit",
                       "uncertainty", "source", "grade"}],
     "events": [...], "work_orders": [...], "labels": [...]}
The cloud should treat records as upserts by id: a resend after a lost reply is harmless.
"""

from __future__ import annotations

import json
import logging
import sqlite3
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from . import db
from .config import Config, read_secret

log = logging.getLogger(__name__)
FORMAT = "vayunetra-sync/1"
JSON_COLUMNS = ("nodes", "detail", "check_result")
MUTABLE = ("events", "work_orders", "labels")


@dataclass
class PushResult:
    status: str  # disabled | nothing | ok | error
    observations: int = 0
    events: int = 0
    work_orders: int = 0
    labels: int = 0
    error: str = ""


def iso(t: int) -> str:
    return datetime.fromtimestamp(t, UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def _row(r: sqlite3.Row) -> dict[str, Any]:
    out = dict(r)
    out.pop("dirty", None)
    for k in JSON_COLUMNS:
        if k in out and isinstance(out[k], str):
            out[k] = json.loads(out[k])
    return out


def mark_sent(conn: sqlite3.Connection, table: str, sent: list[tuple[int, int]]) -> None:
    """Clear the dirty flag of rows whose updated_at is still the version that was sent."""
    column = "at" if table == "labels" else "updated_at"
    for row_id, version in sent:
        conn.execute(f"UPDATE {table} SET dirty = 0 WHERE id = ? AND {column} = ?",
                     (row_id, version))


def _post(url: str, token: str, body: bytes, timeout: int) -> None:
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:  # noqa: S310 (configured URL)
        if not 200 <= resp.status < 300:
            raise urllib.error.HTTPError(url, resp.status, "not 2xx", resp.headers, None)


def push(conn: sqlite3.Connection, cfg: Config, now: int) -> PushResult:
    s = cfg.sync
    if not s.url:
        return PushResult("disabled")
    cursor = int(db.kv_get(conn, "sync_obs_id", "0"))
    obs = conn.execute("SELECT * FROM observations WHERE id > ? ORDER BY id LIMIT ?",
                       (cursor, s.batch)).fetchall()
    changed = {t: conn.execute(f"SELECT * FROM {t} WHERE dirty = 1 ORDER BY id LIMIT ?",
                               (s.batch,)).fetchall() for t in MUTABLE}
    if not obs and not any(changed.values()):
        return PushResult("nothing")
    body = {
        "format": FORMAT, "area": cfg.area.id, "sent_at": iso(now),
        "observations": [{
            "id": r["id"], "site": r["area_id"], "node": r["node_id"], "time": iso(r["at"]),
            "variable": r["variable"], "value": r["value"], "unit": r["unit"],
            "uncertainty": r["uncertainty"], "source": r["source"], "grade": r["grade"],
        } for r in obs],
        **{t: [_row(r) for r in rows] for t, rows in changed.items()},
    }
    try:
        _post(s.url, read_secret(s.token_file), json.dumps(body).encode(), s.timeout_s)
    except (urllib.error.URLError, OSError, ValueError) as e:
        log.info("sync deferred: %s", e)
        return PushResult("error", error=str(e))
    with db.tx(conn):
        if obs:
            db.kv_set(conn, "sync_obs_id", str(obs[-1]["id"]))
        for t, rows in changed.items():
            version = "at" if t == "labels" else "updated_at"
            mark_sent(conn, t, [(r["id"], r[version]) for r in rows])
        db.kv_set(conn, "sync_last_ok", str(now))
    return PushResult("ok", observations=len(obs), events=len(changed["events"]),
                      work_orders=len(changed["work_orders"]), labels=len(changed["labels"]))
