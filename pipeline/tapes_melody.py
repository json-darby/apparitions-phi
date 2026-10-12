"""Whole-phrase speaker pitch line ("melody") for The Tapes clips.

Pitch comes from the proven Praat extraction in tapes_pitch_b.py (to_pitch_ac 10 ms,
per-clip two-pass floor/ceiling, octave cleanup) plus its weak-frame dropping.
No segmentation: one contour per clip, normalised like the app, 48 points.

  python tapes_melody.py            # uses b_feats.pkl cache if present
  python tapes_melody.py --fresh    # re-extract with Praat (4 workers)

Input/output live in pipeline/work/tapes_pitch (private, gitignored).
"""
from __future__ import annotations

import argparse
import json
import pickle
import sys
import time
from concurrent.futures import ProcessPoolExecutor

import numpy as np

from tapes_pitch_b import CACHE, META, P, ROOT, extract_one, voiced_f0

OUT = ROOT / "melody.json"
POINTS = 48
SPECK = 4          # voiced runs shorter than 40 ms at either end are ignored
EDGE = 2           # voiced frames dropped at onset and offset
MIN_VOICED = 8
MIN_COVER = 0.25


def runs(mask):
    """List of (start, end) for True runs."""
    d = np.diff(np.concatenate([[0], mask.astype(int), [0]]))
    return list(zip(np.flatnonzero(d == 1), np.flatnonzero(d == -1)))


def melody(f):
    """Return (values, span_seconds, coverage, reason)."""
    if f is None:
        return None, 0, 0, "no pitch"
    f0 = voiced_f0(f, P)
    v = f0 > 0
    rs = runs(v)
    while rs and rs[0][1] - rs[0][0] < SPECK:
        v[rs[0][0]:rs[0][1]] = False
        rs.pop(0)
    while rs and rs[-1][1] - rs[-1][0] < SPECK:
        v[rs[-1][0]:rs[-1][1]] = False
        rs.pop()
    idx = np.flatnonzero(v)
    if len(idx) > 2 * EDGE:
        v[idx[:EDGE]] = False
        v[idx[-EDGE:]] = False
        idx = idx[EDGE:-EDGE]
    if len(idx) < MIN_VOICED:
        return None, 0, 0, "few voiced"
    a, b = idx[0], idx[-1] + 1
    span = b - a
    cover = len(idx) / span
    if cover < MIN_COVER:
        return None, span * 0.01, cover, "low cover"
    hz = f0[idx]
    mid = float(np.median(hz))
    floor = mid * 2 ** (-10 / 24)
    vals = 12 * np.log2(hz / floor) / 10.0
    line = np.interp(np.arange(a, b), idx, vals)
    x = np.linspace(0, span - 1, POINTS)
    out = np.interp(x, np.arange(span), line)
    return [round(float(z), 3) for z in out], span * 0.01, cover, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--fresh", action="store_true", help="re-run Praat instead of using b_feats.pkl")
    args = ap.parse_args()
    t0 = time.time()
    meta = json.loads(META.read_text(encoding="utf-8"))
    keys = sorted(meta)
    feats = {} if args.fresh or not CACHE.exists() else pickle.loads(CACHE.read_bytes())
    todo = [k for k in keys if k not in feats]
    if todo:
        with ProcessPoolExecutor(max_workers=4) as ex:
            for i, (k, f) in enumerate(ex.map(extract_one, todo, chunksize=8)):
                feats[k] = f
                if i % 300 == 0:
                    print(f"  extracted {i}/{len(todo)} {time.time() - t0:.0f}s", flush=True)
    print(f"pitch: {len(keys) - len(todo)} from cache, {len(todo)} extracted")

    res, spans, covers, skipped = {}, [], [], {}
    for k in keys:
        vals, span, cover, why = melody(feats.get(k))
        if vals is None:
            skipped[why] = skipped.get(why, 0) + 1
            continue
        res[k] = vals
        spans.append(span)
        covers.append(cover)
    OUT.write_text(json.dumps(res, ensure_ascii=False), encoding="utf-8")

    c = np.array(covers)
    print(f"measured {len(res)}/{len(keys)}  omitted {skipped}")
    print(f"median span {np.median(spans):.2f}s (p10 {np.percentile(spans, 10):.2f}, p90 {np.percentile(spans, 90):.2f})")
    print("voiced coverage: p10 {:.2f}  p25 {:.2f}  median {:.2f}  p75 {:.2f}  p90 {:.2f}".format(
        *np.percentile(c, [10, 25, 50, 75, 90])))
    edges = [0.25, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.01]
    h, _ = np.histogram(c, edges)
    print("  " + "  ".join(f"{lo:.2f}-{min(hi, 1):.2f}:{n}" for lo, hi, n in zip(edges[:-1], edges[1:], h)))
    print(f"run time {time.time() - t0:.1f}s  wrote {OUT}")


if __name__ == "__main__":
    sys.exit(main())
