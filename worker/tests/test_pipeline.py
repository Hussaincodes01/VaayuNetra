"""End-to-end glue without Earth Engine or torch: cached passes -> scan_site -> outputs -> DB records.

A stand-in model flags pixels where the MBMP input channel is high, so this exercises everything
around the U-Net: the pass cache, reference selection, run_scene, the physics gate, Monte Carlo
quantification, evidence images, plume polygon, chip bounds and the scans-table mapping.
"""

from __future__ import annotations

import datetime as dt
import json
import math
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pytest

from vayunetra import earth_engine as gee
from vayunetra import outputs as out
from vayunetra import physics as ph
from vayunetra.pipeline import END, START, Scanner, builtin_sites
from vayunetra.sync import scan_record

from .conftest import scene

PLUME_DAY = 5  # the 6th of 10 passes carries the plume


@dataclass
class StandInModel:
    """Same interface as VayuModel; 'detects' where clip(MBMP / 0.02) is above 0.25."""

    card: dict = field(default_factory=lambda: {"scene_threshold": 0.8442, "ime": {"a": 0.14, "b": 1.11}})
    device: str = "cpu"
    model_version: str = "test00000000"
    chip: int = ph.CHIP
    min_plume_px: int = ph.MIN_PLUME_PX
    threshold: float = 0.8442
    a_cal: float = 0.14
    b_cal: float = 1.11

    def predict(self, x: np.ndarray) -> tuple[np.ndarray, float]:
        prob = (x[15] > 0.25).astype("float32")
        return prob, 0.95 if prob.sum() >= self.min_plume_px else 0.10


@pytest.fixture
def cached_site(tmp_path: Path, lut: ph.Lut):
    site = next(s for s in builtin_sites() if s.slug == "deonar")
    t0 = dt.datetime(2024, 3, 1, 5, 50, tzinfo=dt.UTC)
    passes, enh = [], ph.gaussian_plume_ppb(10000, 4.0, 0.0, (ph.CHIP / 2, ph.CHIP / 2), elev=site.elev)
    for k in range(10):
        idx = f"SYN_{k:02d}"
        t = t0 + dt.timedelta(days=12 * k)
        passes.append([idx, int(t.timestamp() * 1000), "Sentinel-2B", 35.0, 5.0])
        chip = scene()
        if k == PLUME_DAY:
            chip = ph.inject(lut, chip, enh, "Sentinel-2B", 35.0, 5.0)
        path = gee.chip_path(tmp_path, idx, site.lat, site.lon)
        path.parent.mkdir(parents=True, exist_ok=True)
        np.save(path, chip)
    cache = gee._passes_cache(tmp_path, site.lat, site.lon, START, END)
    cache.parent.mkdir(parents=True, exist_ok=True)
    cache.write_text(json.dumps(passes))
    plume_date = (t0 + dt.timedelta(days=12 * PLUME_DAY)).date()
    return site, tmp_path, plume_date


def test_scan_site_offline_end_to_end(cached_site, lut: ph.Lut) -> None:
    site, cache_dir, plume_date = cached_site
    scanner = Scanner(model=StandInModel(), lut=lut, threshold=0.8442, cache_dir=cache_dir, offline=True)
    results = scanner.scan_site(site, winds={plume_date: (4.0, 0.0)})

    # Every pass with >= 4 references 10-150 days away is scanned; only the plume pass is flagged.
    assert len(results) == 10
    flagged = [r for r in results if r.row["detected"]]
    assert [r.row["date"] for r in flagged] == [plume_date]
    row, ev = flagged[0].row, flagged[0].evidence
    assert row["tier"] == "T1", row
    assert row["spectral_ok"] and row["aligned"]
    assert row["q_kgph"] > 0 and row["q_lo"] < row["q_med"] < row["q_hi"]

    # Evidence outputs.
    plume = out.plume_geojson(ev.prob, site.lat, site.lon)
    assert plume["features"]
    lon, lat = plume["features"][0]["geometry"]["coordinates"][0][0]
    assert abs(lon - site.lon) < 0.02 and abs(lat - site.lat) < 0.02
    corners = out.chip_bounds(site.lat, site.lon)
    assert len(corners) == 4
    assert corners[0][0] < site.lon < corners[1][0] and corners[2][1] < site.lat < corners[0][1]
    png = out.panel_png(site.name, row["date"], ev.rgb, ev.m, ev.prob, ev.u, ev.v, row["tier"], row["q_kgph"])
    assert png[:8] == b"\x89PNG\r\n\x1a\n"

    # Mapping onto the scans table.
    rec = scan_record(row, "00000000-0000-0000-0000-000000000001", 0.8442, "test00000000")
    assert rec["tier"] == "T1" and rec["wind_u"] == 4.0 and rec["pass_date"] == plume_date.isoformat()
    assert rec["overpass_utc"].startswith(plume_date.isoformat())
    clean = scan_record(results[0].row, "00000000-0000-0000-0000-000000000001", 0.8442, "test00000000")
    assert clean["tier"] == "none" and clean["q_kgph"] is None and clean["d_b12"] is None


def test_calm_wind_flag_gets_no_rate(cached_site, lut: ph.Lut) -> None:
    site, cache_dir, plume_date = cached_site
    scanner = Scanner(model=StandInModel(), lut=lut, threshold=0.8442, cache_dir=cache_dir, offline=True)
    results = scanner.scan_site(site, winds={plume_date: (0.5, 0.4)}, only_dates={plume_date})
    row = results[0].row
    assert row["detected"] and math.isnan(row["q_kgph"]) and math.isnan(row["q_med"])


def test_target_after_skips_seen_passes(cached_site, lut: ph.Lut) -> None:
    site, cache_dir, plume_date = cached_site
    scanner = Scanner(model=StandInModel(), lut=lut, threshold=0.8442, cache_dir=cache_dir, offline=True)
    results = scanner.scan_site(site, target_after=plume_date, winds={})
    assert results and all(r.row["date"] > plume_date for r in results)
