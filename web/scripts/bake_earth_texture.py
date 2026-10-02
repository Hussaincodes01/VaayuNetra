"""Bake the hero Earth texture (public/hero/earth-albedo.webp) from NASA Blue Marble, July 2004
(public domain, NASA Earth Observatory):
https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74092/world.200407.3x5400x2700.jpg

    python scripts/bake_earth_texture.py public/hero/earth-albedo.webp   # with the JPEG in the cwd

Land becomes a green ramp by how lush the original is (forest -> grassland -> dry -> desert), ice white,
ocean a light aqua with paler shallows along coasts. Output: equirectangular 2048x1024 WebP.
"""

import sys

import numpy as np
from PIL import Image, ImageFilter

SRC = "world.200407.3x5400x2700.jpg"
OUT = sys.argv[1] if len(sys.argv) > 1 else "earth-albedo.webp"
W, H = 2048, 1024

img = Image.open(SRC).convert("RGB").resize((W, H), Image.LANCZOS)
a = np.asarray(img).astype(np.float32)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
mx = a.max(axis=2)

# Water: blue-dominant and not bright, or almost black (inland seas).
water = ((b > r + 6) & (mx < 140)) | (r + g + b < 24)
mask = Image.fromarray((~water * 255).astype(np.uint8)).filter(ImageFilter.MedianFilter(3))
land = np.asarray(mask).astype(np.float32) / 255.0

lum = 0.3 * r + 0.59 * g + 0.11 * b
sat = (mx - a.min(axis=2)) / np.maximum(mx, 1)

# Land ramp, keyed on brightness: dense vegetation is dark in Blue Marble, deserts are bright.
stops = np.array([0, 45, 95, 150, 255], np.float32)
cols = np.array(
    [
        [0x2F, 0x86, 0x4F],  # forest
        [0x5C, 0xA8, 0x5E],  # grassland
        [0x9C, 0xC9, 0x7C],  # dry grass
        [0xD2, 0xDF, 0xAE],  # arid, kept green-tinged
        [0xE6, 0xE9, 0xC8],  # desert
    ],
    np.float32,
)
land_rgb = np.stack([np.interp(lum, stops, cols[:, i]) for i in range(3)], axis=-1)

# Texture: carry a little of the original's fine relief (high-pass of luminance).
blur = np.asarray(Image.fromarray(lum.astype(np.uint8)).filter(ImageFilter.GaussianBlur(3))).astype(np.float32)
detail = np.clip((lum - blur) / 70.0, -0.35, 0.35)
land_rgb *= (1.0 + detail)[..., None]

# Ice and snow: bright and unsaturated.
ice = np.clip((lum - 200) / 40, 0, 1) * np.clip((0.25 - sat) / 0.15, 0, 1)
land_rgb = land_rgb * (1 - ice[..., None]) + np.array([0xF6, 0xFA, 0xF8], np.float32) * ice[..., None]

# Ocean: light aqua, paler near coasts (blurred land mask = shallows).
near = np.asarray(Image.fromarray((land * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(6))).astype(np.float32) / 255.0
shallow = np.clip(near * 2.2, 0, 1)
deep = np.array([0x9F, 0xCF, 0xDB], np.float32)
shelf = np.array([0xCF, 0xEC, 0xEC], np.float32)
ocean_rgb = deep * (1 - shallow[..., None]) + shelf * shallow[..., None]

out = ocean_rgb * (1 - land[..., None]) + land_rgb * land[..., None]
Image.fromarray(np.clip(out, 0, 255).astype(np.uint8)).save(OUT, "WEBP", quality=86, method=6)
print(OUT, f"land share {land.mean():.3f}")
