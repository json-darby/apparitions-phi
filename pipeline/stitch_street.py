"""Join the street sections (gen_street_vertex.py) into one panorama.

Each section was made from a starter holding the previous section's edge, so
neighbours share most of a strip. The model sometimes redraws that strip a
little, so a plain cross-fade ghosts (doubled plants, doubled signs). Instead:
the horizontal shift is found by feature matching (ORB + RANSAC on the shared
strip), then the join is a cut at the column where the two images agree most,
feathered over a few pixels. Writes generated/street/street.png and
street-joins.json (where each place sits, for the app).

    python stitch_street.py [--skip 00-start]
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
D = ROOT / "generated" / "street"
ORDER = ["00-start", "01-hotel", "02-food", "03-pharmacy", "04-bar", "05-shop", "06-market", "07-taxi", "08-end"]
KEEP = 0.4
FEATHER = 24


def load(n: str) -> np.ndarray:
    return cv2.imread(str(D / f"{n}.png"), cv2.IMREAD_COLOR)


def shift(left: np.ndarray, right: np.ndarray) -> tuple[int, int, int]:
    """(dx, dy, inliers): right image placed at x = dx relative to the left one."""
    h, w = left.shape[:2]
    k = int(w * KEEP)
    a = cv2.cvtColor(left[:, w - k - 120 :], cv2.COLOR_BGR2GRAY)
    b = cv2.cvtColor(right[:, : k + 360], cv2.COLOR_BGR2GRAY)
    orb = cv2.ORB_create(4000)
    ka, da = orb.detectAndCompute(a, None)
    kb, db = orb.detectAndCompute(b, None)
    if da is None or db is None:
        return w - k, 0, 0
    m = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True).match(da, db)
    if len(m) < 8:
        return w - k, 0, 0
    pa = np.float32([ka[x.queryIdx].pt for x in m]) + [w - k - 120, 0]
    pb = np.float32([kb[x.trainIdx].pt for x in m])
    d = pa - pb  # translation that maps right-image points onto the left image
    # robust mode of the translations: count agreement within 3 px
    best, bi = 0, 0
    for i in range(len(d)):
        n = int(np.sum(np.all(np.abs(d - d[i]) < 3, axis=1)))
        if n > best:
            best, bi = n, i
    inl = np.all(np.abs(d - d[bi]) < 3, axis=1)
    dx, dy = np.median(d[inl], axis=0)
    return int(round(dx)), int(round(dy)), best


def main() -> None:
    global D
    ap = argparse.ArgumentParser()
    ap.add_argument("--skip", nargs="*", default=[])
    ap.add_argument("--dir", default=str(D))
    a = ap.parse_args()
    D = Path(a.dir)
    order = [n for n in ORDER if n not in a.skip]
    ims = [load(n) for n in order]
    h = ims[0].shape[0]
    xs, ys, joins = [0], [0], []
    for i in range(1, len(ims)):
        dx, dy, inl = shift(ims[i - 1], ims[i])
        if inl < 15:  # too few matches: trust the planned overlap
            dx, dy = ims[i - 1].shape[1] - int(ims[i - 1].shape[1] * KEEP), 0
        xs.append(xs[-1] + dx)
        ys.append(ys[-1] + dy)
        joins.append({"between": [order[i - 1], order[i]], "dx": dx, "dy": dy, "inliers": inl})
    y0 = min(ys)
    H = h + max(ys) - y0
    W = xs[-1] + ims[-1].shape[1]
    canvas = np.zeros((H, W, 3), np.float32)
    have = np.zeros((H, W), bool)
    for i, (x0, y, im) in enumerate(zip(xs, ys, ims)):
        y1 = y - y0
        w = im.shape[1]
        reg = (slice(y1, y1 + h), slice(x0, x0 + w))
        new = im.astype(np.float32)
        if i == 0:
            canvas[reg] = new
            have[reg] = True
            continue
        # the overlap with what is already down: cut where the two agree most
        old = canvas[reg]
        ov = have[reg].any(axis=0)
        ov_end = int(np.nonzero(ov)[0].max()) + 1 if ov.any() else 0
        lo, hi = 40, max(41, ov_end - 40)
        diff = np.abs(old - new).mean(axis=2)
        band = slice(int(h * 0.12), int(h * 0.88))
        cost = diff[band].mean(axis=0)
        cost = np.convolve(cost, np.ones(15) / 15, mode="same")
        cut = lo + int(np.argmin(cost[lo:hi])) if hi > lo else ov_end // 2
        wt = np.clip((np.arange(w) - (cut - FEATHER)) / (2 * FEATHER), 0, 1)[None, :, None]
        wt = np.where(have[reg][..., None], wt, 1.0)
        canvas[reg] = old * (1 - wt) + new * wt
        have[reg] = True
        joins[i - 1]["cut_at"] = int(x0 + cut)
    # trim rows that not every section reaches
    rows = have.all(axis=1)
    top, bot = int(np.argmax(rows)), int(len(rows) - np.argmax(rows[::-1]))
    canvas = canvas[top:bot]
    cv2.imwrite(str(D / "street.png"), np.clip(canvas, 0, 255).astype(np.uint8))
    centres = {n: int(x0 + ims[i].shape[1] // 2) for i, (n, x0) in enumerate(zip(order, xs))}
    (D / "street-joins.json").write_text(json.dumps({"width": W, "height": int(bot - top), "order": order, "centres": centres, "joins": joins}, indent=2))
    for j in joins:
        print(j)
    print("street.png", W, "x", bot - top)


if __name__ == "__main__":
    main()
