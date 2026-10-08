"""Import the setup survey the cloud produces once per area.

The survey is VayuNetra's satellite map of the area (outline, flagged hotspots), the wind pattern
there, and the planned node layout. After import the Pi runs with no cloud link. Re-importing an
updated survey moves and adds nodes, keeps each node's radio id and calibration unless the survey
sets them, and deactivates (never deletes) nodes the survey no longer lists, so their history stays.
"""

from __future__ import annotations

import json
import sqlite3
from typing import Any, Literal

from pydantic import BaseModel, Field, ValidationError, field_validator, model_validator

from . import db, geo

FORMAT = "vayunetra-survey/1"
SENSORS = ("tgs2600", "tgs2611", "ndir", "none")

# Placeholder coefficients from VayuNetra's sensor model; every node must be calibrated against a
# reference analyser before its ppm values mean anything ("calibrated": false until then).
DEFAULT_MOS_CALIBRATION = {"method": "mos", "ref_ppm": 100.0, "beta": 0.6, "rh_coef": -0.004,
                           "t_coef": -0.006, "calibrated": False}
DEFAULT_LINEAR_CALIBRATION = {"method": "linear", "gain": 1.0, "offset": 0.0, "calibrated": False}


class SurveyError(ValueError):
    pass


Lat = Field(ge=-90, le=90)
Lon = Field(ge=-180, le=180)


class Outline(BaseModel):
    type: Literal["Polygon"]
    coordinates: list[list[list[float]]]

    @field_validator("coordinates")
    @classmethod
    def _ring(cls, rings: list[list[list[float]]]) -> list[list[list[float]]]:
        if not rings or len(rings[0]) < 4:
            raise ValueError("outline needs one ring of at least 4 points")
        ring = rings[0]
        if ring[0] != ring[-1]:
            raise ValueError("outline ring must be closed (first point = last point)")
        for p in ring:
            if len(p) != 2 or not (-180 <= p[0] <= 180 and -90 <= p[1] <= 90):
                raise ValueError(f"outline point {p} is not [lon, lat]")
        return rings


class AreaIn(BaseModel):
    id: str = Field(pattern=r"^[a-z0-9][a-z0-9-]{0,47}$")
    name: str = Field(min_length=1)
    kind: str = Field(min_length=1)  # landfill, industrial, wastewater, ... as VayuNetra maps it
    outline: Outline


class HotspotIn(BaseModel):
    label: str
    lat: float = Lat
    lon: float = Lon
    tier: str | None = None
    observed_on: str | None = None
    rate_kgph: float | None = None
    rate_low_kgph: float | None = None
    rate_high_kgph: float | None = None
    note: str | None = None


class WindIn(BaseModel):
    prevailing_from_deg: float | None = Field(default=None, ge=0, le=360)
    calm_share: float | None = Field(default=None, ge=0, le=1)
    rose: list[dict[str, Any]] = []


class NodeIn(BaseModel):
    id: str = Field(pattern=r"^[A-Za-z0-9_-]{1,32}$")
    role: Literal["ring", "anchor", "head", "background", "community"]
    sensor: Literal["tgs2600", "tgs2611", "ndir", "none"]
    lat: float = Lat
    lon: float = Lon
    radio_id: str | None = None
    calibration: dict[str, Any] | None = None
    interval_s: int | None = Field(default=None, ge=60, le=3600)


class SurveyIn(BaseModel):
    format: Literal["vayunetra-survey/1"]
    area: AreaIn
    hotspots: list[HotspotIn] = []
    wind: WindIn | None = None
    nodes: list[NodeIn] = Field(min_length=1)

    @model_validator(mode="after")
    def _unique(self) -> SurveyIn:
        seen: set[str] = set()
        radios: set[str] = set()
        for n in self.nodes:
            if n.id in seen:
                raise ValueError(f"duplicate node id {n.id}")
            seen.add(n.id)
            if n.radio_id:
                if n.radio_id in radios:
                    raise ValueError(f"duplicate radio id {n.radio_id}")
                radios.add(n.radio_id)
        return self


def parse(data: dict) -> SurveyIn:
    try:
        return SurveyIn.model_validate(data)
    except ValidationError as e:
        problems = "; ".join(
            f"{'.'.join(str(x) for x in err['loc'])}: {err['msg']}" for err in e.errors()
        )
        raise SurveyError(f"invalid survey: {problems}") from e


def default_calibration(sensor: str) -> dict[str, Any]:
    if sensor in ("tgs2600", "tgs2611"):
        return dict(DEFAULT_MOS_CALIBRATION)
    if sensor == "ndir":
        return dict(DEFAULT_LINEAR_CALIBRATION)
    return {"method": "none"}


def _kept_calibration(n: NodeIn, existing: sqlite3.Row) -> dict[str, Any]:
    """The survey's calibration if it sets one; else the node's own, unless its sensor changed."""
    if n.calibration is not None:
        return n.calibration
    if existing["sensor"] == n.sensor:
        return json.loads(existing["calibration"])
    return default_calibration(n.sensor)


def import_survey(conn: sqlite3.Connection, data: dict, now: int) -> dict[str, Any]:
    s = parse(data)
    ring = s.area.outline.coordinates[0]
    clat, clon = geo.polygon_centroid(ring)
    warnings: list[str] = []
    if not any(n.role == "head" for n in s.nodes):
        warnings.append("no head node: without an anemometer the wind check cannot run")
    if not any(n.role == "background" for n in s.nodes):
        warnings.append("no background node: baselines fall back to each node's own low readings")

    added = updated = 0
    with db.tx(conn):
        conn.execute(
            "INSERT INTO areas (id, name, kind, outline, center_lat, center_lon, survey,"
            " imported_at) VALUES (?,?,?,?,?,?,?,?)"
            " ON CONFLICT (id) DO UPDATE SET name=excluded.name, kind=excluded.kind,"
            " outline=excluded.outline, center_lat=excluded.center_lat,"
            " center_lon=excluded.center_lon, survey=excluded.survey,"
            " imported_at=excluded.imported_at",
            (s.area.id, s.area.name, s.area.kind, s.area.outline.model_dump_json(), clat, clon,
             json.dumps(data), now),
        )
        conn.execute("DELETE FROM hotspots WHERE area_id = ?", (s.area.id,))
        for h in s.hotspots:
            conn.execute(
                "INSERT INTO hotspots (area_id, label, lat, lon, tier, observed_on, rate_kgph,"
                " rate_low_kgph, rate_high_kgph, note) VALUES (?,?,?,?,?,?,?,?,?,?)",
                (s.area.id, h.label, h.lat, h.lon, h.tier, h.observed_on, h.rate_kgph,
                 h.rate_low_kgph, h.rate_high_kgph, h.note),
            )
        for n in s.nodes:
            if n.radio_id:  # the survey is authoritative: free the radio id from any other node
                conn.execute("UPDATE nodes SET radio_id = NULL WHERE radio_id = ? AND id != ?",
                             (n.radio_id, n.id))
            existing = conn.execute("SELECT * FROM nodes WHERE id = ?", (n.id,)).fetchone()
            if existing is None:
                conn.execute(
                    "INSERT INTO nodes (id, area_id, radio_id, role, sensor, lat, lon,"
                    " calibration, interval_s, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
                    (n.id, s.area.id, n.radio_id, n.role, n.sensor, n.lat, n.lon,
                     json.dumps(n.calibration or default_calibration(n.sensor)),
                     n.interval_s or 600, now),
                )
                added += 1
            else:
                calibration = _kept_calibration(n, existing)
                conn.execute(
                    "UPDATE nodes SET area_id=?, radio_id=?, role=?, sensor=?, lat=?, lon=?,"
                    " calibration=?, interval_s=?, active=1 WHERE id=?",
                    (s.area.id, n.radio_id or existing["radio_id"], n.role, n.sensor, n.lat,
                     n.lon, json.dumps(calibration), n.interval_s or existing["interval_s"],
                     n.id),
                )
                updated += 1
        ids = [n.id for n in s.nodes]
        cur = conn.execute(
            f"UPDATE nodes SET active = 0 WHERE area_id = ? AND active = 1"
            f" AND id NOT IN ({','.join('?' * len(ids))})",
            (s.area.id, *ids),
        )
        deactivated = cur.rowcount
    return {
        "area": s.area.id,
        "nodes_added": added,
        "nodes_updated": updated,
        "nodes_deactivated": deactivated,
        "hotspots": len(s.hotspots),
        "warnings": warnings,
    }
