"""Plan a real deployment around a landfill: where each node goes and how the mesh links up.

Rules from the VayuNetra hardware design (VaruNetraHardwareShit.pdf, sensor-node README):
  ring        nodes around the fence, 150 m outside it; 12 for a large site (50 ha or more),
              8 for 20-50 ha, 6 below that. One ring node sits on the most-downwind side.
  head        the ring node nearest the gateway carries the anemometer and wind vane
  anchor      an NDIR reference node beside the most-downwind ring node
  community   at the nearest school or hospital within 45 degrees of downwind, else 900 m
              downwind of the fence
  background  2.5 km upwind of the site, the baseline every reading is compared with
  gateway     the site office (Pi + 4G); assumed on the town-facing side until surveyed

Radio links use the mesh simulation's model (mesh.py): log-distance path loss, exponent 2.9
around the landfill and 3.3 through the city, 20 dBm with 3 dBi antennas, SF7 at 125 kHz.
"""

from __future__ import annotations

import json
import math
from collections import deque
from functools import lru_cache
from importlib import resources
from typing import Any

from . import geo
from .hwsim import recorded_results

SENSITIVITY_DBM = {7: -124.0, 8: -127.0, 9: -129.5, 10: -132.0, 11: -134.5, 12: -137.0}
LINK_GAIN_DB = 20 + 3 - 1 + 3 - 1  # tx power, antennas, cables (mesh.py)
USABLE_DB = 6.0   # margin needed to route over a link
GOOD_DB = 12.0    # about two standard deviations of the 6 dB shadowing in mesh.py
RING_OFFSET_M = 150
BACKGROUND_M = 2500
COMMUNITY_FALLBACK_M = 900


@lru_cache(maxsize=8)
def _site_text(slug: str) -> str:
    path = resources.files("vayu_server").joinpath("data", "sites", f"{slug}.json")
    if not path.is_file():
        raise KeyError(f"no packaged site {slug!r}")
    return path.read_text(encoding="utf-8")


def load_site(slug: str) -> dict[str, Any]:
    return json.loads(_site_text(slug))


def list_sites() -> list[dict[str, Any]]:
    folder = resources.files("vayu_server").joinpath("data", "sites")
    out = []
    for f in sorted(folder.iterdir(), key=lambda p: p.name):
        if f.name.endswith(".json"):
            s = load_site(f.name[:-5])
            out.append({"slug": s["slug"], "name": s["name"], "city": s["city"],
                        "point": s["point"], "area_m2": s["outline_source"]["area_m2"]})
    return out


def link_margin_db(distance_m: float, urban: bool = False, sf: int = 7) -> float:
    n = 3.3 if urban else 2.9
    rssi = LINK_GAIN_DB - (31.2 + 10 * n * math.log10(distance_m + 1))
    return rssi - SENSITIVITY_DBM[sf]


# --- geometry in local metres around the outline's centroid -------------------------------------

def _local(site: dict) -> tuple[float, float, list[tuple[float, float]]]:
    ring = site["outline"]["coordinates"][0]
    clat, clon = geo.polygon_centroid(ring)
    pts = [geo.offset_m(clat, clon, p[1], p[0]) for p in ring]
    if pts[0] == pts[-1]:
        pts = pts[:-1]
    pairs = zip(pts, pts[1:] + pts[:1], strict=True)
    area = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in pairs) / 2
    if area < 0:  # make it counter-clockwise, so the right-hand normal points outward
        pts = pts[::-1]
    return clat, clon, pts


def _inside(pts: list[tuple[float, float]], x: float, y: float) -> bool:
    inside = False
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1], strict=False):
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def _dist(pts: list[tuple[float, float]], x: float, y: float) -> float:
    best = math.inf
    for (x1, y1), (x2, y2) in zip(pts, pts[1:] + pts[:1], strict=False):
        dx, dy = x2 - x1, y2 - y1
        t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy or 1)))
        best = min(best, math.hypot(x - x1 - t * dx, y - y1 - t * dy))
    return best


def _exit_point(pts, bearing: float, beyond: float) -> tuple[float, float]:
    """Walk out from the centroid along a bearing; the point `beyond` metres past the fence."""
    ux, uy = math.sin(math.radians(bearing)), math.cos(math.radians(bearing))
    r = 0.0
    while _inside(pts, r * ux, r * uy) and r < 20_000:
        r += 5
    return (r + beyond) * ux, (r + beyond) * uy


def _ring_positions(pts, n: int, downwind: float) -> list[tuple[float, float]]:
    edges = list(zip(pts, pts[1:] + pts[:1], strict=False))
    lengths = [math.hypot(b[0] - a[0], b[1] - a[1]) for a, b in edges]
    total = sum(lengths)
    ux, uy = math.sin(math.radians(downwind)), math.cos(math.radians(downwind))
    starts = [sum(lengths[:i]) for i in range(len(edges))]
    s0 = starts[max(range(len(pts)), key=lambda i: pts[i][0] * ux + pts[i][1] * uy)]
    out = []
    for k in range(n):
        s = (s0 + k * total / n) % total
        i = max(j for j in range(len(edges)) if starts[j] <= s + 1e-9)
        (x1, y1), (x2, y2) = edges[i]
        f = (s - starts[i]) / (lengths[i] or 1)
        px, py = x1 + f * (x2 - x1), y1 + f * (y2 - y1)
        nx, ny = (y2 - y1) / (lengths[i] or 1), -(x2 - x1) / (lengths[i] or 1)
        placed = None
        for d in range(RING_OFFSET_M, 401, 25):
            cx, cy = px + nx * d, py + ny * d
            if not _inside(pts, cx, cy) and _dist(pts, cx, cy) >= 120:
                placed = (cx, cy)
                break
        if placed is None:  # deep concave corner: push out from the centroid instead
            r = math.hypot(px, py) or 1
            for d in range(RING_OFFSET_M, 2001, 25):
                cx, cy = px + px / r * d, py + py / r * d
                if not _inside(pts, cx, cy) and _dist(pts, cx, cy) >= 120:
                    placed = (cx, cy)
                    break
        out.append(placed or (px, py))
    return out


def _bearing(x: float, y: float) -> float:
    return (math.degrees(math.atan2(x, y)) + 360) % 360


# --- the plan ------------------------------------------------------------------------------

def _ring_count(area_m2: float) -> int:
    return 12 if area_m2 >= 500_000 else 8 if area_m2 >= 200_000 else 6


def _day_plume_sigma_m(distance_m: float) -> float:
    d = distance_m + 100  # VayuNetra's plume model with a 100 m source radius, class C
    return 0.11 * d * (1 + 0.0001 * d) ** -0.5


def plan(site: dict, ring_nodes: int | None = None) -> dict[str, Any]:
    clat, clon, pts = _local(site)
    wind = site["wind"]
    upwind = wind["prevailing_from_deg"]
    downwind = (upwind + 180) % 360
    n_ring = ring_nodes or _ring_count(site["outline_source"]["area_m2"])

    def ll(x: float, y: float) -> tuple[float, float]:
        lat, lon = geo.from_offset(clat, clon, x, y)
        return round(lat, 6), round(lon, 6)

    # Gateway: the town-facing side (towards nearby schools and hospitals, weighted by nearness).
    pois = site.get("sensitive_sites", [])
    vx = vy = 0.0
    for p in pois:
        x, y = geo.offset_m(clat, clon, p["lat"], p["lon"])
        d = math.hypot(x, y) or 1
        vx, vy = vx + x / d**2, vy + y / d**2
    gw_bearing = _bearing(vx, vy) if (vx or vy) else downwind
    gx, gy = _exit_point(pts, gw_bearing, 60)
    gw_lat, gw_lon = ll(gx, gy)

    ring_xy = _ring_positions(pts, n_ring, downwind)
    head = min(range(n_ring), key=lambda i: math.hypot(ring_xy[i][0] - gx, ring_xy[i][1] - gy))
    nodes: list[dict[str, Any]] = []
    for i, (x, y) in enumerate(ring_xy):
        lat, lon = ll(x, y)
        nodes.append({"id": f"R{i + 1:02d}", "role": "head" if i == head else "ring",
                      "sensor": "tgs2600", "lat": lat, "lon": lon})

    most_downwind = min(range(n_ring), key=lambda i: geo.angle_diff(
        _bearing(*ring_xy[i]), downwind))
    ax, ay = ring_xy[most_downwind]
    r = math.hypot(ax, ay) or 1
    lat, lon = ll(ax + ax / r * 30, ay + ay / r * 30)
    nodes.append({"id": "A1", "role": "anchor", "sensor": "ndir", "lat": lat, "lon": lon,
                  "beside": nodes[most_downwind]["id"]})

    candidates = []
    for p in pois:
        x, y = geo.offset_m(clat, clon, p["lat"], p["lon"])
        if (geo.angle_diff(_bearing(x, y), downwind) <= 45 and not _inside(pts, x, y)
                and _dist(pts, x, y) >= 150):
            candidates.append((math.hypot(x, y), p))
    community: dict[str, Any] = {"id": "C1", "role": "community", "sensor": "tgs2600"}
    if candidates:
        _, p = min(candidates, key=lambda c: c[0])
        community.update(lat=p["lat"], lon=p["lon"], place=p["name"], place_kind=p["kind"])
    else:
        cx, cy = _exit_point(pts, downwind, COMMUNITY_FALLBACK_M)
        community.update(zip(("lat", "lon"), ll(cx, cy), strict=False))
    nodes.append(community)

    bx = BACKGROUND_M * math.sin(math.radians(upwind))
    by = BACKGROUND_M * math.cos(math.radians(upwind))
    lat, lon = ll(bx, by)
    nodes.append({"id": "B1", "role": "background", "sensor": "tgs2600", "lat": lat, "lon": lon})

    # Radio links and hops to the gateway.
    things = [{"id": "GW", "lat": gw_lat, "lon": gw_lon, "role": "gateway"}] + nodes
    links, best = [], {}
    for i, a in enumerate(things):
        for b in things[i + 1:]:
            d = math.hypot(*geo.offset_m(a["lat"], a["lon"], b["lat"], b["lon"]))
            urban = {a["role"], b["role"]} & {"community", "background"}
            m = link_margin_db(d, urban=bool(urban))
            link = {"a": a["id"], "b": b["id"], "distance_m": round(d), "margin_db": round(m, 1),
                    "quality": "good" if m >= GOOD_DB else "fair" if m >= USABLE_DB else "poor"}
            for x in (a["id"], b["id"]):
                if x not in best or m > best[x]["margin_db"]:
                    best[x] = link
            if m >= USABLE_DB and d <= 2000:
                links.append(link)
    for link in best.values():
        if link["quality"] == "poor" and link not in links:
            links.append(link)
    hops: dict[str, int | None] = {t["id"]: None for t in things}
    hops["GW"] = 0
    queue = deque(["GW"])
    while queue:
        cur = queue.popleft()
        for link in links:
            if link["margin_db"] < USABLE_DB or cur not in (link["a"], link["b"]):
                continue
            other = link["b"] if link["a"] == cur else link["a"]
            if hops[other] is None:
                hops[other] = hops[cur] + 1
                queue.append(other)

    # Notes, every number computed from the plan above.
    ring_poly = ring_xy + ring_xy[:1]
    spacing = sum(math.hypot(b[0] - a[0], b[1] - a[1])
                  for a, b in zip(ring_poly, ring_poly[1:], strict=False)) / n_ring
    sigma = _day_plume_sigma_m(RING_OFFSET_M + math.sqrt(site["outline_source"]["area_m2"]) / 2)
    notes = [f"Ring of {n_ring} nodes about {spacing:.0f} m apart (node spacing), "
             f"{RING_OFFSET_M} m outside the fence.",
             f"By day a plume spreads about {sigma:.0f} m either side of its centreline by the "
             f"time it reaches the ring, so with this spacing some plumes pass between nodes; "
             f"the satellite and drone layers cover that gap.",
             "Gateway placed on the town-facing side as an assumption: set the real site-office "
             "position in the survey before installing."]
    for t in things:
        if hops[t["id"]] is None:
            bl = best.get(t["id"])
            other = bl["b"] if bl and bl["a"] == t["id"] else bl["a"] if bl else "-"
            notes.append(f"{t['id']} has no link with {USABLE_DB:.0f} dB margin at SF7 (best "
                         f"{bl['margin_db'] if bl else float('nan'):.0f} dB to {other}): use SF9 "
                         f"for it, add a relay node, or give it its own 4G link.")
    ring_sf7 = [r for r in recorded_results()["mesh"]
                if r["topology"].startswith("landfill ring") and r["radio"].startswith("SF7")]
    if ring_sf7:
        notes.append("Mesh simulation (mesh_results.csv): a 12-node landfill ring at SF7 / "
                     f"125 kHz delivered {min(r['delivery_pct'] for r in ring_sf7):.0f}% of "
                     "packets, with 0 or 2 dead nodes.")

    hotspots = []
    for f in site.get("satellite_flags", []):
        if f["tier"] not in ("T1", "T2"):
            continue  # T3 is surface change, rejected as methane
        rate = (f" about {f['rate_kgph'] / 1000:.1f} t/h" if f.get("rate_kgph") else "")
        hotspots.append({"label": f"Satellite {f['tier']}, {f['date']}{rate}", "lat": f["lat"],
                         "lon": f["lon"], "tier": f["tier"], "observed_on": f["date"],
                         "rate_kgph": f.get("rate_kgph"), "rate_low_kgph": f.get("rate_low_kgph"),
                         "rate_high_kgph": f.get("rate_high_kgph"),
                         "note": "Screening-grade satellite estimate: confirm with a "
                                 "hyperspectral satellite, OGI drone or ground survey."})
    survey = {
        "format": "vayunetra-survey/1",
        "area": {"id": site["slug"], "name": site["outline_source"]["name"] or site["name"],
                 "kind": "landfill", "outline": site["outline"]},
        "hotspots": hotspots,
        "wind": {"prevailing_from_deg": wind["prevailing_from_deg"],
                 "calm_share": wind["calm_share"], "rose": wind["rose"]},
        "nodes": [{k: v for k, v in n.items() if k in ("id", "role", "sensor", "lat", "lon")}
                  for n in nodes],
    }
    return {"survey": survey, "nodes": nodes,
            "gateway": {"id": "GW", "lat": gw_lat, "lon": gw_lon, "assumed": True},
            "center": [round(clat, 6), round(clon, 6)], "links": links, "hops": hops,
            "spacing_m": round(spacing), "notes": notes}
