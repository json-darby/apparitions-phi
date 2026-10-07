"""
Accurate depth for Phi packs (called by pack_portraits.py --depth dav2, and by filler_packs.py).

Free, open models only, all run on CPU from the pipeline venv:
  - Depth Anything V2 Small (Apache-2.0)       depth-anything/Depth-Anything-V2-Small-hf
  - BiRefNet / BiRefNet-portrait (MIT)          ZhengPeng7/BiRefNet, ZhengPeng7/BiRefNet-portrait
  - MediaPipe Face Landmarker + canonical face model (Apache-2.0, Google)
  - MiDaS v2.1 small (MIT), only as a fallback when Depth Anything fails the checks
Weights are cached under pipeline/work/models/ (git-ignored), never in the app.

What the renderer does with depth (app/src/anim/gl/glsl.ts CLOUD_VS)
  A dot at grid position g (x in [-asp, asp], y in [-1, 1]) gets
      z = (d - offset) * scale            d = the depth texel 0..1 (white = near)
  and is projected by a pinhole camera at z = 3.6:  screen ~ g * 3.6 / (3.6 - z).

So, for a point that the photo shows at u and that really lies at distance Z:
  * z must be linear in metric depth:  z = (Z_pivot - Z) / L,  with L = Z_pivot / 3.6
    (L = mm per grid unit; Z_pivot = the depth that sits at z = 0, the turn pivot).
    d is therefore stored linear in Z (not in disparity), and the manifest's
    offset/scale are computed from the encoding window, not guessed.
  * the dot must sit at g = u * Z / Z_pivot (inverse perspective), otherwise the
    renderer's own perspective is applied a second time (near parts swell). Every
    map is pre-warped with that inverse, so at rest the cloud reproduces the photo
    exactly and when it turns it moves like the real 3D shape.
  This assumes the photo was taken with the renderer's field of view (31 degrees
  vertical); the at-rest view is exact regardless, only the turn depends on it.

Depth Anything gives affine-invariant disparity: 1/Z = s * D + t, s and t unknown.
Inverting and normalising D (the old MiDaS path) silently picks some t, which
decides how deep the face is. Here s and t are solved for:
  * portraits: 478 face landmarks; the metric MediaPipe canonical face is posed
    onto them with PnP (renderer intrinsics); s, t are fitted (IRLS, Huber in mm)
    so the depth map matches the posed template at every visible landmark.
  * objects: the median of the object sits at z = 0 and its visible depth extent
    equals a per-object shape prior (depth extent / width, e.g. a bottle 0.5).
  * scenes: the camera moves sideways along the street, and sideways parallax is
    proportional to disparity 1/Z, so z is made linear in true disparity:
    z = K (Z_p / Z - 1). The shift of D is fixed by a far-plane prior (the
    farthest 1% of the frame is FAR_RATIO times the pivot distance away).

Accuracy steps: 518 px pass (global shape) + 1022 px pass (detail) fused by
frequency, each with horizontal-flip test-time augmentation; confidence-weighted
guided filter against the RGB (edges follow hair and face, background never
bleeds in); BiRefNet matte refined with a guided filter; depth extended outward
past the matte so edge dots do not fall back; automatic sanity checks that reject
inverted, flat or noisy maps (logged), with MiDaS as the fallback.
"""

from __future__ import annotations

import hashlib
import json
import math
import os
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
MODELS = HERE / "work" / "models"
CACHE = HERE / "work" / "cache"
os.environ.setdefault("HF_HOME", str(MODELS / "hf"))
os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

CAM = 3.6  # renderer camera distance in grid units (half the frame height = 1 unit)
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


class DepthRejected(Exception):
    pass


def _cv2():
    import cv2

    return cv2


def _hf_load(cls, repo: str, **kw):
    try:
        return cls.from_pretrained(repo, local_files_only=True, **kw)
    except Exception:
        return cls.from_pretrained(repo, **kw)


def sha(*parts) -> str:
    h = hashlib.sha1()
    for p in parts:
        h.update(p if isinstance(p, bytes) else str(p).encode())
    return h.hexdigest()[:20]


# ================================================================ depth models

@dataclass
class Disp:
    """Relative disparity at image resolution (higher = nearer) + diagnostics."""

    d: np.ndarray
    unc: np.ndarray  # |f(x) - flip(f(flip x))|, same units as d
    model: str
    passes: list = field(default_factory=list)


class DepthAnythingV2:
    REPO = "depth-anything/Depth-Anything-V2-Small-hf"
    name = "Depth Anything V2 Small (Apache-2.0)"

    def __init__(self, lo: int = 518, hi: int = 1022):
        import torch
        from transformers import AutoModelForDepthEstimation

        torch.set_num_threads(int(os.environ.get("PHI_THREADS", "4")))  # modest: other jobs share this PC
        self.torch = torch
        self.m = _hf_load(AutoModelForDepthEstimation, self.REPO).eval()
        self.lo, self.hi = lo, hi

    def _run(self, rgb: np.ndarray, short: int) -> tuple[np.ndarray, np.ndarray, tuple[int, int]]:
        cv2 = _cv2()
        h, w = rgb.shape[:2]
        k = short / min(h, w)
        H, W = max(14, round(h * k / 14) * 14), max(14, round(w * k / 14) * 14)
        x = cv2.resize(rgb, (W, H), interpolation=cv2.INTER_CUBIC if k > 1 else cv2.INTER_AREA)
        x = (np.clip(x, 0, 1) - MEAN) / STD
        t = self.torch.from_numpy(np.ascontiguousarray(x.transpose(2, 0, 1)[None])).float()
        with self.torch.inference_mode():
            y = self.m(pixel_values=self.torch.cat([t, t.flip(-1)])).predicted_depth.float().numpy()
        a, b = y[0], y[1][:, ::-1]
        up = lambda z: cv2.resize(np.ascontiguousarray(z), (w, h), interpolation=cv2.INTER_CUBIC)
        return up(0.5 * (a + b)), up(np.abs(a - b)), (W, H)

    def predict(self, rgb: np.ndarray, weight: np.ndarray | None = None) -> Disp:
        cv2 = _cv2()
        h, w = rgb.shape[:2]
        lo, ulo, slo = self._run(rgb, self.lo)
        passes = [f"{slo[0]}x{slo[1]} + flip"]
        if min(h, w) < self.lo * 1.3:
            return Disp(lo, ulo, self.name, passes)
        hi, uhi, shi = self._run(rgb, min(self.hi, (min(h, w) // 14) * 14))
        passes.append(f"{shi[0]}x{shi[1]} + flip")
        # align the detail pass to the global pass (least squares, scale + shift)
        wt = np.ones_like(lo) if weight is None else np.clip(weight, 0, 1) + 1e-3
        A = np.stack([hi.ravel(), np.ones(hi.size)], 1) * np.sqrt(wt.ravel())[:, None]
        a, b = np.linalg.lstsq(A, lo.ravel() * np.sqrt(wt.ravel()), rcond=None)[0]
        hi = a * hi + b
        # low frequencies from the 518 pass, high frequencies from the detail pass
        sig = 1.6 * min(h, w) / self.lo
        g = lambda z: cv2.GaussianBlur(z, (0, 0), sig)
        d = g(lo) + (hi - g(hi))
        unc = np.maximum(ulo, np.abs(a) * uhi)
        return Disp(d.astype(np.float32), unc.astype(np.float32), self.name, passes)


class MidasSmall:
    """Fallback only. MiDaS v2.1 small ONNX (MIT), 256 px, flip TTA."""

    name = "MiDaS v2.1 small (MIT, fallback)"

    def __init__(self, path: Path | None = None):
        import onnxruntime as ort

        p = Path(path) if path else MODELS / "midas-small.onnx"
        if not p.exists():
            raise FileNotFoundError(f"{p} (https://github.com/isl-org/MiDaS/releases/download/v2_1/model-small.onnx)")
        self.s = ort.InferenceSession(str(p), providers=["CPUExecutionProvider"])
        self.inp = self.s.get_inputs()[0].name

    def predict(self, rgb: np.ndarray, weight=None) -> Disp:
        cv2 = _cv2()
        h, w = rgb.shape[:2]
        x = (cv2.resize(rgb, (256, 256), interpolation=cv2.INTER_AREA) - MEAN) / STD
        x = x.transpose(2, 0, 1)[None].astype(np.float32)
        a = np.squeeze(self.s.run(None, {self.inp: x})[0])
        b = np.squeeze(self.s.run(None, {self.inp: np.ascontiguousarray(x[..., ::-1])})[0])[:, ::-1]
        up = lambda z: cv2.resize(np.ascontiguousarray(z.astype(np.float32)), (w, h), interpolation=cv2.INTER_CUBIC)
        return Disp(up(0.5 * (a + b)), up(np.abs(a - b)), self.name, ["256x256 + flip"])


# ================================================================ matting

class Matter:
    """BiRefNet matte (MIT). 'portrait' for people, 'general' for objects. Cached."""

    REPOS = {"portrait": "ZhengPeng7/BiRefNet-portrait", "general": "ZhengPeng7/BiRefNet"}

    def __init__(self):
        self.models = {}

    def _model(self, kind: str):
        if kind not in self.models:
            import gc

            import torch

            self.models.clear()  # one BiRefNet at a time: this PC is short of memory
            gc.collect()
            from transformers import AutoModelForImageSegmentation

            self.models[kind] = _hf_load(AutoModelForImageSegmentation, self.REPOS[kind], trust_remote_code=True).float().eval()
        return self.models[kind]

    def alpha(self, rgb: np.ndarray, kind: str = "portrait") -> np.ndarray:
        cv2 = _cv2()
        h, w = rgb.shape[:2]
        key = sha(self.REPOS[kind], rgb.shape, (np.clip(rgb, 0, 1) * 255).astype(np.uint8).tobytes())
        cp = CACHE / "matte" / f"{key}.npy"
        if cp.exists():
            a = np.load(cp).astype(np.float32)
        else:
            import torch

            x = (cv2.resize(rgb, (1024, 1024), interpolation=cv2.INTER_AREA if min(h, w) > 1024 else cv2.INTER_CUBIC) - MEAN) / STD
            t = torch.from_numpy(np.ascontiguousarray(x.transpose(2, 0, 1)[None])).float()
            with torch.inference_mode():
                y = self._model(kind)(t)[-1].sigmoid()[0, 0].numpy()
            a = cv2.resize(y, (w, h), interpolation=cv2.INTER_LINEAR)
            cp.parent.mkdir(parents=True, exist_ok=True)
            np.save(cp, a.astype(np.float16))
        return refine_alpha(np.clip(a, 0, 1), rgb)


def refine_alpha(a: np.ndarray, rgb: np.ndarray) -> np.ndarray:
    """Edge refinement: guided filter of the matte against the photo (He et al.),
    only in the uncertain band, so hair strands follow the image and the solid core stays solid."""
    cv2 = _cv2()
    r = max(2, round(min(a.shape) / 340))
    g = cv2.ximgproc.guidedFilter(rgb.astype(np.float32), a.astype(np.float32), r, 1e-4)
    band = cv2.dilate(((a > 0.02) & (a < 0.98)).astype(np.uint8), np.ones((2 * r + 1, 2 * r + 1), np.uint8)) > 0
    out = np.where(band, np.clip(g, 0, 1), a)
    return out.astype(np.float32)


# ================================================================ filters

def weighted_guided(z: np.ndarray, rgb: np.ndarray, w: np.ndarray, r: int, eps: float) -> np.ndarray:
    """Confidence-weighted guided filter (normalised convolution): only pixels with
    weight contribute, so background depth never bleeds into the subject's edge."""
    cv2 = _cv2()
    g = rgb.astype(np.float32)
    num = cv2.ximgproc.guidedFilter(g, (z * w).astype(np.float32), r, eps)
    den = cv2.ximgproc.guidedFilter(g, w.astype(np.float32), r, eps)
    out = np.where(den > 0.05, num / np.maximum(den, 1e-6), z)
    return out.astype(np.float32)


def push_pull(z: np.ndarray, w: np.ndarray) -> np.ndarray:
    """Fill where w ~ 0 from the surrounding weighted values (pyramid push-pull)."""
    cv2 = _cv2()
    levels = []
    zc, wc = (z * w).astype(np.float32), w.astype(np.float32)
    while min(zc.shape) > 4:
        levels.append((zc, wc))
        zc = cv2.resize(zc, (max(1, zc.shape[1] // 2), max(1, zc.shape[0] // 2)), interpolation=cv2.INTER_AREA)
        wc = cv2.resize(wc, (max(1, wc.shape[1] // 2), max(1, wc.shape[0] // 2)), interpolation=cv2.INTER_AREA)
    est = zc / np.maximum(wc, 1e-6)
    for zl, wl in reversed(levels):
        up = cv2.resize(est, (zl.shape[1], zl.shape[0]), interpolation=cv2.INTER_LINEAR)
        k = np.clip(wl * 4, 0, 1)
        est = k * (zl / np.maximum(wl, 1e-6)) + (1 - k) * up
    return np.where(w > 0.999, z, est).astype(np.float32)


def extend_nearest(z: np.ndarray, inside: np.ndarray) -> np.ndarray:
    """Outside `inside`, take the value of the nearest inside pixel (continuous at the edge)."""
    cv2 = _cv2()
    src = (~inside).astype(np.uint8)
    _, lab = cv2.distanceTransformWithLabels(src, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(src == 0)
    lut_y = np.zeros(lab.max() + 1, np.int64)
    lut_x = np.zeros(lab.max() + 1, np.int64)
    lut_y[lab[ys, xs]] = ys
    lut_x[lab[ys, xs]] = xs
    out = z[lut_y[lab], lut_x[lab]]
    return np.where(inside, z, out).astype(np.float32)


def bilinear(img: np.ndarray, pts: np.ndarray) -> np.ndarray:
    cv2 = _cv2()
    m = pts.astype(np.float32).reshape(-1, 1, 2)
    return cv2.remap(img.astype(np.float32), m[..., 0], m[..., 1], cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).ravel()


def prewarp(maps: list[np.ndarray], z_render: np.ndarray, iters: int = 0) -> list[np.ndarray]:
    """Inverse of the renderer's perspective, as a forward splat with a z-buffer.
    The photo pixel at u (depth z in grid units) belongs at grid g = u (3.6 - z) / 3.6,
    because the renderer projects g to g * 3.6 / (3.6 - z). Every photo pixel is
    splatted to its g; where several land on one texel the nearest wins (occlusion);
    texels nothing lands on (disocclusions beside a near edge, e.g. next to the jaw)
    are filled from their hit neighbours. (A fixed-point inverse warp is ambiguous at
    depth steps and smears the near surface into the gap.) Returns the warped maps and
    (last) the validity mask."""
    cv2 = _cv2()
    h, w = z_render.shape
    cy, cx = (h - 1) / 2, (w - 1) / 2
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    f = np.maximum(CAM - z_render, 0.5) / CAM
    gx = np.rint(cx + (xx - cx) * f).astype(np.int64)
    gy = np.rint(cy + (yy - cy) * f).astype(np.int64)
    ok = ((gx >= 0) & (gx < w) & (gy >= 0) & (gy < h)).ravel()
    tgt = (gy * w + gx).ravel()[ok]
    order = np.argsort(z_render.ravel()[ok], kind="stable")  # far first, nearest written last
    tgt = tgt[order]
    hit = np.zeros(h * w, np.float32)
    hit[tgt] = 1.0
    hit = hit.reshape(h, w)
    outs = []
    for m in maps:
        o = np.zeros(h * w, np.float32)
        o[tgt] = m.astype(np.float32).ravel()[ok][order]
        o = o.reshape(h, w)
        outs.append(push_pull(o, hit))
    # valid where the photo reaches: hits, plus holes enclosed by hits
    valid = (cv2.morphologyEx(hit, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8)) > 0.5).astype(np.float32)
    return outs + [valid]


# ================================================================ faces

FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
NOSE_TIP = 1
CHEEKS = [50, 280, 205, 425]       # cheek centres (left, right pairs)
SIDES = [234, 454, 93, 323]        # face contour by the ears
LIPS = set([0, 13, 14, 17, 37, 39, 40, 61, 78, 80, 81, 82, 84, 87, 88, 91, 95, 146, 178, 181, 185, 191, 267, 269, 270, 291, 308, 310, 311, 312, 314, 317, 318, 321, 324, 375, 402, 405, 409, 415])
IRIS_R, IRIS_L = 468, 473          # subject's right / left iris centres
# low-frequency anchors for the template correction: outline, cheeks, temples,
# forehead, chin. Not the nose, eyes or lips: those stay the person's own (from the model).
NOSE_LINE = [1, 4, 5, 195, 197, 6, 168]
SHAPE_ANCHORS = sorted(set(FACE_OVAL + [50, 280, 205, 425, 117, 346, 123, 352, 187, 411, 147, 376, 10, 151, 9, 108, 337, 69, 299, 152, 175, 199, 54, 284, 21, 251, 162, 389, 227, 447, 116, 345]))


class Face:
    """MediaPipe Face Landmarker (478 points) + the metric canonical face (cm)."""

    def __init__(self):
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        self.mp = mp
        self.lm = vision.FaceLandmarker.create_from_options(
            vision.FaceLandmarkerOptions(
                base_options=BaseOptions(model_asset_path=str(MODELS / "face_landmarker.task")),
                num_faces=1,
                output_facial_transformation_matrixes=True,
                min_face_detection_confidence=0.3,
            )
        )
        v, f = [], []
        for line in (MODELS / "canonical_face_model.obj").read_text().splitlines():
            if line.startswith("v "):
                v.append([float(q) for q in line.split()[1:4]])
            elif line.startswith("f "):
                f.append([int(q.split("/")[0]) - 1 for q in line.split()[1:4]])
        # canonical: cm, x to the subject's left (image right), y up, z toward the viewer
        # -> OpenCV camera frame in mm: x right, y down, z away from the camera
        self.obj = np.array(v, np.float64)[:468] * 10.0 * np.array([1, -1, -1])
        self.faces = np.array(f)
        n = np.zeros_like(self.obj)
        a, b, c = self.obj[self.faces[:, 0]], self.obj[self.faces[:, 1]], self.obj[self.faces[:, 2]]
        fn = np.cross(b - a, c - a)
        for k in range(3):
            np.add.at(n, self.faces[:, k], fn)
        n /= np.linalg.norm(n, axis=1, keepdims=True) + 1e-9
        # orient normals toward the camera for the frontal template (nose tip faces -z)
        if n[NOSE_TIP, 2] > 0:
            n = -n
        self.normals = n

    def landmarks(self, rgb: np.ndarray, pad: bool = True):
        """(478, 2) pixel coords and the 4x4 head pose, or (None, None). A face that
        fills or overflows the frame is retried on a black-padded copy."""
        h, w = rgb.shape[:2]
        im = self.mp.Image(image_format=self.mp.ImageFormat.SRGB, data=np.ascontiguousarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8)))
        r = self.lm.detect(im)
        if not r.face_landmarks:
            if not pad:
                return None, None
            k = round(0.35 * max(h, w))
            p, M = self.landmarks(_cv2().copyMakeBorder(np.ascontiguousarray(rgb), k, k, k, k, _cv2().BORDER_CONSTANT, value=(0, 0, 0)), pad=False)
            return (None, None) if p is None else (p - k, M)
        p = np.array([[q.x * w, q.y * h] for q in r.face_landmarks[0]], np.float64)
        M = np.array(r.facial_transformation_matrixes[0]) if r.facial_transformation_matrixes else None
        return p, M

    def pose(self, pts: np.ndarray, w: int, h: int):
        """PnP of the canonical face onto the landmarks with the renderer's intrinsics.
        Returns (Z per landmark in mm, facing per landmark, reprojection rms px, R, t)."""
        cv2 = _cv2()
        f = CAM * (h / 2)  # renderer: half the frame height at distance 3.6
        K = np.array([[f, 0, (w - 1) / 2], [0, f, (h - 1) / 2], [0, 0, 1]], np.float64)
        img = pts[:468].astype(np.float64)
        ok, rv, tv = cv2.solvePnP(self.obj, img, K, None, flags=cv2.SOLVEPNP_SQPNP)
        ok, rv, tv = cv2.solvePnP(self.obj, img, K, None, rv, tv, useExtrinsicGuess=True, flags=cv2.SOLVEPNP_ITERATIVE)
        R = cv2.Rodrigues(rv)[0]
        P = (R @ self.obj.T).T + tv.ravel()
        proj = cv2.projectPoints(self.obj, rv, tv, K, None)[0].reshape(-1, 2)
        rms = float(np.sqrt(np.mean(np.sum((proj - img) ** 2, 1))))
        n = (R @ self.normals.T).T
        view = -P / np.linalg.norm(P, axis=1, keepdims=True)
        facing = np.sum(n * view, 1)
        return P[:, 2], facing, rms, R, tv.ravel()


def fit_inverse_affine(D: np.ndarray, Z: np.ndarray, w0: np.ndarray, delta: float = 6.0, iters: int = 30):
    """Solve 1/Z = s*D + t (IRLS, Huber on the residual in mm)."""
    w = w0.copy()
    s = t = 0.0
    for _ in range(iters):
        sw = np.sqrt(w)
        A = np.stack([D, np.ones_like(D)], 1) * sw[:, None]
        s, t = np.linalg.lstsq(A, (1.0 / Z) * sw, rcond=None)[0]
        pred = s * D + t
        Zp = np.where(pred > 1e-9, 1.0 / np.maximum(pred, 1e-9), 1e9)
        r = np.abs(Zp - Z)
        w = w0 * np.where(r <= delta, 1.0, delta / np.maximum(r, 1e-9))
    pred = s * D + t
    Zp = np.where(pred > 1e-9, 1.0 / np.maximum(pred, 1e-9), np.nan)
    return float(s), float(t), Zp


# ================================================================ checks

@dataclass
class Report:
    kind: str
    name: str
    model: str = ""
    passes: list = field(default_factory=list)
    checks: dict = field(default_factory=dict)
    values: dict = field(default_factory=dict)
    ok: bool = True
    fallback: str | None = None

    def check(self, key: str, ok: bool, detail: str):
        self.checks[key] = {"ok": bool(ok), "detail": detail}
        if not ok:
            self.ok = False

    def line(self) -> str:
        bad = [k for k, v in self.checks.items() if not v["ok"]]
        return f"{self.kind}/{self.name}: {'PASS' if self.ok else 'REJECT ' + ','.join(bad)} [{self.model}]"

    def as_dict(self):
        return {"kind": self.kind, "name": self.name, "model": self.model, "passes": self.passes, "ok": self.ok, "fallback": self.fallback, "checks": self.checks, "values": self.values}


def noise_check(rep: Report, disp: Disp, region: np.ndarray, Zmm: np.ndarray | None, limit_unc=0.08, limit_hf_mm=4.0):
    cv2 = _cv2()
    m = region > 0.5
    if m.sum() < 50:
        rep.check("noise", False, "region too small")
        return
    rng = np.percentile(disp.d[m], 97) - np.percentile(disp.d[m], 3)
    u = float(np.mean(disp.unc[m]) / max(rng, 1e-6))
    rep.values["flip_disagreement"] = round(u, 4)
    msg = f"flip-TTA disagreement {u:.3f} of the range (limit {limit_unc})"
    ok = u <= limit_unc
    if Zmm is not None:
        sig = max(1.0, min(Zmm.shape) / 160)
        hf = Zmm - cv2.GaussianBlur(Zmm, (0, 0), sig)
        e = float(np.std(hf[cv2.erode(m.astype(np.uint8), np.ones((7, 7), np.uint8)) > 0]))
        rep.values["hf_noise_mm"] = round(e, 2)
        msg += f"; high-frequency depth noise {e:.2f} mm (limit {limit_hf_mm})"
        ok = ok and e <= limit_hf_mm
    rep.check("noise", ok, msg)


# ================================================================ portrait depth

@dataclass
class PortraitDepth:
    Z: np.ndarray        # calibrated metric depth (mm), extended past the matte
    eye_mm: float        # PnP eye-plane distance
    rep: Report


def portrait_depth(rgb: np.ndarray, alpha: np.ndarray, pts: np.ndarray, face: Face, model, name: str) -> PortraitDepth:
    """Calibrated metric depth for an aligned portrait (see module docstring)."""
    cv2 = _cv2()
    h, w = alpha.shape
    rep = Report("portrait", name)
    disp = model.predict(rgb, weight=alpha)
    rep.model, rep.passes = disp.model, disp.passes
    # edge-aware refinement in disparity, weighted by the matte (core pixels only)
    conf = np.clip((alpha - 0.5) / 0.45, 0, 1) ** 2
    r = max(3, round(min(h, w) / 170))
    D = weighted_guided(disp.d, rgb, conf, r, 2e-3)
    D = weighted_guided(D, rgb, conf, max(2, r // 2), 5e-4)

    Ztpl, facing, rms, R, tv = face.pose(pts, w, h)
    rep.values["pnp_rms_px"] = round(rms, 2)
    eye = float(np.mean(Ztpl[[33, 133, 362, 263]]))
    rep.values["eye_plane_mm"] = round(eye, 1)
    yaw = math.degrees(math.atan2(-R[2, 0], math.hypot(R[2, 1], R[2, 2])))
    rep.values["head_yaw_deg"] = round(yaw, 1)

    idx = np.arange(468)
    a_at = bilinear(alpha, pts[:468])
    w0 = ((facing > 0.25) & (a_at > 0.9)).astype(np.float64)
    w0[list(LIPS)] *= 0.3  # expressions move the lips away from the neutral template
    w0[FACE_OVAL] *= 0.5   # silhouette points: depth there changes fastest
    Dl = bilinear(cv2.GaussianBlur(D, (0, 0), max(1.0, r / 2)), pts[:468]).astype(np.float64)
    keep = w0 > 0
    rep.values["landmarks_used"] = int(keep.sum())
    if keep.sum() < 60:
        rep.check("landmarks", False, f"only {keep.sum()} visible landmarks")
        return PortraitDepth(np.zeros_like(D), eye, rep)
    s, t, Zfit = fit_inverse_affine(Dl[keep], Ztpl[keep], w0[keep])
    rep.values["s"], rep.values["t"] = s, t
    res = Zfit - Ztpl[keep]
    fit_rms = float(np.sqrt(np.nanmean(res**2)))
    corr = float(np.corrcoef(np.nan_to_num(Zfit, nan=0), Ztpl[keep])[0, 1]) if np.all(np.isfinite(Zfit)) else -1.0
    rep.values["fit_rms_mm"], rep.values["fit_corr"] = round(fit_rms, 2), round(corr, 3)
    rep.check("inverted", s > 0, f"slope s={s:.3g} (must be > 0: higher disparity = nearer)")
    rep.check("shape", corr >= 0.6 and fit_rms <= 12, f"agreement with the posed face template: r={corr:.2f} (>= 0.6), rms {fit_rms:.1f} mm (<= 12)")
    if s <= 0:
        return PortraitDepth(np.zeros_like(D), eye, rep)

    # metric depth everywhere; cap where the affine model runs out (far background)
    zmax = eye + 600
    inv = s * D + t
    Z = np.where(inv > 1.0 / zmax, 1.0 / np.maximum(inv, 1.0 / zmax), zmax).astype(np.float32)

    # plausibility on the face: nose nearer than cheeks nearer than the sides (by
    # the ears); the background farthest; relief close to the posed template's
    Zs = cv2.GaussianBlur(Z, (0, 0), max(1.0, r / 2))
    zn = float(bilinear(Zs, pts[[NOSE_TIP]])[0])
    ck = [i for i in CHEEKS if facing[i] > 0.15]
    sd = [i for i in SIDES if facing[i] > -0.35 and a_at[i] > 0.5]  # silhouette points face sideways
    zc = float(np.mean(bilinear(Zs, pts[ck]))) if ck else float("nan")
    zs = float(np.mean(bilinear(Zs, pts[sd]))) if sd else float("nan")
    t_rel = float(np.mean(Ztpl[sd]) - Ztpl[NOSE_TIP]) if sd else float("nan")
    rel = zs - zn
    rep.values.update({"nose_mm": round(zn, 1), "cheeks_mm": round(zc, 1), "sides_mm": round(zs, 1), "relief_mm": round(rel, 1), "template_relief_mm": round(t_rel, 1)})
    rep.check("order", zn < zc < zs, f"nose {zn:.0f} < cheeks {zc:.0f} < sides {zs:.0f} mm")
    ratio = rel / t_rel if t_rel and t_rel > 0 else float("nan")
    rep.values["relief_vs_template"] = round(ratio, 3)
    # monocular nets compress the periphery (bas-relief); the native map must still
    # have real relief (>= 0.35 of anatomy) - the template corrects the rest below
    # a turned head is flattened harder (the far cheek runs toward the silhouette,
    # where the net's bas-relief is strongest), so the floor drops with the yaw; the
    # template correction and the corrected-order check below still have to hold
    lo = 0.35 if abs(yaw) < 12 else 0.2
    rep.check("relief", lo <= ratio <= 1.8, f"native nose-to-sides relief {rel:.0f} mm = {ratio:.2f} x the posed template's {t_rel:.0f} mm ({lo}..1.8 at yaw {yaw:.0f}; flat or stretched otherwise)")
    bg = alpha < 0.05
    fg = alpha > 0.95
    if bg.sum() > 0.02 * alpha.size:
        db, df = float(np.median(disp.d[bg])), float(np.median(disp.d[fg]))
        rep.check("background", db < df, f"background disparity {db:.3g} < subject {df:.3g} (background farthest)")
    else:
        rep.checks["background"] = {"ok": True, "detail": "no background visible (skipped)"}
    hull = np.zeros((h, w), np.uint8)
    cv2.fillConvexPoly(hull, cv2.convexHull(pts[FACE_OVAL].astype(np.int32)), 1)
    inv_raw = s * disp.d + t
    Z_raw = np.where(inv_raw > 1.0 / zmax, 1.0 / np.maximum(inv_raw, 1.0 / zmax), zmax).astype(np.float32)
    noise_check(rep, disp, hull.astype(np.float32) * (alpha > 0.9), Z_raw, limit_unc=0.2)
    if not rep.ok:
        return PortraitDepth(Z, eye, rep)

    # template-guided low-frequency correction: a smoothed thin-plate spline through
    # the residuals (posed metric template - map) at visible landmarks, added in mm.
    # The model keeps the detail (nose, eye sockets, lips, hair); anatomy fixes the
    # large-scale shape. Outside the face the correction continues smoothly.
    from scipy.interpolate import RBFInterpolator

    sel = np.zeros(468, bool)
    if abs(yaw) < 12:
        sel[[i for i in SHAPE_ANCHORS if facing[i] > -0.35 and a_at[i] > 0.9]] = True
    else:
        # turned head: the far side of the outline is near the silhouette, where the
        # map is flattest, and the spline overshoots between it and the nose; anchor on
        # landmarks that face the camera, and pin the nose line itself
        sel[[i for i in SHAPE_ANCHORS + NOSE_LINE if facing[i] > 0.1 and a_at[i] > 0.9]] = True
    corr_pts = pts[:468][sel] / np.array([w, h])
    resid = Ztpl[sel] - bilinear(Zs, pts[:468][sel])
    rep.values["correction_mm"] = {"mean": round(float(resid.mean()), 1), "p5": round(float(np.percentile(resid, 5)), 1), "p95": round(float(np.percentile(resid, 95)), 1)}
    rep.check("correction", float(np.percentile(np.abs(resid - np.median(resid)), 95)) <= 70, "template correction stays within 70 mm (map not wildly off)")
    rbf = RBFInterpolator(corr_pts, resid, kernel="thin_plate_spline", smoothing=1e-5)
    gs = 128
    gy, gx = np.mgrid[0:gs, 0:gs].astype(np.float64)
    field = rbf(np.stack([(gx.ravel() + 0.5) / gs, (gy.ravel() + 0.5) / gs], 1)).reshape(gs, gs).astype(np.float32)
    field = cv2.resize(field, (w, h), interpolation=cv2.INTER_CUBIC)
    # the spline interpolates inside the face outline only (it extrapolates steeply
    # outside); beyond the outline the boundary correction is carried outward
    # (hair, ears, neck, shoulders), then the field is smoothed so it has no kink
    # outward continuation from a thin ring on the outline only (smooth, membrane-like;
    # interior values do not leak out and there are no nearest-pixel rays)
    ring = (hull - cv2.erode(hull, np.ones((7, 7), np.uint8))).astype(np.float32)
    ext = push_pull(field, ring)
    field = np.where(hull > 0, field, ext).astype(np.float32)
    # the correction is low-frequency by construction (anchors ~ 1/20 of the frame
    # apart); smoothing at that scale removes the step where the in-oval spline meets
    # the outward continuation (a step there folds the inverse-perspective warp)
    field = cv2.GaussianBlur(field, (0, 0), w / 45)
    Z = (Z + field).astype(np.float32)
    Zs = cv2.GaussianBlur(Z, (0, 0), max(1.0, r / 2))
    zn2, zc2 = float(bilinear(Zs, pts[[NOSE_TIP]])[0]), float(np.mean(bilinear(Zs, pts[ck]))) if ck else float("nan")
    zs2 = float(np.mean(bilinear(Zs, pts[sd]))) if sd else float("nan")
    after = Ztpl[sel] - bilinear(Zs, pts[:468][sel])
    rep.values["corrected"] = {"nose_mm": round(zn2, 1), "cheeks_mm": round(zc2, 1), "sides_mm": round(zs2, 1), "relief_mm": round(zs2 - zn2, 1), "rms_vs_template_mm": round(float(np.sqrt(np.mean(after**2))), 2)}
    rep.check("order_corrected", zn2 < zc2 < zs2, f"after correction: nose {zn2:.0f} < cheeks {zc2:.0f} < sides {zs2:.0f} mm")

    # extend the subject's depth outward past the matte (edge dots must not fall back)
    Z = push_pull(Z, (alpha > 0.6).astype(np.float32))
    return PortraitDepth(Z, eye, rep)


# ================================================================ object / scene depth

def object_depth(rgb, alpha, model, name, extent_ratio: float):
    """Z in grid units (frame half-height = 1, camera at 3.6), z = 0 at the object's median."""
    cv2 = _cv2()
    h, w = alpha.shape
    rep = Report("object", name)
    disp = model.predict(rgb, weight=alpha)
    rep.model, rep.passes = disp.model, disp.passes
    conf = np.clip((alpha - 0.5) / 0.45, 0, 1) ** 2
    r = max(3, round(min(h, w) / 170))
    D = weighted_guided(disp.d, rgb, conf, r, 2e-3)
    m = alpha > 0.6
    if m.sum() < 100:
        rep.check("matte", False, "object matte is empty")
        return None, rep
    ys, xs = np.nonzero(m)
    width_units = (np.percentile(xs, 99) - np.percentile(xs, 1)) / (h / 2)  # at z = 0
    E = extent_ratio * width_units  # visible depth extent, grid units
    Dm = D[m]
    d2, d50, d98 = (float(np.percentile(Dm, q)) for q in (2, 50, 98))
    rep.values.update({"width_units": round(float(width_units), 3), "extent_units": round(float(E), 3), "extent_ratio": extent_ratio})
    if d98 - d2 <= 1e-6:
        rep.check("flat", False, "no depth variation on the object")
        return None, rep
    Z0 = CAM

    def extent(s):
        t = 1 / Z0 - s * d50
        a, b = t + s * d2, t + s * d98
        if a <= 0:
            return float("inf")
        return 1 / a - 1 / b

    lo, hi = 0.0, 1.0
    while extent(hi) < E and hi < 1e6:
        hi *= 2
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        lo, hi = (mid, hi) if extent(mid) < E else (lo, mid)
    s = 0.5 * (lo + hi)
    t = 1 / Z0 - s * d50
    inv = s * D + t
    zcap = Z0 + 3 * E
    Z = np.where(inv > 1 / zcap, 1 / np.maximum(inv, 1 / zcap), zcap).astype(np.float32)
    rep.values.update({"s": s, "t": t})
    # surroundings: a ring around the object. Objects often rest on a surface whose
    # front edge is nearer than the object's back, so "background farther" is wrong
    # here; the object must stand out from (not sink into) its immediate surroundings.
    k = max(5, round(0.08 * w)) | 1
    ring = (cv2.dilate(m.astype(np.uint8), cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (k, k))) > 0) & (alpha < 0.05)
    if ring.sum() > 200:
        dr, df = float(np.median(disp.d[ring])), float(np.median(Dm))
        tol = 0.05 * (d98 - d2)
        rep.check("surroundings", df >= dr - tol, f"object disparity {df:.3g} >= surroundings {dr:.3g} (- {tol:.2g}): not sunk into its background")
    rel = (d98 - d2) / max(abs(d50), 1e-6)
    rep.values["relative_range"] = round(float(rel), 3)
    rep.check("flat", rel > 0.03, f"object disparity range {rel:.3f} of its level (> 0.03)")
    noise_check(rep, disp, m.astype(np.float32), None, limit_unc=0.1)
    Z = push_pull(Z, (alpha > 0.6).astype(np.float32))
    return Z, rep


FAR_RATIO = 8.0  # the farthest 1% of a street scene is this many times the pivot distance


def scene_depth(rgb, model, name, K: float = 0.5, q: float = 2.5):
    """Returns ratio = Z_p / Z (true-disparity ratio, 1 at the pivot) and the report."""
    cv2 = _cv2()
    h, w = rgb.shape[:2]
    rep = Report("scene", name)
    disp = model.predict(rgb)
    rep.model, rep.passes = disp.model, disp.passes
    r = max(3, round(min(h, w) / 200))
    D = weighted_guided(disp.d, rgb, np.ones((h, w), np.float32), r, 2e-3)
    d1 = float(np.percentile(D, 1))
    cy0, cy1, cx0, cx1 = h // 4, 3 * h // 4, w // 4, 3 * w // 4
    dp = float(np.median(D[cy0:cy1, cx0:cx1]))
    if dp <= d1:
        rep.check("flat", False, "no depth range")
        return None, rep
    dinf = (FAR_RATIO * d1 - dp) / (FAR_RATIO - 1)
    ratio = np.clip((D - dinf) / (dp - dinf), 0, None).astype(np.float32)
    rep.values.update({"d1": d1, "d_pivot": dp, "d_inf": dinf, "near_clip_ratio": q, "K": K})
    bottom = float(np.median(D[int(h * 0.85):, :]))
    top = float(np.median(D[: int(h * 0.15), w // 4: 3 * w // 4]))
    rep.check("orientation", bottom > top, f"ground at the bottom {bottom:.3g} nearer than the top centre {top:.3g}")
    rel = (np.percentile(D, 99) - d1) / max(abs(dp), 1e-6)
    rep.check("flat", rel > 0.1, f"scene disparity range {rel:.2f} of the pivot level (> 0.1)")
    noise_check(rep, disp, np.ones((h, w), np.float32), None, limit_unc=0.1)
    return ratio, rep


# ================================================================ framing, grade, encoding (pack level)

FRAME_IPD = 0.25      # interpupillary distance as a fraction of the frame width (demo 2: ~0.26)
FRAME_EYE_Y = 0.46    # eye line, fraction of the frame height from the top
WORK = 1024           # working resolution for portraits and objects


def load_rgb(path) -> np.ndarray:
    from PIL import Image, ImageOps

    with Image.open(path) as im:
        im = ImageOps.exif_transpose(im).convert("RGB")
        return np.asarray(im, np.float32) / 255.0


def feather(valid: np.ndarray, frac: float) -> np.ndarray:
    """Soft fade over `frac` of the frame inside the edge of the source photo, so a
    photo that does not fill the frame dissolves instead of ending in a hard line."""
    cv2 = _cv2()
    d = cv2.distanceTransform((valid > 0.99).astype(np.uint8), cv2.DIST_L2, 5)
    x = np.clip(d / max(1.0, frac * max(valid.shape)), 0, 1)
    return (x * x * (3 - 2 * x)).astype(np.float32)


def luma(rgb: np.ndarray) -> np.ndarray:
    return (0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]).astype(np.float32)


def align_portrait(src: np.ndarray, face: Face, size: int = WORK):
    """Similarity transform: eyes level, eye midpoint on a fixed point, IPD fixed
    (corrected for head yaw so a three-quarter view is not over-scaled)."""
    cv2 = _cv2()
    h, w = src.shape[:2]
    k0 = min(1.0, 1600 / max(h, w))
    small = cv2.resize(src, (round(w * k0), round(h * k0)), interpolation=cv2.INTER_AREA) if k0 < 1 else src
    pts, M = face.landmarks(small)
    if pts is None:
        # very tight crops (face filling the frame) defeat the detector: retry padded
        pad = round(0.35 * max(small.shape[:2]))
        padded = cv2.copyMakeBorder(small, pad, pad, pad, pad, cv2.BORDER_CONSTANT, value=(0, 0, 0))
        pts, M = face.landmarks(padded, pad=False)
        if pts is None:
            raise DepthRejected("no face found")
        pts = pts - pad
    pts = pts / k0
    er, el = pts[IRIS_R], pts[IRIS_L]
    left, right = (er, el) if er[0] < el[0] else (el, er)  # image left / right
    d = right - left
    ang = math.atan2(d[1], d[0])
    yaw = 0.0
    if M is not None:
        R = M[:3, :3] / np.linalg.norm(M[:3, 0])
        yaw = math.atan2(-R[2, 0], math.hypot(R[2, 1], R[2, 2]))
    ipd = float(np.hypot(*d)) / max(math.cos(yaw), 0.6)
    k = FRAME_IPD * size / ipd
    if k < 0.5:  # pre-shrink with area filtering so the warp does not alias
        f = min(1.0, 2 * k)
        src = cv2.resize(src, (round(w * f), round(h * f)), interpolation=cv2.INTER_AREA)
        pts, left, right, k = pts * f, left * f, right * f, k / f
    mid = (left + right) / 2
    c, s = math.cos(-ang) * k, math.sin(-ang) * k
    A = np.array([[c, -s, 0.0], [s, c, 0.0]])
    A[:, 2] = np.array([size * 0.5, size * FRAME_EYE_Y]) - A[:, :2] @ mid
    out = cv2.warpAffine(src, A, (size, size), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
    valid = cv2.warpAffine(np.ones(src.shape[:2], np.float32), A, (size, size), flags=cv2.INTER_LINEAR, borderValue=0)
    return np.clip(out, 0, 1), valid, {"source_ipd_px": round(ipd, 1), "scale": round(k, 3), "roll_deg": round(math.degrees(ang), 1), "yaw_deg": round(math.degrees(yaw), 1)}


def tone(Y: np.ndarray, region: np.ndarray, black_q: float, mid_q: float, white_q: float, mid_to: float, white_to: float) -> np.ndarray:
    """Matched grade: black point, mid and white of `region` go to fixed targets
    (a power curve through the three anchors), so every image has the same tonal shape."""
    v = Y[region > 0.5] if (region > 0.5).sum() > 50 else Y.ravel()
    b, m, wq = (float(np.percentile(v, q)) for q in (black_q, mid_q, white_q))
    x = np.clip((Y - b) / max(wq - b, 1e-4), 0, None)
    xm = np.clip((m - b) / max(wq - b, 1e-4), 1e-3, 0.999)
    g = math.log(mid_to / white_to) / math.log(xm)
    g = min(max(g, 0.35), 3.0)
    return np.clip(white_to * x**g, 0, 1).astype(np.float32)


def face_mask(shape, pts, ids=FACE_OVAL) -> np.ndarray:
    cv2 = _cv2()
    m = np.zeros(shape, np.uint8)
    cv2.fillConvexPoly(m, cv2.convexHull(pts[ids].astype(np.int32)), 1)
    return m > 0


def grade_portrait(rgb, alpha, pts) -> np.ndarray:
    """Low-key monochrome: face tones pinned to fixed anchors, then falling off into
    darkness away from the face like one soft key light (the renderer adds colour)."""
    h, w = alpha.shape
    Y = luma(rgb)
    skin = face_mask(alpha.shape, pts) & (alpha > 0.9)
    g = tone(Y, skin.astype(np.float32), 1, 50, 98, 0.56, 0.96)
    nose = pts[NOSE_TIP]
    ipd = FRAME_IPD * w
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    rr = ((xx - nose[0]) / (1.9 * ipd)) ** 2 + ((yy - (nose[1] - 0.3 * ipd)) / (2.3 * ipd)) ** 2
    fall = 0.3 + 0.7 * np.exp(-0.5 * np.maximum(rr - 0.5, 0))
    return np.clip(g * fall, 0, 1).astype(np.float32)


def key_side(rgb, alpha, pts) -> str:
    """Which half of the face (image left or right) the key light falls on."""
    Y = luma(rgb)
    face = face_mask(alpha.shape, pts) & (alpha > 0.9)
    cx = float(np.median(pts[[1, 4, 5, 195, 197, 6, 168, 8, 9, 151, 10, 152], 0]))
    xx = np.arange(alpha.shape[1])[None, :]
    a = float(np.median(Y[face & (xx < cx)]))
    b = float(np.median(Y[face & (xx >= cx)]))
    return "left" if a >= b else "right"


@dataclass
class Window:
    """Depth encoding window (shared by all expressions of a person)."""

    z_near: float
    z_far: float
    z_pivot: float

    @property
    def L(self):
        return self.z_pivot / CAM

    def depth_map(self):
        return {"offset": round((self.z_far - self.z_pivot) / (self.z_far - self.z_near), 5), "scale": round((self.z_far - self.z_near) / self.L, 5)}

    def encode(self, Z):
        return np.clip((self.z_far - Z) / (self.z_far - self.z_near), 0, 1)

    def z_render(self, Z):
        return ((self.z_pivot - Z) / self.L).astype(np.float32)

    @staticmethod
    def for_eye(eye_mm: float):
        # nose ~25-40 mm in front of the eye plane; ears, hair and shoulders behind;
        # the head turns about a point ~80 mm behind the eyes (near the neck axis)
        return Window(eye_mm - 70.0, eye_mm + 230.0, eye_mm + 80.0)


def downsample(grey, alpha, Z, out_w, out_h):
    """Area resample: brightness premultiplied by the matte (no dark fringes) and
    depth averaged with the matte as weight (no background mixed into edges)."""
    cv2 = _cv2()
    ar = lambda x: cv2.resize(x.astype(np.float32), (out_w, out_h), interpolation=cv2.INTER_AREA)
    a = ar(alpha)
    g = ar(grey * alpha) / np.maximum(a, 1e-4)
    wz = np.maximum(alpha, 1e-3)
    z = ar(Z * wz) / ar(wz)
    return np.clip(np.where(a > 1e-3, g, 0), 0, 1), np.clip(a, 0, 1), z


def to_images(grey, alpha, d01, flip=False):
    from PIL import Image

    if flip:
        grey, alpha, d01 = grey[:, ::-1], alpha[:, ::-1], d01[:, ::-1]
    L = Image.fromarray((np.clip(grey, 0, 1) * 255 + 0.5).astype(np.uint8))
    A = Image.fromarray((np.clip(alpha, 0, 1) * 255 + 0.5).astype(np.uint8))
    rgba = Image.merge("RGBA", (L, L, L, A))
    dimg = Image.fromarray((np.clip(d01, 0, 1) * 255 + 0.5).astype(np.uint8))
    return rgba, dimg


class Engine:
    """Lazily loaded models, shared across a packing run."""

    def __init__(self, midas_path=None, log=print):
        self._da = self._midas = self._face = None
        self.matter = Matter()
        self.midas_path = midas_path
        self.log = log

    @property
    def da(self):
        if self._da is None:
            self._da = DepthAnythingV2()
        return self._da

    @property
    def midas(self):
        if self._midas is None:
            self._midas = MidasSmall(self.midas_path)
        return self._midas

    @property
    def face(self):
        if self._face is None:
            self._face = Face()
        return self._face

    def models(self):
        yield self.da
        try:
            yield self.midas
        except FileNotFoundError as e:
            self.log(f"    (no MiDaS fallback: {e})")

    # ---------------------------------------------------------- portraits
    def portrait(self, src: np.ndarray, name: str, out_size: int = 256, window: Window | None = None, flip: bool | None = None):
        """-> rgba, depth image, window, flip, info. Raises DepthRejected."""
        rgb, valid, frame = align_portrait(src, self.face)
        matte = self.matter.alpha(rgb, "portrait")
        alpha = matte * (valid > 0.99)          # depth analysis: the photo as it is
        alpha_out = matte * feather(valid, 0.07)  # output: fades out before the photo ends
        pts, _ = self.face.landmarks(rgb)
        if pts is None:
            raise DepthRejected("face lost after alignment")
        reps, res, used = [], None, None
        for model in self.models():
            pdp = portrait_depth(rgb, alpha, pts, self.face, model, name)
            reps.append(pdp.rep)
            self.log("    " + pdp.rep.line())
            if pdp.rep.ok:
                res, used = pdp, model
                break
        self.last = reps
        if res is None:
            raise DepthRejected(" | ".join(r.line() for r in reps))
        if used is not self.da:
            res.rep.fallback = "MiDaS used: Depth Anything failed " + ",".join(k for k, v in reps[0].checks.items() if not v["ok"])
        win = window or Window.for_eye(res.eye_mm)
        side = key_side(rgb, alpha, pts)
        if flip is None:
            flip = side == "right"  # key light from the picture's left, as in the cast sheet
        grey = grade_portrait(rgb, alpha, pts)
        g2, a2, Z2, v2 = prewarp([grey, alpha_out, res.Z], win.z_render(res.Z))
        g3, a3, Z3 = downsample(g2, a2 * v2, Z2, out_size, out_size)
        rgba, dimg = to_images(g3, a3, win.encode(Z3), flip)
        info = {"frame": frame, "key_side": side, "flipped": bool(flip), "window_mm": [round(win.z_near, 1), round(win.z_far, 1), round(win.z_pivot, 1)], "depth": [r.as_dict() for r in reps]}
        return rgba, dimg, win, flip, info

    # ---------------------------------------------------------- objects
    def object(self, src: np.ndarray, name: str, extent_ratio: float = 0.6, out_size: int = 256, fill: float = 0.8):
        cv2 = _cv2()
        rgb0 = src
        h0, w0 = rgb0.shape[:2]
        k = min(1.0, 2048 / max(h0, w0))
        if k < 1:
            rgb0 = cv2.resize(rgb0, (round(w0 * k), round(h0 * k)), interpolation=cv2.INTER_AREA)
        a0 = self.matter.alpha(rgb0, "general")
        # centre the object in a square frame; its larger side fills `fill` of the frame
        ys, xs = np.nonzero(a0 > 0.5)
        if len(xs) < 50:
            raise DepthRejected("object matte is empty")
        x0, x1, y0, y1 = np.percentile(xs, 0.5), np.percentile(xs, 99.5), np.percentile(ys, 0.5), np.percentile(ys, 99.5)
        side = max(x1 - x0, y1 - y0) / fill
        sc = WORK / side
        A = np.array([[sc, 0, WORK / 2 - sc * (x0 + x1) / 2], [0, sc, WORK / 2 - sc * (y0 + y1) / 2]])
        rgb = np.clip(cv2.warpAffine(rgb0, A, (WORK, WORK), flags=cv2.INTER_CUBIC, borderValue=0), 0, 1)
        alpha = np.clip(cv2.warpAffine(a0, A, (WORK, WORK), flags=cv2.INTER_LINEAR, borderValue=0), 0, 1)
        reps, Z = [], None
        for model in self.models():
            Z, rep = object_depth(rgb, alpha, model, name, extent_ratio)
            reps.append(rep)
            self.log("    " + rep.line())
            if rep.ok and Z is not None:
                if model is not self.da:
                    rep.fallback = "MiDaS used: Depth Anything failed " + ",".join(k for k, v in reps[0].checks.items() if not v["ok"])
                break
            Z = None
        if Z is None:
            raise DepthRejected(" | ".join(r.line() for r in reps))
        grey = tone(luma(rgb), (alpha > 0.9).astype(np.float32), 1, 50, 99.5, 0.42, 1.0)
        m = alpha > 0.6
        zn, zf = float(np.percentile(Z[m], 0.5)), float(np.percentile(Z[m], 99.5))
        pad = 0.08 * (zf - zn) + 1e-3
        win = Window(zn - pad, zf + pad, CAM)  # grid units; object median at z = 0
        g2, a2, Z2, v2 = prewarp([grey, alpha, Z], win.z_render(Z))
        g3, a3, Z3 = downsample(g2, a2 * v2, Z2, out_size, out_size)
        rgba, dimg = to_images(g3, a3, win.encode(Z3))
        return rgba, dimg, win.depth_map(), {"depth": [r.as_dict() for r in reps], "window_units": [round(win.z_near, 4), round(win.z_far, 4), CAM]}

    # ---------------------------------------------------------- scenes
    def scene(self, src: np.ndarray, name: str, size=(384, 240), K: float = 0.5, q: float = 2.5, crop_x: float = 0.5, crop_y: float = 0.5):
        cv2 = _cv2()
        ow, oh = size
        asp = ow / oh
        h, w = src.shape[:2]
        cw, ch = (h * asp, h) if w / h > asp else (w, w / asp)
        x0, y0 = (w - cw) * crop_x, (h - ch) * crop_y
        crop = src[int(y0): int(y0 + ch), int(x0): int(x0 + cw)]
        W = 1280
        rgb = np.clip(cv2.resize(crop, (W, round(W / asp)), interpolation=cv2.INTER_AREA if crop.shape[1] > W else cv2.INTER_CUBIC), 0, 1)
        reps, ratio = [], None
        for model in self.models():
            ratio, rep = scene_depth(rgb, model, name, K, q)
            reps.append(rep)
            self.log("    " + rep.line())
            if rep.ok and ratio is not None:
                if model is not self.da:
                    rep.fallback = "MiDaS used: Depth Anything failed " + ",".join(k for k, v in reps[0].checks.items() if not v["ok"])
                break
            ratio = None
        if ratio is None:
            raise DepthRejected(" | ".join(r.line() for r in reps))
        d01 = np.clip(ratio / q, 0, 1).astype(np.float32)
        offset, scale = 1 / q, K * q  # z = K (Zp/Z - 1) = (d - 1/q) K q
        zr = ((d01 - offset) * scale).astype(np.float32)
        grey = tone(luma(rgb), np.ones(rgb.shape[:2], np.float32), 2, 50, 99.7, 0.17, 1.0)
        g2, d2, v2 = prewarp([grey, d01], zr)
        ar = lambda x: cv2.resize(x.astype(np.float32), (ow, oh), interpolation=cv2.INTER_AREA)
        a3 = ar(v2)
        g3 = ar(g2 * v2) / np.maximum(a3, 1e-4)
        d3 = ar(d2 * np.maximum(v2, 1e-3)) / ar(np.maximum(v2, 1e-3))
        rgba, dimg = to_images(g3, (a3 > 0.5).astype(np.float32), d3)
        return rgba, dimg, {"offset": round(offset, 5), "scale": round(scale, 5)}, {"depth": [r.as_dict() for r in reps]}


# ================================================================ self-test of the checks

class _Corrupt:
    """Wraps a depth model and damages its output, to prove the checks reject it."""

    def __init__(self, model, how: str):
        self.model, self.how = model, how
        self.name = f"{model.name} [{how}]"

    def predict(self, rgb, weight=None):
        d = self.model.predict(rgb, weight)
        x = d.d.copy()
        lo, hi = np.percentile(x, 2), np.percentile(x, 98)
        rng = np.random.default_rng(0)
        if self.how == "inverted":
            x = lo + hi - x
        elif self.how == "compressed":
            x = lo + 0.03 * (x - lo)
        elif self.how == "cardboard":
            a = weight if weight is not None else np.ones_like(x)
            x = np.where(a > 0.5, float(np.median(x[a > 0.5])), lo).astype(np.float32)
            x = _cv2().GaussianBlur(x, (0, 0), 3.0)
        elif self.how == "noisy":
            n = rng.normal(0, 1, x.shape).astype(np.float32)
            n = _cv2().GaussianBlur(n, (0, 0), 3.0)
            x = x + n / n.std() * 0.08 * (hi - lo)
        return Disp(x.astype(np.float32), d.unc, self.name, d.passes)


def selftest(path) -> dict:
    """Run a real portrait through intact and corrupted depth; the corrupted ones must fail."""
    eng = Engine(log=lambda *_: None)
    rgb, valid, _ = align_portrait(load_rgb(path), eng.face)
    alpha = eng.matter.alpha(rgb, "portrait") * (valid > 0.99)
    pts, _ = eng.face.landmarks(rgb)
    out = {}
    for how in ["intact", "inverted", "compressed", "cardboard", "noisy"]:
        model = eng.da if how == "intact" else _Corrupt(eng.da, how)
        rep = portrait_depth(rgb, alpha, pts, eng.face, model, how).rep
        failed = [k for k, v in rep.checks.items() if not v["ok"]]
        out[how] = {"ok": rep.ok, "failed": failed}
        print(f"  {how:10} -> {'PASS' if rep.ok else 'REJECT'} {', '.join(failed)}   {json.dumps({k: rep.values.get(k) for k in ('fit_corr', 'fit_rms_mm', 'relief_vs_template', 'flip_disagreement', 'hf_noise_mm')})}")
    good = out["intact"]["ok"] and not any(out[k]["ok"] for k in ("inverted", "compressed", "cardboard", "noisy"))
    print("selftest", "OK" if good else "FAILED")
    return out


if __name__ == "__main__":
    import sys

    if len(sys.argv) >= 3 and sys.argv[1] == "selftest":
        selftest(sys.argv[2])
    else:
        print("usage: python phi_depth.py selftest <portrait image>")
