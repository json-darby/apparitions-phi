"""Pack the street people's full-body poses for The Street.

Each person has three approved photos in generated/bodies/<who>/ (idle, notice,
greet: 9:16, black background, the feet in the same place). Fah also has a
jacket set for when the 18+ setting is off. For each set:

1. notice and greet are lined up on idle by the legs (an affine ECC fit on the
   lower body only), so the soles never move between poses;
2. the head turn idle -> notice is a small change, so RIFE (rife-ncnn-vulkan,
   MIT) fills seven in-betweens and the app blends neighbouring frames;
3. the greeting is NOT interpolated: the generated poses differ in head angle
   and torso as well as the arm, and RIFE turns that into ghosted faces and
   smeared arms. The app re-forms the dots into the greeting instead (a
   "reform" join in the index);
4. the keys are cut out with BiRefNet; each in-between carries the mattes of
   its two keys across by optical flow (small motion, so the flow holds);
5. every frame is toned with ONE curve per person, measured on idle, so the
   brightness never flickers from frame to frame;
6. all frames (and both of Fah's sets) share one crop, scaled to TILE_H, laid
   out in a grid atlas: the photo's own colour (graded, a little desaturated for
   the night street) in RGB, the matte in alpha. The app draws them as fine dots
   so their faces, clothes and props read.

    python pack_bodies.py [who ...]
Writes app/public/packs/bodies/<who>.webp, index.json and work/bodies/<who>-strip.jpg.
"""

from __future__ import annotations

import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image

import phi_depth as P

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
SRC = ROOT / "generated" / "bodies"
OUT = ROOT / "app" / "public" / "packs" / "bodies"
WORK = HERE / "work" / "bodies"
RIFE = HERE / "work" / "tools" / "rife-ncnn-vulkan-20221029-windows"
PEOPLE = ["nok", "ton", "ploy", "lek", "mai", "bank", "theo", "fah"]
POSES = ["idle", "notice", "greet"]
STEPS = 8  # frames for the head turn (7 in-betweens)
# people whose head turn does not interpolate cleanly: their turn re-forms as well
TURN_REFORM: set[str] = {"fah"}  # her over-the-shoulder look ghosts the eyes mid-turn
TILE_H = 420
COLS = 5
CREDIT = "AI-generated (Gemini 3 Pro Image), fictional people; in-betweens by RIFE (MIT); matte by BiRefNet (MIT)"


def load(p: Path) -> np.ndarray:
    return np.asarray(Image.open(p).convert("RGB"), np.float32) / 255.0


def save(rgb: np.ndarray, p: Path) -> None:
    Image.fromarray((np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)).save(p)


def align_legs(ref: np.ndarray, mov: np.ndarray, legs: np.ndarray) -> tuple[np.ndarray, float]:
    """Warp `mov` onto `ref` with an affine fitted on the legs only. Returns the warped image and the residual shift (px)."""
    cv2 = P._cv2()
    g0 = cv2.GaussianBlur(P.luma(ref).astype(np.float32), (0, 0), 1.2)
    g1 = cv2.GaussianBlur(P.luma(mov).astype(np.float32), (0, 0), 1.2)
    warp = np.eye(2, 3, dtype=np.float32)
    crit = (cv2.TERM_CRITERIA_EPS | cv2.TERM_CRITERIA_COUNT, 300, 1e-6)
    _, warp = cv2.findTransformECC(g0, g1, warp, cv2.MOTION_AFFINE, crit, legs.astype(np.uint8), 5)
    h, w = ref.shape[:2]
    out = cv2.warpAffine(mov, warp, (w, h), flags=cv2.INTER_CUBIC | cv2.WARP_INVERSE_MAP, borderMode=cv2.BORDER_REPLICATE)
    shift = float(np.hypot(warp[0, 2], warp[1, 2]))
    return np.clip(out, 0, 1), shift


def rife(a: Path, b: Path, t: float, out: Path) -> None:
    subprocess.run([str(RIFE / "rife-ncnn-vulkan.exe"), "-0", str(a), "-1", str(b), "-o", str(out), "-m", "rife-v4.6", "-s", f"{t:.4f}"],
                   cwd=RIFE, check=True, capture_output=True)


def warp_to(frame: np.ndarray, key: np.ndarray, key_alpha: np.ndarray) -> np.ndarray:
    """The key's matte moved onto `frame`: dense flow frame -> key (DIS), then a backward warp."""
    cv2 = P._cv2()
    g = lambda z: (np.clip(P.luma(z), 0, 1) * 255).astype(np.uint8)
    dis = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM)
    flow = dis.calc(g(frame), g(key), None)
    h, w = key_alpha.shape
    gx, gy = np.meshgrid(np.arange(w, dtype=np.float32), np.arange(h, dtype=np.float32))
    return cv2.remap(key_alpha.astype(np.float32), gx + flow[..., 0], gy + flow[..., 1], cv2.INTER_LINEAR, borderValue=0)


def carry(frame, ka, aa, kb, ab, t: float) -> np.ndarray:
    return np.clip((1 - t) * warp_to(frame, ka, aa) + t * warp_to(frame, kb, ab), 0, 1)


def curve(Y: np.ndarray, region: np.ndarray, black_q=1.0, mid_q=50.0, white_q=99.5, mid_to=0.42, white_to=1.0):
    """The object grade (phi_depth.tone), measured once and returned as a function to apply to every frame."""
    v = Y[region > 0.5]
    b, m, wq = (float(np.percentile(v, q)) for q in (black_q, mid_q, white_q))
    xm = np.clip((m - b) / max(wq - b, 1e-4), 1e-3, 0.999)
    g = min(max(math.log(mid_to / white_to) / math.log(xm), 0.35), 3.0)
    return lambda Z: np.clip(white_to * np.clip((Z - b) / max(wq - b, 1e-4), 0, None) ** g, 0, 1).astype(np.float32)


def clean_matte(a: np.ndarray) -> np.ndarray:
    """The person and what they hold, nothing else: only the largest connected shape is kept (no stray
    specks of background the cut-out left), and the edge is pulled in about 2 px so no dark fringe of
    the studio background shows around them."""
    cv2 = P._cv2()
    n, lab, stats, _ = cv2.connectedComponentsWithStats((a > 0.3).astype(np.uint8), 8)
    if n > 2:
        keep = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        a = a * cv2.dilate((lab == keep).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float32)
    a = cv2.erode(a.astype(np.float32), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)))
    return np.clip(cv2.GaussianBlur(a, (0, 0), 0.8), 0, 1)


def bbox(a: np.ndarray, thr=0.08) -> tuple[int, int, int, int]:
    ys, xs = np.where(a > thr)
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def sequence(keys: list[np.ndarray], turn_reform: bool, tmp: Path, tag: str) -> tuple[list[np.ndarray], list[int], list[list[int]]]:
    """Frames, the index of each key in them, and the reform joins."""
    paths = []
    for i, k in enumerate(keys):
        p = tmp / f"{tag}-k{i}.png"
        save(k, p)
        paths.append(p)
    frames = [keys[0]]
    if turn_reform:
        frames.append(keys[1])
    else:
        for s in range(1, STEPS):
            p = tmp / f"{tag}-turn-{s}.png"
            rife(paths[0], paths[1], s / STEPS, p)
            frames.append(load(p))
        frames.append(keys[1])
    frames.append(keys[2])
    n = len(frames)
    key_at = [0, n - 2, n - 1]
    joins = [[n - 2, n - 1]] + ([[0, 1]] if turn_reform else [])
    return frames, key_at, sorted(joins)


def pack(who: str, eng: P.Engine) -> dict:
    cv2 = P._cv2()
    sets = {"": [SRC / who / f"{p}.png" for p in POSES]}
    if (SRC / who / "idle-jacket.png").exists():
        sets["jacket"] = [SRC / who / f"{p}-jacket.png" for p in POSES]
    base = load(sets[""][0])
    h, w = base.shape[:2]
    a_idle = eng.matter.alpha(base, "portrait")
    x0, y0, x1, y1 = bbox(a_idle)
    # the legs: the lower 42% of the body, inside the idle matte (dilated a little)
    legs = np.zeros((h, w), np.uint8)
    legs[int(y1 - 0.42 * (y1 - y0)) : min(h, y1 + 6), :] = 1
    legs &= cv2.dilate((a_idle > 0.5).astype(np.uint8), np.ones((15, 15), np.uint8))
    report = {"shift_px": {}}
    all_frames: dict[str, list[np.ndarray]] = {}
    key_at: list[int] = []
    joins: list[list[int]] = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for tag, paths in sets.items():
            keys = [base if (tag == "" and i == 0) else load(p) for i, p in enumerate(paths)]
            # every key lines up on the dress idle (the jacket set too, so a setting switch never shifts her)
            for i in range(1, len(keys)) if tag == "" else range(len(keys)):
                keys[i], s = align_legs(base, keys[i], legs)
                report["shift_px"][f"{tag or 'main'}:{POSES[i]}"] = round(s, 2)
            all_frames[tag], key_at, joins = sequence(keys, who in TURN_REFORM, tmp, tag or "main")
    # mattes: BiRefNet on the keys; each in-between carries its two keys' mattes across by optical flow
    alphas = {}
    for t, fs in all_frames.items():
        key_a = {i: (a_idle if (t == "" and i == 0) else eng.matter.alpha(fs[i], "portrait")) for i in key_at}
        alphas[t] = []
        for i in range(len(fs)):
            if i in key_a:
                alphas[t].append(key_a[i])
                continue
            a = max(k for k in key_at if k < i)
            b = min(k for k in key_at if k > i)
            alphas[t].append(carry(fs[i], fs[a], key_a[a], fs[b], key_a[b], (i - a) / (b - a)))
    alphas = {t: [clean_matte(a) for a in al] for t, al in alphas.items()}
    tone = curve(P.luma(all_frames[""][0]), (alphas[""][0] > 0.9).astype(np.float32))
    # one crop for everything: the union of all mattes, with a margin
    boxes = [bbox(a) for t in alphas for a in alphas[t]]
    cx0, cy0 = min(b[0] for b in boxes), min(b[1] for b in boxes)
    cx1, cy1 = max(b[2] for b in boxes), max(b[3] for b in boxes)
    m = round(0.02 * (cy1 - cy0))
    cx0, cy0, cx1, cy1 = max(0, cx0 - m), max(0, cy0 - m), min(w, cx1 + m), min(h, cy1 + m)
    k = TILE_H / (cy1 - cy0)
    tw = int(math.ceil((cx1 - cx0) * k / 2) * 2)
    n = len(all_frames[""])
    rows = math.ceil(n / COLS)
    entry = {}
    crop = lambda z: cv2.resize(z[cy0:cy1, cx0:cx1].astype(np.float32), (tw, TILE_H), interpolation=cv2.INTER_AREA)
    for tag, fs in all_frames.items():
        atlas = np.zeros((rows * TILE_H, COLS * tw, 4), np.float32)
        for i, (f, a) in enumerate(zip(fs, alphas[tag])):
            Y = P.luma(f)
            # the grade moves luminance only; colour keeps its hue, 20% toward grey for the night street
            col = np.clip(f * (tone(Y) / np.maximum(Y, 1e-3))[..., None], 0, 1)
            col = 0.8 * col + 0.2 * tone(Y)[..., None]
            # a light unsharp mask: faces and clothing edges still read when the figure is small
            col = np.clip(col + 0.6 * (col - cv2.GaussianBlur(col, (0, 0), 1.6)), 0, 1) * (a > 0.02)[..., None]
            r, c = divmod(i, COLS)
            for ch in range(3):
                atlas[r * TILE_H : (r + 1) * TILE_H, c * tw : (c + 1) * tw, ch] = crop(col[..., ch])
            atlas[r * TILE_H : (r + 1) * TILE_H, c * tw : (c + 1) * tw, 3] = crop(a)
        q = lambda z: Image.fromarray((np.clip(z, 0, 1) * 255 + 0.5).astype(np.uint8))
        name = f"{who}{'-' + tag if tag else ''}.webp"
        OUT.mkdir(parents=True, exist_ok=True)
        Image.merge("RGBA", [q(atlas[..., ch]) for ch in range(4)]).save(OUT / name, quality=92, alpha_quality=100, method=6)
        entry[tag] = f"bodies/{name}"
    # crown, soles and the centre between the feet, measured on idle (tile fractions)
    ai = alphas[""][0][cy0:cy1, cx0:cx1]
    rowsum = (ai > 0.5).sum(1)
    crown = int(np.argmax(rowsum > 2))
    sole = int(len(rowsum) - np.argmax(rowsum[::-1] > 2))
    band = slice(int(sole - 0.06 * (sole - crown)), sole)
    foot = ai[band] > 0.5
    fx = float(np.mean(np.where(foot)[1])) if foot.any() else ai.shape[1] / 2
    # QA: how still the soles are across all frames (centroid of the bottom band)
    feet_x = []
    for t in alphas:
        for a in alphas[t]:
            fb = a[cy0:cy1, cx0:cx1][band] > 0.5
            feet_x.append(float(np.mean(np.where(fb)[1])) if fb.any() else np.nan)
    report["feet_drift_px_at_tile"] = round(float(np.nanmax(feet_x) - np.nanmin(feet_x)) * k, 2)
    out = {
        "image": entry[""], "tile": [tw, TILE_H], "cols": COLS, "frames": n,
        "keys": {"idle": key_at[0], "notice": key_at[1], "greet": key_at[2]},
        "reform": joins,
        "head": round(crown / ai.shape[0], 4), "feet": round(sole / ai.shape[0], 4), "centre": round(fx / ai.shape[1], 4),
        "looks": "right",
    }
    if "jacket" in entry:
        out["alt"] = {"jacket": {"image": entry["jacket"]}}
    # a strip for checking by eye: every frame of each set, cut out on dark plum (shows matte faults)
    WORK.mkdir(parents=True, exist_ok=True)
    cw, chh = tw, TILE_H
    sheet = Image.new("RGB", (n * cw, chh * len(all_frames)), (40, 10, 30))
    for r, (tag, fs) in enumerate(all_frames.items()):
        for i, (f, a) in enumerate(zip(fs, alphas[tag])):
            rgb = np.stack([crop(f[..., j]) for j in range(3)], -1)
            al = crop(a)[..., None]
            comp = rgb * al + np.array([40, 10, 30]) / 255 * (1 - al)
            sheet.paste(Image.fromarray((np.clip(comp, 0, 1) * 255).astype(np.uint8)), (i * cw, r * chh))
    sheet.save(WORK / f"{who}-strip.jpg", quality=85)
    print(f"{who}: {n} frames, tile {tw}x{TILE_H}, sets {list(entry)}, {json.dumps(report)}")
    return out


def main() -> None:
    who = sys.argv[1:] or PEOPLE
    eng = P.Engine()
    idx_path = OUT / "index.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8")) if idx_path.exists() else {"version": 2, "credit": CREDIT, "people": {}}
    idx["version"] = 2
    for w in who:
        idx["people"][w] = pack(w, eng)
        idx_path.write_text(json.dumps(idx, indent=1), encoding="utf-8")


if __name__ == "__main__":
    main()
