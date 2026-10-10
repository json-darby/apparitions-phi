"""Give every portrait pack a clean bust: the matte ends in a smooth rounded neck
below the chin instead of running on into collars, shoulders and hair ends,
which the dot renderer thinned into loose, ragged dots.

One cut per person, measured on the neutral face and shared by every front-on
expression (they blend into each other, so the edge must not move). The turned
head is only in the developer catalogue and is left as it is. Only the alpha changes; the brightness is re-encoded at a
higher quality so nothing visible is lost. Originals are kept in work/busts-before/.

    pipeline/.venv/Scripts/python.exe pipeline/clean_busts.py [--who pim,nok] [--preview out.png]
"""
from __future__ import annotations

import argparse
import shutil
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
PACKS = ROOT.parent / "app" / "public" / "packs"
BACKUP = ROOT / "work" / "busts-before"
PEOPLE = ["pim", "nok", "ton", "ploy", "lek", "mai", "bank", "theo", "fah"]
FRONT = ["neutral", "smile", "sad", "puzzled", "closed"]

CHIN, JAW_L, JAW_R, TOP = 152, 172, 397, 10


def landmarks(face, grey: np.ndarray) -> np.ndarray | None:
    rgb = np.ascontiguousarray(np.repeat(grey[..., None], 3, 2))
    big = cv2.resize(rgb, (768, 768), interpolation=cv2.INTER_CUBIC)
    res = face.lm.detect(face.mp.Image(image_format=face.mp.ImageFormat.SRGB, data=big))
    if not res.face_landmarks:
        return None
    n = grey.shape[0]
    return np.array([[p.x * n, p.y * n] for p in res.face_landmarks[0]])


def bust_cut(pts: np.ndarray, n: int) -> np.ndarray:
    """1 inside the kept head and neck, 0 below; a soft edge of a few texels."""
    chin = pts[CHIN]
    jl, jr = pts[JAW_L], pts[JAW_R]
    face_h = chin[1] - pts[TOP][1]
    cx = chin[0]
    jaw_w = abs(jr[0] - jl[0])
    neck_half = 0.34 * jaw_w
    neck_bottom = chin[1] + 0.17 * face_h
    side = max(jl[1], jr[1]) + 0.04 * face_h  # beside the neck the head ends just under the jaw angle
    ys, xs = np.mgrid[0:n, 0:n].astype(np.float32)
    dx = np.abs(xs - cx)
    # the neck: a column with a gently rounded bottom, flaring smoothly into the jaw line
    u = np.clip(dx / neck_half, 0, None)
    neck_y = neck_bottom - 0.03 * face_h * np.minimum(u, 1) ** 2
    blend = np.clip((dx - neck_half) / (0.22 * jaw_w), 0, 1)
    blend = blend * blend * (3 - 2 * blend)
    edge = neck_y * (1 - blend) + side * blend
    f = 2.5
    return np.clip((edge - ys) / (2 * f) + 0.5, 0, 1)


def largest(alpha: np.ndarray) -> np.ndarray:
    m = (alpha > 0.1).astype(np.uint8)
    k, lab, st, _ = cv2.connectedComponentsWithStats(m, 8)
    if k <= 2:
        return alpha
    keep = 1 + int(np.argmax(st[1:, 4]))
    return alpha * (lab == keep)


def source(who: str, expr: str) -> Path:
    """The pack as it was before any cleaning, so a re-run starts from the original matte."""
    bk = BACKUP / who / f"{expr}.webp"
    return bk if bk.exists() else PACKS / who / f"{expr}.webp"


def clean(who: str, face) -> list[tuple[str, np.ndarray, np.ndarray]]:
    out = []
    base = np.array(Image.open(source(who, "neutral")))
    pts = landmarks(face, base[..., 0])
    if pts is None:
        raise SystemExit(f"{who}: no face found")
    cut = bust_cut(pts, base.shape[0])
    for expr in FRONT:
        if not source(who, expr).exists():
            continue
        im = np.array(Image.open(source(who, expr)))
        a0 = im[..., 3].astype(np.float32) / 255
        a = largest(a0 * cut)
        out.append((expr, im, a))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--who", default=",".join(PEOPLE))
    ap.add_argument("--preview", help="write a before/after sheet here and do not save the packs")
    a = ap.parse_args()
    import sys

    sys.path.insert(0, str(ROOT))
    from phi_depth import Face

    face = Face()
    rows = []
    for who in a.who.split(","):
        for expr, im, alpha in clean(who, face):
            if a.preview:
                lum = im[..., 0].astype(np.float32)
                before = lum * (im[..., 3] / 255)
                after = lum * alpha
                rows.append(np.concatenate([before, after], 1).astype(np.uint8))
                continue
            p = PACKS / who / f"{expr}.webp"
            bk = BACKUP / who / p.name
            if not bk.exists():
                bk.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(p, bk)
            rgba = im.copy()
            rgba[..., 3] = np.round(alpha * 255).astype(np.uint8)
            Image.fromarray(rgba, "RGBA").save(p, "WEBP", quality=92, method=6, alpha_quality=100)
            print("cleaned", who, expr)
    if a.preview:
        # one row per face, before and after
        sheet = np.concatenate(rows, 0)
        Image.fromarray(sheet).save(a.preview)
        print("preview", a.preview, sheet.shape)


if __name__ == "__main__":
    main()
