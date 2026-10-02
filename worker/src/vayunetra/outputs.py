"""Evidence images, plume polygons, chip bounds and site dossiers (ops notebook Cells 12 and 13)."""

from __future__ import annotations

import base64
import html as html_lib
import io
import math
import time
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

import numpy as np

from vayunetra import earth_engine as gee
from vayunetra.physics import CHIP, PIX_M

SCREENING_LINE = (
    "Screening-grade satellite estimate: confirm with a hyperspectral satellite, an OGI drone or a "
    "ground survey before enforcement or carbon crediting."
)


# --- Evidence images -----------------------------------------------------------------------------


def _plt():
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    return plt


def _png(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=110, bbox_inches="tight")
    _plt().close(fig)
    return buf.getvalue()


def true_colour(rgb: np.ndarray) -> np.ndarray:
    return np.clip(np.moveaxis(rgb, 0, -1) * 3.5, 0, 1)


def _wind_arrow(ax, u: float, v: float) -> None:
    if np.isfinite(u):
        sp = math.hypot(u, v) + 1e-9
        ax.arrow(20, 20, 25 * u / sp, -25 * v / sp, color="cyan", width=1.5, head_width=6)


def rgb_png(rgb: np.ndarray) -> bytes:
    plt = _plt()
    fig, ax = plt.subplots(figsize=(3.7, 3.7))
    c0 = CHIP / 2
    ax.imshow(true_colour(rgb))
    ax.plot(c0, c0, "c+", ms=12)
    ax.axis("off")
    return _png(fig)


def mbmp_png(m: np.ndarray) -> bytes:
    plt = _plt()
    fig, ax = plt.subplots(figsize=(3.7, 3.7))
    ax.imshow(m, cmap="RdBu_r", vmin=-0.05, vmax=0.05)
    ax.axis("off")
    return _png(fig)


def mask_png(rgb: np.ndarray, prob: np.ndarray, u: float, v: float) -> bytes:
    plt = _plt()
    fig, ax = plt.subplots(figsize=(3.7, 3.7))
    ax.imshow(true_colour(rgb))
    ax.imshow(np.ma.masked_less(prob, 0.5), cmap="autumn", alpha=0.6)
    _wind_arrow(ax, u, v)
    ax.axis("off")
    return _png(fig)


def panel_png(
    site: str, date: Any, rgb: np.ndarray, m: np.ndarray, prob: np.ndarray, u: float, v: float,
    tier: str, q_kgph: float,
) -> bytes:  # fmt: skip
    """The notebook's 3-panel evidence figure: true colour, MBMP signal, plume mask with wind."""
    plt = _plt()
    img = true_colour(rgb)
    c0 = CHIP / 2
    fig, ax = plt.subplots(1, 3, figsize=(11, 3.7))
    ax[0].imshow(img)
    ax[0].plot(c0, c0, "c+", ms=12)
    ax[0].set_title(f"{site} {date} (true colour)")
    ax[1].imshow(m, cmap="RdBu_r", vmin=-0.05, vmax=0.05)
    ax[1].set_title("methane signal (MBMP)")
    ax[2].imshow(img)
    ax[2].imshow(np.ma.masked_less(prob, 0.5), cmap="autumn", alpha=0.6)
    _wind_arrow(ax[2], u, v)
    rate = f"{q_kgph / 1000:.1f} t/h" if np.isfinite(q_kgph) else "rate n/a"
    ax[2].set_title(f"VayuNetra {tier} | {rate}")
    for a in ax:
        a.axis("off")
    if np.isfinite(q_kgph):
        fig.text(0.5, -0.02, SCREENING_LINE, ha="center", fontsize=7, color="0.35")
    return _png(fig)


# --- Geometry ------------------------------------------------------------------------------------


def _affine(lat: float, lon: float):
    from affine import Affine

    g = gee.grid(lat, lon)["affineTransform"]
    return Affine(g["scaleX"], g["shearX"], g["translateX"], g["shearY"], g["scaleY"], g["translateY"])


def _to_wgs84(lat: float, lon: float):
    from pyproj import Transformer

    return Transformer.from_crs(f"EPSG:{gee.utm_epsg(lat, lon)}", "EPSG:4326", always_xy=True)


def _ring_area(ring: Sequence[Sequence[float]]) -> float:
    xs, ys = np.array([p[0] for p in ring]), np.array([p[1] for p in ring])
    return 0.5 * abs(float(np.dot(xs, np.roll(ys, 1)) - np.dot(ys, np.roll(xs, 1))))


def plume_geojson(prob: np.ndarray, lat: float, lon: float, threshold: float = 0.5) -> dict[str, Any]:
    """Plume polygons (prob > threshold) in WGS84, traced on the UTM request grid."""
    from rasterio import features

    mask = prob > threshold
    tf = _to_wgs84(lat, lon)
    feats = []
    for geom, _ in features.shapes(mask.astype("uint8"), mask=mask, transform=_affine(lat, lon)):
        rings = geom["coordinates"]
        area = _ring_area(rings[0]) - sum(_ring_area(r) for r in rings[1:])
        coords = [[[round(c, 6) for c in tf.transform(x, y)] for x, y in ring] for ring in rings]
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": coords},
            "properties": {"prob_threshold": threshold, "area_m2": round(area)},
        })  # fmt: skip
    return {"type": "FeatureCollection", "features": feats}


def chip_bounds(lat: float, lon: float) -> list[list[float]]:
    """[lon, lat] of the chip's top-left, top-right, bottom-right, bottom-left corners (map image source order)."""
    g = gee.grid(lat, lon)["affineTransform"]
    x0, y0, size = g["translateX"], g["translateY"], CHIP * PIX_M
    tf = _to_wgs84(lat, lon)
    corners = [(x0, y0), (x0 + size, y0), (x0 + size, y0 - size), (x0, y0 - size)]
    return [[round(c, 6) for c in tf.transform(x, y)] for x, y in corners]


# --- Action plan (Cell 12) -----------------------------------------------------------------------

RATES = [2000, 5000, 10000, 20000, 40000]


def limit_at(qs: Sequence[float], pods: Sequence[float], level: float = 0.5) -> float:
    if pods[0] >= level:
        return qs[0]
    for (q1, p1), (q2, p2) in zip(zip(qs, pods, strict=True), zip(qs[1:], pods[1:], strict=True), strict=False):
        if p1 < level <= p2:
            return math.exp(math.log(q1) + (level - p1) / (p2 - p1) * (math.log(q2) - math.log(q1)))
    return float("nan")


def detect_limit_tph(stats: Mapping[str, Any]) -> float:
    rates = stats.get("detect_rates") or {}
    if not rates.get("pod"):
        return float("nan")
    return limit_at(rates.get("rates_kgph", RATES), rates["pod"]) / 1000


def action_plan(s: Mapping[str, Any], a: Mapping[str, Any]) -> tuple[str, list[str], dict[str, float]]:
    """Status, actions and economics for one site from its site_stats row and the assumptions."""
    acts: list[str] = []
    econ: dict[str, float] = {}
    t1, t2, flags = int(s["t1"]), int(s["t2"]), int(s["flags"])
    min_mean = float(s.get("min_mean_kgph") or 0.0)
    if t1 > 0 or t2 > 0:
        status = "PRIORITY: methane plume evidence" if t1 > 0 else "WATCH: probable plume, needs confirmation"
        acts.append("Confirm within 2–4 weeks: task a hyperspectral satellite (EMIT / EnMAP / PRISMA / Tanager) "
                    "or fly an OGI-camera drone survey over the flagged area.")  # fmt: skip
        if min_mean > 0:
            cap = min_mean * a["capture_eff"]
            avoided = cap * 8.76 * a["flare_destruction"] * a["gwp100"]
            mwe = cap * a["ch4_lhv_mj_per_kg"] / 3600 * a["engine_eff"]
            mwh = mwe * 8760
            inr = mwh * 1000 * a["power_price_inr_per_kwh"]
            usd = avoided * a["carbon_price_usd_per_t"]
            econ = dict(captured_kgph=cap, avoided_tco2e_yr=avoided, power_mwe=mwe, power_mwh_yr=mwh,
                        power_value_inr_yr=inr, carbon_value_usd_yr=usd)  # fmt: skip
            acts.append(f"Install landfill-gas collection (vertical wells + header) on the flagged cell; at "
                        f"{a['capture_eff']:.0%} capture this avoids ≈{avoided:,.0f} t CO₂e/yr (minimum estimate).")  # fmt: skip
            acts.append(f"Use the gas: ≈{mwe:.1f} MW electric ({mwh:,.0f} MWh/yr, ≈₹{inr / 1e7:,.1f} crore/yr at "
                        f"₹{a['power_price_inr_per_kwh']}/kWh); flare whatever the engine can't take.")  # fmt: skip
            acts.append(f"Register the avoided emissions for carbon credits: ≈${usd:,.0f}/yr at "
                        f"${a['carbon_price_usd_per_t']}/t.")  # fmt: skip
        acts.append("Interim: cover exposed waste and apply a biocover / compost layer on side slopes to oxidise "
                    "methane; repair cracks and leachate seeps.")  # fmt: skip
    elif flags > 0:
        status = "SURFACE ACTIVITY: no methane confirmed"
        burn = int(s.get("burn_like") or 0)
        acts.append(
            f"{flags} landfill flags were rejected by the physics gate as surface change ({burn} burn/smoke-like)."
        )
        if burn:
            acts.append("Fire management: daily soil cover on active faces, thermal monitoring, water/foam readiness; "
                        "burn-like events are themselves an alert.")  # fmt: skip
        acts.append("Re-scan monthly; re-survey with hyperspectral data once a year.")
    else:
        status = "NO LARGE EVENTS SEEN"
    lim = detect_limit_tph(s)
    acts.append(
        f"Satellite sensitivity here: events above ≈{lim:.0f} t/h would be seen ~50% of the time; smaller, steady "
        "emissions need hyperspectral or ground survey."
        if np.isfinite(lim)
        else "Satellite sensitivity here: no plume size up to 40 t/h reached 50% detection; screening relies on "
        "hyperspectral / ground survey."
    )
    acts.append("Long term: continue legacy-waste bio-mining / remediation and divert organics (composting, "
                "biomethanation) so less methane is generated.")  # fmt: skip
    return status, acts, econ


# --- Dossier (Cell 13) ---------------------------------------------------------------------------

CSS = """body{font-family:system-ui,Segoe UI,Arial;margin:24px;max-width:1100px;color:#1d2433}h1{margin:0}h2{border-bottom:2px solid #e3e7ef;padding-bottom:4px}
.badge{display:inline-block;padding:4px 10px;border-radius:12px;font-weight:600;color:#fff}.P{background:#c0392b}.W{background:#8e44ad}.S{background:#d68910}.N{background:#2e7d32}
table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #e3e7ef;padding:4px 8px;text-align:left}img{max-width:100%}.small{color:#5b6475;font-size:12px}"""


def _badge(status: str) -> str:
    return {"P": "P", "W": "W", "S": "S"}.get(status[0], "N")


def timeline_png(scans: Sequence[Mapping[str, Any]], threshold: float) -> bytes:
    import pandas as pd

    plt = _plt()
    fig, ax = plt.subplots(figsize=(10, 2.6))
    df = pd.DataFrame(scans)
    if len(df):
        df = df.sort_values("pass_date")
        ax.plot(pd.to_datetime(df.pass_date), df.scene_score, ".", c="0.6", label="all passes")
        for t, c in [("T3", "tab:orange"), ("T2", "tab:purple"), ("T1", "tab:red")]:
            s = df[df.tier == t]
            if len(s):
                ax.plot(pd.to_datetime(s.pass_date), s.scene_score, "o", c=c, label=t)
    ax.axhline(threshold, ls="--", c="k", lw=0.8)
    ax.set_ylabel("scene score")
    ax.set_ylim(0, 1)
    ax.legend(fontsize=7, ncol=4)
    ax.grid(alpha=0.3)
    return _png(fig)


def _fmt(v: Any, spec: str) -> str:
    try:
        return format(float(v), spec) if v is not None and np.isfinite(float(v)) else "n/a"
    except (TypeError, ValueError):
        return "n/a"


def dossier_html(
    stats: Mapping[str, Any],
    scans: Sequence[Mapping[str, Any]],
    panel_urls: Mapping[str, str],
    assumptions: Mapping[str, Any],
    threshold: float,
    a_cal: float,
    b_cal: float,
    window: tuple[str, str],
) -> str:
    """One self-contained page per landfill: verdict, evidence, timeline, emissions, action plan."""
    esc = html_lib.escape
    status, acts, econ = action_plan(stats, assumptions)
    flagged = sorted((r for r in scans if r.get("detected")),
                     key=lambda r: (r["tier"], -float(r["scene_score"])))[:4]  # fmt: skip
    imgs = "".join(
        (f'<img alt="{esc(stats["name"])} {r["pass_date"]} evidence: true colour, MBMP signal and plume mask" '
         f'src="{esc(panel_urls[str(r["id"])])}">' if str(r.get("id")) in panel_urls else "")
        + f'<p class="small">{r["pass_date"]}: tier {r["tier"]} {esc(r.get("surface_kind") or "")} · '
        f'dB12 {_fmt(r.get("d_b12"), "+.3f")}, dB11 {_fmt(r.get("d_b11"), "+.3f")}, visible/NIR {_fmt(r.get("d_visnir"), ".3f")}'
        f' · axis vs wind {_fmt(r.get("axis_vs_wind"), ".0f")}°</p>'
        for r in flagged
    )  # fmt: skip
    events = [r for r in scans if r.get("tier") in ("T1", "T2")]
    ev_tab = (
        "<table><tr><th>date</th><th>tier</th><th>q_med (kg/h)</th><th>q_lo</th><th>q_hi</th><th>u10 (m/s)</th></tr>"
        + "".join(f"<tr><td>{r['pass_date']}</td><td>{r['tier']}</td><td>{_fmt(r.get('q_med'), ',.0f')}</td>"
                  f"<td>{_fmt(r.get('q_lo'), ',.0f')}</td><td>{_fmt(r.get('q_hi'), ',.0f')}</td>"
                  f"<td>{_fmt(r.get('u10'), '.1f')}</td></tr>" for r in events)
        + "</table>"
        if events else "<p>No T1/T2 events.</p>"
    )  # fmt: skip
    econ_tab = ("<table>" + "".join(f"<tr><td>{k}</td><td>{v:,.1f}</td></tr>" for k, v in econ.items())
                + "</table>") if econ else ""  # fmt: skip
    timeline = base64.b64encode(timeline_png(scans, threshold)).decode()
    s = stats
    return f"""<html><head><meta charset="utf-8"><title>VayuNetra: {esc(s["name"])}</title><style>{CSS}</style></head><body>
<h1>VayuNetra site dossier: {esc(s["name"])}, {esc(s["city"])}</h1><p class="small">{float(s["lat"]):.4f}, {float(s["lon"]):.4f} · scan {window[0]} → {window[1]} · generated {time.strftime("%Y-%m-%d")}</p>
<p><span class="badge {_badge(status)}">{esc(status)}</span></p>
<h2>Evidence</h2><table><tr><th>clear passes</th><th>flags</th><th>T1 methane-confident</th><th>T2 probable</th><th>T3 surface change</th><th>control flags</th><th>p vs control</th><th>detection limit (t/h)</th></tr>
<tr><td>{s["passes"]}</td><td>{s["flags"]}</td><td>{s["t1"]}</td><td>{s["t2"]}</td><td>{s["t3"]}</td><td>{s["control_flags"]}/{s["control_passes"]}</td><td>{_fmt(s.get("p_vs_control"), ".3g")}</td><td>{_fmt(detect_limit_tph(s), ".1f")}</td></tr></table>
<img alt="Scene score of every pass over time, flagged passes coloured by tier" src="data:image/png;base64,{timeline}">{imgs}
<h2>Emissions</h2>{ev_tab}<p>Minimum time-averaged rate: <b>{_fmt(s.get("min_mean_kgph"), ",.0f")} kg/h</b> → <b>{_fmt(s.get("tco2e100_yr"), ",.0f")} t CO₂e/yr</b> (GWP100) · {_fmt(s.get("tco2e20_yr"), ",.0f")} t CO₂e/yr (GWP20), minimum estimate.
<span class="small">Counts only T1 days; all other days assumed zero.</span></p>
<p class="small">{SCREENING_LINE}</p>
<h2>Action plan</h2><ol>{"".join(f"<li>{esc(x)}</li>" for x in acts)}</ol>{econ_tab}
<h2>Method & assumptions</h2><p class="small">Sentinel-2 L1C (harmonized) 2 km chips; VayuNetra U-Net (SSL4EO-S12 ResNet-50, fine-tuned on MethaneSET + synthetic plumes),
scene threshold {threshold:.2f}; physics gate (B12-only dimming, wind alignment); IME emission rate with U_eff = {a_cal:.3f}·U10 + {b_cal:.3f}; ERA5-Land wind.
Assumptions: {esc(", ".join(f"{k}={v}" for k, v in assumptions.items()))}. Satellite estimates are screening-grade and must be confirmed before enforcement or crediting.</p></body></html>"""


def html_to_pdf(html: str, path: Path) -> Path:
    """Render the dossier to A4 PDF with headless Chromium (pip install playwright; playwright install chromium)."""
    from playwright.sync_api import sync_playwright

    path.parent.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        page.set_content(html, wait_until="networkidle")
        page.pdf(path=str(path), format="A4", print_background=True,
                 margin={"top": "12mm", "bottom": "12mm", "left": "10mm", "right": "10mm"})  # fmt: skip
        browser.close()
    return path
