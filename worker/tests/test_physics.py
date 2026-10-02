"""Physics unit tests on synthetic injected plumes (no model, no Earth Engine, no network).

A synthetic transmittance LUT (Beer-Lambert in the methane mixing ratio, B12 absorbing more than
B11) stands in for integrated_transmittances.json so the tests run in CI without the model zip.
"""

from __future__ import annotations

import csv
import math
from pathlib import Path

import numpy as np
import pytest

from vayunetra import physics as ph

from .conftest import scene

SEED_CSV = Path(__file__).resolve().parents[2] / "data" / "seed" / "scan_all_passes.csv"


def plume(lut: ph.Lut, q_kgph: float = 10000, u: float = 4.0, theta: float = 0.0) -> np.ndarray:
    """Compact plume: source 50 px from the east edge, so it covers ~2% of the chip.

    MBSP fits its coefficient over the whole chip; a plume filling most of it would bias the fit.
    """
    return ph.gaussian_plume_ppb(q_kgph, u, theta, (ph.CHIP / 2, ph.CHIP - 50), elev=10.0)


# --- Forward model and retrieval -----------------------------------------------------------------


def test_band_ratios_dim_b12_more_than_b11(lut: ph.Lut) -> None:
    r11, r12 = ph.band_ratios(lut, np.array([0.0, 500.0, 2000.0]), "S2B", 2.4)
    assert r11[0] == pytest.approx(1.0) and r12[0] == pytest.approx(1.0)
    assert np.all(np.diff(r12) < 0) and np.all(r12[1:] < r11[1:])


def test_ppb_from_mbmp_inverts_the_forward_model(lut: ph.Lut) -> None:
    enh = np.array([100.0, 1000.0, 4000.0])
    r11, r12 = ph.band_ratios(lut, enh, "S2A", 2.2)
    recovered = ph.ppb_from_mbmp(lut, 1 - r12 / r11, "S2A", 2.2)
    np.testing.assert_allclose(recovered, enh, rtol=0.02)


def test_mbmp_recovers_injected_enhancement(lut: ph.Lut) -> None:
    clean = scene()
    enh = plume(lut)
    tgt = ph.inject(lut, clean, enh, "Sentinel-2B", 30.0, 5.0)
    refs = [(clean[ph.B["swir1"]], clean[ph.B["swir2"]])] * 4
    m = ph.mbmp(tgt[ph.B["swir1"]], tgt[ph.B["swir2"]], refs)
    core = enh > 500
    assert m[core].min() > 0, "methane must give a positive MBMP signal"
    assert np.abs(m[enh < 1]).max() < 1e-3, "near-zero signal away from the plume"
    amf = ph.amf_of(lut, 30.0, 5.0)
    ppb = ph.ppb_from_mbmp(lut, m, "S2B", amf)
    np.testing.assert_allclose(ppb[core], enh[core], rtol=0.05)


def test_ime_matches_injected_mass(lut: ph.Lut) -> None:
    clean = scene()
    enh = plume(lut)
    tgt = ph.inject(lut, clean, enh, "Sentinel-2A", 30.0, 5.0)
    refs = [(clean[ph.B["swir1"]], clean[ph.B["swir2"]])] * 4
    m = ph.mbmp(tgt[ph.B["swir1"]], tgt[ph.B["swir2"]], refs)
    mask = enh > 1
    ime, length = ph.ime_kg(lut, m, mask, "S2A", ph.amf_of(lut, 30.0, 5.0), 10.0)
    true_mass = float((enh[mask] * 1e-9 * ph.n_air(10.0) * ph.M_CH4).sum() * ph.PIX_M**2)
    assert ime == pytest.approx(true_mass, rel=0.05)
    assert length == pytest.approx(math.sqrt(mask.sum()) * ph.PIX_M)


def test_gaussian_plume_carries_the_emitted_flux() -> None:
    q, u = 36000.0, 5.0  # 10 kg/s
    enh = ph.gaussian_plume_ppb(q, u, 0.0, (100, 20), elev=0.0)
    col = enh[:, 120] * 1e-9 * ph.n_air(0.0) * ph.M_CH4  # kg/m² across a downwind section
    flux = col.sum() * ph.PIX_M * u  # kg/s through the section
    assert flux == pytest.approx(q / 3600, rel=0.05)


def test_make_input_has_17_channels(lut: ph.Lut) -> None:
    clean = scene()
    refs = [(clean[11], clean[12])] * 4
    m = ph.mbmp(clean[11], clean[12], refs)
    x = ph.make_input(clean, refs, m)
    assert x.shape == (17, ph.CHIP, ph.CHIP) and x.dtype == np.float32


# --- Emission rate guards ------------------------------------------------------------------------


def _detected_plume(lut: ph.Lut):
    clean = scene()
    enh = plume(lut)
    tgt = ph.inject(lut, clean, enh, "Sentinel-2B", 30.0, 5.0)
    refs = [(clean[11], clean[12])] * 4
    m = ph.mbmp(tgt[11], tgt[12], refs)
    prob = (enh > 200).astype("float32")
    return m, prob


def test_emission_rate_needs_wind(lut: ph.Lut) -> None:
    m, prob = _detected_plume(lut)
    args = ("Sentinel-2B", 30.0, 5.0, 10.0, 0.14, 1.11)
    assert math.isnan(ph.emission_rate(lut, m, prob, 1.4, *args))
    assert math.isnan(ph.emission_rate(lut, m, prob, float("nan"), *args))
    assert ph.emission_rate(lut, m, prob, 4.0, *args) > 0


def test_quantify_calm_wind_gives_no_rate(lut: ph.Lut) -> None:
    m, prob = _detected_plume(lut)
    q = ph.quantify(lut, m, prob, 0.5, 0.5, "Sentinel-2B", 30.0, 5.0, 10.0, 0.14, 1.11)
    assert all(math.isnan(v) for v in q.values())


def test_quantify_gives_ordered_68pct_range(lut: ph.Lut) -> None:
    m, prob = _detected_plume(lut)
    q = ph.quantify(lut, m, prob, 4.0, 0.0, "Sentinel-2B", 30.0, 5.0, 10.0, 0.14, 1.11)
    assert 0 < q["q_lo"] < q["q_med"] < q["q_hi"]


# --- Physics gate --------------------------------------------------------------------------------


def test_physics_gate_accepts_methane_like_dimming(lut: ph.Lut) -> None:
    clean = scene()
    enh = plume(lut, theta=0.0)  # plume blows east
    tgt = ph.inject(lut, clean, enh, "Sentinel-2B", 30.0, 5.0)
    prob = (enh > 200).astype("float32")
    res = ph.physics_check(tgt, [clean] * 4, prob, 4.0, 0.0)
    assert res["spectral_ok"] and res["aligned"]
    assert res["dB12"] < -0.01 and res["dVisNIR"] == 0


def test_physics_gate_rejects_broadband_darkening(lut: ph.Lut) -> None:
    clean = scene()
    tgt = clean.copy()
    prob = np.zeros((ph.CHIP, ph.CHIP), dtype="float32")
    prob[90:110, 60:140] = 1
    tgt[:, prob > 0.5] *= 0.9  # burn scar: every band darkens
    res = ph.physics_check(tgt, [clean] * 4, prob, 4.0, 0.0)
    assert not res["spectral_ok"]


def test_geometry_check_downwind_vs_upwind() -> None:
    prob = np.zeros((ph.CHIP, ph.CHIP), dtype="float32")
    prob[98:102, 100:160] = 1  # starts at the centre and extends east
    assert ph.geometry_check(prob, 4.0, 0.0)["at_source_downwind"]  # wind blows east
    assert not ph.geometry_check(prob, -4.0, 0.0)["at_source_downwind"]  # wind blows west


def _row(**kw):
    base = dict(detected=True, spectral_ok=False, aligned=False, at_source_downwind=False,
                dB12=np.nan, dB11=np.nan, dVisNIR=np.nan)  # fmt: skip
    return {**base, **kw}


def test_tier_rules() -> None:
    assert ph.tier_of(_row(detected=False)) == "-"
    assert ph.tier_of(_row(spectral_ok=True, aligned=True)) == "T1"
    near = dict(dB12=-0.03, dB11=-0.01, dVisNIR=0.015)
    assert ph.tier_of(_row(aligned=True, **near)) == "T2"
    assert ph.tier_of(_row(at_source_downwind=True, **near)) == "T2"
    assert ph.tier_of(_row(**near)) == "T3"
    assert ph.tier_of(_row(aligned=True, dB12=0.01, dB11=0.0, dVisNIR=0.0)) == "T3"


def test_tier_and_surface_kind_reproduce_the_field_test() -> None:
    """tier_of / surface_kind on all 674 notebook rows give the notebook's own labels."""
    with SEED_CSV.open(newline="") as f:
        rows = list(csv.DictReader(f))
    assert len(rows) == 674

    def num(s: str) -> float:
        return float(s) if s else float("nan")

    for r in rows:
        rec = dict(detected=r["detected"] == "True", spectral_ok=r["spectral_ok"] == "True",
                   aligned=r["aligned"] == "True", at_source_downwind=r["at_source_downwind"] == "True",
                   dB12=num(r["dB12"]), dB11=num(r["dB11"]), dVisNIR=num(r["dVisNIR"]))  # fmt: skip
        rec["tier"] = ph.tier_of(rec)
        assert rec["tier"] == r["tier"], (r["site"], r["date"])
        assert ph.surface_kind(rec) == r["surface_kind"], (r["site"], r["date"])
    assert sum(r["tier"] == "T1" for r in rows) == 1
