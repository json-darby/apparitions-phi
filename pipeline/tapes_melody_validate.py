"""Validate the app's melody match (score.ts melodySimilarity/dtwDistance) on
real recordings: SAME sentence by a man vs a woman against DIFF-TONE pairs.

Exact port of app/src/audio/score.ts: resampleSeries, deltas, dtwDistance
(band round(48*0.2)=10, slopeWeight 0.04), centred, melodySimilarity
(exp(-(d/0.2)^2)). Reads pipeline/work/tapes_pitch/{melody,meta}.json.
"""
import json
import math
import random
import sys
from pathlib import Path

HERE = Path(__file__).parent / "work" / "tapes_pitch"
POINTS = 48
BAND = round(POINTS * 0.2)
PARTICLES = {"ครับ", "ค่ะ", "คะ", "ขา", "ครับผม", "ค๊ะ", "จ้ะ", "จ้า"}
PRONOUNS = {"ผม", "ดิฉัน", "ฉัน"}


def resample(v, m=POINTS):
    if not v:
        return []
    if len(v) == 1:
        return [v[0]] * m
    out = []
    for i in range(m):
        p = (i / (m - 1)) * (len(v) - 1)
        a = math.floor(p)
        b = min(len(v) - 1, a + 1)
        out.append(v[a] + (v[b] - v[a]) * (p - a))
    return out


def deltas(v):
    n = len(v)
    out = []
    for i in range(n):
        lo, hi = max(0, i - 1), min(n - 1, i + 1)
        out.append((v[hi] - v[lo]) / (hi - lo) * (n - 1))
    return out


def dtw(a, b, band=3, slope_weight=0.04):
    n, m = len(a), len(b)
    da, db = deltas(a), deltas(b)
    INF = 1e9
    D = [[INF] * (m + 1) for _ in range(n + 1)]
    L = [[0] * (m + 1) for _ in range(n + 1)]
    D[0][0] = 0.0
    w = max(band, abs(n - m))
    for i in range(1, n + 1):
        # JS Math.round: half up
        jc = math.floor(i * m / n + 0.5)
        Di1, Li1, Di, Li = D[i - 1], L[i - 1], D[i], L[i]
        for j in range(max(1, jc - w), min(m, jc + w) + 1):
            cost = (a[i - 1] - b[j - 1]) ** 2 + slope_weight * (da[i - 1] - db[j - 1]) ** 2
            best, ln = Di1[j - 1], Li1[j - 1]
            if Di1[j] < best:
                best, ln = Di1[j], Li1[j]
            if Di[j - 1] < best:
                best, ln = Di[j - 1], Li[j - 1]
            Di[j] = best + cost
            Li[j] = ln + 1
    return math.sqrt(D[n][m] / max(1, L[n][m]))


def centred(v):
    mu = sum(v) / len(v)
    return [x - mu for x in v]


def sim(d, k=0.2):
    return math.exp(-((d / k) ** 2))


def core(meta):
    syl = list(meta["syl"])
    tones = list(meta["tones"])
    n = len(syl)
    while syl and syl[-1] in PARTICLES:
        syl.pop()
        tones.pop()
    return tuple("PRON" if s in PRONOUNS else s for s in syl), tuple(tones), n


def line(mel, keep, total):
    """First keep/total of the line, resampled to 48, mean removed."""
    m = len(mel)
    cut = max(2, round(m * keep / total)) if total else m
    return centred(resample(mel[:cut]))


def stats(xs):
    xs = sorted(xs)
    q = lambda p: xs[min(len(xs) - 1, int(p * (len(xs) - 1) + 0.5))]
    return f"n={len(xs):5d} med={q(.5):.3f} p10={q(.1):.3f} p90={q(.9):.3f}"


def auc(pos, neg):
    allv = sorted([(x, 1) for x in pos] + [(x, 0) for x in neg])
    # rank-sum with ties averaged
    ranks, i = {}, 0
    r_pos = 0.0
    while i < len(allv):
        j = i
        while j < len(allv) and allv[j][0] == allv[i][0]:
            j += 1
        avg = (i + j + 1) / 2
        r_pos += avg * sum(1 for k in range(i, j) if allv[k][1])
        i = j
    np_, nn = len(pos), len(neg)
    return (r_pos - np_ * (np_ + 1) / 2) / (np_ * nn)


def best_threshold(pos, neg):
    """Balanced accuracy at the best cut (mean of the two class accuracies)."""
    best = (0, 0)
    for t in sorted(set(pos + neg)):
        acc = 0.5 * (sum(x >= t for x in pos) / len(pos) + sum(x < t for x in neg) / len(neg))
        if acc > best[0]:
            best = (acc, t)
    return best


def bucket(n):
    return "1-2" if n <= 2 else ("3-5" if n <= 5 else "6+")


def main():
    random.seed(7)
    mel = json.loads((HERE / "melody.json").read_text(encoding="utf-8"))
    meta = json.loads((HERE / "meta.json").read_text(encoding="utf-8"))
    keys = [k for k in mel if k in meta and meta[k].get("who") in ("m", "f")
            and len(mel[k]) >= 2 and all(isinstance(x, (int, float)) and math.isfinite(x) for x in mel[k])]
    info = {k: core(meta[k]) for k in keys}
    print(f"clips with m/f speaker and a melody: {len(keys)} (of {len(mel)})")

    same = []  # (k1, k2, ncore)
    by_core = {}
    for k in keys:
        c, _, _ = info[k]
        if c:
            by_core.setdefault(c, []).append(k)
    for c, ks in by_core.items():
        for i in range(len(ks)):
            for j in range(i + 1, len(ks)):
                if meta[ks[i]]["who"] != meta[ks[j]]["who"]:
                    same.append((ks[i], ks[j], len(c)))

    diff = []
    by_len = {}
    for k in keys:
        c, t, _ = info[k]
        if c:
            by_len.setdefault(len(c), []).append(k)
    for n, ks in by_len.items():
        cand = []
        for i in range(len(ks)):
            for j in range(i + 1, len(ks)):
                a, b = ks[i], ks[j]
                if meta[a]["who"] == meta[b]["who"]:
                    continue
                ta, tb = info[a][1], info[b][1]
                ham = sum(x != y for x, y in zip(ta, tb))
                if ham >= n / 2 and info[a][0] != info[b][0]:
                    cand.append((a, b, n))
        random.shuffle(cand)
        diff += cand[:400]  # cap per length to keep runtime sane

    def score_pairs(pairs):
        out = []
        for a, b, n in pairs:
            ca, ta, na = info[a]
            cb, tb, nb = info[b]
            la = line(mel[a], len(ca), na)
            lb = line(mel[b], len(cb), nb)
            out.append((dtw(la, lb, BAND), n))
        return out

    S = score_pairs(same)
    Dd = score_pairs(diff)
    print(f"SAME pairs {len(S)}, DIFF pairs {len(Dd)}\n")

    for k in (0.2, 0.15, 0.12, 0.1, 0.08):
        sp = [sim(d, k) for d, _ in S]
        dn = [sim(d, k) for d, _ in Dd]
        print(f"k={k}: SAME {stats(sp)} | DIFF {stats(dn)}")
    dS = [d for d, _ in S]
    dD = [d for d, _ in Dd]
    print(f"\nraw DTW distance: SAME {stats(dS)} | DIFF {stats(dD)}")
    sp = [sim(d) for d in dS]
    dn = [sim(d) for d in dD]
    a = auc(sp, dn)
    acc, t = best_threshold(sp, dn)
    print(f"\nk=0.2  AUC={a:.3f}  best balanced acc={acc:.3f} at sim>={t:.3f} (d<={0.2*math.sqrt(-math.log(t)) if t>0 else float('inf'):.3f})")

    print("\nby syllable count (core syllables), k=0.2:")
    for b in ("1-2", "3-5", "6+"):
        sp = [sim(d) for d, n in S if bucket(n) == b]
        dn = [sim(d) for d, n in Dd if bucket(n) == b]
        if len(sp) < 3 or len(dn) < 3:
            print(f"  {b}: too few (SAME {len(sp)}, DIFF {len(dn)})")
            continue
        acc, t = best_threshold(sp, dn)
        print(f"  {b}: SAME {stats(sp)} | DIFF {stats(dn)} | AUC={auc(sp, dn):.3f} acc={acc:.3f}@{t:.3f}")


if __name__ == "__main__":
    sys.exit(main())
