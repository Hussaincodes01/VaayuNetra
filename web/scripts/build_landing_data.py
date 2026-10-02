"""Build the landing page's offline data from the ops-notebook export in data/seed/.

Used when Supabase is not configured (and as the source for the seed). Writes:
  web/src/content/field-test.json        sites, per-site stats, the 14 landfill flags, scene counts
  web/public/evidence/<site>/<date>/     rgb.webp, mbmp.webp, mask.webp cropped from the dossier figures
  web/public/dossiers/deonar.pdf         the notebook's Deonar dossier rendered to PDF (Playwright)

Plume polygons are traced from the dossier's mask panel (overlay minus true colour, wind arrow removed),
resampled to the 200 x 200 chip grid and converted with the worker's own plume_geojson / chip_bounds, so
geometry matches what the worker uploads to the evidence table.

Run from the repo root:  py -3.11 web/scripts/build_landing_data.py
"""

from __future__ import annotations

import base64
import csv
import io
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "data" / "seed"
WEB = ROOT / "web"
sys.path.insert(0, str(ROOT / "worker" / "src"))

from vayunetra import outputs  # noqa: E402
from vayunetra.pipeline import CONTROL_OFFSET_DEG, LANDFILLS  # noqa: E402

STATE = {"Delhi": "Delhi", "Mumbai": "Maharashtra", "Ahmedabad": "Gujarat"}
CHIP = 200


def num(s: str | None) -> float | None:
    if s is None or s == "" or s.lower() == "nan":
        return None
    v = float(s)
    return v if math.isfinite(v) else None


def read_csv(name: str) -> list[dict[str, str]]:
    with (SEED / name).open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


# --- Figure cropping ------------------------------------------------------------------------------


def panel_boxes(img: np.ndarray) -> list[tuple[int, int, int, int]]:
    """(x0, y0, x1, y1) of the three image panels: the three widest runs of non-white columns."""
    rgb = img[..., :3].astype(int)
    ink = (rgb < 235).any(axis=2) & (img[..., 3] > 0)
    h = ink.shape[0]
    body = ink[int(h * 0.15) :]  # skip the titles
    cols = body.mean(axis=0) > 0.5
    runs, start = [], None
    for x, on in enumerate(list(cols) + [False]):
        if on and start is None:
            start = x
        elif not on and start is not None:
            runs.append((start, x))
            start = None
    runs = sorted(sorted(runs, key=lambda r: r[1] - r[0], reverse=True)[:3])
    boxes = []
    for x0, x1 in runs:
        rows = ink[:, x0:x1].mean(axis=1) > 0.5
        ys = np.nonzero(rows)[0]
        y0, y1 = int(ys.min()), int(ys.max()) + 1
        side = min(x1 - x0, y1 - y0)
        boxes.append((x0, y1 - side, x0 + side, y1))
    return boxes


def is_cyan(p: np.ndarray) -> np.ndarray:
    r, g, b = p[..., 0].astype(int), p[..., 1].astype(int), p[..., 2].astype(int)
    return (g > 150) & (b > 150) & (r < 120)


def _chip(arr: np.ndarray) -> np.ndarray:
    """Downsample a rendered panel back to the 200 x 200 chip grid it was drawn from."""
    return np.array(Image.fromarray(arr).resize((CHIP, CHIP), Image.Resampling.BOX)).astype(int)


def extract(fig: Image.Image) -> tuple[Image.Image, Image.Image, Image.Image, np.ndarray]:
    """Clean true colour, MBMP and mask panels, plus the plume mask on the 200 x 200 chip grid.

    Panel 3 can be drawn smaller than panel 1: when the wind arrow points off the image, matplotlib
    widens the axes limits to fit it. Both panels are therefore compared on the chip grid.
    """
    from scipy.ndimage import binary_opening, label

    a = np.array(fig.convert("RGBA"))
    b1, b2, b3 = panel_boxes(a)
    p1 = a[b1[1] : b1[3], b1[0] : b1[2], :3]
    p2 = a[b2[1] : b2[3], b2[0] : b2[2], :3]
    c1 = _chip(p1)
    best = None
    for dy in range(-2, 3):
        for dx in range(-2, 3):
            box = a[b3[1] + dy : b3[3] + dy, b3[0] + dx : b3[2] + dx, :3]
            c3 = _chip(np.ascontiguousarray(box))
            err = float(np.median(np.abs(c3 - c1).sum(axis=2)))
            if best is None or err < best[0]:
                best = (err, box, c3)
    _, p3, c3 = best
    clean = p1.copy()
    cross = is_cyan(p1)
    clean[cross] = np.array(Image.fromarray(p3).resize(p1.shape[1::-1], Image.Resampling.BILINEAR))[cross]
    plume = (np.abs(c3 - c1).sum(axis=2) > 60) & ~is_cyan(c3.astype("uint8")) & ~is_cyan(c1.astype("uint8"))
    plume = binary_opening(plume, iterations=1)
    lab, n = label(plume)
    sizes = np.bincount(lab.ravel())
    keep = [i for i in range(1, n + 1) if sizes[i] >= 15]
    plume = np.isin(lab, keep)
    p3_full = Image.fromarray(p3).resize(p1.shape[1::-1], Image.Resampling.LANCZOS)
    return Image.fromarray(clean), Image.fromarray(p2), p3_full, plume


# --- Main -----------------------------------------------------------------------------------------


def main() -> None:
    card = json.loads((SEED / "model_card.json").read_text())
    sha = (SEED / "model_sha256.txt").read_text().split()[0]
    scans = read_csv("scan_all_passes.csv")
    summary = {r["site"]: r for r in read_csv("site_summary.csv")}
    mc = {(r["site"], r["date"]): r for r in read_csv("confirmed_events.csv")}
    bounds = {r["site"]: num(r["persistent_upper_tph"]) for r in read_csv("site_sensitivity.csv")}

    sites, stats = [], []
    for name, (lat, lon, elev, city) in LANDFILLS.items():
        slug = name.lower()
        sites.append({
            "slug": slug, "name": name, "city": city, "state": STATE[city], "lat": lat, "lon": lon,
            "elevM": elev, "control": {"lat": round(lat + CONTROL_OFFSET_DEG, 4), "lon": lon},
        })  # fmt: skip
        s = summary[name]
        t1, t2, flags = int(s["T1"]), int(s["T2"]), int(s["flags"])
        site_scans = [r for r in scans if r["site"] == name]
        stats.append({
            "slug": slug, "passes": int(s["passes"]), "flags": flags, "t1": t1, "t2": t2, "t3": int(s["T3"]),
            "burnLike": int(s["burn_like"]), "controlPasses": int(s["control_passes"]),
            "controlFlags": int(s["control_flags"]), "pVsControl": num(s["p_vs_control"]),
            "minMeanKgph": num(s["min_mean_kgph"]), "tco2e100Yr": num(s["tco2e100_yr"]),
            "tco2e20Yr": num(s["tco2e20_yr"]), "persistentUpperTph": bounds.get(name),
            "status": "priority" if t1 else "watch" if t2 else "surface_activity" if flags else "no_large_events",
            "lastPassDate": max(r["date"] for r in site_scans),
        })  # fmt: skip

    # Evidence figures from the dossiers, keyed by (site, date).
    figures: dict[tuple[str, str], Image.Image] = {}
    for name in LANDFILLS:
        html = (SEED / f"dossier_{name}.html").read_text(encoding="utf-8")
        for m in re.finditer(r'<img src="data:image/png;base64,([^"]+)"><p class="small">(\d{4}-\d{2}-\d{2}):', html):
            figures[(name, m.group(2))] = Image.open(io.BytesIO(base64.b64decode(m.group(1))))

    flags = []
    for r in scans:
        if r["kind"] != "landfill" or r["detected"] != "True":
            continue
        name, date = r["site"], r["date"]
        slug = name.lower()
        lat, lon = LANDFILLS[name][0], LANDFILLS[name][1]
        q = mc.get((name, date), {})
        flag = {
            "slug": slug, "date": date, "tier": r["tier"], "surfaceKind": r["surface_kind"] or None,
            "sceneScore": num(r["scene_score"]), "qKgph": num(r["q_kgph"]), "qMed": num(q.get("q_med")),
            "qLo": num(q.get("q_lo")), "qHi": num(q.get("q_hi")), "u10": num(r["u10"]),
            "windU": num(r["u"]), "windV": num(r["v"]), "dB12": num(r["dB12"]), "dB11": num(r["dB11"]),
            "dVisNir": num(r["dVisNIR"]), "elong": num(r["elong"]), "axisVsWind": num(r["axis_vs_wind"]),
            "srcDistM": num(r["src_dist_m"]), "satellite": r["sat"], "evidence": None,
        }  # fmt: skip
        fig = figures.get((name, date))
        if fig is not None:
            rgb, mbmp, mask, plume_px = extract(fig)
            out_dir = WEB / "public" / "evidence" / slug / date
            out_dir.mkdir(parents=True, exist_ok=True)
            for label, im in (("rgb", rgb), ("mbmp", mbmp), ("mask", mask)):
                im.save(out_dir / f"{label}.webp", "WEBP", quality=88, method=6)
            if r["tier"] == "T1":  # Open Graph image (the OG renderer reads PNG, not WebP)
                og = WEB / "public" / "og"
                og.mkdir(parents=True, exist_ok=True)
                mask.resize((480, 480), Image.Resampling.LANCZOS).save(og / "t1-mask.png", optimize=True)
            plume = outputs.plume_geojson(plume_px.astype("float32"), lat, lon)
            plume["properties"] = {"source": "traced from the ops-notebook evidence figure"}
            flag["evidence"] = {
                "rgb": f"/evidence/{slug}/{date}/rgb.webp",
                "mbmp": f"/evidence/{slug}/{date}/mbmp.webp",
                "mask": f"/evidence/{slug}/{date}/mask.webp",
                "sizePx": rgb.size[0],
                "chipBounds": outputs.chip_bounds(lat, lon),
                "plume": plume,
            }
        flags.append(flag)

    tier_order = {"T1": 0, "T2": 1, "T3": 2}
    flags.sort(key=lambda f: (tier_order[f["tier"]], -(f["sceneScore"] or 0)))
    data = {
        "source": "data/seed: ops notebook export vayunetra_ops_20261001_1656",
        "modelVersion": sha[:12],
        "sceneThreshold": card["scene_threshold"],
        "window": {"start": "2024-01-01", "end": "2025-12-31"},
        "scenes": {
            "landfill": sum(r["kind"] == "landfill" for r in scans),
            "control": sum(r["kind"] == "control" for r in scans),
            "total": len(scans),
            "controlFlags": sum(r["kind"] == "control" and r["detected"] == "True" for r in scans),
            "lastPassDate": max(r["date"] for r in scans),
        },
        "sites": sites,
        "stats": stats,
        "flags": flags,
    }
    dest = WEB / "src" / "content" / "field-test.json"
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(json.dumps(data, indent=1) + "\n", encoding="utf-8")
    with_ev = sum(f["evidence"] is not None for f in flags)
    print(f"wrote {dest.relative_to(ROOT)}: {len(flags)} flags ({with_ev} with evidence), {len(scans)} scenes")

    pdf = WEB / "public" / "dossiers" / "deonar.pdf"
    try:
        outputs.html_to_pdf((SEED / "dossier_Deonar.html").read_text(encoding="utf-8"), pdf)
        print(f"wrote {pdf.relative_to(ROOT)} ({pdf.stat().st_size // 1024} KB)")
    except Exception as e:  # Playwright missing: the page links to the HTML dossier instead
        print(f"PDF skipped: {e!r}"[:200])


if __name__ == "__main__":
    main()
