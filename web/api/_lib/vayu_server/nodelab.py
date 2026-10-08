"""Node Lab: the node firmware simulated in the browser, its gateway's serial output replayed
through the Pi's own code (bridge -> ingest -> detection -> SMS) on a throwaway database.

The browser runs the C firmware (Vayu-node) compiled to WebAssembly (static/nodelab/vn_sim.wasm).
Its nodes are the planned nodes of a real site (deployment.plan) at their planned positions; the
gateway sits at the planned site office. Radio ids follow the simulator: simulated node k (the
gateway is 0) is !{0x56000000 + (k + 1) * 0x10203:08x}.

The NDIR anchor is left out: this firmware drives the metal-oxide sensor only, and the server
calibrates an anchor from an NDIR reading it would never get.
"""

from __future__ import annotations

import dataclasses
from typing import Any

from . import alerts, db, deployment, geo
from .bridge import gateway_line_to_message
from .config import Config, DetectCfg
from .detect import Detector
from .ingest import ingest
from .sandbox import PEOPLE, _events, _Outbox
from .survey import import_survey

MAX_LINES = 20_000
MAX_SPAN_S = 24 * 3600
LAB_ROLES = ("head", "ring", "community", "background")


def sim_radio_id(k: int) -> str:
    return f"!{(0x56000000 + (k + 1) * 0x00010203) & 0xFFFFFFFF:08x}"


def lab_nodes(slug: str) -> list[dict[str, Any]]:
    """The simulated network for a site, in the order the browser adds it to the simulator."""
    plan = deployment.plan(deployment.load_site(slug))
    clat, clon = plan["center"]
    gw = plan["gateway"]
    gx, gy = geo.offset_m(clat, clon, gw["lat"], gw["lon"])
    out = [{"id": "GW", "role": "gateway", "lat": gw["lat"], "lon": gw["lon"], "x": round(gx, 1),
            "y": round(gy, 1), "radio_id": sim_radio_id(0), "has_wind": False, "has_pms": False}]
    for n in plan["survey"]["nodes"]:
        if n["role"] not in LAB_ROLES:
            continue
        x, y = geo.offset_m(clat, clon, n["lat"], n["lon"])
        out.append({"id": n["id"], "role": n["role"], "lat": n["lat"], "lon": n["lon"],
                    "x": round(x, 1), "y": round(y, 1), "radio_id": sim_radio_id(len(out)),
                    "has_wind": n["role"] == "head", "has_pms": True})
    return out


def replay(slug: str, lines: list[str], detect: DetectCfg, gateway_down_from: int | None = None,
           utc_offset_h: float = 5.5) -> dict[str, Any]:
    """Feed gateway lines to the server code minute by minute, as the Pi would receive them."""
    if len(lines) > MAX_LINES:
        raise ValueError(f"at most {MAX_LINES} lines")
    plan = deployment.plan(deployment.load_site(slug))
    nodes = lab_nodes(slug)
    survey = dict(plan["survey"])
    survey["nodes"] = [n for n in survey["nodes"] if n["role"] in LAB_ROLES]
    area_id = survey["area"]["id"]
    cfg = Config.for_area(area_id)
    cfg.detect = dataclasses.replace(detect)
    cfg.area.utc_offset_h = utc_offset_h
    cfg.model.early_warning_enabled = False

    msgs, skipped, status = [], 0, 0
    for raw in lines:
        if isinstance(raw, str) and raw.startswith('{"gw"'):
            status += 1  # the gateway's own heartbeat line
            continue
        m = gateway_line_to_message(raw) if isinstance(raw, str) else None
        if m is None or m[2] is None:
            skipped += 1
            continue
        msgs.append(m)
    msgs.sort(key=lambda m: m[2])
    if not msgs:
        return {"lines": len(lines), "accepted": 0, "skipped": skipped, "status_lines": status,
                "unknown_radios": [],
                "events": [], "sms": [], "timeline": [], "nodes": {}}
    t_first, t_last = msgs[0][2], msgs[-1][2]
    if t_last - t_first > MAX_SPAN_S:
        raise ValueError("lines must span at most 24 hours")
    t0 = t_first - t_first % 60

    conn = db.connect(":memory:")
    import_survey(conn, survey, now=t0 - 86_400)
    radio = {n["id"]: n["radio_id"] for n in nodes}
    for row in conn.execute("SELECT id FROM nodes WHERE area_id = ?", (area_id,)).fetchall():
        conn.execute("UPDATE nodes SET radio_id = ? WHERE id = ?", (radio[row["id"]], row["id"]))
    who = {}
    for k, (name, role, lang) in enumerate(PEOPLE):
        phone = f"+9100000000{k + 1:02d}"
        alerts.add_recipient(conn, f"{name} (node lab)", phone, role, lang, now=t0)
        who[phone] = (name, role, lang)

    det, outbox = Detector(conn, cfg), _Outbox()
    timeline, accepted, unknown = [], 0, set()
    i, sent_before = 0, 0
    t = t0
    while t <= t_last + 60:
        while i < len(msgs) and msgs[i][2] <= t:
            radio_id, body, rx = msgs[i]
            res = ingest(conn, cfg, radio_id, body, now=rx)
            if res.node_id is None and not res.error:
                unknown.add(radio_id)
            accepted += res.accepted
            i += 1
        if gateway_down_from is not None and t >= gateway_down_from:
            db.kv_set(conn, "bridge_state", "offline")
        else:
            db.kv_set(conn, "bridge_state", "online")
            db.kv_set(conn, "bridge_seen", str(t))
        changes = det.run(t)
        alerts.queue_for(conn, cfg, changes, now=t)
        alerts.send_due(conn, cfg, outbox, now=t)
        for c in changes:
            timeline.append({"minute": (t - t0) // 60, "t": t,
                             "text": f"{c.kind.replace('_', ' ')} {c.action}"
                                     + (f" ({c.node_id})" if c.node_id else "")})
        for phone, _text in outbox.sent[sent_before:]:
            name, _role, lang = who[phone]
            timeline.append({"minute": (t - t0) // 60, "t": t, "text": f"SMS to {name} ({lang})",
                             "sms": True})
        sent_before = len(outbox.sent)
        t += 60

    sms = [{"to": who[phone][0], "role": who[phone][1], "language": who[phone][2], "text": text}
           for phone, text in outbox.sent]
    latest = {}
    for n in nodes[1:]:
        row = {}
        for var in ("ch4_ppm", "ch4_excess_ppm", "pm25_ugm3", "wind_ms", "wind_from_deg"):
            r = conn.execute("SELECT value FROM observations WHERE node_id = ? AND variable = ?"
                             " ORDER BY at DESC LIMIT 1", (n["id"], var)).fetchone()
            row[var] = None if r is None else round(r["value"], 2)
        latest[n["id"]] = row
    return {"lines": len(lines), "accepted": accepted, "skipped": skipped, "status_lines": status,
            "unknown_radios": sorted(unknown), "start": t0, "end": t_last,
            "events": _events(conn, t0, t0), "sms": sms, "timeline": timeline, "nodes": latest,
            "detection": {"rise_ppm": cfg.detect.rise_ppm, "lel_ppm": cfg.detect.lel_ppm,
                          "pm25_rise": cfg.detect.pm25_rise}}
