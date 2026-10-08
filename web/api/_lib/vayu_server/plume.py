"""Gaussian plume physics and source location from node readings.

`plume_excess_ppm` is VayuNetra's model (sensors.ts) ported line for line: a source of finite
radius, Briggs rural dispersion (class C by day, E at night). `locate` inverts it: over a grid
inside the area outline, it finds the point whose plume, scaled by least squares, best matches the
excess every node measured (zeros included: a node that saw nothing is evidence too).

It reports where, not how much. An emission rate from a handful of low-cost sensors is not
defensible, so the fitted scale is never stored or shown.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from . import geo

RAD = math.pi / 180
MAX_CANDIDATES = 4000
NEAR_BEST_SHARE = 0.05  # candidates within 5% of the signal of the best fit set the radius


def pumping(dpdt_hpa_per_h: float, k: float = 2.5) -> float:
    """Emission multiplier from the pressure tendency: falling pressure pushes landfill gas out."""
    return min(25.0, max(0.03, math.exp(-k * dpdt_hpa_per_h)))


def plume_excess_ppm(q_kgph: float, x: float, y: float, wind_ms: float, wind_from_deg: float,
                     night: bool, source_radius_m: float = 250.0) -> float:
    """Ground-level methane above background (ppm) at offset (x east, y north) m from the source."""
    to = (wind_from_deg + 180) * RAD
    down = x * math.sin(to) + y * math.cos(to)
    cross = x * math.cos(to) - y * math.sin(to)
    d = max(down, 0.0) + source_radius_m
    upwind_fade = math.exp(down / 60) if down < 0 else 1.0
    if night:
        sy = 0.06 * d * (1 + 0.0001 * d) ** -0.5
        sz = 0.03 * d / (1 + 0.0003 * d)
    else:
        sy = 0.11 * d * (1 + 0.0001 * d) ** -0.5
        sz = 0.08 * d * (1 + 0.0002 * d) ** -0.5
    u = max(0.7, wind_ms)
    kg_per_m3 = (q_kgph / 3600 / (math.pi * u * sy * sz)) * math.exp(-(cross * cross)
                                                                     / (2 * sy * sy))
    return kg_per_m3 * 1e6 * (24.45 / 16.04) * upwind_fade  # mg/m3 -> ppm at 25 C


@dataclass
class Located:
    lat: float
    lon: float
    radius_m: float
    fit: float  # share of the measured signal the best plume explains, 0..1


def locate(nodes: list[tuple[float, float, float]], ring: list[list[float]], wind_ms: float,
           wind_from_deg: float, night: bool, step_m: float = 25.0,
           source_radius_m: float = 100.0) -> Located | None:
    """Most likely source inside the outline for (lat, lon, excess ppm) per node; None when the
    readings cannot say (fewer than 3 nodes, or no node above baseline)."""
    if len(nodes) < 3:
        return None
    obs = [max(e, 0.0) for _, _, e in nodes]
    total = sum(v * v for v in obs)
    if total <= 0:
        return None

    lat0, lon0 = ring[0][1], ring[0][0]
    pts = [geo.offset_m(lat0, lon0, lat, lon) for lat, lon, _ in nodes]
    xy = [geo.offset_m(lat0, lon0, p[1], p[0]) for p in ring]
    minx, maxx = min(p[0] for p in xy), max(p[0] for p in xy)
    miny, maxy = min(p[1] for p in xy), max(p[1] for p in xy)
    nx, ny = (maxx - minx) / step_m + 1, (maxy - miny) / step_m + 1
    if nx * ny > MAX_CANDIDATES:
        step_m *= math.sqrt(nx * ny / MAX_CANDIDATES)

    scored: list[tuple[float, float, float]] = []  # (sse, x, y)
    x = minx
    while x <= maxx + 1e-6:
        y = miny
        while y <= maxy + 1e-6:
            lat, lon = geo.from_offset(lat0, lon0, x, y)
            if geo.point_in_polygon(lat, lon, ring):
                unit = [plume_excess_ppm(1.0, px - x, py - y, wind_ms, wind_from_deg, night,
                                         source_radius_m) for px, py in pts]
                cc = sum(c * c for c in unit)
                if cc > 0:
                    q = max(0.0, sum(c * o for c, o in zip(unit, obs, strict=True)) / cc)
                    sse = sum((o - q * c) ** 2 for c, o in zip(unit, obs, strict=True))
                    scored.append((sse, x, y))
            y += step_m
        x += step_m
    if not scored:
        return None
    best_sse, bx, by = min(scored)
    near = best_sse + NEAR_BEST_SHARE * total
    radius = max(
        [math.hypot(x - bx, y - by) for sse, x, y in scored if sse <= near] + [step_m / 2]
    )
    lat, lon = geo.from_offset(lat0, lon0, bx, by)
    return Located(lat=lat, lon=lon, radius_m=radius, fit=max(0.0, 1 - best_sse / total))
