"""SQLite storage. One file, WAL mode, so the core service writes while the dashboard reads.

Every sensor value is one row in `observations` (area, node, time, variable, value, unit,
uncertainty, source, grade): the shared record format the cloud sync sends as-is. Times are integer
Unix seconds (UTC) throughout.
"""

from __future__ import annotations

import os
import sqlite3
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path

SCHEMA_VERSION = 1

SCHEMA = """
CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS areas (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL,
    outline TEXT NOT NULL,              -- GeoJSON Polygon geometry
    center_lat REAL NOT NULL,
    center_lon REAL NOT NULL,
    survey TEXT NOT NULL,               -- the full survey file as imported
    imported_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS hotspots (
    id INTEGER PRIMARY KEY,
    area_id TEXT NOT NULL REFERENCES areas(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    tier TEXT,
    observed_on TEXT,
    rate_kgph REAL,
    rate_low_kgph REAL,
    rate_high_kgph REAL,
    note TEXT
);

CREATE TABLE IF NOT EXISTS nodes (
    id TEXT PRIMARY KEY,
    area_id TEXT NOT NULL,
    radio_id TEXT UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('ring', 'anchor', 'head', 'background', 'community')),
    sensor TEXT NOT NULL,
    lat REAL NOT NULL,
    lon REAL NOT NULL,
    calibration TEXT NOT NULL DEFAULT '{}',
    interval_s INTEGER NOT NULL DEFAULT 600,
    active INTEGER NOT NULL DEFAULT 1,
    last_seen INTEGER,
    battery_v REAL,
    rssi REAL,
    snr REAL,
    hops INTEGER,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS unknown_radios (
    radio_id TEXT PRIMARY KEY,
    first_seen INTEGER NOT NULL,
    last_seen INTEGER NOT NULL,
    packets INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS observations (
    id INTEGER PRIMARY KEY,
    area_id TEXT NOT NULL,
    node_id TEXT,
    at INTEGER NOT NULL,
    variable TEXT NOT NULL,
    value REAL NOT NULL,
    unit TEXT NOT NULL,
    uncertainty REAL,
    source TEXT NOT NULL,
    grade TEXT NOT NULL DEFAULT 'screening',
    UNIQUE (node_id, variable, at)
);
CREATE INDEX IF NOT EXISTS observations_area_var_at ON observations (area_id, variable, at);

CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY,
    area_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    node_id TEXT,                       -- set for node-level kinds (offline, battery, lel, ...)
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
    opened_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER,
    peak REAL,
    wind_ms REAL,
    wind_from_deg REAL,
    wind_check TEXT,
    nodes TEXT,                         -- JSON list of node ids involved
    source_lat REAL,
    source_lon REAL,
    source_radius_m REAL,
    detail TEXT NOT NULL DEFAULT '{}',
    dirty INTEGER NOT NULL DEFAULT 1    -- changed since the last cloud sync
);
CREATE UNIQUE INDEX IF NOT EXISTS events_one_open
    ON events (area_id, kind, IFNULL(node_id, '')) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS events_opened ON events (opened_at);

CREATE TABLE IF NOT EXISTS recipients (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    agency TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL CHECK (role IN ('official', 'admin')),
    language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi')),
    kinds TEXT NOT NULL,                -- comma-separated event kinds this person gets by SMS
    active INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id),
    recipient_id INTEGER NOT NULL REFERENCES recipients(id),
    stage TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL,
    next_try_at INTEGER NOT NULL,
    sent_at INTEGER,
    UNIQUE (event_id, recipient_id, stage)
);

CREATE TABLE IF NOT EXISTS work_orders (
    id INTEGER PRIMARY KEY,
    area_id TEXT NOT NULL,
    event_id INTEGER REFERENCES events(id),
    title TEXT NOT NULL,
    fix TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL,
    deadline TEXT NOT NULL,             -- YYYY-MM-DD
    status TEXT NOT NULL DEFAULT 'open'
        CHECK (status IN ('open', 'in_progress', 'fixed', 'check_failed', 'closed')),
    fixed_at INTEGER,
    check_result TEXT,                  -- JSON from the readings check
    created_by TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER,
    dirty INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS labels (
    id INTEGER PRIMARY KEY,
    event_id INTEGER NOT NULL REFERENCES events(id),
    result TEXT NOT NULL CHECK (result IN ('confirmed', 'rejected')),
    method TEXT NOT NULL CHECK (method IN
        ('drone_laser', 'handheld_laser', 'ogi', 'thermal', 'ground_survey', 'other')),
    labelled_by TEXT NOT NULL DEFAULT '',
    at INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '',
    dirty INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'officer')),
    language TEXT NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi')),
    created_at INTEGER NOT NULL
);
"""


def connect(path: str | os.PathLike) -> sqlite3.Connection:
    """Open (and if needed create) the database. One connection per thread."""
    if str(path) != ":memory:":
        Path(path).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10, isolation_level=None, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA synchronous=NORMAL")  # safe with WAL; far fewer SD-card writes
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=10000")
    if conn.execute("PRAGMA user_version").fetchone()[0] < SCHEMA_VERSION:
        conn.executescript(SCHEMA)
        conn.execute(f"PRAGMA user_version={SCHEMA_VERSION}")
    return conn


@contextmanager
def tx(conn: sqlite3.Connection) -> Iterator[sqlite3.Connection]:
    """All-or-nothing block. IMMEDIATE takes the write lock up front, so two writers queue
    instead of failing halfway through."""
    conn.execute("BEGIN IMMEDIATE")
    try:
        yield conn
    except BaseException:
        conn.execute("ROLLBACK")
        raise
    conn.execute("COMMIT")


def kv_get(conn: sqlite3.Connection, key: str, default: str | None = None) -> str | None:
    row = conn.execute("SELECT value FROM kv WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else default


def kv_set(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO kv (key, value) VALUES (?, ?)"
        " ON CONFLICT (key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
