"""Real walking motion from a reference video, as joint angles only.

The owner's reference clips show a person walking, filmed from the side (left
half of the frame) and the front (right half). MediaPipe Pose (Apache-2.0)
reads 33 body joints from the side view in every frame. Nothing of the
person's image is kept, only how the body moves:

1. Left/right swaps (MediaPipe often trades the legs or arms on a side view)
   are undone with a second-order Viterbi pass: in every frame the labelling
   that keeps both limbs moving most smoothly wins.
2. The near side (the one facing the camera, best tracked) is measured as bone
   angles; bone lengths are fixed, so limbs never stretch.
3. Every clean stride (near thigh's furthest swing to the next) is resampled to
   N phases and the strides are averaged (median), which removes most tracker
   noise; a circular Savitzky-Golay filter smooths what is left without
   rounding off the heel strike, and any end-to-start drift is spread over
   the cycle so the loop is seamless.
4. The far side is the near side half a stride later (a symmetric gait), so
   the poorly seen far limbs never carry tracker errors.
5. The standing frames at the start or end give a natural standing pose.

    python extract_walk.py VIDEO NAME
Writes work/walk/<NAME>.json (angles, bone lengths, contact schedule).
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
from scipy.signal import savgol_filter

HERE = Path(__file__).resolve().parent
MODEL = HERE / "work" / "models" / "pose_landmarker_heavy.task"
OUT = HERE / "work" / "walk"
N = 64  # phases per stride

# MediaPipe pose indices, (left, right)
SH, EL, WR, HIP, KN, AN, HEEL, TOE, EAR = (11, 12), (13, 14), (15, 16), (23, 24), (25, 26), (27, 28), (29, 30), (31, 32), (7, 8)
NOSE = 0


def track(video: Path) -> tuple[np.ndarray, np.ndarray, float]:
    from mediapipe.tasks.python import BaseOptions, vision
    import cv2
    import mediapipe as mp

    opts = vision.PoseLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(MODEL)),
                                        running_mode=vision.RunningMode.VIDEO, num_poses=1)
    det = vision.PoseLandmarker.create_from_options(opts)
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25
    pts, vis = [], []
    i = 0
    while True:
        ok, f = cap.read()
        if not ok:
            break
        side = f[:, : f.shape[1] // 2]
        rgb = cv2.cvtColor(side, cv2.COLOR_BGR2RGB)
        res = det.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(i * 1000 / fps))
        if res.pose_landmarks:
            lm = res.pose_landmarks[0]
            pts.append([[p.x * side.shape[1], p.y * side.shape[0], p.z * side.shape[1]] for p in lm])
            vis.append([p.visibility for p in lm])
        else:
            pts.append([[np.nan] * 3] * 33)
            vis.append([0.0] * 33)
        i += 1
    cap.release()
    return np.array(pts, np.float32), np.array(vis, np.float32), fps


def tracked(video: Path) -> tuple[np.ndarray, np.ndarray, float]:
    """Landmarks for a video, cached (only joint coordinates are cached, never pixels)."""
    cache = OUT / "cache" / f"{video.stem}.npz"
    if cache.exists() and cache.stat().st_mtime > video.stat().st_mtime:
        d = np.load(cache)
        return d["pts"], d["vis"], float(d["fps"])
    pts, vis, fps = track(video)
    cache.parent.mkdir(parents=True, exist_ok=True)
    np.savez(cache, pts=pts, vis=vis, fps=fps)
    return pts, vis, fps


def fill_gaps(p: np.ndarray) -> np.ndarray:
    """Linear fill of frames the tracker missed."""
    p = p.copy()
    n = len(p)
    t = np.arange(n)
    good = ~np.isnan(p[:, 0, 0])
    for j in range(p.shape[1]):
        for c in range(p.shape[2]):
            p[:, j, c] = np.interp(t, t[good], p[good, j, c])
    return p


def unswap(p: np.ndarray, pairs: list[tuple[int, int]], scale: float, zw: float = 0.5, zprior: float = 0.3, capk: float = 0.6) -> tuple[np.ndarray, np.ndarray]:
    """Second-order Viterbi over 'swapped or not' per frame for one limb group (pairs of left/right joints).

    Each labelling is scored by how well every joint follows on from the two frames before (constant
    velocity), with the error per joint capped so one wild point cannot decide it, plus a prior from
    depth: MediaPipe's z is noisy but the far limb is mostly behind the near one.
    """
    n = len(p)
    zs = np.array([1.0, 1.0, zw])
    L = np.stack([p[:, a, :] * zs for a, _ in pairs], 1)  # n, k, 3
    R = np.stack([p[:, b, :] * zs for _, b in pairs], 1)
    X = np.stack([np.concatenate([L, R], 1), np.concatenate([R, L], 1)], 1)  # n, state, 2k, 3
    cap = (capk * scale) ** 2
    dz = np.mean([p[:, a, 2] - p[:, b, 2] for a, b in pairs], 0)  # left minus right
    sgn = np.sign(np.median(dz)) or 1.0
    unary = np.stack([zprior * np.maximum(0, -sgn * dz) ** 2, zprior * np.maximum(0, sgn * dz) ** 2], 1)
    err = lambda d: np.minimum(np.sum(d ** 2, -1), cap).sum()
    INF = 1e18
    cost = np.zeros(4)
    for s in range(4):
        a, b = divmod(s, 2)
        cost[s] = err(X[1, b] - X[0, a]) + unary[0, a] + unary[1, b]
    back = np.zeros((n, 4), int)
    for t in range(2, n):
        new = np.full(4, INF)
        for s in range(4):  # (b, c)
            b, c = divmod(s, 2)
            for a in range(2):
                prev = a * 2 + b
                v = cost[prev] + err(X[t, c] - (2 * X[t - 1, b] - X[t - 2, a])) + unary[t, c]
                if v < new[s]:
                    new[s] = v
                    back[t, s] = prev
        cost = new
    s = int(np.argmin(cost))
    states = np.zeros(n, int)
    for t in range(n - 1, 1, -1):
        states[t] = s % 2
        s = back[t, s]
    states[1] = s % 2
    states[0] = s // 2
    q = p.copy()
    for t in np.nonzero(states)[0]:
        for a, b in pairs:
            q[t, a], q[t, b] = p[t, b].copy(), p[t, a].copy()
    return q, states


def despike(p: np.ndarray, win: int = 5) -> np.ndarray:
    """Running median per coordinate: removes single-frame tracker glitches before anything else."""
    from scipy.ndimage import median_filter

    return median_filter(p, size=(win, 1, 1), mode="nearest")


def runs(mask: np.ndarray) -> list[tuple[int, int]]:
    out, start = [], None
    for i, m in enumerate(list(mask) + [False]):
        if m and start is None:
            start = i
        if not m and start is not None:
            out.append((start, i))
            start = None
    return out


def ang_down(v: np.ndarray) -> np.ndarray:
    """Angle of a vector (x forward, y up) from straight down; positive = forward."""
    return np.arctan2(v[..., 0], -v[..., 1])


def ang_up(v: np.ndarray) -> np.ndarray:
    """Angle from straight up; positive = leaning forward."""
    return np.arctan2(v[..., 0], v[..., 1])


def ang_fwd(v: np.ndarray) -> np.ndarray:
    """Angle from horizontal forward; positive = pointing up."""
    return np.arctan2(v[..., 1], v[..., 0])


def circ_smooth(x: np.ndarray, win: int, order: int = 3) -> np.ndarray:
    pad = win
    y = np.concatenate([x[-pad:], x, x[:pad]])
    return savgol_filter(y, win, order)[pad:-pad]


def main() -> None:
    video, name = Path(sys.argv[1]), sys.argv[2]
    raw, vis, fps = tracked(video)
    p = fill_gaps(raw)
    n = len(p)
    vis = vis.copy()
    leg = [(a, b) for a, b in (KN, AN, HEEL, TOE)]
    arm = [(a, b) for a, b in (EL, WR, (17, 18), (19, 20), (21, 22))]
    scale = float(np.nanmedian(np.hypot(*(p[:, 23, :2] - p[:, 27, :2]).T)))  # hip to ankle, px
    p, st1 = unswap(p, leg, scale, zprior=0.01)
    p, st2 = unswap(p, arm, scale, zprior=0.01)
    swaps = int(st1.sum() + st2.sum())
    for t in np.nonzero(st1)[0]:
        for a, b in leg:
            vis[t, a], vis[t, b] = vis[t, b], vis[t, a]
    # running median sized to the stride (the f clip is slow motion, so its glitches last longer)
    ax_ = p[:, 28, 0] - (p[:, 23, 0] + p[:, 24, 0]) / 2
    ax_ = ax_ - ax_.mean()
    ac = np.correlate(ax_, ax_, "full")[len(ax_) - 1:]
    lag = int(np.argmax(ac[15:200]) + 15)
    win = max(3, int(round(lag / 12)) | 1)
    p = despike(p, win)
    # facing: the nose is ahead of the ears
    sign = 1.0 if np.median(p[:, NOSE, 0] - (p[:, 7, 0] + p[:, 8, 0]) / 2) >= 0 else -1.0
    # near side: nearer the camera (MediaPipe z is smaller toward the camera)
    zl = np.median(p[:, [KN[0], AN[0], HEEL[0]], 2])
    zr = np.median(p[:, [KN[1], AN[1], HEEL[1]], 2])
    s = 1 if zr < zl else 0  # index into the (left, right) pairs

    def J(pair: tuple[int, int] | int, near=True) -> np.ndarray:
        """Joint track in image px, x flipped so forward is +x, y up."""
        j = pair if isinstance(pair, int) else pair[s if near else 1 - s]
        return np.stack([sign * p[:, j, 0], -p[:, j, 1]], -1)

    mid = lambda a, b: (J(a, True) + J(a, False)) / 2 if b is None else (J(a) + J(b)) / 2
    hipc = (J(HIP, True) + J(HIP, False)) / 2
    shc = (J(SH, True) + J(SH, False)) / 2
    earc = (J(EAR, True) + J(EAR, False)) / 2

    # standing frames: both ankles still and together for a while
    an_n, an_f = J(AN, True), J(AN, False)
    spd = np.hypot(*np.gradient(an_n - hipc, axis=0).T) + np.hypot(*np.gradient(an_f - hipc, axis=0).T)
    gapx = np.abs(an_n[:, 0] - an_f[:, 0])
    leg_px = np.median(np.hypot(*(J(HIP) - J(AN)).T))
    still = (spd < 0.03 * leg_px) & (gapx < 0.12 * leg_px)
    stand_runs = [r for r in runs(still) if r[1] - r[0] >= 8]
    if not stand_runs:
        sys.exit("no standing frames found")
    st = max(stand_runs, key=lambda r: r[1] - r[0])
    sf = np.arange(st[0] + 2, st[1] - 2)
    heel_y = (J(HEEL, True)[sf, 1] + J(HEEL, False)[sf, 1]) / 2
    H = float(np.median(earc[sf, 1] - heel_y) / 0.925)  # ear canal sits at about 0.925 of body height above the heel point
    print(f"{name}: {n} frames at {fps:.0f} fps, {swaps} swapped frames fixed, median window {win}, near side {'right' if s else 'left'}, "
          f"standing frames {st}, body height {H:.0f}px")

    # bone angles per frame for both tracked sides (labels 0 and 1; which is which no longer matters below)
    def limb(near: bool) -> dict[str, np.ndarray]:
        hp, kn, an, he, to = J(HIP, near), J(KN, near), J(AN, near), J(HEEL, near), J(TOE, near)
        sh, el, wr = J(SH, near), J(EL, near), J(WR, near)
        return {"thigh": ang_down(kn - hp), "shin": ang_down(an - kn), "foot": ang_fwd(to - he),
                "uarm": ang_down(el - sh), "farm": ang_down(wr - el), "hipx": hp[:, 0] / H, "shx": sh[:, 0] / H}

    S0, S1 = limb(True), limb(False)
    C = {"spine": ang_up(shc - hipc), "neck": ang_up(earc - shc), "head": ang_fwd(J(NOSE) - earc)}

    # bone lengths (body heights): median over both sides and all frames
    def blen(pair_a, pair_b):
        return float(np.median(np.concatenate([np.hypot(*(J(pair_a, k) - J(pair_b, k)).T) for k in (True, False)])) / H)

    L = {"thigh": blen(KN, HIP), "shin": blen(AN, KN), "uarm": blen(EL, SH), "farm": blen(WR, EL),
         "spine": float(np.median(np.hypot(*(shc - hipc).T)) / H), "neck": float(np.median(np.hypot(*(earc - shc).T)) / H),
         "nose": float(np.median(np.hypot(*(J(NOSE) - earc).T)) / H)}
    # the foot as a rigid shape in its own frame (heel to toe along +x), relative to the ankle
    rot = lambda v, a: np.stack([v[:, 0] * np.cos(a) - v[:, 1] * np.sin(a), v[:, 0] * np.sin(a) + v[:, 1] * np.cos(a)], -1)
    fl = lambda pt: np.concatenate([rot(J(pt, k) - J(AN, k), -ang_fwd(J(TOE, k) - J(HEEL, k))) for k in (True, False)])
    heel_l = np.median(fl(HEEL), 0) / H
    toe_l = np.median(fl(TOE), 0) / H
    print("  lengths (body heights):", {k: round(v, 3) for k, v in L.items()}, "heel", heel_l.round(3), "toe", toe_l.round(3))

    walking = np.ones(n, bool)
    for a_, b_ in stand_runs:
        walking[max(0, a_ - 3): b_ + 3] = False

    # strides: from one furthest forward swing of a thigh to the next, about one autocorrelation period
    # apart. The tracker sometimes hands the near leg's label to the far leg for a step or two; only
    # strides where one label follows one leg for the whole stride have the right length, so a
    # label that wanders produces no clean strides and drops out.
    def strides(th: np.ndarray) -> list[tuple[int, int]]:
        th = savgol_filter(th, win + 2 | 1, 2)
        r = max(3, lag // 3)
        pk = [i for i in range(r, n - r) if th[i] == th[i - r: i + r + 1].max() and walking[i] and th[i] > np.percentile(th[walking], 70)]
        return [(a_, b_) for a_, b_ in zip(pk, pk[1:]) if walking[a_: b_ + 1].all() and abs((b_ - a_) - lag) < 0.2 * lag]

    cand = [(lab, ab) for lab, S_ in enumerate((S0, S1)) for ab in strides(S_["thigh"])]
    if not cand:
        sys.exit("no clean strides")
    period = float(np.median([b_ - a_ for _, (a_, b_) in cand]) / fps)
    print(f"  clean strides (label, frames): {cand}; {period:.2f} s per stride in the video")

    ph = np.arange(N + 1) / N
    fi = lambda x, a_, b_: np.interp(a_ + ph * (b_ - a_), np.arange(n), x)

    def average(rows: list[np.ndarray]) -> np.ndarray:
        rows = np.array(rows)
        m = np.median(rows, 0)
        dev = np.abs(rows - m).mean(1)
        m = rows[dev <= max(np.median(dev) * 2.0, 1e-9)].mean(0)
        return m[:N] - (m[N] - m[0]) * ph[:N]  # seamless: spread any end-to-start drift over the stride

    R: dict[str, list[np.ndarray]] = {k: [] for k in ("thigh", "shin", "foot", "uarm", "farm", "spine", "neck", "head", "hipdx", "shdx")}
    for lab, (a_, b_) in cand:
        Ln, Lf = (S0, S1) if lab == 0 else (S1, S0)
        for k in ("thigh", "shin", "foot"):
            R[k].append(fi(np.unwrap(Ln[k]), a_, b_))
        R["hipdx"].append(fi(Ln["hipx"] - Lf["hipx"], a_, b_))
        # the near arm swings against the near leg: take the arm label that does so in this stride
        thn = fi(Ln["thigh"], a_, b_)
        arms = [(S0, S1), (S1, S0)]
        An, Af = min(arms, key=lambda p_: np.corrcoef(thn, fi(p_[0]["uarm"], a_, b_))[0, 1])
        for k in ("uarm", "farm"):
            R[k].append(fi(np.unwrap(An[k]), a_, b_))
        R["shdx"].append(fi(An["shx"] - Af["shx"], a_, b_))
        for k in ("spine", "neck", "head"):
            R[k].append(fi(np.unwrap(C[k]), a_, b_))
    T = {k: average(v) for k, v in R.items()}
    # pelvis and shoulder rotation are antisymmetric over half a stride; trunk and head repeat each step
    for k in ("hipdx", "shdx"):
        T[k] = (T[k] - np.roll(T[k], N // 2)) / 2
    for k in ("spine", "neck", "head"):
        T[k] = (T[k] + np.roll(T[k], N // 2)) / 2

    keys = ["thigh", "shin", "foot", "uarm", "farm", "spine", "neck", "head", "hipdx", "shdx"]
    # smoothing: gentle on the feet (keeps the heel strike crisp), more on the rest
    for k in keys:
        T[k] = circ_smooth(T[k], 7 if k in ("foot", "shin") else 9)

    # quality: in one stride the near shin swings forward once. Where the tracker kept confusing the
    # legs (the f clip: slow motion, long passing phases) the averaged stride shows two swings; then
    # the legs and arms come from the clean clip, shaped to this walker (posture, proportions,
    # a slightly shorter step, smaller arm swing, more hip rotation), and only those are measured here.
    sh_ = T["shin"]
    swings = sum(1 for i in range(N) if sh_[i] < -0.6 and sh_[i] <= sh_[(i - 1) % N] and sh_[i] <= sh_[(i + 1) % N])
    borrowed = None
    if swings != 1 and len(sys.argv) > 3:
        donor = json.loads((OUT / f"{sys.argv[3]}.json").read_text(encoding="utf-8"))
        borrowed = donor["name"]
        dw, ds = donor["walk"], donor["stand"]
        own = {k: T[k].copy() for k in ("spine", "neck", "head")}
        for k in ("thigh", "shin", "foot"):
            T[k] = np.array(dw[k])
        T["thigh"] = ds["thigh"] + 0.94 * (T["thigh"] - ds["thigh"])
        T["uarm"] = ds["uarm"] + 0.8 * (np.array(dw["uarm"]) - ds["uarm"])
        el = np.array(dw["farm"]) - np.array(dw["uarm"])
        T["farm"] = T["uarm"] + 0.75 * el
        T["hipdx"] = 1.25 * np.array(dw["hipdx"])
        T["shdx"] = 0.85 * np.array(dw["shdx"])
        for k in ("spine", "neck", "head"):
            # the donor's lean while walking (relative to its stand), on this walker's own posture
            T[k] = float(np.median(C[k][sf])) + (np.array(dw[k]) - ds[k])
        period = donor["period"] * 0.96
        print(f"  this clip's averaged stride has {swings} shin swings (tracker confused the legs): legs and arms from '{borrowed}'")

    # the standing pose: both sides averaged over the still frames
    S = {k: float(np.median((S0[k][sf] + S1[k][sf]) / 2)) for k in ("thigh", "shin", "foot", "uarm", "farm")}
    S.update({k: float(np.median(C[k][sf])) for k in ("spine", "neck", "head")})
    S["hipdx"] = S["shdx"] = 0.0

    # contact schedule from the reconstructed legs: a foot is down when it is the lowest (within 2.5 cm)
    # and moving back relative to the hips
    def foot_pts(th_, sh_, fo_):
        kn = L["thigh"] * np.stack([np.sin(th_), -np.cos(th_)], -1)
        an = kn + L["shin"] * np.stack([np.sin(sh_), -np.cos(sh_)], -1)
        c, sn = np.cos(fo_)[:, None], np.sin(fo_)[:, None]
        he = an + np.concatenate([heel_l[0] * c - heel_l[1] * sn, heel_l[0] * sn + heel_l[1] * c], 1)
        to = an + np.concatenate([toe_l[0] * c - toe_l[1] * sn, toe_l[0] * sn + toe_l[1] * c], 1)
        return he, to

    sh2 = lambda x: np.roll(x, -N // 2)
    hn, tn = foot_pts(T["thigh"], T["shin"], T["foot"])
    hf, tf = foot_pts(sh2(T["thigh"]), sh2(T["shin"]), sh2(T["foot"]))
    lown = np.minimum(hn[:, 1], tn[:, 1]) + T["hipdx"] * 0
    lowf = np.minimum(hf[:, 1], tf[:, 1])
    lo = np.minimum(lown, lowf)
    vxn = (np.roll(hn[:, 0] + tn[:, 0], -1) - np.roll(hn[:, 0] + tn[:, 0], 1)) / 4
    near_down = np.clip((0.016 - (lown - lo)) / 0.01, 0, 1) * (vxn < 0.002)
    w = circ_smooth(near_down.astype(float), 5, 2).clip(0, 1)
    contact = np.round(w, 3)

    out = {
        "name": name,
        "source": "joint angles tracked from a reference walking video (MediaPipe Pose); no images kept",
        "phases": N,
        "period": round(period, 3),
        "gait_from": borrowed or name,
        "len": {k: round(v, 4) for k, v in L.items()},
        "heel": [round(float(v), 4) for v in heel_l],
        "toe": [round(float(v), 4) for v in toe_l],
        "stand": {k: round(v, 4) for k, v in S.items()},
        "walk": {k: [round(float(v), 4) for v in T[k]] for k in keys},
        "contact": [float(v) for v in contact],
    }
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"{name}.json").write_text(json.dumps(out, separators=(",", ":")), encoding="utf-8")
    print(f"  wrote {OUT / f'{name}.json'}; near foot down for {contact.mean():.0%} of the stride")


if __name__ == "__main__":
    main()
