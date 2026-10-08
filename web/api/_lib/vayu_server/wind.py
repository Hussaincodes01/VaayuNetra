"""Site wind forecast: hourly history from the Open-Meteo API, a model slot and honest scores.

The model slot ([model] wind in vayu.toml):
  "persistence"        the last hour, repeated. The baseline every model has to beat.
  "amazon/chronos-2"   Chronos-2 zero-shot: u and v forecast jointly from the last 512 hours,
                       no training. Needs the forecast extra (torch, chronos-forecasting).
  "vayunetra:<dir>"    VayuNetra's own Chronos-2, fine-tuned on ERA5 in the wind-model notebook
                       (out/chronos-lora/finetuned-ckpt). Same code path, different weights.

Directions are meteorological: where the wind blows FROM, degrees clockwise from north.
u is eastward and v northward, as ERA5 u10/v10. The forecast is screening-grade: it decides
which side of the site is downwind for the next hours, it does not replace the anemometer.
"""

from __future__ import annotations

import importlib.util
import json
import math
import urllib.parse
import urllib.request
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ZERO_SHOT = "amazon/chronos-2"
CALM_MS = 1.0  # same as DetectCfg.calm_ms: below this the direction is not used
DIR_MIN_MS = 2.0  # direction errors are scored only where the true wind is at least this
QUANTILES = (0.1, 0.5, 0.9)


def to_uv(speed_ms: float, from_deg: float) -> tuple[float, float]:
    r = math.radians(from_deg)
    return -speed_ms * math.sin(r), -speed_ms * math.cos(r)


def from_uv(u: float, v: float) -> tuple[float, float]:
    """(speed m/s, direction the wind blows from in degrees)."""
    return math.hypot(u, v), math.degrees(math.atan2(-u, -v)) % 360.0


def angle_diff(a: float, b: float) -> float:
    return abs((a - b + 180.0) % 360.0 - 180.0)


@dataclass(frozen=True)
class Obs:
    time: int  # unix seconds, start of the hour (UTC)
    u: float
    v: float

    @property
    def speed_ms(self) -> float:
        return math.hypot(self.u, self.v)

    @property
    def direction_deg(self) -> float:
        return from_uv(self.u, self.v)[1]


@dataclass
class Lead:
    h: int
    time: int
    u: float
    v: float
    speed_ms: float
    direction_deg: float
    calm: bool
    direction_spread_deg: float | None = None  # half-width of the 10-90 % direction range
    u_band: tuple[float, float] | None = None
    v_band: tuple[float, float] | None = None


@dataclass
class Forecast:
    model: str
    issued: int  # time of the last hour of history used
    leads: list[Lead]
    context_h: int = 0
    note: str = ""

    def to_dict(self) -> dict:
        return asdict(self)


def lead_from_point(h: int, time: int, u: float, v: float) -> Lead:
    ms, frm = from_uv(u, v)
    return Lead(h, time, u, v, ms, frm, ms < CALM_MS)


def lead_from_quantiles(h: int, time: int, u: tuple[float, float, float],
                        v: tuple[float, float, float]) -> Lead:
    """u and v as (10 %, 50 %, 90 %). The direction range is taken over the corners of the
    u-v box: a conservative envelope, since the two marginals do not give the joint spread.
    A box around the origin means any direction (180)."""
    lead = lead_from_point(h, time, u[1], v[1])
    if u[0] <= 0 <= u[2] and v[0] <= 0 <= v[2]:
        spread = 180.0
    else:
        spread = max(angle_diff(from_uv(cu, cv)[1], lead.direction_deg)
                     for cu in (u[0], u[2]) for cv in (v[0], v[2]))
    lead.direction_spread_deg = spread
    lead.u_band, lead.v_band = (u[0], u[2]), (v[0], v[2])
    return lead


# --- data -------------------------------------------------------------------------------------

def _parse_time(s: str) -> int:
    return int(datetime.fromisoformat(s).replace(tzinfo=UTC).timestamp())


def parse_open_meteo(body: dict) -> list[Obs]:
    """Open-Meteo hourly wind_speed_10m (m/s) and wind_direction_10m, times in GMT."""
    h = body["hourly"]
    out = []
    for t, ms, d in zip(h["time"], h["wind_speed_10m"], h["wind_direction_10m"], strict=True):
        if ms is None or d is None:
            continue
        out.append(Obs(_parse_time(t), *to_uv(float(ms), float(d))))
    return out


def api_url(base: str, lat: float, lon: float, **extra: object) -> str:
    q = {"latitude": f"{lat:.5f}", "longitude": f"{lon:.5f}",
         "hourly": "wind_speed_10m,wind_direction_10m", "wind_speed_unit": "ms",
         "timezone": "GMT", **extra}
    return base + "?" + urllib.parse.urlencode(q)


def fetch_json(url: str, timeout_s: float = 60.0) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "vayu-server"})
    with urllib.request.urlopen(req, timeout=timeout_s) as r:  # noqa: S310 (fixed https hosts)
        return json.load(r)


def era5_history(lat: float, lon: float, start: str, end: str) -> list[Obs]:
    """ERA5 reanalysis through the Open-Meteo archive API (about five days behind)."""
    return parse_open_meteo(fetch_json(api_url(ARCHIVE_URL, lat, lon, start_date=start,
                                               end_date=end, models="era5")))


def recent(lat: float, lon: float, now: int, past_days: int = 30,
           forecast_days: int = 2) -> tuple[list[Obs], list[Obs]]:
    """(history up to the current hour, the weather service's own forecast after it)."""
    s = parse_open_meteo(fetch_json(api_url(FORECAST_URL, lat, lon, past_days=past_days,
                                            forecast_days=forecast_days)))
    cut = now - now % 3600
    return [o for o in s if o.time <= cut], [o for o in s if o.time > cut]


def regular(series: list[Obs], max_gap_h: int = 3) -> list[Obs]:
    """Hourly, gap-free tail of the series: short holes are filled linearly in u and v,
    a longer hole cuts the context so the model never sees invented hours."""
    out: list[Obs] = []
    for o in sorted(series, key=lambda x: x.time):
        if out:
            missing = (o.time - out[-1].time) // 3600 - 1
            if missing > max_gap_h:
                out = []
            elif missing > 0:
                a = out[-1]
                for k in range(1, missing + 1):
                    f = k / (missing + 1)
                    out.append(Obs(a.time + 3600 * k, a.u + f * (o.u - a.u),
                                   a.v + f * (o.v - a.v)))
            elif missing < 0:
                continue
        out.append(o)
    return out


# --- models -----------------------------------------------------------------------------------

class Persistence:
    name = "persistence"

    def forecast(self, series: list[Obs], horizon_h: int) -> Forecast:
        last = series[-1]
        return Forecast(self.name, last.time, [
            lead_from_point(h, last.time + 3600 * h, last.u, last.v)
            for h in range(1, horizon_h + 1)], context_h=1)


class Diurnal:
    """The same hour yesterday: tests whether a model has learnt more than the daily cycle."""
    name = "diurnal"

    def forecast(self, series: list[Obs], horizon_h: int) -> Forecast:
        last, n = series[-1], len(series)
        leads = []
        for h in range(1, horizon_h + 1):
            o = series[n - 25 + h] if n - 25 + h >= 0 else last
            leads.append(lead_from_point(h, last.time + 3600 * h, o.u, o.v))
        return Forecast(self.name, last.time, leads, context_h=24)


def _chronos_available() -> bool:
    return importlib.util.find_spec("chronos") is not None


class Chronos2:
    def __init__(self, source: str = ZERO_SHOT, zero_shot: bool = True, context_h: int = 512,
                 device: str = "cpu"):
        self.source, self.zero_shot = source, zero_shot
        self.context_h, self.device = context_h, device
        self.name = "chronos-2" if zero_shot else "vayunetra-chronos-2"
        self._pipe = None

    def pipeline(self):
        if self._pipe is None:
            from chronos import Chronos2Pipeline
            self._pipe = Chronos2Pipeline.from_pretrained(self.source, device_map=self.device)
        return self._pipe

    def forecast(self, series: list[Obs], horizon_h: int) -> Forecast:
        return self.forecast_many([series], horizon_h)[0]

    def forecast_many(self, contexts: list[list[Obs]], horizon_h: int) -> list[Forecast]:
        """One batched call for many contexts (the backtest issues hundreds)."""
        import pandas as pd

        frames, used = [], []
        for i, series in enumerate(contexts):
            ctx = regular(series)[-self.context_h:]
            used.append(ctx)
            frames.append(pd.DataFrame({
                "id": i, "timestamp": pd.to_datetime([o.time for o in ctx], unit="s"),
                "u10": [o.u for o in ctx], "v10": [o.v for o in ctx]}))
        pred = self.pipeline().predict_df(
            pd.concat(frames, ignore_index=True), id_column="id", timestamp_column="timestamp",
            target=["u10", "v10"], prediction_length=horizon_h, quantile_levels=list(QUANTILES))
        q = [str(x) for x in QUANTILES]
        out = []
        for i, ctx in enumerate(used):
            rows = pred[pred["id"] == i]
            u = rows[rows["target_name"] == "u10"].sort_values("timestamp")[q].to_numpy()
            v = rows[rows["target_name"] == "v10"].sort_values("timestamp")[q].to_numpy()
            t0 = ctx[-1].time
            out.append(Forecast(self.name, t0, [
                lead_from_quantiles(h + 1, t0 + 3600 * (h + 1), tuple(map(float, u[h])),
                                    tuple(map(float, v[h])))
                for h in range(horizon_h)], context_h=len(ctx)))
        return out


def make_model(spec: str):
    spec = spec.strip() or ZERO_SHOT
    if spec == "persistence":
        return Persistence()
    if spec == "diurnal":
        return Diurnal()
    kind, _, rest = spec.partition(":")
    if kind == "vayunetra":
        path = Path(rest)
        if not path.is_dir():
            raise ValueError(f"vayunetra wind model not found at {path}: point [model] wind at"
                             " the notebook's out/chronos-lora/finetuned-ckpt folder")
        return Chronos2(str(path), zero_shot=False)
    return Chronos2(spec, zero_shot=True)


def run(model, series: list[Obs], horizon_h: int = 6) -> Forecast:
    """Forecast with the configured model; persistence if Chronos-2 cannot run here, and say so."""
    if isinstance(model, Chronos2):
        why = ""
        if not _chronos_available():
            why = "Chronos-2 not installed on this machine (uv sync --extra forecast)"
        else:
            try:
                return model.forecast(series, horizon_h)
            except Exception as e:  # weights not downloaded, out of memory, ...
                why = f"Chronos-2 failed: {type(e).__name__}: {e}"
        f = Persistence().forecast(series, horizon_h)
        f.note = why + "; persistence used."
        return f
    return model.forecast(series, horizon_h)


# --- scores -----------------------------------------------------------------------------------

def score(pred: list[tuple[float, float]], truth: list[tuple[float, float]],
          dir_min_ms: float = DIR_MIN_MS) -> dict:
    """Vector RMSE (m/s) over all pairs; direction error only where the true wind is moving."""
    n = len(pred)
    sq = [(pu - tu) ** 2 + (pv - tv) ** 2 for (pu, pv), (tu, tv) in zip(pred, truth, strict=True)]
    sp = [abs(math.hypot(*p) - math.hypot(*t)) for p, t in zip(pred, truth, strict=True)]
    de = [angle_diff(from_uv(*p)[1], from_uv(*t)[1])
          for p, t in zip(pred, truth, strict=True) if math.hypot(*t) >= dir_min_ms]
    return {"n": n, "vector_rmse": math.sqrt(sum(sq) / n) if n else None,
            "speed_mae": sum(sp) / n if n else None,
            "n_dir": len(de), "dir_mae_deg": sum(de) / len(de) if de else None,
            "within_45": sum(d <= 45 for d in de) / len(de) if de else None}


@dataclass
class _Origin:
    context: list[Obs]
    truth: list[Obs]
    forecasts: dict = field(default_factory=dict)


def backtest(series: list[Obs], models: list, every_h: int = 24, context_h: int = 512,
             horizon_h: int = 6) -> dict:
    """Issue forecasts every `every_h` hours through an hourly series and score each lead hour
    against what followed. Windows with a missing hour are skipped, never filled."""
    s = sorted(series, key=lambda o: o.time)
    origins = []
    for i in range(context_h - 1, len(s) - horizon_h, every_h):
        lo, hi = i - context_h + 1, i + horizon_h
        if s[hi].time - s[lo].time != (hi - lo) * 3600:
            continue
        origins.append(_Origin(s[lo:i + 1], s[i + 1:hi + 1]))
    for m in models:
        ctxs = [o.context for o in origins]
        fs = (m.forecast_many(ctxs, horizon_h) if hasattr(m, "forecast_many")
              else [m.forecast(c, horizon_h) for c in ctxs])
        for o, f in zip(origins, fs, strict=True):
            o.forecasts[m.name] = f
    names = [m.name for m in models]
    by_lead = []
    for h in range(horizon_h):
        truth = [(o.truth[h].u, o.truth[h].v) for o in origins]
        row: dict = {"lead_h": h + 1}
        for name in names:
            leads = [o.forecasts[name].leads[h] for o in origins]
            row[name] = score([(ld.u, ld.v) for ld in leads], truth)
            if leads and leads[0].u_band is not None:
                inside = [ld.u_band[0] <= t[0] <= ld.u_band[1] and ld.v_band[0] <= t[1]
                          <= ld.v_band[1] for ld, t in zip(leads, truth, strict=True)]
                row[name]["band_cover"] = sum(inside) / len(inside)
        by_lead.append(row)
    # Hours when the wind turned more than 45 degrees from the last observed hour: where a
    # forecast can add something over persistence, and where a plume check needs it most.
    turns = [(o, h) for o in origins for h in range(horizon_h)
             if o.truth[h].speed_ms >= DIR_MIN_MS and o.context[-1].speed_ms >= DIR_MIN_MS
             and angle_diff(o.truth[h].direction_deg, o.context[-1].direction_deg) > 45]
    turning = {name: score([(o.forecasts[name].leads[h].u, o.forecasts[name].leads[h].v)
                            for o, h in turns], [(o.truth[h].u, o.truth[h].v) for o, h in turns])
               for name in names}
    calm = [o.truth[h].speed_ms < CALM_MS for o in origins for h in range(horizon_h)]
    return {"origins": len(origins), "every_h": every_h, "context_h": context_h,
            "horizon_h": horizon_h, "models": names, "by_lead": by_lead, "turning": turning,
            "calm_share": sum(calm) / len(calm) if calm else None,
            "first_origin": origins[0].context[-1].time if origins else None,
            "last_origin": origins[-1].context[-1].time if origins else None}
