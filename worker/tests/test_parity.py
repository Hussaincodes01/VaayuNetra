"""Parity with the ops notebook: re-run the 14 landfill flags of the India field test from cached chips.

Needs the model zip (models/ or VAYU_MODEL_ZIP), torch + segmentation-models-pytorch, and the chip
and pass-list cache that `vayu scan --site <slug> --no-upload` writes for each landfill (Earth Engine
credentials needed once). Skipped when any of these is missing. Wind comes from the notebook's own
ERA5-Land values in scan_all_passes.csv, so no Earth Engine call is made here.
"""

from __future__ import annotations

import csv
import datetime as dt
import math
from collections import defaultdict
from pathlib import Path

import pytest

SEED_CSV = Path(__file__).resolve().parents[2] / "data" / "seed" / "scan_all_passes.csv"

pytestmark = pytest.mark.parity


def _flags() -> list[dict[str, str]]:
    with SEED_CSV.open(newline="") as f:
        return [r for r in csv.DictReader(f) if r["kind"] == "landfill" and r["detected"] == "True"]


@pytest.fixture(scope="module")
def scanner():
    pytest.importorskip("torch")
    pytest.importorskip("segmentation_models_pytorch")
    from vayunetra.config import Settings
    from vayunetra.model import find_model_zip, load_model
    from vayunetra.physics import Lut
    from vayunetra.pipeline import Scanner

    settings = Settings.from_env()
    try:
        zip_path = find_model_zip(settings.model_zip)
    except FileNotFoundError as e:
        pytest.skip(str(e))
    if not (settings.cache_dir / "passes").is_dir():
        pytest.skip(f"no cached passes in {settings.cache_dir}; run `vayu scan --site <slug> --no-upload` first")
    model = load_model(zip_path, settings.cache_dir, settings.device)
    return Scanner(model=model, lut=Lut.load(model.lut_path), threshold=model.threshold,
                   cache_dir=settings.cache_dir, offline=True)  # fmt: skip


def test_fourteen_flags_listed() -> None:
    flags = _flags()
    assert len(flags) == 14
    assert sorted(r["tier"] for r in flags).count("T3") == 11


def test_flags_reproduce_tier_and_rate(scanner) -> None:
    from vayunetra.pipeline import builtin_sites

    by_site: dict[str, list[dict[str, str]]] = defaultdict(list)
    for r in _flags():
        by_site[r["site"]].append(r)
    sites = {s.name: s for s in builtin_sites()}
    mismatches = []
    for name, expected in by_site.items():
        dates = {dt.date.fromisoformat(r["date"]): r for r in expected}
        winds = {d: (float(r["u"]), float(r["v"])) for d, r in dates.items()}
        try:
            results = scanner.scan_site(sites[name], winds=winds, only_dates=set(dates))
        except FileNotFoundError as e:
            pytest.skip(f"{name}: {e}")
        got = {r.row["date"]: r.row for r in results}
        for d, exp in dates.items():
            row = got.get(d)
            if row is None:
                mismatches.append(f"{name} {d}: pass not in cache")
                continue
            if row["tier"] != exp["tier"]:
                mismatches.append(f"{name} {d}: tier {row['tier']} != {exp['tier']} (score {row['scene_score']})")
            q_exp = float(exp["q_kgph"]) if exp["q_kgph"] else math.nan
            q_got = float(row["q_kgph"])
            if math.isnan(q_exp) != math.isnan(q_got) or (not math.isnan(q_exp) and abs(q_got - q_exp) > 0.02 * q_exp):
                mismatches.append(f"{name} {d}: q_kgph {q_got} vs {q_exp}")
    assert not mismatches, "\n".join(mismatches)
