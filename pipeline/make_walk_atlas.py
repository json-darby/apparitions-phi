"""Pack the walk cycle (generated/frames/walk, made by tween_keys.py) for The Street.

Each frame is cut out with the BiRefNet matte and placed in a 4 x 4 atlas of
256 px tiles: grey brightness in RGB, alpha = matte, the same convention as the
portrait and sequence packs. Also writes the numbers The Street needs to keep
the figure to scale and the feet planted.

    python make_walk_atlas.py
Writes app/public/packs/walk/you.webp and app/public/packs/walk/you.json
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image

from phi_depth import Matter

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "generated" / "frames" / "walk"
OUT = ROOT / "app" / "public" / "packs" / "walk"
TILE = 256
COLS = 4


def main() -> None:
    frames = sorted(SRC.glob("*.png"))
    n = len(frames)
    rows = (n + COLS - 1) // COLS
    atlas = Image.new("RGBA", (COLS * TILE, rows * TILE), (0, 0, 0, 0))
    matter = Matter()
    tops, feet, fronts = [], [], []
    for i, f in enumerate(frames):
        im = Image.open(f).convert("RGB")
        a = matter.alpha(np.asarray(im, np.float32) / 255, "portrait")
        g = np.asarray(im.convert("L"), np.float32)
        # lift the shadows so the dark top still carries dots; the matte decides the outline
        g = np.clip(255 * (g / 255) ** 0.6, 0, 255)
        rgba = np.dstack([g, g, g, np.clip(a * 255, 0, 255)]).astype(np.uint8)
        tile = Image.fromarray(rgba, "RGBA").resize((TILE, TILE), Image.LANCZOS)
        atlas.paste(tile, ((i % COLS) * TILE, (i // COLS) * TILE))
        ys, xs = np.nonzero(a > 0.5)
        tops.append(int(ys.min()))
        feet.append(int(ys.max()))
        fronts.append(int(xs.max()))
    OUT.mkdir(parents=True, exist_ok=True)
    atlas.save(OUT / "you.webp", "WEBP", quality=90, method=6)
    size = Image.open(frames[0]).size[0]
    meta = {
        "image": "walk/you.webp",
        "frames": n,
        "cols": COLS,
        "rows": rows,
        "tile": [TILE, TILE],
        # in tile fractions (0 top/left .. 1 bottom/right), from the source frames
        "head": round(min(tops) / size, 4),
        "feet": round(max(feet) / size, 4),
        # one loop is one step: the feet swap once; the body travels about 0.39 of its height per step
        "step_per_height": 0.39,
        "fps": 18,
        "credit": "AI-generated (image model), in-between frames by RIFE (MIT), cut out by BiRefNet (MIT). Not a real person.",
    }
    (OUT / "you.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(meta)


if __name__ == "__main__":
    main()
