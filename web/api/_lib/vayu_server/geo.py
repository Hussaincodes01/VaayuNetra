"""Small-area geometry: local metre offsets, bearings, wind vectors, polygons.

A monitored area spans a few kilometres, so an equirectangular projection around a reference point
is accurate to well under a metre and needs no projection library. Constants match VayuNetra's
sensors.ts so the two stay comparable.
"""

from __future__ import annotations

import math

M_PER_DEG_LAT = 110_574.0
M_PER_DEG_LON_EQUATOR = 111_320.0
RAD = math.pi / 180


def offset_m(lat0: float, lon0: float, lat: float, lon: float) -> tuple[float, float]:
    """East (x) and north (y) offset in metres of (lat, lon) from (lat0, lon0)."""
    return (
        (lon - lon0) * M_PER_DEG_LON_EQUATOR * math.cos(lat0 * RAD),
        (lat - lat0) * M_PER_DEG_LAT,
    )


def from_offset(lat0: float, lon0: float, x: float, y: float) -> tuple[float, float]:
    """Inverse of offset_m."""
    return (
        lat0 + y / M_PER_DEG_LAT,
        lon0 + x / (M_PER_DEG_LON_EQUATOR * math.cos(lat0 * RAD)),
    )


def bearing_deg(lat0: float, lon0: float, lat: float, lon: float) -> float:
    """Bearing in degrees (0 = north, clockwise) from the first point to the second."""
    x, y = offset_m(lat0, lon0, lat, lon)
    return (math.degrees(math.atan2(x, y)) + 360) % 360


def destination(lat: float, lon: float, bearing: float, dist_m: float) -> tuple[float, float]:
    return from_offset(
        lat, lon, dist_m * math.sin(bearing * RAD), dist_m * math.cos(bearing * RAD)
    )


def angle_diff(a: float, b: float) -> float:
    """Smallest difference between two directions, 0 to 180 degrees."""
    d = abs(a - b) % 360
    return 360 - d if d > 180 else d


def point_in_polygon(lat: float, lon: float, ring: list[list[float]]) -> bool:
    """Ray casting on a GeoJSON ring ([lon, lat] pairs)."""
    inside = False
    n = len(ring)
    for i in range(n):
        x1, y1 = ring[i][0], ring[i][1]
        x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
        if (y1 > lat) != (y2 > lat):
            x_cross = x1 + (lat - y1) * (x2 - x1) / (y2 - y1)
            if lon < x_cross:
                inside = not inside
    return inside


def polygon_centroid(ring: list[list[float]]) -> tuple[float, float]:
    """Area-weighted centroid (lat, lon) of a GeoJSON ring."""
    lat0, lon0 = ring[0][1], ring[0][0]
    pts = [offset_m(lat0, lon0, p[1], p[0]) for p in ring]
    if pts[0] != pts[-1]:
        pts.append(pts[0])
    a = cx = cy = 0.0
    for (x1, y1), (x2, y2) in zip(pts, pts[1:], strict=False):
        cross = x1 * y2 - x2 * y1
        a += cross
        cx += (x1 + x2) * cross
        cy += (y1 + y2) * cross
    if abs(a) < 1e-9:  # degenerate: fall back to the vertex mean
        mx = sum(p[0] for p in pts[:-1]) / (len(pts) - 1)
        my = sum(p[1] for p in pts[:-1]) / (len(pts) - 1)
        return from_offset(lat0, lon0, mx, my)
    return from_offset(lat0, lon0, cx / (3 * a), cy / (3 * a))


def wind_uv(ms: float, from_deg: float) -> tuple[float, float]:
    """Wind "from" direction and speed -> the (u, v) vector the air moves along."""
    return -ms * math.sin(from_deg * RAD), -ms * math.cos(from_deg * RAD)


def mean_wind(winds: list[tuple[float, float]]) -> tuple[float, float] | None:
    """Vector mean of (speed m/s, from degrees) pairs; None when there are none."""
    if not winds:
        return None
    u = v = 0.0
    for ms, frm in winds:
        du, dv = wind_uv(ms, frm)
        u += du
        v += dv
    u /= len(winds)
    v /= len(winds)
    return math.hypot(u, v), (math.degrees(math.atan2(-u, -v)) + 360) % 360


def local_hour(epoch_s: float, utc_offset_h: float) -> float:
    return ((epoch_s / 3600 + utc_offset_h) % 24 + 24) % 24


def is_night(epoch_s: float, utc_offset_h: float) -> bool:
    """Night as VayuNetra's simulator defines it: before 06:00 or from 19:00 local time."""
    h = local_hour(epoch_s, utc_offset_h)
    return h < 6 or h >= 19
