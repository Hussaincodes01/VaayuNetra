# VayuNetra sensor node (reference design)

A solar-powered methane sensor node for the ground tier of VayuNetra. Nodes sit around a landfill that
the satellite has flagged, report every 10 minutes, and feed the early-warning model that forecasts a
rise 3 hours ahead (web/src/lib/sensors.ts). No node has been built yet: the dashboard runs a simulated
network until real units report, and this design and its firmware are untested on hardware.

## What a node measures

| Part | Measures | Why |
| --- | --- | --- |
| Figaro TGS2611-E00 (metal-oxide) | methane, as sensor resistance Rs | low power, made for methane; the E00 variant is less sensitive to alcohol |
| Bosch BME280 | air pressure, temperature, humidity | pressure trend is the forecast's main input; temperature and humidity correct the methane sensor |
| ESP32 board | time, buffering, upload | deep-sleeps between readings |
| Solar panel, Li-ion cell, charge controller | power | runs off-grid |

Metal-oxide sensors also react to humidity, temperature and other gases, and they drift. A 2024 study of
a TGS2611-E00 node found it needs humidity and temperature correction and frequent recalibration, and
works better at the higher concentrations found around landfills than near background levels
([Furuta et al. 2024, Atmospheric Measurement Techniques](https://amt.copernicus.org/articles/17/2103/2024/)).
A node is a screening instrument: it says where and when methane rises, not how many tonnes are emitted.

## Why the warning can come before the rise

Landfill gas escapes faster while barometric pressure falls and is held back while it rises
([Kissas 2022, DTU](https://orbit.dtu.dk/en/publications/landfill-methane-emission-dynamics-and-the-influence-of-barometri/)).
The pressure forecast for the next 3 hours is known before the gas arrives, so the model can warn ahead
of the rise; at night, stable air keeps the plume near the ground and raises readings downwind.

## Placement

- **Perimeter (three nodes):** 200–400 m from the waste body, at least one on the downwind side of the
  prevailing wind.
- **Community (one node):** near homes or a school downwind, where people breathe the air.
- **Background (one node):** 2–3 km upwind. Every reading is compared with it, as the satellite compares
  each landfill with its control point.
- Mount the sensor 1.5–2 m above ground in a louvred radiation shield, away from vehicle exhausts and
  generators (metal-oxide sensors respond to them).

## Power budget (worked method; check against your parts)

The TGS2611 heater runs continuously: its datasheet heater current is 56 mA, at 5 V about 0.28 W, or
about 6.7 Wh a day. Allow about 2 Wh a day for the ESP32 and radio, so roughly 9 Wh a day.

- **Panel:** 9 Wh ÷ (4 peak-sun hours × 0.5 system efficiency) ≈ 4.5 W. Size up for monsoon cloud.
- **Battery:** 3 cloudy days × 9 Wh ≈ 27 Wh, about 7.5 Ah at 3.7 V.

The peak-sun hours and efficiency are assumptions; use your site's figures.

## Calibration

1. Before deployment, put the node beside a reference methane analyser (or in a chamber with
   calibration gas at known concentrations) across the humidity and temperature range it will see.
2. Fit `ppm = ref_ppm × (Rs/R0 ÷ (1 + rh_coef·(RH − 65) + t_coef·(T − 20)))^(−1/beta)` and store the
   four coefficients in the node's `calibration` (Supabase table `sensor_nodes`).
3. Repeat monthly, and whenever a drone or ground survey visits the site.

## Data path

1. An admin registers the node on the dashboard (**Sensors → Register a real sensor node**) and copies
   its device key, shown once.
2. The firmware posts batches to `POST /api/sensors/ingest` with `Authorization: Bearer <device key>`:

   ```json
   { "readings": [ { "at": "2026-10-08T05:10:00Z", "rs_ratio": 0.82, "temp_c": 29.4,
                     "rh_pct": 71, "pressure_hpa": 1007.9, "battery_v": 3.96 } ] }
   ```

3. The server converts Rs/R0 to ppm with the node's calibration, stores the readings, and answers with
   the sampling interval to use next. A node that loses its connection keeps readings and sends up to
   500 at once when it reconnects.
4. Every 15 minutes the sensors cron forecasts each node and opens or closes alerts: early warning, rise,
   10% of methane's lower explosive limit (5,000 ppm) and offline. Alerts from real nodes are written into
   the Bitcoin-anchored integrity ledger, so a warning is provably on record before the rise.

## Firmware

`firmware/vayunetra_node/vayunetra_node.ino` (Arduino, ESP32): reads the sensor and BME280 every
interval, keeps up to 144 readings in RTC memory through deep sleep, syncs time over NTP, and uploads when
Wi-Fi is available. Set `WIFI_SSID`, `WIFI_PASS`, `INGEST_URL`, `DEVICE_KEY`, the load resistor and R0
before flashing. Untested on hardware.
