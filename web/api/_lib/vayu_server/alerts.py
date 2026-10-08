"""Who is told about which event, in which language, and the SMS queue.

Each recipient lists the event kinds they get. A methane rise whose pattern does not fit the wind
goes to admins only (likely a local source such as a truck); officials are told if a later update
makes it fit. Every person is told once per event: the queue is unique on (event, person, stage).
Failed sends retry with doubling delays, up to sms.max_attempts.
"""

from __future__ import annotations

import json
import logging
import re
import sqlite3
import time
from typing import Any

from . import db
from .config import Config
from .detect import Change
from .sms import Sender, SmsError

log = logging.getLogger(__name__)

DEFAULT_KINDS = {
    "official": ("methane_rise", "fire_smoke", "lel"),
    "admin": ("methane_rise", "fire_smoke", "lel", "node_offline", "low_battery",
              "bridge_offline"),
}
ALL_KINDS = ("methane_rise", "fire_smoke", "lel", "early_warning", "node_offline", "low_battery",
             "bridge_offline")
PHONE = re.compile(r"^\+[1-9]\d{7,14}$")

COMPASS = {
    "en": ["N", "NE", "E", "SE", "S", "SW", "W", "NW"],
    "hi": ["उत्तर", "उत्तर-पूर्व", "पूर्व", "दक्षिण-पूर्व", "दक्षिण", "दक्षिण-पश्चिम", "पश्चिम",
           "उत्तर-पश्चिम"],
}

TEXT = {
    "en": {
        "brand": "VayuNetra",
        "methane_rise": "{brand} {area}: methane rise at {nodes}, peak +{peak:.1f} ppm. "
                        "{wind}{source}Screening-grade: confirm on site. Event #{id}",
        "node_count": "{n} node{s} ({ids})",
        "consistent": "Wind from {dir} {ws:.1f} m/s; pattern fits the wind. ",
        "inconsistent": "Wind from {dir} {ws:.1f} m/s; pattern does not fit the wind, "
                        "check for a local source. ",
        "calm": "Calm wind; direction not checked. ",
        "no_wind": "No wind reading. ",
        "source": "Likely source {lat:.5f},{lon:.5f} (±{r:.0f} m). ",
        "fire_smoke": "{brand} {area}: possible fire or smoke at {nodes}, PM2.5 +{peak:.0f} ug/m3 "
                      "above the cleanest node. Screening-grade: check on site. Event #{id}",
        "lel": "{brand} {area}: DANGER, methane {peak:.0f} ppm at node {node}, above 10% of the "
               "explosive limit. Keep flames and sparks away and check now. Event #{id}",
        "early_warning": "{brand} {area}: early warning, methane rise likely within {h:g} h at "
                         "node {node} (p={p:.2f}){placeholder}. Event #{id}",
        "placeholder": ", placeholder model, not validated",
        "node_offline": "{brand} {area}: node {node} silent since {time}. Check its power and "
                        "radio. Event #{id}",
        "low_battery": "{brand} {area}: node {node} battery {peak:.2f} V. Check its solar panel. "
                       "Event #{id}",
        "bridge_offline": "{brand} {area}: radio bridge silent since {time}; no node data is "
                          "arriving. Event #{id}",
    },
    "hi": {
        "brand": "वायुनेत्र",
        "methane_rise": "{brand} {area}: {nodes} पर मीथेन बढ़ी, अधिकतम +{peak:.1f} ppm। "
                        "{wind}{source}स्क्रीनिंग स्तर: मौके पर पुष्टि करें। घटना #{id}",
        "node_count": "{n} नोड ({ids})",
        "consistent": "हवा {dir} से {ws:.1f} m/s; पैटर्न हवा से मेल खाता है। ",
        "inconsistent": "हवा {dir} से {ws:.1f} m/s; पैटर्न हवा से मेल नहीं खाता, "
                        "स्थानीय स्रोत जाँचें। ",
        "calm": "हवा शांत; दिशा की जाँच नहीं हुई। ",
        "no_wind": "हवा का माप नहीं। ",
        "source": "संभावित स्रोत {lat:.5f},{lon:.5f} (±{r:.0f} मी)। ",
        "fire_smoke": "{brand} {area}: {nodes} पर संभावित आग या धुआँ, PM2.5 सबसे साफ़ नोड से "
                      "+{peak:.0f} ug/m3। स्क्रीनिंग स्तर: मौके पर जाँच करें। घटना #{id}",
        "lel": "{brand} {area}: खतरा! नोड {node} पर मीथेन {peak:.0f} ppm, विस्फोटक सीमा के 10% से "
               "ऊपर। आग और चिंगारी दूर रखें, तुरंत जाँचें। घटना #{id}",
        "early_warning": "{brand} {area}: पूर्व चेतावनी, नोड {node} पर {h:g} घंटे में मीथेन बढ़ने "
                         "की संभावना (p={p:.2f}){placeholder}। घटना #{id}",
        "placeholder": ", अस्थायी मॉडल, सत्यापित नहीं",
        "node_offline": "{brand} {area}: नोड {node} {time} से चुप है। बिजली और रेडियो जाँचें। "
                        "घटना #{id}",
        "low_battery": "{brand} {area}: नोड {node} की बैटरी {peak:.2f} V। सोलर पैनल जाँचें। "
                       "घटना #{id}",
        "bridge_offline": "{brand} {area}: रेडियो ब्रिज {time} से चुप है; नोड का डेटा नहीं आ रहा। "
                          "घटना #{id}",
    },
}


def add_recipient(conn: sqlite3.Connection, name: str, phone: str, role: str, language: str,
                  now: int, kinds: list[str] | None = None, agency: str = "") -> int:
    if not PHONE.match(phone):
        raise ValueError("phone must be in international format, e.g. +919812345678")
    if role not in DEFAULT_KINDS:
        raise ValueError("role must be official or admin")
    if language not in TEXT:
        raise ValueError("language must be en or hi")
    chosen = kinds if kinds is not None else list(DEFAULT_KINDS[role])
    bad = [k for k in chosen if k not in ALL_KINDS]
    if bad:
        raise ValueError(f"unknown event kinds: {', '.join(bad)}")
    cur = conn.execute(
        "INSERT INTO recipients (name, phone, agency, role, language, kinds, created_at)"
        " VALUES (?,?,?,?,?,?,?)", (name, phone, agency, role, language, ",".join(chosen), now))
    return cur.lastrowid


def compass(deg: float, lang: str) -> str:
    return COMPASS[lang][round(deg / 45) % 8]


def local_time(cfg: Config, t: int) -> str:
    s = (t + cfg.area.utc_offset_h * 3600) % 86400
    return f"{int(s // 3600):02d}:{int(s % 3600 // 60):02d} {cfg.area.tz_label}"


def compose(cfg: Config, ev: sqlite3.Row, area_name: str, lang: str) -> str:
    t = TEXT[lang]
    detail = json.loads(ev["detail"] or "{}")
    nodes = json.loads(ev["nodes"] or "[]")
    args: dict[str, Any] = {"brand": t["brand"], "area": area_name, "id": ev["id"],
                            "node": ev["node_id"], "peak": ev["peak"] or 0.0}
    if nodes:
        args["nodes"] = t["node_count"].format(n=len(nodes), s="" if len(nodes) == 1 else "s",
                                               ids=", ".join(nodes))
    kind = ev["kind"]
    if kind == "methane_rise":
        check = ev["wind_check"] or "no_wind"
        args["wind"] = t[check].format(dir=compass(ev["wind_from_deg"] or 0, lang),
                                       ws=ev["wind_ms"] or 0)
        args["source"] = (t["source"].format(lat=ev["source_lat"], lon=ev["source_lon"],
                                             r=ev["source_radius_m"])
                          if ev["source_lat"] is not None else "")
    elif kind == "early_warning":
        args.update(h=detail.get("horizon_h", 3), p=detail.get("p", 0.0),
                    placeholder=t["placeholder"] if detail.get("placeholder") else "")
    elif kind in ("node_offline", "bridge_offline"):
        args["time"] = local_time(cfg, detail.get("last_seen", ev["opened_at"]))
    return t[kind].format(**args)


def _eligible(ev: sqlite3.Row, person: sqlite3.Row) -> bool:
    if ev["kind"] not in person["kinds"].split(","):
        return False
    if ev["kind"] == "methane_rise" and ev["wind_check"] == "inconsistent":
        return person["role"] == "admin"
    return True


def queue_for(conn: sqlite3.Connection, cfg: Config, changes: list[Change], now: int) -> int:
    """Queue SMS for opened or updated events. Safe to call repeatedly."""
    ids = {c.event_id for c in changes if c.action in ("opened", "updated")}
    if not ids:
        return 0
    area = conn.execute("SELECT name FROM areas WHERE id = ?", (cfg.area.id,)).fetchone()
    area_name = area["name"] if area else cfg.area.id
    people = conn.execute("SELECT * FROM recipients WHERE active = 1 ORDER BY id").fetchall()
    added = 0
    with db.tx(conn):
        for ev in conn.execute(f"SELECT * FROM events WHERE id IN ({','.join('?' * len(ids))})"
                               " AND status = 'open' ORDER BY id", sorted(ids)).fetchall():
            for person in people:
                if not _eligible(ev, person):
                    continue
                cur = conn.execute(
                    "INSERT OR IGNORE INTO alerts (event_id, recipient_id, stage, body,"
                    " created_at, next_try_at) VALUES (?, ?, 'open', ?, ?, ?)",
                    (ev["id"], person["id"], compose(cfg, ev, area_name, person["language"]),
                     now, now))
                added += cur.rowcount
    return added


def send_due(conn: sqlite3.Connection, cfg: Config, sender: Sender, now: int | None = None,
             limit: int = 20) -> int:
    """Send queued messages whose time has come. Returns how many went out."""
    now = int(time.time()) if now is None else now
    due = conn.execute(
        "SELECT a.id, a.body, a.attempts, r.phone FROM alerts a JOIN recipients r"
        " ON r.id = a.recipient_id WHERE a.status = 'queued' AND a.next_try_at <= ?"
        " ORDER BY a.id LIMIT ?", (now, limit)).fetchall()
    sent = 0
    for a in due:
        try:
            sender.send(a["phone"], a["body"])
        except SmsError as e:
            attempts = a["attempts"] + 1
            failed = attempts >= cfg.sms.max_attempts
            log.warning("SMS %s to %s failed (attempt %s): %s", a["id"], a["phone"], attempts, e)
            conn.execute(
                "UPDATE alerts SET attempts = ?, last_error = ?, status = ?, next_try_at = ?"
                " WHERE id = ?",
                (attempts, str(e), "failed" if failed else "queued",
                 now + cfg.sms.retry_base_s * 2 ** (attempts - 1), a["id"]))
            continue
        conn.execute("UPDATE alerts SET status = 'sent', attempts = attempts + 1, sent_at = ?"
                     " WHERE id = ?", (now, a["id"]))
        sent += 1
    return sent
