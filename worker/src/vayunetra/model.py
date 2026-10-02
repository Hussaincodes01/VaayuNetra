"""Load the exported VayuNetra U-Net and run inference (ops notebook Cells 3 and 4).

The model card in the zip is the single source of truth: input channels, chip size, padding,
minimum plume size, scene threshold and the IME wind calibration all come from it.
"""

from __future__ import annotations

import hashlib
import json
import os
import zipfile
from collections.abc import Iterable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import numpy as np

from vayunetra.config import REPO_ROOT, WORKER_DIR

WEIGHT_NAMES = ("vayunetra_best.pt", "best.pt", "vayunetra_ssl4eo_unet.pt")
ZIP_GLOB = "vayunetra_best_model_*.zip"


def sha256_file(path: Path, chunk: int = 1 << 20) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(chunk), b""):
            h.update(block)
    return h.hexdigest()


def _is_model_zip(path: Path) -> bool:
    try:
        names = zipfile.ZipFile(path).namelist()
    except (zipfile.BadZipFile, OSError):
        return False
    has_card = any(n.endswith(("model_card.json", "vayunetra_config.json")) for n in names)
    return has_card and any(n.endswith(".pt") for n in names)


def find_model_zip(explicit: Path | None = None, search_dirs: Iterable[Path] | None = None) -> Path:
    """VAYU_MODEL_ZIP if it exists, else the newest vayunetra_best_model_*.zip in the usual places."""
    if explicit is not None and explicit.exists():
        return explicit
    dirs = list(search_dirs) if search_dirs is not None else [
        Path.cwd() / "models", WORKER_DIR / "models", REPO_ROOT / "models", Path.cwd(),
    ]  # fmt: skip
    seen: list[Path] = []
    for d in dirs:
        zips = sorted(d.glob(ZIP_GLOB), key=lambda p: -p.stat().st_mtime) if d.is_dir() else []
        for z in zips:
            seen.append(z)
            if _is_model_zip(z):
                return z
    hint = f" (VAYU_MODEL_ZIP={explicit} does not exist)" if explicit else ""
    raise FileNotFoundError(f"no model zip found{hint}; looked in {[str(d) for d in dirs]}, saw {seen}")


def extract_model(zip_path: Path, cache_dir: Path) -> Path:
    """Unzip once into cache_dir/model/<zip stem> and return that folder."""
    dest = cache_dir / "model" / zip_path.stem
    marker = dest / ".extracted"
    if not marker.exists():
        dest.mkdir(parents=True, exist_ok=True)
        zipfile.ZipFile(zip_path).extractall(dest)
        marker.write_text(str(zip_path.stat().st_mtime))
    return dest


def resolve_device(preference: str = "auto") -> str:
    import torch

    if preference == "auto":
        return "cuda" if torch.cuda.is_available() else "cpu"
    if preference.startswith("cuda") and not torch.cuda.is_available():
        raise RuntimeError("VAYU_DEVICE asks for CUDA but torch.cuda.is_available() is False")
    return preference


@dataclass
class VayuModel:
    net: Any = field(repr=False)
    card: dict[str, Any]
    device: str
    weights_path: Path
    lut_path: Path
    model_version: str
    weights_sha256: str

    @property
    def in_ch(self) -> int:
        return int(self.card.get("in_channels", 17))

    @property
    def chip(self) -> int:
        return int(self.card.get("chip", 200))

    @property
    def pad(self) -> int:
        return int(self.card.get("pad", 12))

    @property
    def min_plume_px(self) -> int:
        return int(self.card.get("min_plume_px", 20))

    @property
    def threshold(self) -> float:
        return float(self.card["scene_threshold"])

    @property
    def a_cal(self) -> float:
        return float(self.card["ime"]["a"])

    @property
    def b_cal(self) -> float:
        return float(self.card["ime"]["b"])

    def predict(self, x: np.ndarray) -> tuple[np.ndarray, float]:
        """Probability map (chip x chip) and scene score = mean of the top-20 pixel probabilities, 4-flip TTA."""
        import torch

        amp = self.device.startswith("cuda") and os.environ.get("VAYU_AMP", "auto") != "off"
        amp_dtype = torch.bfloat16 if (amp and torch.cuda.is_bf16_supported()) else torch.float16
        pad = self.pad
        with torch.no_grad():
            xx = torch.from_numpy(np.pad(x, ((0, 0), (pad, pad), (pad, pad)), mode="reflect"))[None]
            xx = xx.to(self.device)
            if self.device.startswith("cuda"):
                xx = xx.to(memory_format=torch.channels_last)
            ps = []
            for fl in [(), (2,), (3,), (2, 3)]:
                with torch.autocast("cuda", dtype=amp_dtype, enabled=amp):
                    s, _ = self.net(torch.flip(xx, fl) if fl else xx)
                s = torch.sigmoid(s.float())
                ps.append(torch.flip(s, fl) if fl else s)
            p = torch.stack(ps).mean(0)[0, 0, pad:-pad, pad:-pad]
            flat = p.reshape(-1)
            score = float(torch.topk(flat, min(self.min_plume_px, flat.numel())).values.mean())
        return p.cpu().numpy(), score


def load_model(zip_path: Path, cache_dir: Path, device: str = "auto") -> VayuModel:
    import segmentation_models_pytorch as smp
    import torch

    root = extract_model(zip_path, cache_dir)
    card_path = next(iter(root.rglob("model_card.json")), None) or next(root.rglob("vayunetra_config.json"))
    card = json.loads(card_path.read_text())

    weights = next((p for w in WEIGHT_NAMES for p in root.rglob(w)), None)
    if weights is None:
        raise FileNotFoundError(f"no weights inside {zip_path.name}")
    digest = sha256_file(weights)
    sha_file = next(iter(root.rglob("SHA256.txt")), None)
    if sha_file is not None and weights.name == "vayunetra_best.pt":
        expected = sha_file.read_text().split()[0]
        if digest != expected:
            raise ValueError(f"weights checksum mismatch: {digest} != {expected}")
    lut_path = next(iter(root.rglob("integrated_transmittances.json")), None)
    if lut_path is None:
        raise FileNotFoundError("integrated_transmittances.json missing from the zip")

    dev = resolve_device(device)
    net = smp.Unet(
        "resnet50",
        encoder_weights=None,
        in_channels=int(card.get("in_channels", 17)),
        classes=1,
        decoder_attention_type="scse",
        aux_params=dict(classes=1, pooling="avg", dropout=0.2),
    )
    sd = torch.load(weights, map_location="cpu")
    sd = sd.get("state_dict", sd)
    net.load_state_dict({k: v.float() for k, v in sd.items()})
    net = net.to(dev).eval()
    if dev.startswith("cuda"):
        net = net.to(memory_format=torch.channels_last)
    return VayuModel(
        net=net,
        card=card,
        device=dev,
        weights_path=weights,
        lut_path=lut_path,
        model_version=digest[:12],
        weights_sha256=digest,
    )
