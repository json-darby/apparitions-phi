"""Line up the eight walk poses before RIFE fills in between them.

The model draws each pose in its own grid cell, a little left or right of the
others, so played in order the figure jitters. Each cell is cut out with the
BiRefNet matte; the torso's centre is moved to the middle and the feet to one
ground line, on a plain near-black square. Writes generated/keys/walk/w0..w7.png.

    python align_walk.py
"""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image

from phi_depth import Matter
from tween_keys import WALK_CELLS

ROOT = Path(__file__).resolve().parent.parent
KEYS = ROOT / "generated" / "keys" / "walk"
SIZE = 512
GROUND = int(SIZE * 0.94)
BG = (10, 10, 10)


def main() -> None:
    import sys

    matter = Matter()
    cells, alphas = [], []
    for w in sorted(KEYS.glob("w[0-9].png")):
        w.unlink()
    if len(sys.argv) > 1:  # single photographs, one pose each, in walking order
        sources = [Image.open(p).convert("RGB") for p in sys.argv[1:]]
    else:  # the eight cells of the walk sheet
        sheet = Image.open(KEYS / "sheet.png").convert("RGB")
        sources = [sheet.crop(box) for box in WALK_CELLS]
    for c in sources:
        rgb = np.asarray(c, np.float32) / 255
        a = matter.alpha(rgb, "portrait")
        cells.append(c)
        alphas.append(a)
    heights = []
    for a in alphas:
        ys = np.nonzero(a.max(axis=1) > 0.5)[0]
        heights.append(ys.max() - ys.min())
    # one scale for every pose: the tallest figure fills 86% of the square
    k0 = SIZE * 0.86 / max(heights)
    for i, (c, a) in enumerate(zip(cells, alphas)):
        # separate photographs come at different sizes: bring each figure to one height
        k = SIZE * 0.86 / heights[i] if len(sys.argv) > 1 else k0
        ys = np.nonzero(a.max(axis=1) > 0.5)[0]
        top, feet = ys.min(), ys.max()
        h = feet - top
        band = a[top + int(h * 0.22) : top + int(h * 0.5)]  # chest to hips: steady while arms and legs swing
        cols = np.nonzero(band.max(axis=0) > 0.5)[0]
        w = band[:, cols].sum(axis=0)
        cx = float((cols * w).sum() / w.sum())
        cs = c.resize((round(c.width * k), round(c.height * k)), Image.LANCZOS)
        am = Image.fromarray((a * 255).astype(np.uint8)).resize(cs.size, Image.LANCZOS)
        out = Image.new("RGB", (SIZE, SIZE), BG)
        out.paste(cs, (round(SIZE / 2 - cx * k), round(GROUND - feet * k)), am)
        out.save(KEYS / f"w{i}.png")
        print(f"w{i}: centre {cx:.0f}, feet {feet}, height {h}")


if __name__ == "__main__":
    main()
