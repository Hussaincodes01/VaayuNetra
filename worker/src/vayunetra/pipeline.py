"""Scan sites end to end (ops notebook Cells 6, 7, 11 and 16).

run_scene     one target pass + its clean references -> score, physics gate, tier, emission rate
scan_site     every usable pass at a site (optionally only passes after target_after)
"""

from __future__ import annotations

import datetime as dt
import math
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from vayunetra import earth_engine as gee
from vayunetra import physics as ph
from vayunetra.model import VayuModel

START, END = "2024-01-01", "2025-12-31"  # the India field-test window
CONTROL_OFFSET_DEG = 0.045  # control point ≈5 km north of each landfill
MONITOR_LOOKBACK_DAYS = 45

# name: (lat, lon, elevation m, city), as in the ops notebook. Used when Supabase is not configured.
LANDFILLS: dict[str, tuple[float, float, float, str]] = {
    "Ghazipur": (28.6247, 77.3272, 210, "Delhi"),
    "Bhalswa": (28.7406, 77.1582, 215, "Delhi"),
    "Okhla": (28.5125, 77.2835, 205, "Delhi"),
    "Deonar": (19.0717, 72.9278, 10, "Mumbai"),
    "Pirana": (22.9762, 72.5656, 50, "Ahmedabad"),
}


@dataclass(frozen=True)
class Site:
    slug: str
    name: str
    lat: float
    lon: float
    elev: float
    city: str
    kind: str  # landfill | control
    id: str | None = None
    control_of: str | None = None  # landfill id for a control point


def builtin_sites() -> list[Site]:
    sites = [
        Site(slug=n.lower(), name=n, lat=la, lon=lo, elev=el, city=c, kind="landfill")
        for n, (la, lo, el, c) in LANDFILLS.items()
    ]
    sites += [
        Site(
            slug=f"{s.slug}-control",
            name=f"{s.name} control",
            lat=round(s.lat + CONTROL_OFFSET_DEG, 4),
            lon=s.lon,
            elev=s.elev,
            city=s.city,
            kind="control",
        )  # fmt: skip
        for s in list(sites)
    ]
    return sites


def threshold_from_settings(settings: Mapping[str, Any], model_card_threshold: float) -> tuple[float, str]:
    """threshold_mode 'model_card' (0.844) or 'india_calibrated' (0.793, 99th pct of Indian controls)."""
    mode = str(settings.get("threshold_mode", "model_card"))
    thresholds = settings.get("thresholds") or {}
    if mode == "india_calibrated":
        return float(thresholds.get("india_calibrated", 0.793)), mode
    return float(model_card_threshold), "model_card"


@dataclass
class SceneEvidence:
    """Arrays kept for a detected pass so outputs.py can draw the evidence images."""

    rgb: np.ndarray
    m: np.ndarray
    prob: np.ndarray
    u: float
    v: float


@dataclass
class ScanResult:
    row: dict[str, Any]
    evidence: SceneEvidence | None = None


WindFn = Callable[[int, float, float], tuple[float, float]]


@dataclass
class Scanner:
    model: VayuModel
    lut: ph.Lut
    threshold: float
    cache_dir: Path
    offline: bool = False
    wind_fn: WindFn = field(default=gee.wind_uv)
    assumptions: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        if self.model.chip != ph.CHIP or self.model.min_plume_px != ph.MIN_PLUME_PX:
            raise ValueError(
                f"model card chip/min_plume_px ({self.model.chip}/{self.model.min_plume_px}) differ from "
                f"physics constants ({ph.CHIP}/{ph.MIN_PLUME_PX})"
            )

    def run_scene(
        self,
        tgt: np.ndarray,
        ref_chips: list[np.ndarray],
        sza: float,
        vza: float,
        sat: str,
        elev: float,
        t_ms: int,
        lat: float,
        lon: float,
        wind: tuple[float, float] | None = None,
    ) -> tuple[dict[str, Any], np.ndarray, np.ndarray]:
        B = ph.B
        refs = [(r[B["swir1"]], r[B["swir2"]]) for r in ref_chips]
        m = ph.mbmp(tgt[B["swir1"]], tgt[B["swir2"]], refs)
        prob, score = self.model.predict(ph.make_input(tgt, refs, m))
        out: dict[str, Any] = dict(
            scene_score=round(score, 3), detected=bool(score > self.threshold),
            plume_px=int((prob > 0.5).sum()), u=np.nan, v=np.nan, u10=np.nan, q_kgph=np.nan,
        )  # fmt: skip
        if out["detected"]:
            u, v = wind if wind is not None else self.wind_fn(t_ms, lat, lon)
            out.update(u=u, v=v, u10=math.hypot(u, v) if np.isfinite(u) else np.nan)
            out.update(ph.physics_check(tgt, ref_chips, prob, u, v))
            out.update(ph.geometry_check(prob, u, v))
            out["q_kgph"] = ph.emission_rate(
                self.lut, m, prob, out["u10"], sat, sza, vza, elev, self.model.a_cal, self.model.b_cal
            )
        else:
            out.update(dB12=np.nan, dB11=np.nan, dVisNIR=np.nan, spectral_ok=False, elong=np.nan,
                       axis_vs_wind=np.nan, aligned=False, src_dist_m=np.nan, wind_angle=np.nan,
                       at_source_downwind=False)  # fmt: skip
        out["tier"] = ph.tier_of(out)
        out["surface_kind"] = ph.surface_kind(out)
        return out, prob, m

    def quantify(self, ev: SceneEvidence, sat: str, sza: float, vza: float, elev: float) -> dict[str, float]:
        a = self.assumptions
        return ph.quantify(
            self.lut, ev.m, ev.prob, ev.u, ev.v, sat, sza, vza, elev, self.model.a_cal, self.model.b_cal,
            wind_rel_unc=float(a.get("wind_rel_unc", 0.30)), calib_rel_unc=float(a.get("calib_rel_unc", 0.20)),
        )  # fmt: skip

    def scan_site(
        self,
        site: Site,
        start: str = START,
        end: str = END,
        target_after: dt.date | None = None,
        winds: Mapping[dt.date, tuple[float, float]] | None = None,
        only_dates: set[dt.date] | None = None,
    ) -> list[ScanResult]:
        """Scan every usable pass with enough references. winds/only_dates support cached re-runs."""
        P = gee.load_site_passes(site.lat, site.lon, start, end, self.cache_dir, offline=self.offline)
        results: list[ScanResult] = []
        for k in range(len(P)):
            r = P.iloc[k]
            if target_after is not None and r.date <= target_after:
                continue
            if only_dates is not None and r.date not in only_dates:
                continue
            refs = gee.refs_for(P, k)
            if not refs:
                continue
            wind = winds.get(r.date) if winds else None
            o, prob, m = self.run_scene(r.chip, refs, r.sza, r.vza, r.sat, site.elev, int(r.t),
                                        site.lat, site.lon, wind=wind)  # fmt: skip
            row = dict(kind=site.kind, site=site.name, slug=site.slug, date=r.date, t_ms=int(r.t),
                       lat=site.lat, lon=site.lon, sat=r.sat, sza=r.sza, vza=r.vza, **o)  # fmt: skip
            ev = None
            if o["detected"]:
                B = ph.B
                ev = SceneEvidence(rgb=r.chip[[B["red"], B["green"], B["blue"]]].copy(), m=m, prob=prob,
                                   u=o["u"], v=o["v"])  # fmt: skip
                if site.kind == "landfill" and o["tier"] in ("T1", "T2"):
                    row.update(self.quantify(ev, r.sat, r.sza, r.vza, site.elev))
            results.append(ScanResult(row=row, evidence=ev))
        return results


def monitor_window(last_seen: dt.date | None, today: dt.date | None = None) -> tuple[str, str, dt.date]:
    """Load enough history for references (REF_MAX_DAYS) and scan only passes after last_seen."""
    today = today or dt.date.today()
    start = (today - dt.timedelta(days=MONITOR_LOOKBACK_DAYS + gee.REF_MAX_DAYS)).isoformat()
    after = last_seen or (today - dt.timedelta(days=MONITOR_LOOKBACK_DAYS))
    return start, today.isoformat(), after
