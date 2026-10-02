"""Sentinel-2 passes, 2 km chips and ERA5-Land wind from Google Earth Engine (ops notebook Cell 5).

Chips are cached on disk as <idx>_<translateX>_<translateY>.npy, the notebook's naming, so a chip
folder from an earlier notebook run can be reused by pointing VAYU_CACHE_DIR at its parent. Pass
lists are cached as JSON so cached runs (the parity test) work without Earth Engine.
"""

from __future__ import annotations

import json
import logging
import time
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, TypeVar

import numpy as np
import pandas as pd

from vayunetra.physics import CHIP, S2_BANDS, B

log = logging.getLogger(__name__)

MAX_CLOUD, N_REF, MAX_PASSES = 30, 4, 80
REF_MIN_DAYS, REF_MAX_DAYS = 10, 150
HALF = CHIP * 10 // 2
S2_COLLECTION = "COPERNICUS/S2_HARMONIZED"
ERA5_COLLECTION = "ECMWF/ERA5_LAND/HOURLY"

T = TypeVar("T")
_initialised = False


def retry(fn: Callable[[], T], attempts: int = 4, base_delay: float = 2.0, what: str = "") -> T:
    """Call fn with exponential backoff (2, 4, 8 s ...) on any exception; re-raise the last one."""
    for k in range(attempts):
        try:
            return fn()
        except Exception as e:  # Earth Engine raises plain EEException / HttpError
            if k == attempts - 1:
                raise
            delay = base_delay * 2**k
            log.warning("%s failed (%s); retry in %.0fs", what or fn, repr(e)[:160], delay)
            time.sleep(delay)
    raise AssertionError("unreachable")


def initialize(project: str | None, service_account: str | None, key_file: Path | None) -> None:
    """Authenticate with a service account (no browser), or fall back to stored user credentials."""
    global _initialised
    import ee

    if service_account and key_file:
        if not key_file.exists():
            raise FileNotFoundError(f"EE_KEY_FILE not found: {key_file}")
        creds = ee.ServiceAccountCredentials(service_account, key_file=str(key_file))
        ee.Initialize(creds, project=project)
    else:
        ee.Initialize(project=project)
    _initialised = True


def _ee():
    if not _initialised:
        raise RuntimeError("call earth_engine.initialize() first")
    import ee

    return ee


def utm_epsg(lat: float, lon: float) -> int:
    return (32600 if lat >= 0 else 32700) + int((lon + 180) // 6) + 1


def grid(lat: float, lon: float) -> dict[str, Any]:
    """200 x 200 px, 10 m UTM grid centred on the site (the request grid for computePixels)."""
    from pyproj import Transformer

    epsg = utm_epsg(lat, lon)
    x, y = Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True).transform(lon, lat)
    return {
        "dimensions": {"width": CHIP, "height": CHIP},
        "crsCode": f"EPSG:{epsg}",
        "affineTransform": {
            "scaleX": 10, "shearX": 0, "translateX": x - HALF,
            "shearY": 0, "scaleY": -10, "translateY": y + HALF,
        },
    }  # fmt: skip


def _passes_cache(cache_dir: Path, lat: float, lon: float, start: str, end: str) -> Path:
    return cache_dir / "passes" / f"{lat:.4f}_{lon:.4f}_{start}_{end}.json"


def list_passes(
    lat: float, lon: float, start: str, end: str, cache_dir: Path | None = None, offline: bool = False
) -> pd.DataFrame:
    """Cloud-light Sentinel-2 passes over a point: idx, t (ms), sat, sza, vza."""
    cols = ["idx", "t", "sat", "sza", "vza"]
    cache = _passes_cache(cache_dir, lat, lon, start, end) if cache_dir else None
    if offline:
        if cache is None or not cache.exists():
            raise FileNotFoundError(f"no cached pass list {cache}")
        return pd.DataFrame(json.loads(cache.read_text()), columns=cols).dropna()

    ee = _ee()

    def query():
        return (
            ee.ImageCollection(S2_COLLECTION)
            .filterBounds(ee.Geometry.Point(lon, lat))
            .filterDate(start, end)
            .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", MAX_CLOUD))
            .reduceColumns(
                ee.Reducer.toList(5),
                [
                    "system:index",
                    "system:time_start",
                    "SPACECRAFT_NAME",
                    "MEAN_SOLAR_ZENITH_ANGLE",
                    "MEAN_INCIDENCE_ZENITH_ANGLE_B12",
                ],  # fmt: skip
            )
            .get("list")
            .getInfo()
        )

    lst = retry(query, what=f"list_passes {lat},{lon}")
    if cache is not None:
        cache.parent.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(lst))
    return pd.DataFrame(lst, columns=cols).dropna()


def chip_path(cache_dir: Path, idx: str, lat: float, lon: float) -> Path:
    g = grid(lat, lon)["affineTransform"]
    return cache_dir / "chips" / f"{idx}_{g['translateX']:.0f}_{g['translateY']:.0f}.npy"


def fetch(idx: str, lat: float, lon: float, cache_dir: Path, offline: bool = False) -> np.ndarray | None:
    """13-band TOA reflectance chip (DN / 10000), cached on disk."""
    f = chip_path(cache_dir, idx, lat, lon)
    if f.exists():
        return np.load(f)
    if offline:
        return None
    ee = _ee()
    g = grid(lat, lon)

    def pull():
        a = ee.data.computePixels({
            "expression": ee.Image(f"{S2_COLLECTION}/{idx}").select(S2_BANDS),
            "fileFormat": "NUMPY_NDARRAY",
            "grid": g,
        })  # fmt: skip
        return np.stack([a[b] for b in S2_BANDS]).astype("float32") / 10000

    try:
        x = retry(pull, attempts=3, what=f"fetch {idx}")
    except Exception as e:
        log.warning("fetch failed %s %s", idx, repr(e)[:120])
        return None
    f.parent.mkdir(parents=True, exist_ok=True)
    np.save(f, x)
    return x


def usable(x: np.ndarray | None) -> bool:
    if x is None or not np.isfinite(x).all() or (x[B["swir2"]] > 0).mean() < 0.99:
        return False
    return bool(((x[B["blue"]] > 0.25) | (x[10] > 0.012)).mean() < 0.05)  # blue = cloud, B10 = cirrus


def wind_uv(t_ms: int, lat: float, lon: float) -> tuple[float, float]:
    """ERA5-Land 10 m wind (u, v) in m/s at the overpass hour; NaN if unavailable."""
    ee = _ee()

    def query():
        t = ee.Date(int(t_ms))
        im = ee.ImageCollection(ERA5_COLLECTION).filterDate(t.advance(-30, "minute"), t.advance(90, "minute")).first()
        d = (
            im.select(["u_component_of_wind_10m", "v_component_of_wind_10m"])
            .reduceRegion(ee.Reducer.first(), ee.Geometry.Point(lon, lat), 11132)
            .getInfo()
        )
        return float(d["u_component_of_wind_10m"]), float(d["v_component_of_wind_10m"])

    try:
        return retry(query, attempts=3, what=f"wind {t_ms}")
    except Exception:
        return float("nan"), float("nan")


def load_site_passes(
    lat: float,
    lon: float,
    start: str,
    end: str,
    cache_dir: Path,
    max_passes: int = MAX_PASSES,
    offline: bool = False,
) -> pd.DataFrame:
    """Usable passes with chips, one per UTC date, oldest first (newest max_passes kept)."""
    P = list_passes(lat, lon, start, end, cache_dir=cache_dir, offline=offline)
    if not len(P):
        return P
    P["date"] = pd.to_datetime(P.t, unit="ms").dt.date
    P = P.drop_duplicates("date").sort_values("t").tail(max_passes).reset_index(drop=True)
    with ThreadPoolExecutor(8) as ex:
        P["chip"] = list(ex.map(lambda s: fetch(s, lat, lon, cache_dir, offline=offline), P.idx))
    return P[[usable(c) for c in P.chip]].reset_index(drop=True)


def refs_for(P: pd.DataFrame, k: int) -> list[np.ndarray]:
    """The N_REF passes closest in time to pass k, 10–150 days away; [] if there are too few."""
    dd = np.array([(d - P.date[k]).days for d in P.date])
    cand = np.where((np.abs(dd) >= REF_MIN_DAYS) & (np.abs(dd) <= REF_MAX_DAYS))[0]
    if len(cand) < N_REF:
        return []
    return [P.chip[j] for j in cand[np.argsort(np.abs(dd[cand]))[:N_REF]]]
