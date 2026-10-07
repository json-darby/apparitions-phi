"""Fill in the frames between gesture key poses with RIFE (rife-ncnn-vulkan, MIT).

Each pair of neighbouring keys gets STEPS-1 in-betweens, with short holds on the
first and last key so the move reads. The walk sheet is cut into its eight cells
first and the cycle closes back on the first pose, so it loops.

    python tween_keys.py palm handover walk
Writes generated/frames/<move>/0001.png ... and a preview strip.
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
KEYS = ROOT / "generated" / "keys"
FR = ROOT / "generated" / "frames"
RIFE = Path(__file__).resolve().parent / "work" / "tools" / "rife-ncnn-vulkan-20221029-windows"
STEPS = 8  # frames per key-to-key step (7 in-betweens)
HOLD = {"palm": (6, 12), "handover": (6, 10), "walk": (0, 0)}
# the walk sheet's eight cells (x0, y0, x1, y1), trimmed inside the cell borders
WALK_CELLS = [(158, 45, 405, 370), (430, 45, 676, 370), (702, 45, 947, 370), (972, 45, 1217, 370),
              (158, 392, 405, 714), (430, 392, 676, 714), (702, 392, 947, 714), (972, 392, 1217, 714)]


def mid(a: Path, b: Path, t: float, out: Path) -> None:
    subprocess.run([str(RIFE / "rife-ncnn-vulkan.exe"), "-0", str(a), "-1", str(b), "-o", str(out), "-m", "rife-v4.6", "-s", f"{t:.4f}"],
                   cwd=RIFE, check=True, capture_output=True)


def keys_for(move: str, tmp: Path) -> list[Path]:
    if move != "walk":
        return sorted((KEYS / move).glob("k*.png"), key=lambda p: int(p.stem[1:]))
    aligned = sorted((KEYS / "walk").glob("w[0-9].png"))
    if aligned:  # made by align_walk.py: torso and feet already lined up
        return aligned + aligned[:1]
    sheet = Image.open(KEYS / "walk" / "sheet.png").convert("RGB")
    out = []
    for i, box in enumerate(WALK_CELLS + WALK_CELLS[:1]):  # close the loop on the first pose
        p = tmp / f"w{i}.png"
        cell = sheet.crop(box)
        sq = Image.new("RGB", (max(cell.size), max(cell.size)), (10, 10, 10))
        sq.paste(cell, ((sq.width - cell.width) // 2, sq.height - cell.height))
        sq.resize((512, 512), Image.LANCZOS).save(p)
        out.append(p)
    return out


def main() -> None:
    for move in sys.argv[1:]:
        dst = FR / move
        shutil.rmtree(dst, ignore_errors=True)
        dst.mkdir(parents=True)
        with tempfile.TemporaryDirectory() as td:
            tmp = Path(td)
            ks = keys_for(move, tmp)
            frames: list[Path] = []
            h0, h1 = HOLD[move]
            frames += [ks[0]] * h0
            for a, b in zip(ks, ks[1:]):
                frames.append(a)
                for s in range(1, STEPS):
                    p = tmp / f"{a.stem}-{s}.png"
                    mid(a, b, s / STEPS, p)
                    frames.append(p)
            if move != "walk":  # the walk's last key is its first: not repeated
                frames.append(ks[-1])
                frames += [ks[-1]] * h1
            for i, f in enumerate(frames, 1):
                Image.open(f).convert("RGB").save(dst / f"{i:04d}.png")
        n = len(list(dst.glob("*.png")))
        strip = [Image.open(dst / f"{i:04d}.png").resize((120, 120)) for i in range(1, n + 1, max(1, n // 16))]
        s = Image.new("RGB", (120 * len(strip), 120))
        for i, im in enumerate(strip):
            s.paste(im, (i * 120, 0))
        s.save(FR / f"{move}-strip.jpg", quality=85)
        print(move, n, "frames")


if __name__ == "__main__":
    main()
