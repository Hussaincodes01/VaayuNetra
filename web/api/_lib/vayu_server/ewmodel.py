"""Early-warning model slot: will methane rise at a node within the next few hours?

Models use VayuNetra's JSON MLP format (scikit-learn layout: W is n_in x n_out, ReLU between
layers, sigmoid at the end), so a model trained by web/scripts/train-sensor-model.py drops in.

Until the team's own models exist, the bundled one is VayuNetra's simulator-trained model. It was
trained with a weather forecast for the next 3 hours; the Pi has none after setup, so the forecast
features are filled by persistence (the last 3 hours' pressure tendency and the current wind carry
on). Its warnings are a placeholder and are labelled as such.
"""

from __future__ import annotations

import json
import math
import sqlite3
import statistics
from dataclasses import dataclass, field
from importlib import resources
from pathlib import Path
from typing import Any

from . import geo, series
from .config import Config

FEATURE_NAMES = (
    "excess_now", "excess_prev", "excess_trend", "excess_max_3h", "dp_past_3h", "dp_next_3h",
    "align_now", "align_next_3h", "wind_now", "wind_next_3h", "night_next_3h", "hour_sin",
    "hour_cos", "rh_now",
)
BUNDLED = "vayunetra-ew-sim.json"


class ModelError(ValueError):
    pass


@dataclass
class Model:
    version: str
    features: list[str]
    mean: list[float]
    std: list[float]
    layers: list[dict[str, Any]]
    threshold: float
    horizon_h: float
    placeholder: bool
    raw: str = field(repr=False, default="")


def load_model(path: str) -> Model:
    if path:
        raw = Path(path).read_text(encoding="utf-8")
    else:
        raw = resources.files("vayu_server").joinpath("data", BUNDLED).read_text(encoding="utf-8")
    m = json.loads(raw)
    unknown = [f for f in m["features"] if f not in FEATURE_NAMES]
    if unknown:
        raise ModelError(f"model needs features the Pi cannot compute: {', '.join(unknown)}")
    n = len(m["features"])
    if len(m["mean"]) != n or len(m["std"]) != n or len(m["layers"][0]["W"]) != n:
        raise ModelError("model feature count does not match its weights")
    return Model(version=m["version"], features=m["features"], mean=m["mean"], std=m["std"],
                 layers=m["layers"], threshold=float(m["threshold"]),
                 horizon_h=float(m["horizon_h"]),
                 placeholder=not path or bool(m.get("placeholder")), raw=raw)


def predict(model: Model, x: list[float]) -> float:
    """Probability that a rise starts within the model's horizon."""
    h = [(v - mu) / (sd or 1) for v, mu, sd in zip(x, model.mean, model.std, strict=True)]
    last = len(model.layers) - 1
    for li, layer in enumerate(model.layers):
        w, b = layer["W"], layer["b"]
        out = [b[j] + sum(h[i] * w[i][j] for i in range(len(h))) for j in range(len(b))]
        h = out if li == last else [max(0.0, v) for v in out]
    return 1 / (1 + math.exp(-h[0]))


def _mean(points: list[tuple[int, float]]) -> float | None:
    return sum(v for _, v in points) / len(points) if points else None


def node_features(conn: sqlite3.Connection, cfg: Config, node: sqlite3.Row,
                  center: tuple[float, float], t: int) -> list[float] | None:
    """VayuNetra's 14 features at time t from stored readings; None if inputs are missing."""
    excess = series.between(conn, node["id"], "ch4_excess_ppm", t - 3 * 3600, t)
    now = _mean([p for p in excess if p[0] > t - 1800])
    prev = _mean([p for p in excess if t - 5400 < p[0] <= t - 1800])
    if now is None or prev is None:
        return None
    wind = series.area_wind(conn, cfg, t)
    dp = series.area_pressure_change(conn, cfg.area.id, t, 3)
    if wind is None or dp is None:
        return None
    rh = series.latest(conn, node["id"], "rh_pct", t, 1800)
    rh_now = rh[1] if rh else series.area_median_latest(conn, cfg.area.id, "rh_pct", t, 1800)
    if rh_now is None:
        return None
    wind_ms, wind_from = wind
    bearing = geo.bearing_deg(center[0], center[1], node["lat"], node["lon"])
    align = math.cos(((wind_from + 180) % 360 - bearing) * geo.RAD)
    off = cfg.area.utc_offset_h
    night_ahead = statistics.mean(
        1.0 if geo.is_night(t + h * 3600, off) else 0.0 for h in (0.5, 1.5, 2.5))
    hour = geo.local_hour(t, off)
    return [
        now, prev, now - prev, max(v for _, v in excess),
        dp, dp,  # persistence: the next 3 h continue the last 3 h's pressure tendency
        align, align, wind_ms, wind_ms,  # persistence: the wind stays as it is now
        night_ahead,
        math.sin(hour / 24 * 2 * math.pi), math.cos(hour / 24 * 2 * math.pi),
        rh_now,
    ]
