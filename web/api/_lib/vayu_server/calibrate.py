"""Raw sensor signal -> methane ppm, per node.

Each node's `calibration` JSON names a method:
  mos     metal-oxide (Figaro TGS2600 / TGS2611): Rs/R0 corrected for humidity and temperature,
          ppm = ref_ppm x (Rs/R0 / f(RH, T))^(-1/beta), the same formula as VayuNetra's sensors.ts
  linear  NDIR anchor: ppm = gain x ndir_ppm + offset
  none    the node has no methane sensor
A node that already computes ppm itself may send `ch4_ppm`; it is used when no raw signal came.

The source label travels with every value ("calib:mos:uncalibrated" until a node has been fitted
against a reference analyser), so retraining can tell fitted values from placeholder ones.
"""

from __future__ import annotations

import math
from typing import Any


class CalibrationError(ValueError):
    pass


def _humidity_factor(cal: dict[str, Any], rh: float, t: float) -> float:
    return max(0.2, 1 + cal["rh_coef"] * (rh - 65) + cal["t_coef"] * (t - 20))


def mos_rs_ratio(true_ppm: float, rh: float, t: float, cal: dict[str, Any],
                 drift: float = 1.0) -> float:
    """Sensor response Rs/R0 to a true concentration (used by the simulator)."""
    return (
        math.pow(max(true_ppm, 0.1) / cal["ref_ppm"], -cal["beta"])
        * _humidity_factor(cal, rh, t)
        * drift
    )


def _label(method: str, cal: dict[str, Any]) -> str:
    return f"calib:{method}" if cal.get("calibrated") else f"calib:{method}:uncalibrated"


def calibrate(cal: dict[str, Any], values: dict[str, float]) -> tuple[float, str] | None:
    """(ppm, source) for one reading, or None when it cannot be computed."""
    method = cal.get("method", "none")
    ppm: float | None = None
    source = ""
    if method == "mos":
        rs, rh, t = values.get("rs_ratio"), values.get("rh_pct"), values.get("temp_c")
        if rs is not None and rh is not None and t is not None and rs > 0:
            ppm = cal["ref_ppm"] * math.pow(rs / _humidity_factor(cal, rh, t), -1 / cal["beta"])
            source = _label("mos", cal)
    elif method == "linear":
        raw = values.get("ndir_ppm")
        if raw is not None:
            ppm = cal.get("gain", 1.0) * raw + cal.get("offset", 0.0)
            source = _label("linear", cal)
    elif method != "none":
        raise CalibrationError(f"unknown calibration method {method!r}")

    if ppm is None and values.get("ch4_ppm") is not None:
        ppm, source = values["ch4_ppm"], "node"
    if ppm is None or not math.isfinite(ppm) or ppm < 0:
        return None
    return ppm, source
