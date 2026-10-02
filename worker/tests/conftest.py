"""Shared fixtures: a synthetic transmittance LUT and flat synthetic scenes."""

from __future__ import annotations

import numpy as np
import pytest

from vayunetra import physics as ph


def scene(level: float = 0.25) -> np.ndarray:
    """Flat 13-band surface with B11 == B12 (so the MBSP fit coefficient is ~1)."""
    x = np.full((13, ph.CHIP, ph.CHIP), level, dtype="float32")
    x[10] = 0.002  # B10 cirrus band stays dark
    return x


@pytest.fixture(scope="session")
def lut() -> ph.Lut:
    """Beer-Lambert stand-in for integrated_transmittances.json: B12 absorbs ~7x more than B11."""
    amf = np.linspace(2.0, 3.2, 8)
    mr = np.array([1324.0, 1655.0, 1904.0, 2152.0, 2400.0, 2649.0, 3145.0, 4966.0, 8278.0])
    bg = 1800.0

    def table(k: float) -> list[list[float]]:
        return [list(np.exp(-k * a * (mr - bg) / 1e4)) for a in amf]

    sensor = {"transmittance_b11": table(0.02), "transmittance_b12": table(0.15)}
    return ph.Lut.from_dict(
        {
            "amf_arr": list(amf),
            "mr_ch4_arr": [list(mr)] * len(amf),
            "background_concentration": bg,
            "S2A": sensor,
            "S2B": sensor,
            "S2C": sensor,
        }
    )
