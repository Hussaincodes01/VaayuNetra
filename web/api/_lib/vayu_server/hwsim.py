"""Simulations of the edge node, served to the dashboard.

Ported from the hardware team's files (VayuNetra_KiCad_simulations/ and
VayuNetra_reliability_simulations/) and checked against their results in the tests:

  gas_chain   TGS2600 -> divider -> RC filter -> ADS1115 input (vn_gas_sim.cir, spice_runs.py).
              A linear circuit, solved exactly: DC value and the step response.
  droop       Battery -> BMS -> cable -> PTC fuse -> VBAT bus -> Heltec during a LoRa burst
              (vn_droop_sim.cir; spice_runs.py with a constant-power boost converter).
              One capacitor, integrated with its exact exponential update.
  energy      Hour-by-hour solar harvest, load and battery temperature over a year of real
              Delhi or Mumbai weather, with the firmware's power policy (energy.py, line by line).

The mesh simulation (mesh.py) is a discrete-event model too heavy for the Pi to rerun on demand;
its recorded results are served as tables by `recorded_results`.
"""

from __future__ import annotations

import csv
import datetime as dt
import json
import math
from functools import lru_cache
from importlib import resources
from typing import Any

ADS_LSB_V = 62.5e-6  # ADS1115 at +/-2.048 V
ENCLOSURES = {"white box, shaded under panel": 0.006, "white box, in sun": 0.012,
              "grey/black box, in sun": 0.025}
CITIES = {"Delhi": ("delhi_2022-04-09.csv", dt.date(2022, 4, 9), dt.date(2022, 5, 21),
                    dt.date(2023, 5, 20), 28.61),
          "Mumbai": ("mumbai_2025-05-01.csv", dt.date(2025, 5, 1), None, None, 19.08)}
CELL_OHM = {2: 0.04, 3: 0.027}


def _data(name: str):
    return resources.files("vayu_server").joinpath("data", "hardware", name)


# --- gas measurement chain ---------------------------------------------------------------------

def _gas_dc(v5: float, rs: float, r3: float, r4: float, r5: float, r_ads: float) -> float:
    load = r4 * (r5 + r_ads) / (r4 + r5 + r_ads)
    v_mid = v5 * load / (rs + r3 + load)
    return v_mid * r_ads / (r5 + r_ads)


def gas_chain(rs_ohm: float = 30e3, v5: float = 5.0, r3: float = 2200.0, r4: float = 2700.0,
              r5: float = 1000.0, c: float = 100e-9, r_ads: float = 6e6,
              points: int = 200) -> dict[str, Any]:
    """Sensor resistance Rs -> voltage at ADS1115 AIN0, and the response to the 5 V step."""
    if min(rs_ohm, v5, r3, r4, r5, c, r_ads) <= 0:
        raise ValueError("all values must be positive")
    v = _gas_dc(v5, rs_ohm, r3, r4, r5, r_ads)
    v_plus = _gas_dc(v5, rs_ohm * 1.01, r3, r4, r5, r_ads)
    r_th = (1 / (1 / ((rs_ohm + r3) * r4 / (rs_ohm + r3 + r4) + r5) + 1 / r_ads))
    tau = r_th * c
    t_end = max(5e-3, 7 * tau)
    t = [t_end * k / (points - 1) for k in range(points)]
    return {
        "v_ain0": v,
        "mv_per_1pct_rs": (v - v_plus) * 1000,
        "ads_lsb_per_1pct_rs": (v - v_plus) / ADS_LSB_V,
        "tau_ms": tau * 1e3,
        "settle_99_ms": tau * math.log(100) * 1e3,
        "curve_ms": [x * 1e3 for x in t],
        "curve_v": [v * (1 - math.exp(-x / tau)) for x in t],
    }


# --- supply droop during a LoRa transmission ---------------------------------------------------

def _pwl(t: float, base: float, high: float, start: float, stop: float,
         ramp: float = 1e-4) -> float:
    if t <= start:
        return base
    if t < start + ramp:
        return base + (high - base) * (t - start) / ramp
    if t <= stop:
        return high
    if t < stop + ramp:
        return high + (base - high) * (t - stop) / ramp
    return base


def droop(battery_v: float = 3.3, cells: int = 3, ptc_ohm: float = 0.25,
          pm_fan_start: bool = True, boost: str = "pwl", heltec_tx_a: float = 0.19,
          r_bms: float = 0.04, r_cable: float = 0.073, c: float = 470e-6, esr: float = 0.15,
          r_heltec: float = 0.072, t_end: float = 0.6, dt_s: float = 1e-4) -> dict[str, Any]:
    """Voltage at the Heltec input while it transmits (10-410 ms), optionally while the PMS5003
    fan starts on the 5 V boost (5-300 ms). `boost="pwl"` is the KiCad sheet's current profile,
    `"constant_power"` the ngspice sweep's model (0.247 W, plus 0.59 W for the fan)."""
    if cells not in CELL_OHM:
        raise ValueError("cells must be 2 or 3")
    if boost not in ("pwl", "constant_power"):
        raise ValueError("boost must be pwl or constant_power")
    rs = CELL_OHM[cells] + r_bms + r_cable + ptc_ohm
    g = 1 / rs + 1 / esr

    def heltec(t: float) -> float:
        return _pwl(t, 0.05, heltec_tx_a, 10e-3, 410e-3)

    def boost_i(t: float, vbus: float) -> float:
        if boost == "pwl":
            return _pwl(t, 0.077, 0.26 if pm_fan_start else 0.077, 5e-3, 300e-3)
        watts = 0.247 + (0.59 if pm_fan_start and 5e-3 < t < 300e-3 else 0.0)
        return watts / max(vbus, 2.5)

    # DC operating point at t = 0: the capacitor carries no current.
    vbus = battery_v
    for _ in range(20):
        vbus = battery_v - rs * (heltec(0.0) + boost_i(0.0, vbus))
    vc = vbus
    steps = int(round(t_end / dt_s))
    every = max(1, steps // 600)
    t_out, v_out, vmin = [], [], float("inf")
    for k in range(steps + 1):
        t = k * dt_s
        ih = heltec(t)
        for _ in range(6):  # the boost load depends on the bus voltage
            vbus = (battery_v / rs + vc / esr - ih - boost_i(t, vbus)) / g
        v_heltec = vbus - ih * r_heltec
        vmin = min(vmin, v_heltec)
        if k % every == 0:
            t_out.append(t * 1e3)
            v_out.append(v_heltec)
        # Capacitor: dVc/dt = (Vbus - Vc) / (esr C), with Vbus linear in Vc -> exact update.
        load = ih + boost_i(t, vbus)
        target = (battery_v / rs - load) / (g - 1 / esr)  # Vc where no current flows
        rate = (1 - 1 / (esr * g)) / (esr * c)
        vc = target + (vc - target) * math.exp(-rate * dt_s)
    return {"min_v_heltec": vmin, "rs_total_ohm": rs, "curve_ms": t_out,
            "curve_v_heltec": v_out}


# --- energy and battery temperature over a year -------------------------------------------------

@lru_cache(maxsize=4)
def _weather(city: str) -> tuple[tuple[dt.date, float, float, float], ...]:
    name, first, start, end, _ = CITIES[city]
    with _data(name).open(encoding="utf-8") as f:
        rows = list(csv.DictReader(f))
    days = []
    for k, r in enumerate(rows):
        day = first + dt.timedelta(days=k)
        if (start is None or day >= start) and (end is None or day <= end):
            days.append((day, float(r["tmax"]), float(r["tmin"]), float(r["rad"])))
    return tuple(days)


def _hours(city: str):
    lat = math.radians(CITIES[city][4])
    for day, tmax, tmin, rad in _weather(city):
        doy = day.timetuple().tm_yday
        dec = math.radians(23.45 * math.sin(math.radians(360 * (284 + doy) / 365)))
        hs = [h + 0.5 for h in range(24)]
        cz = [max(0.0, math.sin(lat) * math.sin(dec) + math.cos(lat) * math.cos(dec)
                  * math.cos(math.radians(15 * (h - 12.0)))) for h in hs]
        total = sum(cz)
        for h, z in zip(hs, cz, strict=True):
            g = rad / 3.6 * 1000 * z / total
            if 6 <= h <= 15:
                t = tmin + (tmax - tmin) * (1 - math.cos(math.pi * (h - 6) / 9)) / 2
            elif h > 15:
                t = tmax - (tmax - tmin) * (1 - math.cos(math.pi * (h - 15) / 15)) / 2
            else:
                t = tmin + (tmax - tmin) * (1 + math.cos(math.pi * (h + 9) / 15)) / 2
            yield day, g, t


def energy(city: str = "Delhi", panel_w: float = 6, cells: int = 3, mcu_ma: float = 12,
           pm: bool = False, soil: float = 0.85, age: float = 1.0,
           enclosure: str = "white box, shaded under panel") -> dict[str, Any]:
    """One node for a year (Mumbai: the 155 days of data) with energy.py's model and firmware
    policy: below 8% charge the node sleeps, above 20% it wakes, the gas heater runs above 25%."""
    if city not in CITIES:
        raise ValueError(f"city must be one of {', '.join(CITIES)}")
    if enclosure not in ENCLOSURES:
        raise ValueError(f"enclosure must be one of {', '.join(ENCLOSURES)}")
    if not (panel_w > 0 and cells > 0 and mcu_ma >= 0 and 0 < soil <= 1 and 0 < age <= 1):
        raise ValueError("panel, cells, soiling and age must be positive")
    cap = cells * 2.6 * 3.65 * age
    e, vb = cap, 3.7
    heater, mt_q, misc = 0.210 / 0.85, 0.008, 0.002
    pm_w = (0.5 * 30 / 300 + 0.001) / 0.85 if pm else 0.0
    k_encl = ENCLOSURES[enclosure]
    node_on = heater_on = True
    tb_prev = None
    n = node_hours = heater_hours = 0
    soc_min, load_sum, pin_sum, tb_max = 1.0, 0.0, 0.0, -99.0
    above45 = chg45 = above60 = 0
    daily: dict[dt.date, dict[str, Any]] = {}
    for day, g, t in _hours(city):
        tb = t + k_encl * g
        tb = tb if tb_prev is None else tb_prev + 0.6 * (tb - tb_prev)  # ~1 h thermal lag
        tb_prev = tb
        tc = t + g / 800 * 25
        p_in = panel_w * g / 1000 * (1 - 0.004 * (tc - 25)) * soil * 0.97 * 0.85
        soc = e / cap
        if soc < 0.08:
            node_on = False
        if soc > 0.20:
            node_on = True
        heater_on = node_on and soc > 0.25
        load = ((mcu_ma / 1000 * vb if node_on else 0.0002) + (heater if heater_on else 0)
                + (pm_w if node_on else 0) + (mt_q if node_on else 0) + misc)
        charging = p_in > 0.05 and e < cap
        e = min(cap, max(0.0, e + p_in - load))
        n += 1
        node_hours += node_on
        heater_hours += heater_on
        soc_min = min(soc_min, soc)
        load_sum += load
        pin_sum += p_in
        tb_max = max(tb_max, tb)
        above45 += tb > 45
        above60 += tb > 60
        chg45 += charging and tb > 45
        d = daily.setdefault(day, {"date": day.isoformat(), "soc_min": 1.0, "soc_max": 0.0,
                                   "harvest_wh": 0.0, "batt_max_c": -99.0, "gas_hours": 0})
        d["soc_min"] = min(d["soc_min"], soc)
        d["soc_max"] = max(d["soc_max"], soc)
        d["harvest_wh"] += p_in
        d["batt_max_c"] = max(d["batt_max_c"], tb)
        d["gas_hours"] += heater_on
    days = []
    for d in daily.values():
        days.append({"date": d["date"], "soc_min": round(d["soc_min"] * 100, 1),
                     "soc_max": round(d["soc_max"] * 100, 1),
                     "harvest_wh": round(d["harvest_wh"], 2),
                     "batt_max_c": round(d["batt_max_c"], 1),
                     "gas_on": d["gas_hours"] / 24 >= 0.5})
    return {
        "inputs": {"city": city, "panel_w": panel_w, "cells": cells, "mcu_ma": mcu_ma, "pm": pm,
                   "soil": soil, "age": age, "enclosure": enclosure},
        "summary": {
            "gas_uptime": round(100 * heater_hours / n, 1),
            "mesh_uptime": round(100 * node_hours / n, 1),
            "min_soc": round(100 * soc_min),
            "days_gas_off": sum(not d["gas_on"] for d in days),
            "load_wh_day": round(load_sum / n * 24, 1),
            "harvest_wh_day": round(pin_sum / n * 24, 1),
            "max_batt_c": round(tb_max, 1),
            "hours_above_45c": above45,
            "charging_hours_above_45c": chg45,
            "hours_above_60c": above60,
            "days": len(days),
        },
        "daily": days,
    }


# --- recorded results ----------------------------------------------------------------------

def _num(v: str) -> Any:
    for cast in (int, float):
        try:
            return cast(v)
        except ValueError:
            pass
    return {"True": True, "False": False}.get(v, v)


def _table(name: str) -> list[dict[str, Any]]:
    with _data(name).open(encoding="utf-8") as f:
        return [{k: _num(v) for k, v in row.items()} for row in csv.DictReader(f)]


def recorded_results() -> dict[str, Any]:
    return {
        "mesh": _table("mesh_results.csv"),
        "mesh_alarm_retry": _table("mesh_alarm_retry.csv"),
        "energy": _table("energy_results.csv"),
        "energy_stress": _table("energy_stress.csv"),
        "thermal": _table("thermal_results.csv"),
        "spice": json.loads(_data("spice_results.json").read_text(encoding="utf-8")),
        "wiring": _table("wiring.csv"),
    }
