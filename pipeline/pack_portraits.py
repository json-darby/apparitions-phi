"""
Phi asset packer: turns generated stills and clips into the packs the app loads.

Free tools only: Pillow, numpy, onnxruntime, ffmpeg, and for the accurate depth
mode (the default for portraits, objects and scenes: --depth dav2) torch,
transformers, timm, kornia, einops, opencv-contrib, scipy and mediapipe
(see phi_depth.py):

    pip install pillow numpy onnxruntime
    pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision
    pip install transformers timm kornia einops opencv-contrib-python scipy mediapipe
    # models are fetched once into pipeline/work/models/ (git-ignored):
    #   Depth Anything V2 Small (Apache-2.0), BiRefNet / BiRefNet-portrait (MIT),
    #   MediaPipe face_landmarker.task + canonical_face_model.obj (Apache-2.0),
    #   MiDaS v2.1 small (MIT), the fallback: work/models/midas-small.onnx
    # ffmpeg on PATH for video clips

--depth dav2 (default): Depth Anything V2 at 518 + 1022 px with flip TTA, BiRefNet
matte, guided-filter edges, metric calibration (faces against the posed MediaPipe
canonical face; objects by a shape prior; scenes linear in disparity), inverse
perspective pre-warp, and automatic sanity checks that reject bad maps (logged to
pipeline/work/depth_log.json), with MiDaS as the fallback.
--depth midas: the old MiDaS small path (--midas MODEL); --depth none: test depth.
Clips (sequence) still use the MiDaS path.

Commands (run from phi-project/):

  portraits  Generated portraits -> app/public/packs/<who>/<expression>.webp + .depth.webp
             python pipeline/pack_portraits.py portraits --src generated/portraits --midas models/model-small.onnx
             expects  <src>/<who>/<expression>.png   or   <src>/<who>_<expression>.png
             expressions: neutral smile puzzled sad closed turn

  sequence   A gesture clip -> 8 to 12 stills a second -> depth per still -> one atlas
             python pipeline/pack_portraits.py sequence --name palm --who fah --video generated/clips/palm.mp4 --linger near
             python pipeline/pack_portraits.py sequence --name wai --frames generated/clips/wai_frames/

  still      An object or a street scene (image + depth)
             python pipeline/pack_portraits.py still --kind objects --id dish --src generated/objects/dish.png
             python pipeline/pack_portraits.py still --kind scenes --id food --src generated/scenes/food.png --size 384x240

  manifest   Rebuild manifest.json from what is in the pack folder
  check      Report what the app will find (and what is still a code-drawn stand-in)

Pack format (what the app reads; see pipeline/CAST_SHEET.md):
  app/public/packs/manifest.json
  <who>/<expression>.webp         brightness in RGB (grey), alpha = matte (person vs background)
  <who>/<expression>.depth.webp   depth, grey, white = near
  seq/<name>.webp + .depth.webp   frame atlas, cols x rows tiles, row-major from top-left
  objects/<id>.webp + .depth.webp
  scenes/<place>.webp + .depth.webp

All people in Phi are AI-generated and credited as such. Never pack a photo of
a real person, and never use a real person's name or photo in a prompt.
"""

from __future__ import annotations

import argparse
import os
import time
from contextlib import contextmanager
import json
import math
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

EXPRESSIONS = ["neutral", "smile", "puzzled", "sad", "closed", "turn"]
CAST = ["nok", "ton", "ploy", "lek", "mai", "bank", "fah", "pim", "theo"]
SEQUENCES = ["palm", "wai", "handover", "glance", "walkaway"]
PLACES = ["food", "taxi", "hotel", "market", "bar", "pharmacy"]
IMG_EXT = (".png", ".jpg", ".jpeg", ".webp")
CREDIT = "AI-generated (image model), depth by MiDaS. Not real people."
CREDIT_DAV2 = "AI-generated (image model), depth by Depth Anything V2. Not real people."
LOG = Path(__file__).resolve().parent / "work" / "depth_log.json"

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_OUT = ROOT / "app" / "public" / "packs"


# ---------------------------------------------------------------- depth

class Depth:
    """MiDaS small (ONNX) as in animation-demos/pipeline/depth_and_hand_prep.py.
    Output is relative inverse depth: higher = nearer. With --midas none a rough
    stand-in (blurred brightness with a centre bias) is used, for testing only."""

    def __init__(self, model: str | None):
        self.sess = None
        if model and model.lower() != "none":
            try:
                import onnxruntime as ort
            except ImportError:
                sys.exit("onnxruntime is not installed: pip install onnxruntime")
            if not Path(model).exists():
                sys.exit(f"depth model not found: {model}\n  download model-small.onnx from https://github.com/isl-org/MiDaS/releases/tag/v2_1")
            self.sess = ort.InferenceSession(model, providers=["CPUExecutionProvider"])
            self.inp = self.sess.get_inputs()[0]
            shape = self.inp.shape
            self.size = int(shape[2]) if isinstance(shape[2], int) else 256
        else:
            print("warning: no depth model, using a rough stand-in depth (testing only)")

    def raw(self, im: Image.Image) -> np.ndarray:
        """Unnormalised depth at the image size (float32, higher = nearer)."""
        w, h = im.size
        if self.sess is None:
            g = np.asarray(im.convert("L").filter(ImageFilter.GaussianBlur(max(2, w // 40))), np.float32) / 255
            yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
            r = np.hypot((xx - w / 2) / (w / 2), (yy - h * 0.45) / (h / 2))
            return (0.6 * g + 0.4 * np.clip(1 - r, 0, 1)).astype(np.float32)
        s = self.size
        c = im.convert("RGB").resize((s, s), Image.LANCZOS)
        x = (np.asarray(c).astype(np.float32) / 255 - [0.485, 0.456, 0.406]) / [0.229, 0.224, 0.225]
        d = self.sess.run(None, {self.inp.name: x.transpose(2, 0, 1)[None].astype(np.float32)})[0]
        d = np.squeeze(d).astype(np.float32)
        return np.asarray(Image.fromarray(d).resize((w, h), Image.BICUBIC), np.float32)


def normalise(d: np.ndarray, lo: float | None = None, hi: float | None = None) -> np.ndarray:
    lo = np.percentile(d, 2) if lo is None else lo
    hi = np.percentile(d, 98) if hi is None else hi
    return np.clip((d - lo) / max(1e-6, hi - lo), 0, 1)


# ---------------------------------------------------------------- matte and framing

def square_crop(im: Image.Image, crop: str | None) -> Image.Image:
    w, h = im.size
    if crop:
        x, y, cw, ch = [float(v) for v in crop.split(",")]
        return im.crop((int(x * w), int(y * h), int((x + cw) * w), int((y + ch) * h)))
    s = min(w, h)
    # portraits: keep the top (head and shoulders), centre horizontally
    left = (w - s) // 2
    top = 0 if h > w else (h - s) // 2
    return im.crop((left, top, left + s, top + s))


def matte(im: Image.Image, depth: np.ndarray) -> np.ndarray:
    """Person vs plain dark background: colour distance from the border colour,
    helped by depth (the subject is nearer), feathered."""
    a = np.asarray(im.convert("RGB"), np.float32) / 255
    h, w, _ = a.shape
    b = max(2, min(h, w) // 32)
    border = np.concatenate([a[:b].reshape(-1, 3), a[-b:].reshape(-1, 3), a[:, :b].reshape(-1, 3), a[:, -b:].reshape(-1, 3)])
    bg = np.median(border, axis=0)
    dist = np.linalg.norm(a - bg, axis=2)
    m_col = np.clip((dist - 0.05) / 0.12, 0, 1)
    m_dep = np.clip((depth - 0.18) / 0.2, 0, 1)
    m = np.maximum(m_col * (0.35 + 0.65 * m_dep), m_dep * 0.6)
    m = np.asarray(Image.fromarray((m * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.0)), np.float32) / 255
    return m


def to_pack_images(im: Image.Image, depth01: np.ndarray, alpha: np.ndarray | None) -> tuple[Image.Image, Image.Image]:
    lum = im.convert("L")
    if alpha is None:
        alpha = np.ones(depth01.shape, np.float32)
    rgba = Image.merge("RGBA", (lum, lum, lum, Image.fromarray((alpha * 255).astype(np.uint8))))
    dimg = Image.fromarray((depth01 * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
    return rgba, dimg


def save_pair(rgba: Image.Image, dimg: Image.Image, base: Path, lossless_depth: bool = False) -> tuple[str, str]:
    """Image lossy (quality 82); depth lossless in the accurate mode (lossy depth
    blocks show up as steps in the dot cloud)."""
    base.parent.mkdir(parents=True, exist_ok=True)
    img_p = base.parent / (base.name + ".webp")
    dep_p = base.parent / (base.name + ".depth.webp")
    rgba.save(img_p, "WEBP", quality=82, method=6, alpha_quality=90)
    if lossless_depth:
        dimg.save(dep_p, "WEBP", lossless=True, quality=100, method=6)
    else:
        dimg.save(dep_p, "WEBP", quality=85, method=6)
    return img_p.name, dep_p.name


# ---------------------------------------------------------------- manifest

def load_manifest(out: Path) -> dict:
    p = out / "manifest.json"
    if p.exists():
        try:
            m = json.loads(p.read_text(encoding="utf8"))
        except json.JSONDecodeError:
            m = {}
    else:
        m = {}
    m.setdefault("version", 1)
    m.setdefault("credit", CREDIT)
    for k in ("people", "sequences", "objects", "scenes"):
        m.setdefault(k, {})
    return m


@contextmanager
def _manifest_lock(out: Path):
    """A lock file beside the manifest, so parallel packs write it one at a time."""
    lk = out / "manifest.lock"
    for _ in range(600):
        try:
            fd = os.open(lk, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
            os.close(fd)
            break
        except FileExistsError:
            time.sleep(0.1)
    try:
        yield
    finally:
        try:
            lk.unlink()
        except FileNotFoundError:
            pass


def save_manifest(out: Path, m: dict) -> None:
    out.mkdir(parents=True, exist_ok=True)
    for k in ("people", "sequences", "objects", "scenes"):
        m[k] = dict(sorted(m[k].items()))
    (out / "manifest.json").write_text(json.dumps(m, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"wrote {out / 'manifest.json'}")


def rel(out: Path, p: Path) -> str:
    return p.relative_to(out).as_posix()


# ---------------------------------------------------------------- commands

def find_portraits(src: Path) -> dict[str, dict[str, Path]]:
    found: dict[str, dict[str, Path]] = {}
    for p in sorted(src.rglob("*")):
        if p.suffix.lower() not in IMG_EXT:
            continue
        if p.parent != src and p.parent.name.lower() in CAST + ["you"]:
            who, expr = p.parent.name.lower(), p.stem.lower()
        elif "_" in p.stem:
            who, expr = p.stem.lower().split("_", 1)
        else:
            continue
        expr = {"three-quarter": "turn", "threequarter": "turn", "3q": "turn", "eyes-closed": "closed", "eyesclosed": "closed"}.get(expr, expr)
        if expr not in EXPRESSIONS:
            print(f"skip {p}: unknown expression '{expr}' (use {', '.join(EXPRESSIONS)})")
            continue
        found.setdefault(who, {})[expr] = p
    return found


def write_log(entries: dict) -> None:
    """Merge depth-check reports into pipeline/work/depth_log.json (keyed by pack path)."""
    LOG.parent.mkdir(parents=True, exist_ok=True)
    try:
        log = json.loads(LOG.read_text(encoding="utf8")) if LOG.exists() else {}
    except json.JSONDecodeError:
        log = {}
    log.update(entries)
    LOG.write_text(json.dumps(log, indent=1, ensure_ascii=False, default=float) + "\n", encoding="utf8")


def engine(a):
    import phi_depth

    mp = a.midas if a.midas and Path(a.midas).exists() else None
    return phi_depth.Engine(midas_path=mp)


def pack_person(eng, who: str, exprs: dict, out: Path, m: dict, size: int = 256, credit: str = CREDIT_DAV2, sources: dict | None = None) -> dict | None:
    """Accurate depth for one person's portraits. Neutral first: its depth window and
    light-side flip are shared by every expression, so the dots morph in place."""
    import phi_depth

    order = sorted(exprs, key=lambda e: (e != "neutral", EXPRESSIONS.index(e) if e in EXPRESSIONS else 9))
    win = flip = None
    entry = {"credit": credit, "expressions": {}}
    log = {}
    for expr in order:
        p = exprs[expr]
        print(f"  {who}/{expr}  <- {p}")
        try:
            rgba, dimg, w2, f2, info = eng.portrait(phi_depth.load_rgb(p), f"{who}/{expr}", out_size=size, window=win, flip=flip)
        except phi_depth.DepthRejected as e:
            print(f"    REJECTED, not packed: {e}")
            log[f"{who}/{expr}"] = {"packed": False, "reason": str(e), "reports": [r.as_dict() for r in getattr(eng, "last", [])]}
            continue
        win, flip = w2, f2
        save_pair(rgba, dimg, out / who / expr, lossless_depth=True)
        entry["expressions"][expr] = {"image": f"{who}/{expr}.webp", "depth": f"{who}/{expr}.depth.webp"}
        log[f"{who}/{expr}"] = {"packed": True, "source": str((sources or {}).get(expr, p)), **info}
    write_log(log)
    if not entry["expressions"]:
        return None
    entry["depth"] = win.depth_map()
    m["people"][who] = entry
    missing = [e for e in EXPRESSIONS if e not in entry["expressions"]]
    if missing:
        print(f"  {who}: still missing {', '.join(missing)} (the app falls back to neutral)")
    return entry


def cmd_portraits(a) -> None:
    out = Path(a.out)
    m = load_manifest(out)
    found = find_portraits(Path(a.src))
    if a.who:
        found = {k: v for k, v in found.items() if k == a.who}
    if not found:
        sys.exit(f"no portraits found under {a.src}")
    if a.depth == "dav2":
        eng = engine(a)
        for who, exprs in found.items():
            pack_person(eng, who, exprs, out, m, a.size)
        # several packs may run side by side (one person each): re-read the manifest and
        # write back only the people this run packed, so no run undoes another's
        with _manifest_lock(out):
            fresh = load_manifest(out)
            for who in found:
                if who in m["people"]:
                    fresh["people"][who] = m["people"][who]
            save_manifest(out, fresh)
        return
    depth = Depth(a.midas if a.depth == "midas" else "none")
    for who, exprs in found.items():
        entry = m["people"].setdefault(who, {"credit": CREDIT, "depth": {"offset": 0.6, "scale": 0.9}, "expressions": {}})
        for expr, p in exprs.items():
            im = square_crop(Image.open(p), a.crop).convert("RGB").resize((a.size, a.size), Image.LANCZOS)
            d = normalise(depth.raw(im))
            al = matte(im, d)
            rgba, dimg = to_pack_images(im, d, al)
            save_pair(rgba, dimg, out / who / expr)
            entry["expressions"][expr] = {"image": f"{who}/{expr}.webp", "depth": f"{who}/{expr}.depth.webp"}
            print(f"  {who}/{expr}  <- {p}")
        missing = [e for e in EXPRESSIONS if e not in entry["expressions"]]
        if missing:
            print(f"  {who}: still missing {', '.join(missing)} (the app falls back to neutral)")
    save_manifest(out, m)


def extract_frames(video: Path, fps: float, tmp: Path) -> list[Path]:
    if not shutil.which("ffmpeg"):
        sys.exit("ffmpeg is not on PATH (https://ffmpeg.org). Or cut the frames yourself and use --frames DIR")
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", str(video), "-vf", f"fps={fps}", str(tmp / "f%04d.png")], check=True)
    return sorted(tmp.glob("f*.png"))


def atlas_grid(n: int, tile: tuple[int, int], max_side: int = 4096) -> tuple[int, int]:
    tw, th = tile
    cols = max(1, min(max_side // tw, math.ceil(math.sqrt(n * th / tw))))
    rows = math.ceil(n / cols)
    if rows * th > max_side:
        raise SystemExit(f"{n} frames of {tw}x{th} do not fit a {max_side}px atlas: lower --fps, --tile or trim the clip")
    return cols, rows


def cmd_sequence(a) -> None:
    out = Path(a.out)
    depth = Depth(a.midas)
    with tempfile.TemporaryDirectory() as td:
        if a.video:
            frames = extract_frames(Path(a.video), a.fps, Path(td))
        elif a.frames:
            frames = sorted(p for p in Path(a.frames).iterdir() if p.suffix.lower() in IMG_EXT)
        else:
            sys.exit("give --video CLIP or --frames DIR")
        if a.max_frames and len(frames) > a.max_frames:
            frames = frames[: a.max_frames]
        if not frames:
            sys.exit("no frames")
        tile = (a.tile, a.tile)
        ims = [square_crop(Image.open(p), a.crop).convert("RGB").resize(tile, Image.LANCZOS) for p in frames]
    raws = [depth.raw(im) for im in ims]
    # one normalisation for the whole clip, then a little temporal smoothing,
    # so the depth does not flicker from still to still
    lo = float(np.percentile(np.stack(raws), 2))
    hi = float(np.percentile(np.stack(raws), 98))
    ds: list[np.ndarray] = []
    prev = None
    for r in raws:
        d = normalise(r, lo, hi)
        if prev is not None:
            d = 0.65 * d + 0.35 * prev
        ds.append(d)
        prev = d
    n = len(ims)
    cols, rows = atlas_grid(n, tile)
    A = Image.new("RGBA", (cols * tile[0], rows * tile[1]), (0, 0, 0, 0))
    D = Image.new("L", A.size, 0)
    for i, (im, d) in enumerate(zip(ims, ds)):
        rgba, dimg = to_pack_images(im, d, matte(im, d) if a.matte else None)
        x, y = (i % cols) * tile[0], (i // cols) * tile[1]
        A.paste(rgba, (x, y))
        D.paste(dimg, (x, y))
    save_pair(A, D, out / "seq" / a.name)
    m = load_manifest(out)
    m["sequences"][a.name] = {
        "image": f"seq/{a.name}.webp",
        "depth": f"seq/{a.name}.depth.webp",
        "credit": CREDIT,
        "who": a.who,
        "fps": a.fps,
        "frames": n,
        "cols": cols,
        "rows": rows,
        "tile": list(tile),
        "depth_map": {"offset": 0.6, "scale": 0.9},
        "key_frame": a.key_frame if a.key_frame is not None else int(n * 0.6),
        "linger": a.linger,
        "end_fade": a.end_fade,
    }
    save_manifest(out, m)
    size = sum((out / "seq" / f).stat().st_size for f in (f"{a.name}.webp", f"{a.name}.depth.webp"))
    print(f"  seq/{a.name}: {n} stills at {a.fps}/s, atlas {cols}x{rows}, {size / 1e6:.2f} MB")


def pack_still(eng, kind: str, id_: str, src, out: Path, m: dict, size=None, credit: str = CREDIT_DAV2, extent: float = 0.6, crop_x: float = 0.5, crop_y: float = 0.5, source=None) -> bool:
    """Accurate depth for one object (cut out, centred) or scene (16:10, no matte)."""
    import phi_depth

    print(f"  {kind}/{id_}  <- {src}")
    rgb = phi_depth.load_rgb(src)
    try:
        if kind == "scenes":
            w, h = size or (384, 240)
            rgba, dimg, dm, info = eng.scene(rgb, f"{kind}/{id_}", (w, h), crop_x=crop_x, crop_y=crop_y)
        else:
            w = h = size or 256
            rgba, dimg, dm, info = eng.object(rgb, f"{kind}/{id_}", extent_ratio=extent, out_size=w)
    except phi_depth.DepthRejected as e:
        print(f"    REJECTED, not packed: {e}")
        write_log({f"{kind}/{id_}": {"packed": False, "reason": str(e), "reports": [r.as_dict() for r in getattr(eng, "last", [])]}})
        return False
    save_pair(rgba, dimg, out / kind / id_, lossless_depth=True)
    m[kind][id_] = {"image": f"{kind}/{id_}.webp", "depth": f"{kind}/{id_}.depth.webp", "credit": credit, "size": [w, h], "depth_map": dm}
    write_log({f"{kind}/{id_}": {"packed": True, "source": str(source or src), "depth_map": dm, **info}})
    return True


def cmd_still(a) -> None:
    out = Path(a.out)
    if "x" in str(a.size):
        w, h = [int(v) for v in str(a.size).split("x")]
    else:
        w = h = int(a.size)
    if a.depth == "dav2":
        m = load_manifest(out)
        size = (w, h) if a.kind == "scenes" else w
        if pack_still(engine(a), a.kind, a.id, a.src, out, m, size, extent=a.extent):
            save_manifest(out, m)
        return
    depth = Depth(a.midas if a.depth == "midas" else "none")
    im = Image.open(a.src).convert("RGB")
    if w == h:
        im = square_crop(im, a.crop)
    im = im.resize((w, h), Image.LANCZOS)
    d = normalise(depth.raw(im))
    al = matte(im, d) if a.kind == "objects" else None
    rgba, dimg = to_pack_images(im, d, al)
    save_pair(rgba, dimg, out / a.kind / a.id)
    m = load_manifest(out)
    m[a.kind][a.id] = {"image": f"{a.kind}/{a.id}.webp", "depth": f"{a.kind}/{a.id}.depth.webp", "credit": CREDIT, "size": [w, h], "depth_map": {"offset": 0.5 if a.kind == "scenes" else 0.6, "scale": 1.2 if a.kind == "scenes" else 0.9}}
    save_manifest(out, m)


def cmd_manifest(a) -> None:
    out = Path(a.out)
    m = load_manifest(out)
    for who_dir in sorted(p for p in out.iterdir() if p.is_dir() and p.name not in ("seq", "objects", "scenes")):
        ex = {}
        for e in EXPRESSIONS:
            if (who_dir / f"{e}.webp").exists() and (who_dir / f"{e}.depth.webp").exists():
                ex[e] = {"image": f"{who_dir.name}/{e}.webp", "depth": f"{who_dir.name}/{e}.depth.webp"}
        if ex:
            entry = m["people"].setdefault(who_dir.name, {"credit": CREDIT, "depth": {"offset": 0.6, "scale": 0.9}})
            entry["expressions"] = ex
    for kind in ("objects", "scenes"):
        d = out / kind
        if d.is_dir():
            for p in sorted(d.glob("*.webp")):
                if p.name.endswith(".depth.webp"):
                    continue
                if (d / f"{p.stem}.depth.webp").exists() and p.stem not in m[kind]:
                    with Image.open(p) as im:
                        m[kind][p.stem] = {"image": f"{kind}/{p.name}", "depth": f"{kind}/{p.stem}.depth.webp", "credit": CREDIT, "size": list(im.size)}
    # drop entries whose files are gone
    for who in list(m["people"]):
        exs = m["people"][who].get("expressions", {})
        for e in list(exs):
            if not (out / exs[e]["image"]).exists():
                del exs[e]
        if not exs:
            del m["people"][who]
    for kind in ("sequences", "objects", "scenes"):
        for k in list(m[kind]):
            if not (out / m[kind][k]["image"]).exists():
                del m[kind][k]
    save_manifest(out, m)


def cmd_check(a) -> None:
    out = Path(a.out)
    m = load_manifest(out)
    print(f"pack folder: {out}")
    for who in CAST:
        ex = m["people"].get(who, {}).get("expressions", {})
        have = [e for e in EXPRESSIONS if e in ex]
        print(f"  {who:5} {'portraits: ' + ', '.join(have) if have else 'code-drawn stand-in'}")
    for s in SEQUENCES:
        q = m["sequences"].get(s)
        print(f"  seq {s:9} {'%d stills at %s/s' % (q['frames'], q['fps']) if q else 'code-drawn stand-in'}")
    for kind, ids in (("objects", ["dish", "tuktuk", "temple", "banknote", "bottle", "ice", "stall"]), ("scenes", PLACES)):
        for i in ids:
            print(f"  {kind[:-1]:6} {i:9} {'pack' if i in m[kind] else 'code-drawn stand-in'}")
    total = sum(p.stat().st_size for p in out.rglob("*.webp")) if out.exists() else 0
    print(f"  total {total / 1e6:.1f} MB")


def seq_name(v: str) -> str:
    base, _, who = v.partition("-")
    if base not in SEQUENCES or (who and not who.isalpha()):
        raise argparse.ArgumentTypeError(f"use one of {', '.join(SEQUENCES)}, optionally -<who> (e.g. handover-lek)")
    return v.lower()


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description="Pack generated images and clips (with depth) for the Phi app.")
    ap.add_argument("--out", default=str(DEFAULT_OUT), help="pack folder (default app/public/packs)")
    sub = ap.add_subparsers(dest="cmd", required=True)

    def depth_arg(p):
        p.add_argument("--midas", default=str(ROOT / "models" / "model-small.onnx") if (ROOT / "models" / "model-small.onnx").exists() else str(ROOT / "pipeline" / "work" / "models" / "midas-small.onnx"), help="MiDaS ONNX model (the midas mode, and the fallback of dav2), or 'none' for a rough test depth")
        p.add_argument("--crop", default=None, help="x,y,w,h as fractions of the image (default: square, top for portraits)")

    def mode_arg(p):
        p.add_argument("--depth", choices=["dav2", "midas", "none"], default="dav2", help="dav2: accurate (Depth Anything V2 + calibration + checks, MiDaS fallback); midas: the old path; none: test depth")

    p = sub.add_parser("portraits")
    mode_arg(p)
    p.add_argument("--src", required=True)
    p.add_argument("--who", default=None)
    p.add_argument("--size", type=int, default=256)
    depth_arg(p)
    p.set_defaults(fn=cmd_portraits)

    p = sub.add_parser("sequence")
    p.add_argument("--name", required=True, type=seq_name, help="palm, wai, handover, glance or walkaway; add -<who> for a person's own take, e.g. handover-lek")
    p.add_argument("--who", default=None)
    p.add_argument("--video", default=None)
    p.add_argument("--frames", default=None)
    p.add_argument("--fps", type=float, default=10)
    p.add_argument("--tile", type=int, default=192)
    p.add_argument("--max-frames", type=int, default=120)
    p.add_argument("--key-frame", type=int, default=None)
    p.add_argument("--linger", choices=["near"], default=None, help="'near': the nearest dots (a hand on the glass) fade last")
    p.add_argument("--end-fade", type=float, default=0.6)
    p.add_argument("--matte", action=argparse.BooleanOptionalAction, default=True)
    depth_arg(p)
    p.set_defaults(fn=cmd_sequence)

    p = sub.add_parser("still")
    mode_arg(p)
    p.add_argument("--extent", type=float, default=0.6, help="objects, dav2: visible depth extent / width (shape prior, e.g. bottle 0.5, tuk-tuk 0.8)")
    p.add_argument("--kind", required=True, choices=["objects", "scenes"])
    p.add_argument("--id", required=True)
    p.add_argument("--src", required=True)
    p.add_argument("--size", default="256")
    depth_arg(p)
    p.set_defaults(fn=cmd_still)

    sub.add_parser("manifest").set_defaults(fn=cmd_manifest)
    sub.add_parser("check").set_defaults(fn=cmd_check)
    a = ap.parse_args(argv)
    a.fn(a)


if __name__ == "__main__":
    main()
