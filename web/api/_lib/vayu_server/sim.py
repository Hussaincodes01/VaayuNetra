"""Simulated node readings, standing in for hardware until real nodes report.

Physics-shaped, not measured (ported from VayuNetra's sensors.ts): a Gaussian plume from a source
whose emission rises when pressure falls, metal-oxide sensors whose true coefficients differ a
little from the default calibration, and deterministic noise, so a scenario replays identically.
`vayu sim` publishes these readings over MQTT exactly as the radio bridge would.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

from . import geo
from .calibrate import mos_rs_ratio
from .plume import plume_excess_ppm, pumping
from .survey import DEFAULT_MOS_CALIBRATION


def _hash32(s: str) -> int:
    """FNV-1a, as in sensors.ts."""
    h = 2166136261
    for ch in s:
        h ^= ord(ch)
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def gaussian(seed: str) -> float:
    """Standard normal from a string seed (Box-Muller on two hashed uniforms)."""
    u1 = (_hash32(f"{seed}|a") + 1) / 4294967297
    u2 = (_hash32(f"{seed}|b") + 1) / 4294967297
    return math.sqrt(-2 * math.log(u1)) * math.cos(2 * math.pi * u2)


@dataclass
class Scenario:
    source_lat: float
    source_lon: float
    source_kgph: float = 250.0  # simulation input, not a measurement
    wind_ms: float = 3.0
    wind_from_deg: float = 270.0
    leak_from: int | None = None  # the source starts emitting at this time (None: always)
    fire_node: str | None = None
    fire_from: int | None = None
    pressure_hpa: float = 1008.0
    dpdt_hpa_per_h: float = 0.0
    temp_c: float = 28.0
    rh_pct: float = 65.0
    background_ppm: float = 2.0
    source_radius_m: float = 100.0
    utc_offset_h: float = 5.5


def _true_sensor(node_id: str) -> dict[str, Any]:
    """The sensor a simulated node "really" has: a little off the default calibration."""
    c = DEFAULT_MOS_CALIBRATION
    return {**c, "beta": c["beta"] * (1 + 0.05 * gaussian(f"{node_id}|beta")),
            "rh_coef": c["rh_coef"] * (1 + 0.25 * gaussian(f"{node_id}|rh")),
            "t_coef": c["t_coef"] * (1 + 0.25 * gaussian(f"{node_id}|t"))}


def node_reading(node: Any, sc: Scenario, t: int) -> dict[str, Any]:
    """One reading, in the format the bridge publishes, for a node row at time t."""
    nid = node["id"]
    leaking = sc.leak_from is None or t >= sc.leak_from
    q = sc.source_kgph * pumping(sc.dpdt_hpa_per_h) if leaking else 0.0
    x, y = geo.offset_m(sc.source_lat, sc.source_lon, node["lat"], node["lon"])
    excess = plume_excess_ppm(q, x, y, sc.wind_ms, sc.wind_from_deg,
                              geo.is_night(t, sc.utc_offset_h), sc.source_radius_m) if q else 0.0
    true_ppm = sc.background_ppm + excess + 0.05 * gaussian(f"{nid}|{t}|bg")
    temp = sc.temp_c + 0.2 * gaussian(f"{nid}|{t}|temp")
    rh = sc.rh_pct + 0.5 * gaussian(f"{nid}|{t}|rh")
    r: dict[str, Any] = {
        "at": t,
        "temp_c": round(temp, 2),
        "rh_pct": round(rh, 1),
        "pressure_hpa": round(sc.pressure_hpa + 0.05 * gaussian(f"{nid}|{t}|p"), 2),
        "battery_v": round(3.9 + 0.02 * gaussian(f"{nid}|{t}|bat"), 3),
    }
    if node["sensor"] in ("tgs2600", "tgs2611"):
        rs = mos_rs_ratio(true_ppm, rh, temp, _true_sensor(nid)) * math.exp(
            0.05 * gaussian(f"{nid}|{t}|rs"))
        r["rs_ratio"] = round(rs, 6)
    elif node["sensor"] == "ndir":
        r["ndir_ppm"] = round(max(0.0, true_ppm + 0.3 * gaussian(f"{nid}|{t}|ndir")), 3)
    burning = sc.fire_node == nid and (sc.fire_from is None or t >= sc.fire_from)
    r["pm25_ugm3"] = round(max(0.0, 60 + 5 * gaussian(f"{nid}|{t}|pm") + (400 if burning else 0)),
                           1)
    r["co_ppm"] = round(max(0.0, 0.4 + 0.05 * gaussian(f"{nid}|{t}|co") + (9 if burning else 0)),
                        3)
    if node["role"] == "head":
        r["wind_ms"] = round(max(0.0, sc.wind_ms + 0.2 * gaussian(f"{nid}|{t}|ws")), 2)
        r["wind_from_deg"] = round((sc.wind_from_deg + 5 * gaussian(f"{nid}|{t}|wd")) % 360, 1)
    return r
