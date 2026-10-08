"""Run a what-if scenario through the real server code, on a throwaway in-memory database.

The same ingest, detection and alert code as the live Pi, fed by the simulator (sim.py), so the
dashboard can show what would happen: which events open and when, where the source is placed,
and the exact SMS each person would get. Nothing is sent and the live database is never touched.

Scenarios: quiet, leak, fire, bridge_down; any of them can also kill nodes (dead_nodes).
"""

from __future__ import annotations

import dataclasses
import datetime as dt
import json
from typing import Any

from . import alerts, db, geo
from .config import Config, DetectCfg
from .detect import Detector
from .ingest import ingest
from .sim import Scenario, node_reading
from .survey import import_survey

SCENARIOS = ("quiet", "leak", "fire", "bridge_down")
DAY = dt.date(2025, 1, 6)  # fixed date: same answer every run (Deonar's T1 satellite flag day)
PEOPLE = [("Ward officer", "official", "en"), ("Zonal officer", "official", "hi"),
          ("Network admin", "admin", "en")]


class _Outbox:
    """Stands in for the SMS modem: records each message, sends nothing."""

    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    def send(self, phone: str, text: str) -> None:
        self.sent.append((phone, text))


def _params(survey: dict, p: dict) -> dict[str, Any]:
    nodes = {n["id"] for n in survey["nodes"]}
    out = {
        "scenario": p.get("scenario", "leak"),
        "hours": float(p.get("hours", 3)),
        "step_min": int(p.get("step_min", 10)),
        "event_after_h": float(p.get("event_after_h", 1)),
        "kgph": float(p.get("kgph", 1500)),
        "wind_from_deg": float(p.get("wind_from_deg",
                                     (survey.get("wind") or {}).get("prevailing_from_deg", 270))),
        "wind_ms": float(p.get("wind_ms", 3)),
        "local_hour": float(p.get("local_hour", 11)),
        "dpdt_hpa_per_h": float(p.get("dpdt_hpa_per_h", 0)),
        "fire_node": p.get("fire_node") or next(
            (n["id"] for n in survey["nodes"] if n["role"] in ("ring", "head")), None),
        "dead_nodes": list(p.get("dead_nodes") or []),
    }
    if out["scenario"] not in SCENARIOS:
        raise ValueError(f"scenario must be one of {', '.join(SCENARIOS)}")
    if not 0.5 <= out["hours"] <= 12:
        raise ValueError("hours must be 0.5 to 12")
    if out["step_min"] not in (1, 5, 10, 15):
        raise ValueError("step_min must be 1, 5, 10 or 15")
    if not 0 <= out["event_after_h"] < out["hours"]:
        raise ValueError("event_after_h must fall inside the run")
    if not 0 < out["kgph"] <= 100_000:
        raise ValueError("kgph must be above 0 and at most 100000")
    if not (0 <= out["wind_ms"] <= 25 and 0 <= out["wind_from_deg"] <= 360):
        raise ValueError("wind out of range")
    if not 0 <= out["local_hour"] < 24:
        raise ValueError("local_hour must be 0 to 23.9")
    if out["scenario"] == "fire" and out["fire_node"] not in nodes:
        raise ValueError(f"fire_node must be one of {', '.join(sorted(nodes))}")
    bad = [n for n in out["dead_nodes"] if n not in nodes]
    if bad:
        raise ValueError(f"unknown nodes: {', '.join(bad)}")
    src = p.get("source")
    if src:
        out["source"] = {"lat": float(src["lat"]), "lon": float(src["lon"])}
    return out


def _source(survey: dict, params: dict) -> dict[str, float]:
    if "source" in params:
        return params["source"]
    if survey.get("hotspots"):
        h = survey["hotspots"][0]
        return {"lat": h["lat"], "lon": h["lon"]}
    lat, lon = geo.polygon_centroid(survey["area"]["outline"]["coordinates"][0])
    return {"lat": lat, "lon": lon}


def run(survey: dict, params: dict, detect: DetectCfg, utc_offset_h: float = 5.5) -> dict:
    p = _params(survey, params)
    area_id = survey["area"]["id"]
    cfg = Config.for_area(area_id)
    cfg.detect = dataclasses.replace(detect)
    cfg.area.utc_offset_h = utc_offset_h
    cfg.model.early_warning_enabled = False  # the placeholder model needs real weather history

    midnight = dt.datetime.combine(DAY, dt.time(), tzinfo=dt.UTC).timestamp()
    t_event = int(midnight + (p["local_hour"] - utc_offset_h) * 3600)
    t0 = t_event - int(p["event_after_h"] * 3600)
    times = [t0 + k * p["step_min"] * 60
             for k in range(int(p["hours"] * 60 / p["step_min"]) + 1)]

    conn = db.connect(":memory:")
    import_survey(conn, survey, now=t0 - 86_400)
    rows = conn.execute("SELECT * FROM nodes WHERE area_id = ? ORDER BY id", (area_id,)).fetchall()
    for k, n in enumerate(rows):  # planned nodes have no radio yet
        conn.execute("UPDATE nodes SET radio_id = ? WHERE id = ?", (f"!sim{k:04d}", n["id"]))
    rows = conn.execute("SELECT * FROM nodes WHERE area_id = ? ORDER BY id", (area_id,)).fetchall()
    who = {}
    for k, (name, role, lang) in enumerate(PEOPLE):
        phone = f"+9100000000{k + 1:02d}"
        alerts.add_recipient(conn, f"{name} (sandbox)", phone, role, lang, now=t0)
        who[phone] = (name, role, lang)

    src = _source(survey, p)
    sc = Scenario(source_lat=src["lat"], source_lon=src["lon"],
                  source_kgph=p["kgph"] if p["scenario"] == "leak" else 0.0,
                  wind_ms=p["wind_ms"], wind_from_deg=p["wind_from_deg"], leak_from=t_event,
                  fire_node=p["fire_node"] if p["scenario"] == "fire" else None,
                  fire_from=t_event, dpdt_hpa_per_h=p["dpdt_hpa_per_h"],
                  utc_offset_h=utc_offset_h)
    det = Detector(conn, cfg)
    outbox = _Outbox()
    series = {n["id"]: {"role": n["role"], "lat": n["lat"], "lon": n["lon"], "t": [],
                        "excess": [], "ch4_ppm": [], "pm25": [], "state": []} for n in rows}
    timeline = [{"minute": 0, "text": "Simulation starts"},
                {"minute": (t_event - t0) // 60, "text": _event_text(p)}]
    sent_before = 0
    for t in times:
        bridge_down = p["scenario"] == "bridge_down" and t >= t_event
        if bridge_down:
            db.kv_set(conn, "bridge_state", "offline")
        else:
            db.kv_set(conn, "bridge_state", "online")
            db.kv_set(conn, "bridge_seen", str(t))
            for n in rows:
                if n["id"] in p["dead_nodes"] and t >= t_event:
                    continue
                body = json.dumps({"readings": [node_reading(n, sc, t)]})
                ingest(conn, cfg, n["radio_id"], body, now=t)
        changes = det.run(t)
        alerts.queue_for(conn, cfg, changes, now=t)
        alerts.send_due(conn, cfg, outbox, now=t)
        for c in changes:
            timeline.append({"minute": (t - t0) // 60,
                             "text": f"{c.kind.replace('_', ' ')} {c.action}"
                                     + (f" ({c.node_id})" if c.node_id else "")})
        for phone, _text in outbox.sent[sent_before:]:
            name, role, lang = who[phone]
            timeline.append({"minute": (t - t0) // 60, "text": f"SMS to {name} ({lang})",
                             "sms": True})
        sent_before = len(outbox.sent)
        _record(conn, series, t, t0, cfg, p, t_event)

    sms = []
    for phone, text in outbox.sent:
        name, role, lang = who[phone]
        sms.append({"to": name, "role": role, "language": lang, "text": text})
    # Minutes of each SMS, from the queue the sender read.
    for s, a in zip(sms, conn.execute("SELECT sent_at FROM alerts WHERE status = 'sent'"
                                      " ORDER BY sent_at, id").fetchall(), strict=False):
        s["minute"] = (a["sent_at"] - t0) // 60
    return {
        "params": p, "area": area_id, "event_minute": (t_event - t0) // 60,
        "start_utc": dt.datetime.fromtimestamp(t0, dt.UTC).isoformat(),
        "source": src if p["scenario"] == "leak" else None,
        "outline": survey["area"]["outline"],
        "detection": {"rise_ppm": cfg.detect.rise_ppm, "lel_ppm": cfg.detect.lel_ppm,
                      "pm25_rise": cfg.detect.pm25_rise},
        "nodes": series, "events": _events(conn, t0, t_event), "sms": sms,
        "timeline": sorted(timeline, key=lambda x: x["minute"]),
        "note": "Simulated readings through the real detection code. Nothing was sent.",
    }


def _event_text(p: dict) -> str:
    if p["scenario"] == "leak":
        return (f"Leak starts: {p['kgph']:.0f} kg/h (simulation input), wind from "
                f"{p['wind_from_deg']:.0f} deg at {p['wind_ms']:.1f} m/s")
    if p["scenario"] == "fire":
        return f"Fire starts near {p['fire_node']}"
    if p["scenario"] == "bridge_down":
        return "Radio bridge stops"
    if p["dead_nodes"]:
        return f"Nodes stop reporting: {', '.join(p['dead_nodes'])}"
    return "Nothing happens"


def _record(conn, series, t, t0, cfg, p, t_event) -> None:
    window = cfg.detect.window_min * 60
    def latest(node_id, var):
        r = conn.execute("SELECT value FROM observations WHERE node_id = ? AND variable = ?"
                         " AND at BETWEEN ? AND ? ORDER BY at DESC LIMIT 1",
                         (node_id, var, t - window, t)).fetchone()
        return None if r is None else round(r["value"], 3)

    for node_id, s in series.items():
        excess = latest(node_id, "ch4_excess_ppm")
        dead = node_id in p["dead_nodes"] and t >= t_event
        offline = conn.execute("SELECT 1 FROM events WHERE kind = 'node_offline' AND node_id = ?"
                               " AND status = 'open'", (node_id,)).fetchone()
        state = ("offline" if offline or dead else
                 "rising" if excess is not None and excess >= cfg.detect.rise_ppm else "ok")
        s["t"].append((t - t0) // 60)
        s["excess"].append(excess)
        s["ch4_ppm"].append(latest(node_id, "ch4_ppm"))
        s["pm25"].append(latest(node_id, "pm25_ugm3"))
        s["state"].append(state)


def _events(conn, t0: int, t_event: int) -> list[dict[str, Any]]:
    out = []
    for e in conn.execute("SELECT * FROM events ORDER BY opened_at, id"):
        after = (e["opened_at"] - t_event) / 60
        out.append({
            "kind": e["kind"], "node_id": e["node_id"], "status": e["status"],
            "opened_minute": (e["opened_at"] - t0) // 60,
            "closed_minute": None if e["closed_at"] is None else (e["closed_at"] - t0) // 60,
            "opened_after_event_min": round(after) if after >= 0 else None,
            "peak": e["peak"], "nodes": json.loads(e["nodes"] or "[]"),
            "wind_check": e["wind_check"], "wind_ms": e["wind_ms"],
            "wind_from_deg": e["wind_from_deg"], "source_lat": e["source_lat"],
            "source_lon": e["source_lon"], "source_radius_m": e["source_radius_m"],
        })
    return out


def plume_grid(survey: dict, params: dict, cell_m: float = 50, extent_m: float = 2500,
               night: bool = False) -> dict[str, Any]:
    """Ground-level methane above background around the source, for the 3D map."""
    from .plume import plume_excess_ppm

    p = _params(survey, params)
    src = _source(survey, p)
    cells = []
    n = int(extent_m / cell_m)
    for i in range(-n, n + 1):
        for j in range(-n, n + 1):
            x, y = i * cell_m, j * cell_m
            c = plume_excess_ppm(p["kgph"], x, y, p["wind_ms"], p["wind_from_deg"], night,
                                 source_radius_m=100)
            if c >= 0.5:
                lat, lon = geo.from_offset(src["lat"], src["lon"], x, y)
                cells.append([round(lon, 6), round(lat, 6), round(c, 2)])
    return {"source": src, "cell_m": cell_m, "cells": cells,
            "max_ppm": max((c[2] for c in cells), default=0.0), "night": night,
            "params": {k: p[k] for k in ("kgph", "wind_ms", "wind_from_deg")}}
