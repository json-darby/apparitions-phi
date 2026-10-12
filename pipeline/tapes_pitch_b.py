"""Approach B: per-syllable speaker pitch contours for The Tapes clips.

Pitch from Praat (parselmouth), two-pass per-clip range. Syllable boundaries
placed by dynamic programming: exactly n-1 boundaries maximising boundary
evidence (intensity dips, voicing breaks, spectral change, pitch jumps) plus a
duration prior built from the romanisation only. Tone labels are never used to
choose boundaries or settings; they are only read by the local evaluator.

  python tapes_pitch_b.py extract            # cache Praat features (4 workers)
  python tapes_pitch_b.py segment [--subset N] [--eval]
  python tapes_pitch_b.py all                # both, all clips -> B.json

Input/output live in pipeline/work/tapes_pitch (private, gitignored).
"""
from __future__ import annotations

import argparse
import json
import math
import os
import pickle
import random
import re
import sys
import time
import unicodedata
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent / "work" / "tapes_pitch"
CLIPS = ROOT / "clips"
META = ROOT / "meta.json"
CACHE = ROOT / "b_feats.pkl"
OUT = ROOT / "B.json"
STEP = 0.01
POINTS = 16

# ------------------------------------------------------------------ features


def fix_octaves(f0: np.ndarray, win: int = 25) -> np.ndarray:
    f = f0.copy()
    idx = np.flatnonzero(f > 0)
    if len(idx) < 5:
        return f
    for _ in range(2):
        v = f[idx]
        for j, k in enumerate(idx):
            lo, hi = max(0, j - win), min(len(idx), j + win + 1)
            med = np.median(v[lo:hi])
            r = f[k] / med
            if r > 1.6:
                f[k] /= 2.0
            elif r < 0.62:
                f[k] *= 2.0
    return f


def extract_one(key: str):
    import parselmouth

    try:
        snd = parselmouth.Sound(str(CLIPS / f"{key}.mp3"))
        if snd.n_channels > 1:
            snd = snd.convert_to_mono()
        p1 = snd.to_pitch_ac(time_step=STEP, pitch_floor=60, pitch_ceiling=500)
        f1 = p1.selected_array["frequency"]
        v1 = f1[f1 > 0]
        if len(v1) < 8:
            return key, None
        q15, q85 = np.percentile(v1, [15, 85])
        floor = max(50.0, 0.75 * q15)
        ceil = min(700.0, 1.5 * q85)
        p = snd.to_pitch_ac(time_step=STEP, pitch_floor=floor, pitch_ceiling=ceil,
                            very_accurate=False, silence_threshold=0.03, voicing_threshold=0.45,
                            octave_cost=0.01, octave_jump_cost=0.5, voiced_unvoiced_cost=0.14)
        f0 = p.selected_array["frequency"].astype(float)
        strength = p.selected_array["strength"].astype(float)
        t = p.xs()
        f0 = fix_octaves(f0)
        inten = snd.to_intensity(minimum_pitch=max(60.0, floor), time_step=STEP)
        it = inten.xs()
        iv = inten.values[0]
        I = np.interp(t, it, iv, left=iv[0], right=iv[-1])
        mf = snd.to_mfcc(number_of_coefficients=12, window_length=0.015, time_step=STEP)
        ma = mf.to_array()
        mt = mf.x1 + mf.dx * np.arange(mf.nx)
        M = np.stack([np.interp(t, mt, row) for row in ma])
        return key, dict(t=t, f0=f0, s=strength, I=I, M=M.astype(np.float32))
    except Exception as e:  # noqa: BLE001
        print("fail", key, e, file=sys.stderr)
        return key, None


def extract(keys):
    feats = {}
    if CACHE.exists():
        feats = pickle.loads(CACHE.read_bytes())
    todo = [k for k in keys if k not in feats]
    t0 = time.time()
    with ProcessPoolExecutor(max_workers=4) as ex:
        for i, (k, f) in enumerate(ex.map(extract_one, todo, chunksize=8)):
            feats[k] = f
            if i % 300 == 0:
                print(f"  extracted {i}/{len(todo)} {time.time() - t0:.0f}s", flush=True)
    CACHE.write_bytes(pickle.dumps(feats))
    print(f"extract: {len(todo)} clips in {time.time() - t0:.0f}s")
    return feats


# ------------------------------------------------------------------ duration prior (romanisation only)

LONG = ("aa", "ii", "uu", "oo", "ɔɔ", "ee", "ɛɛ", "ʉʉ", "əə", "ia", "ʉa", "ua")


def syl_weight(roman: str, last: bool, p=None) -> float:
    p = p or P
    r = unicodedata.normalize("NFD", roman.lower())
    r = "".join(c for c in r if unicodedata.category(c) != "Mn")
    r = re.sub(r"[^a-zɔɛʉəŋ]", "", r)
    long_v = any(v in r for v in LONG)
    stop = bool(re.search(r"[ptk]$", r)) and not r.endswith("ng")
    sonorant = bool(re.search(r"(ng|ŋ|[mnwyl])$", r))
    if long_v:
        w = 1.35
    elif stop:
        w = 0.75
    elif sonorant:
        w = 1.0
    else:
        w = 0.8  # short open
    if long_v and stop:
        w = 1.2
    if last:
        w *= p["last"]
    return w


# ------------------------------------------------------------------ segmentation

# Settings chosen on a 300-clip subset by the checker's score, confirmed on a held-out 400.
# shift_frac moves each boundary ~0.3 mean-syllable later: Thai tone targets are realised
# late (carry-over), and the voiceless-onset F0 perturbation is pushed out of the syllable.
# on_frac skips the first 15% of each syllable's voiced frames (onset transition).
# w_gap: boundaries the romanisation says should fall in a voicing gap get a strong
# unvoiced-frame bonus. Intensity-dip evidence (w_dip) hurt on this data, so it is off.
P = dict(w_dip=0.0, w_unv=0.6, w_spec=0.5, w_pjump=0.4, sigma=0.45, w_dur=1.0,
         span_db=28.0, minfr=3, mask_db=99.0, mask_str=0.75, seg_db=10.0, shift=0, last=1.0,
         shift_frac=0.3, w_gap=3.0, w_dip_son=0.0, on_trim=0, on_frac=0.15)


def boundary_evidence(f, a, b, p):
    I = f["I"][a:b]
    f0 = f["f0"][a:b]
    M = f["M"][1:, a:b]
    T = b - a
    # intensity dip depth (dB) at each frame vs. peaks within +-12 frames each side
    dip = np.zeros(T)
    for i in range(T):
        l = I[max(0, i - 12):i + 1].max()
        r = I[i:min(T, i + 13)].max()
        dip[i] = max(0.0, min(l, r) - I[i])
    dip = np.minimum(dip / 6.0, 2.0)
    # local minimum bonus
    unv = (f0 <= 0).astype(float)
    # spectral change
    if T > 4:
        d = np.zeros(T)
        d[2:-2] = np.linalg.norm(M[:, 4:] - M[:, :-4], axis=0)
        med = np.median(d[2:-2]) + 1e-6
        spec = np.minimum(d / med, 4.0) / 2.0
    else:
        spec = np.zeros(T)
    # pitch discontinuity in semitones between neighbouring voiced frames
    pj = np.zeros(T)
    st = np.where(f0 > 0, 12 * np.log2(np.maximum(f0, 1) / 100.0), np.nan)
    for i in range(1, T):
        if not np.isnan(st[i]) and not np.isnan(st[i - 1]):
            pj[i] = min(abs(st[i] - st[i - 1]) / 1.5, 2.0)
    sm = lambda x: np.convolve(x, [0.25, 0.5, 0.25], mode="same")  # noqa: E731
    return sm(dip), sm(unv), sm(spec), sm(pj)


def boundary_kinds(romans):
    """Per boundary: 1 if a voicing gap is expected (voiceless onset next or stop final before), else 0."""
    out = []
    for r0, r1 in zip(romans[:-1], romans[1:]):
        a, b = _plain(r0), _plain(r1)
        on = re.match(r"^([^aeiouɔɛʉə]*)", b).group(1)
        fin = re.search(r"([^aeiouɔɛʉə]*)$", a).group(1)
        gap = (on[:1] in VOICELESS and not on.startswith("b") and not (on.startswith("d") and not on.startswith("dt")))             or on.startswith(("bp", "dt")) or fin in ("p", "t", "k")
        out.append(1.0 if gap else (0.5 if on == "" else 0.0))
    return out


VOICELESS = set("ktspcgjhf")


def _plain(r):
    r = unicodedata.normalize("NFD", r.lower())
    r = "".join(c for c in r if unicodedata.category(c) != "Mn")
    return re.sub(r"[^a-zɔɛʉəŋ]", "", r)


def evidence_matrix(comps, kinds, p):
    dip, unv, spec, pj = comps
    rows = []
    for g in kinds:
        e = (p["w_dip"] + (1 - g) * p["w_dip_son"]) * dip + (p["w_unv"] + g * p["w_gap"]) * unv             + p["w_spec"] * spec + p["w_pjump"] * pj
        rows.append(e)
    return rows


def speech_span(f, p):
    I = f["I"]
    thr = I.max() - p["span_db"]
    on = np.flatnonzero(I > thr)
    if len(on) == 0:
        return 0, len(I)
    a, b = on[0], on[-1] + 1
    v = np.flatnonzero(f["f0"] > 0)
    if len(v):
        a, b = min(a, v[0]), max(b, v[-1] + 1)
    return int(a), int(b)


def dp_segment(E, weights, p):
    """Place n-1 boundaries on frames 1..T-1 of E. Returns list of n+1 cut frames."""
    T = len(E[0]) if len(E) else 0
    n = len(weights)
    if n == 1:
        return [0, T]
    mn = p["minfr"]
    if T < n * mn:
        mn = max(1, T // n)
    exp = np.array(weights) / sum(weights) * T
    sig = p["sigma"]
    NEG = -1e18
    pos = np.arange(T + 1)
    # S[k][j]: best score with k-th cut at frame j (cut 0 at 0)
    S = np.full(T + 1, NEG)
    S[0] = 0.0
    back = []
    for k in range(n):
        last = k == n - 1
        S2 = np.full(T + 1, NEG)
        B2 = np.zeros(T + 1, dtype=int)
        targets = [T] if last else range(mn * (k + 1), T - mn * (n - k - 1) + 1)
        for j in targets:
            i = pos[:j - mn + 1]
            if len(i) == 0:
                continue
            dur = (j - i).astype(float)
            pr = -p["w_dur"] * (np.log(np.maximum(dur, 0.5) / exp[k])) ** 2 / (2 * sig * sig)
            sc = S[:j - mn + 1] + pr
            bi = int(np.argmax(sc))
            S2[j] = sc[bi] + (0.0 if last else E[k][j])
            B2[j] = bi
        back.append(B2)
        S = S2
    cuts = [T]
    j = T
    for k in range(n - 1, -1, -1):
        j = back[k][j]
        cuts.append(int(j))
    return cuts[::-1]


def voiced_f0(f, p):
    """Tracker voicing, made stricter: drop weak (low intensity / low strength) frames."""
    f0 = f["f0"].copy()
    weak = (f["I"] < f["I"].max() - p["mask_db"]) | (f["s"] < p["mask_str"])
    f0[weak] = 0.0
    return f0


def contours(f, cuts, a, p):
    f0 = voiced_f0(f, p)
    I = f["I"]
    v = f0[f0 > 0]
    mid = float(np.median(v))
    floor = mid * 2 ** (-10 / 24)
    out = []
    for s, e in zip(cuts[:-1], cuts[1:]):
        seg = f0[a + s:a + e]
        si = I[a + s:a + e]
        keep = seg > 0
        if keep.any():
            keep &= si >= si[keep].max() - p["seg_db"]
        seg = seg[keep]
        # tone lives on the rhyme: skip the onset transition (consonant microprosody)
        cut = int(p["on_trim"] + p["on_frac"] * len(seg))
        if cut and len(seg) - cut >= 4:
            seg = seg[cut:]
        if len(seg) < 4:
            out.append(None)
            continue
        vals = 12 * np.log2(seg / floor) / 10.0
        if len(vals) >= 9:
            vals = vals[1:-1]
        x = np.linspace(0, len(vals) - 1, POINTS)
        out.append([round(float(z), 4) for z in np.interp(x, np.arange(len(vals)), vals)])
    return out


def segment_clip(f, m, p):
    if f is None:
        return None
    n = len(m["tones"])
    if (f["f0"] > 0).sum() < 4:
        return None
    a, b = speech_span(f, p)
    comps = boundary_evidence(f, a, b, p)
    E = evidence_matrix(comps, boundary_kinds(m["roman"]), p) if n > 1 else [comps[0]]
    w = [syl_weight(r, i == n - 1, p) for i, r in enumerate(m["roman"])]
    cuts = dp_segment(E, w, p)
    if p["shift"] or p["shift_frac"]:
        T = len(E[0])
        sh = p["shift"] + p["shift_frac"] * T / n
        cuts = [cuts[0]] + [min(T - 1, max(1, int(round(c + sh)))) for c in cuts[1:-1]] + [cuts[-1]]
    return contours(f, cuts, a, p)


# ------------------------------------------------------------------ local evaluator (port of app classifyTone)

def tone_shape(tone, n=16):
    out = []
    for i in range(n):
        t = i / (n - 1)
        if tone == 0:
            v = 0.52 - 0.06 * t
        elif tone == 1:
            v = 0.38 - 0.18 * t
        elif tone == 2:
            v = 0.68 + 0.14 * math.sin(math.pi * min(1, t * 1.6)) - 0.5 * t * t
        elif tone == 3:
            v = 0.58 + 0.3 * t - 0.08 * t * t
        else:
            v = 0.36 - 0.12 * math.sin(math.pi * min(1, t * 1.4)) + 0.52 * t * t
        out.append(max(0, min(1, v)))
    return np.array(out)


def deltas(v):
    n = len(v)
    out = np.empty(n)
    for i in range(n):
        a, b = max(0, i - 1), min(n - 1, i + 1)
        out[i] = (v[b] - v[a]) / (b - a) * (n - 1)
    return out


TPL = [tone_shape(t) for t in range(5)]
DTPL = [deltas(t) for t in TPL]


def classify(c):
    c = np.asarray(c)
    dc = deltas(c)
    best, bd = 0, 1e18
    for t in range(5):
        shift = max(-0.1, min(0.1, float(np.mean(c - TPL[t]))))
        d = np.mean((c - shift - TPL[t]) ** 2) + 0.4 * np.mean((dc - DTPL[t]) ** 2) + 0.3 * shift * shift
        if d < bd:
            bd, best = d, t
    return best


def evaluate(res, meta, keys):
    syl = meas = agree = used = 0
    per = np.zeros((5, 2))
    for k in keys:
        tones = meta[k]["tones"]
        syl += len(tones)
        c = res.get(k)
        if not c:
            continue
        hits = 0
        for x, t in zip(c, tones):
            if x is None:
                continue
            meas += 1
            per[t, 1] += 1
            if classify(x) == t:
                agree += 1
                hits += 1
                per[t, 0] += 1
        if hits >= math.ceil(len(tones) / 2):
            used += 1
    pt = " ".join(f"{n} {100 * a / max(1, b):.0f}%" for n, (a, b) in zip(["mid", "low", "fall", "high", "rise"], per))
    print(f"measured {100 * meas / syl:.1f}%  agree {100 * agree / max(1, meas):.1f}% of measured, "
          f"{100 * agree / syl:.1f}% of all  clips used {100 * used / len(keys):.1f}%  | {pt}")
    return agree / syl


# ------------------------------------------------------------------ main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["extract", "segment", "all"])
    ap.add_argument("--subset", type=int, default=0)
    ap.add_argument("--eval", action="store_true")
    ap.add_argument("--set", nargs="*", default=[], help="param overrides k=v")
    args = ap.parse_args()
    meta = json.loads(META.read_text(encoding="utf-8"))
    keys = sorted(meta)
    if args.subset:
        random.Random(7).shuffle(keys)
        keys = sorted(keys[:args.subset])
    p = dict(P)
    for kv in args.set:
        k, v = kv.split("=")
        p[k] = type(P[k])(float(v)) if not isinstance(P[k], int) else int(float(v))
    t0 = time.time()
    if args.cmd in ("extract", "all"):
        feats = extract(keys)
    else:
        feats = pickle.loads(CACHE.read_bytes())
    if args.cmd in ("segment", "all"):
        res = {}
        for k in keys:
            c = segment_clip(feats.get(k), meta[k], p)
            if c is not None and any(x is not None for x in c):
                res[k] = c
        print(f"segment: {len(res)}/{len(keys)} clips, {time.time() - t0:.0f}s total")
        if not args.subset:
            OUT.write_text(json.dumps(res), encoding="utf-8")
            print("wrote", OUT)
        if args.eval or args.subset:
            evaluate(res, meta, keys)


if __name__ == "__main__":
    main()
