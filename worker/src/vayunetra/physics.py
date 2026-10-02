"""Methane physics: MBMP retrieval, transmittance forward model, IME emission rate, physics gate.

Port of notebooks/vayunetra_ops.ipynb (Cell 4, the emission step of Cell 6, Cell 9 plume injection and
Cell 11 Monte Carlo quantification). Same functions, constants and thresholds as the notebook; the
only change is that the transmittance LUT is passed in explicitly instead of read from a global.
"""

from __future__ import annotations

import json
import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np
from scipy.ndimage import binary_dilation

# 0-based band indices in L1C order B1..B8, B8A, B9..B12.
B = dict(blue=1, green=2, red=3, nir=8, swir1=11, swir2=12)
S2_BANDS = ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B8A", "B9", "B10", "B11", "B12"]

M_CH4, G, M_AIR = 0.01604, 9.81, 0.028964  # kg/mol CH4, m/s², kg/mol air
PIX_M = 10.0  # Sentinel-2 SWIR resampled to 10 m chips
CHIP = 200  # model card "chip"
MIN_PLUME_PX = 20  # model card "min_plume_px"
CALM_WIND_MS = 1.5  # below this the IME rate is unreliable: no rate is reported


# --- Transmittance LUT ---------------------------------------------------------------------------


@dataclass(frozen=True)
class Lut:
    """integrated_transmittances.json from the model zip."""

    data: Mapping[str, Any]
    amf_arr: np.ndarray = field(repr=False)
    mr: np.ndarray = field(repr=False)
    bgppb: float = 1800.0
    keys: tuple[str, ...] = ()

    @classmethod
    def from_dict(cls, data: Mapping[str, Any]) -> Lut:
        return cls(
            data=data,
            amf_arr=np.array(data["amf_arr"]),
            mr=np.array(data["mr_ch4_arr"]),
            bgppb=float(data["background_concentration"]),
            keys=tuple(k for k in data if isinstance(data[k], dict)),
        )

    @classmethod
    def load(cls, path: str | Path) -> Lut:
        return cls.from_dict(json.loads(Path(path).read_text()))


def lut_key(lut: Lut, sensor: str) -> str:
    s = str(sensor).upper()
    return next((k for k in lut.keys if k in s), "S2A")


def sensor_key(lut: Lut, satellite: str) -> str:
    """'Sentinel-2B' -> 'S2B', as the notebook does with lut_key("S2" + str(sat)[-1])."""
    return lut_key(lut, "S2" + str(satellite)[-1])


def amf_of(lut: Lut, sza: float, vza: float = 0.0) -> float:
    amf = 1 / np.cos(np.radians(sza)) + 1 / np.cos(np.radians(vza))
    return float(np.clip(amf, lut.amf_arr.min(), lut.amf_arr.max()))


def band_ratios(lut: Lut, enh_ppb, key: str, amf: float):
    """B11 and B12 transmittance ratios for a methane enhancement (ppb) over the background."""
    i = int(np.argmin(np.abs(lut.amf_arr - amf)))
    mr = lut.mr[i]
    t11 = np.array(lut.data[key]["transmittance_b11"][i])
    t12 = np.array(lut.data[key]["transmittance_b12"][i])
    x = lut.bgppb + enh_ppb
    return (
        np.interp(x, mr, t11) / np.interp(lut.bgppb, mr, t11),
        np.interp(x, mr, t12) / np.interp(lut.bgppb, mr, t12),
    )


# --- MBMP retrieval and model input --------------------------------------------------------------


def mbsp(r11: np.ndarray, r12: np.ndarray, v: np.ndarray) -> np.ndarray:
    a, b = r11[v], r12[v]
    c = float((a * b).sum() / max((b * b).sum(), 1e-12))
    return (c * r12 - r11) / np.maximum(r11, 1e-6)


def mbmp(t11: np.ndarray, t12: np.ndarray, refs: Sequence[tuple[np.ndarray, np.ndarray]]) -> np.ndarray:
    v = (t11 > 0) & (t12 > 0)
    st = mbsp(t11, t12, v)
    m = np.nanmedian(np.stack([mbsp(r11, r12, v & (r11 > 0) & (r12 > 0)) - st for r11, r12 in refs]), 0)
    m[~v] = 0
    return np.nan_to_num(m).astype("float32")


def robust_sigma(x: np.ndarray) -> float:
    x = x[np.isfinite(x)]
    return float(1.4826 * np.median(np.abs(x - np.median(x)))) + 1e-6


def make_input(img13: np.ndarray, refs: Sequence[tuple[np.ndarray, np.ndarray]], m: np.ndarray) -> np.ndarray:
    """17-channel model input: 13 L1C bands + ref B11, ref B12 + scaled MBMP + robust z of MBMP."""
    ref = np.median(np.stack([np.stack(r) for r in refs]), 0)
    extra = [
        ref[0],
        ref[1],
        np.clip(m / 0.02, -10, 10),
        np.clip((m - np.median(m)) / robust_sigma(m), -8, 8),
    ]
    return np.concatenate([np.clip(img13, 0, 2), np.stack(extra)]).astype("float32")


# --- Emission rate (IME) -------------------------------------------------------------------------


def ppb_from_mbmp(lut: Lut, m: np.ndarray, key: str, amf: float) -> np.ndarray:
    dd = np.linspace(0, 8000, 401)
    r11, r12 = band_ratios(lut, dd, key, amf)
    s = 1 - r12 / r11
    slope0 = (s[1] - s[0]) / (dd[1] - dd[0])
    return np.where(m >= 0, np.interp(m, s, dd), m / slope0)


def n_air(elev: float) -> float:
    """Moles of air per m² of column at a surface elevation (m)."""
    return 101325 * math.exp(-elev / 8434.0) / (G * M_AIR)


def ime_kg(lut: Lut, m: np.ndarray, mask: np.ndarray, key: str, amf: float, elev: float) -> tuple[float, float]:
    """Integrated mass enhancement (kg) inside the mask and the plume length scale L (m)."""
    ime = float((ppb_from_mbmp(lut, m, key, amf)[mask] * 1e-9 * n_air(elev) * M_CH4).sum() * PIX_M**2)
    return ime, math.sqrt(mask.sum() * PIX_M**2)


def emission_rate(
    lut: Lut,
    m: np.ndarray,
    prob: np.ndarray,
    u10: float,
    satellite: str,
    sza: float,
    vza: float,
    elev: float,
    a_cal: float,
    b_cal: float,
) -> float:
    """Point estimate Q (kg/h) = 3600·(a·U10 + b)·IME/L, as in run_scene. NaN in calm wind."""
    msk = binary_dilation(prob > 0.5, iterations=2)
    if msk.sum() < MIN_PLUME_PX or not np.isfinite(u10) or u10 < CALM_WIND_MS:
        return float("nan")
    ime, length = ime_kg(lut, m, msk, sensor_key(lut, satellite), amf_of(lut, sza, vza), elev)
    return round(3600 * (a_cal * u10 + b_cal) * ime / max(length, 1))


# --- Physics gate --------------------------------------------------------------------------------


def band_change(tgt: np.ndarray, ref: np.ndarray, msk: np.ndarray, ring: np.ndarray) -> float:
    r = tgt / np.clip(ref, 1e-4, None) - 1
    return float(np.median(r[msk]) - np.median(r[ring]))


def physics_check(
    tgt: np.ndarray, ref_chips: Sequence[np.ndarray], prob: np.ndarray, u: float, v: float
) -> dict[str, Any]:
    """Methane: B12 dims >1%, B11 < half of B12, visible/NIR < half of B12; elongated plumes within 45° of the wind."""
    ref = np.median(np.stack(ref_chips), 0)
    msk = prob > 0.5
    if msk.sum() < MIN_PLUME_PX:
        return dict(dB12=np.nan, dB11=np.nan, dVisNIR=np.nan, spectral_ok=False, elong=np.nan,
                    axis_vs_wind=np.nan, aligned=False)  # fmt: skip
    ring = binary_dilation(msk, iterations=15) & ~binary_dilation(msk, iterations=3)
    if ring.sum() < 50:
        ring = ~msk
    if ring.sum() < 50:
        ring = np.ones_like(msk)
    bands = [("B2", 1), ("B4", 3), ("B8", 7), ("B11", 11), ("B12", 12)]
    d = {b: band_change(tgt[i], ref[i], msk, ring) for b, i in bands}
    vis = max(abs(d["B2"]), abs(d["B4"]), abs(d["B8"]))
    spectral_ok = d["B12"] < -0.01 and vis < 0.5 * abs(d["B12"]) and d["B11"] > 0.5 * d["B12"]
    rr, cc = np.nonzero(msk)
    X = np.stack([cc - cc.mean(), -(rr - rr.mean())]).astype(float)
    w, V = np.linalg.eigh(np.cov(X))
    elong = math.sqrt(w[1] / max(w[0], 1e-6))
    ok_wind = np.isfinite(u) and math.hypot(u, v) > 0
    axis = (
        math.degrees(math.acos(min(1, abs(V[0, 1] * u + V[1, 1] * v) / (math.hypot(u, v) + 1e-9))))
        if ok_wind
        else np.nan
    )
    aligned = bool(elong < 2.0 or (ok_wind and axis <= 45))
    return dict(
        dB12=round(d["B12"], 4),
        dB11=round(d["B11"], 4),
        dVisNIR=round(vis, 4),
        spectral_ok=bool(spectral_ok),
        elong=round(elong, 1),
        axis_vs_wind=round(axis) if ok_wind else np.nan,
        aligned=aligned,
    )


def geometry_check(
    prob: np.ndarray, u: float, v: float, max_src_m: float = 500, max_angle: float = 60
) -> dict[str, Any]:
    m = prob > 0.5
    if m.sum() < MIN_PLUME_PX or not np.isfinite(u):
        return dict(src_dist_m=np.nan, wind_angle=np.nan, at_source_downwind=False)
    rr, cc = np.nonzero(m)
    c0 = CHIP / 2
    src = float(np.sqrt((rr - c0) ** 2 + (cc - c0) ** 2).min() * PIX_M)
    dx, dy = (cc.mean() - c0) * PIX_M, -(rr.mean() - c0) * PIX_M
    cos = (dx * u + dy * v) / (math.hypot(dx, dy) * math.hypot(u, v) + 1e-9)
    ang = float(np.degrees(np.arccos(np.clip(cos, -1, 1))))
    return dict(
        src_dist_m=round(src),
        wind_angle=round(ang),
        at_source_downwind=bool(src <= max_src_m and ang <= max_angle),
    )


def tier_of(r: Mapping[str, Any]) -> str:
    """T1 methane-confident · T2 probable (near-miss on one test) · T3 surface change · '-' no detection."""
    if not r["detected"]:
        return "-"
    if r["spectral_ok"] and r["aligned"]:
        return "T1"
    d12, d11, vis = r["dB12"], r["dB11"], r["dVisNIR"]
    near = np.isfinite(d12) and d12 < -0.01 and vis < 0.7 * abs(d12) and d11 > 0.6 * d12
    if near and (r["aligned"] or r["at_source_downwind"]):
        return "T2"
    return "T3"


def surface_kind(r: Mapping[str, Any]) -> str:
    """What a rejected (T3) event most likely is: useful landfill-management information in itself."""
    if r["tier"] != "T3" or not np.isfinite(r["dB12"]):
        return ""
    if r["dB12"] < -0.05 and r["dVisNIR"] > 0.04:
        return "burn scar / smoke-like"
    if r["dB12"] > 0:
        return "brightening (fresh waste / drying / earthworks)"
    return "SWIR darkening (moisture / leachate / fresh cover)"


# --- Monte Carlo quantification (Cell 11) --------------------------------------------------------


def quantify(
    lut: Lut,
    m: np.ndarray,
    prob: np.ndarray,
    u: float,
    v: float,
    satellite: str,
    sza: float,
    vza: float,
    elev: float,
    a_cal: float,
    b_cal: float,
    wind_rel_unc: float = 0.30,
    calib_rel_unc: float = 0.20,
    n: int = 300,
    seed: int = 0,
) -> dict[str, float]:
    """Median kg/h and 68% range over wind error, calibration error and mask threshold (0.4/0.5/0.6).

    Calm-wind guard: no rate when the 10 m wind is missing or below 1.5 m/s.
    """
    nan = dict(q_med=float("nan"), q_lo=float("nan"), q_hi=float("nan"))
    if not np.isfinite(u) or math.hypot(u, v) < CALM_WIND_MS:
        return nan
    u10 = math.hypot(u, v)
    key, amf = sensor_key(lut, satellite), amf_of(lut, sza, vza)
    imes = [ime_kg(lut, m, binary_dilation(prob > t, iterations=2), key, amf, elev) for t in (0.4, 0.5, 0.6)]
    rs = np.random.default_rng(seed)
    qs = []
    for _ in range(n):
        ime, length = imes[rs.integers(3)]
        if length <= 0:
            continue
        uu = max(0.5, u10 * (1 + rs.normal(0, wind_rel_unc)))
        cal = 1 + rs.normal(0, calib_rel_unc)
        qs.append(3600 * (a_cal * uu + b_cal) * cal * ime / length)
    if not qs:
        return nan
    q = np.array(qs)
    return dict(q_med=float(np.median(q)), q_lo=float(np.percentile(q, 16)), q_hi=float(np.percentile(q, 84)))


# --- Known-truth plume injection (Cell 9) --------------------------------------------------------


def gaussian_plume_ppb(
    q_kgph: float, u_ms: float, theta: float, src_rc: tuple[float, float], elev: float = 200.0
) -> np.ndarray:
    """Column enhancement (ppb) of a steady Gaussian plume.

    Briggs rural class-D lateral spread; wind blows towards angle theta (rad, from east).
    """
    r, c = np.mgrid[0:CHIP, 0:CHIP].astype("float32")
    dx, dy = (c - src_rc[1]) * PIX_M, -(r - src_rc[0]) * PIX_M
    x = dx * math.cos(theta) + dy * math.sin(theta)
    y = -dx * math.sin(theta) + dy * math.cos(theta)
    sig = np.maximum(0.08 * np.maximum(x, 0) / np.sqrt(1 + 1e-4 * np.maximum(x, 0)), PIX_M)
    omega = np.where(
        x > 0,
        (q_kgph / 3600) / (math.sqrt(2 * math.pi) * sig * max(u_ms, 0.5)) * np.exp(-(y**2) / (2 * sig**2)),
        0.0,
    )
    return (omega / M_CH4 / n_air(elev) * 1e9).astype("float32")


def inject(lut: Lut, tgt: np.ndarray, enh: np.ndarray, satellite: str, sza: float, vza: float) -> np.ndarray:
    """Darken B11/B12 of a clean scene by the transmittance of an enhancement map (ppb)."""
    t = tgt.copy()
    r11, r12 = band_ratios(lut, enh, sensor_key(lut, satellite), amf_of(lut, sza, vza))
    t[B["swir1"]] *= r11
    t[B["swir2"]] *= r12
    return t
