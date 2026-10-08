"""The ground-network simulations behind /dashboard/ground, run by the Pi's own Python code
(Vayu-server, vendored in api/_lib by Vayu-server/tools/export_web.py) as a Vercel Function.

GET  /api/ground?op=gas&rs_ohm=30000&v5=5            gas measurement chain (hwsim.gas_chain)
GET  /api/ground?op=droop&battery_v=3.3&cells=3&...  supply droop during a LoRa burst (hwsim.droop)
GET  /api/ground?op=energy&city=Delhi&panel_w=6&...  a year of solar energy with the power policy
POST /api/ground?op=replay  {"site": "deonar", "lines": [...], "gateway_down_from": null}
     the simulated gateway's serial lines -> bridge -> ingest -> detection -> SMS (nodelab.replay)

Nothing here reads or writes the VayuNetra database: every request is a computation on its inputs.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "_lib"))

from vayu_server import hwsim, nodelab  # noqa: E402
from vayu_server.config import DetectCfg  # noqa: E402

MAX_BODY = 4_000_000  # Vercel accepts 4.5 MB request bodies
MAX_LINES = 12_000


class BadRequest(ValueError):
    pass


def _num(q: dict, key: str, default: float, lo: float, hi: float) -> float:
    raw = q.get(key, [None])[0]
    try:
        v = default if raw in (None, "") else float(raw)
    except ValueError as e:
        raise BadRequest(f"{key} must be a number") from e
    if not lo <= v <= hi:
        raise BadRequest(f"{key} must be {lo} to {hi}")
    return v


def _bool(q: dict, key: str, default: bool) -> bool:
    raw = q.get(key, [None])[0]
    return default if raw is None else raw.lower() in ("1", "true", "yes", "on")


def get(op: str, q: dict) -> dict:
    if op == "gas":
        return hwsim.gas_chain(rs_ohm=_num(q, "rs_ohm", 30e3, 100, 5e6),
                               v5=_num(q, "v5", 5.0, 4.5, 5.5))
    if op == "droop":
        return hwsim.droop(battery_v=_num(q, "battery_v", 3.3, 2.5, 4.3),
                           cells=int(_num(q, "cells", 3, 2, 3)),
                           ptc_ohm=_num(q, "ptc_ohm", 0.25, 0, 5),
                           pm_fan_start=_bool(q, "pm_fan_start", True),
                           heltec_tx_a=_num(q, "heltec_tx_a", 0.19, 0.01, 1))
    if op == "energy":
        city = q.get("city", ["Delhi"])[0]
        enclosure = q.get("enclosure", ["white box, shaded under panel"])[0]
        if city not in hwsim.CITIES or enclosure not in hwsim.ENCLOSURES:
            raise BadRequest("unknown city or enclosure")
        return hwsim.energy(city=city, panel_w=_num(q, "panel_w", 6, 1, 30),
                            cells=int(_num(q, "cells", 3, 2, 3)),
                            mcu_ma=_num(q, "mcu_ma", 12, 1, 200), pm=_bool(q, "pm", False),
                            soil=_num(q, "soil", 0.85, 0.3, 1), age=_num(q, "age", 1.0, 0.5, 1),
                            enclosure=enclosure)
    raise BadRequest("op must be gas, droop or energy")


def replay(body: dict) -> dict:
    lines, down = body.get("lines"), body.get("gateway_down_from")
    if not isinstance(lines, list) or not all(isinstance(x, str) for x in lines):
        raise BadRequest("lines must be a list of gateway lines")
    if len(lines) > MAX_LINES:
        raise BadRequest(f"at most {MAX_LINES} lines")
    if down is not None and (isinstance(down, bool) or not isinstance(down, int)):
        raise BadRequest("gateway_down_from must be Unix seconds or null")
    try:
        return nodelab.replay(str(body.get("site", "")), lines, DetectCfg(), down, 5.5)
    except KeyError as e:
        raise BadRequest(f"unknown site {e}") from e


class handler(BaseHTTPRequestHandler):  # noqa: N801 (the name Vercel looks for)
    def _send(self, code: int, obj: object, cache: bool = False) -> None:
        body = json.dumps(obj, separators=(",", ":")).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control",
                         "public, max-age=3600, s-maxage=86400" if cache else "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        q = parse_qs(urlparse(self.path).query)
        try:
            self._send(200, get(q.get("op", [""])[0], q), cache=True)
        except (BadRequest, ValueError) as e:
            self._send(400, {"detail": str(e)})

    def do_POST(self) -> None:  # noqa: N802
        q = parse_qs(urlparse(self.path).query)
        try:
            if q.get("op", [""])[0] != "replay":
                raise BadRequest("POST supports op=replay")
            n = int(self.headers.get("Content-Length") or 0)
            if not 0 < n <= MAX_BODY:
                raise BadRequest("body must be JSON up to 4 MB")
            try:
                body = json.loads(self.rfile.read(n))
            except ValueError as e:
                raise BadRequest("body must be JSON") from e
            if not isinstance(body, dict):
                raise BadRequest("body must be a JSON object")
            self._send(200, replay(body))
        except BadRequest as e:
            self._send(400, {"detail": str(e)})

    def log_message(self, fmt: str, *args: object) -> None:  # keep function logs quiet
        return
