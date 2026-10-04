"""Pitch check: F0 per clip, syllable segmentation, a transparent tone
classifier, four-voice agreement and the median reference curve the app draws.

No AI model judges tones. This is plain signal processing plus a hand-built
feature classifier whose prototype table can be printed and read.

1. F0: librosa.pyin (probabilistic YIN), 10 ms hop, search range by voice sex,
   octave jumps removed (frames more than 7 semitones from a running median).
2. Speaker level (the app's convention, score.ts rangeFromMid): curves are
   semitones around the voice's mid-tone level, 0 = mid - 5 st, 1 = mid + 5 st,
   stored clamped to 0..1. "Mid" is the median F0 of the voice's mid-tone
   syllables (expected tone from the text) across its clips; when those are
   scarce, the geometric midpoint of its 5th-95th percentile F0; else the
   app's default (m 120 Hz, f 210 Hz). The audition's 60 tone words (16 of
   them mid) give each voice its level first.
3. Syllables: when STT word times exist, syllables are shared out over the
   words in proportion to duration and each word is split at energy/voicing
   dips; otherwise the whole clip is split at voicing gaps and energy dips
   until the count matches the expected syllable count.
4. Each syllable's voiced F0 is resampled to 16 points (internal gaps up to
   50 ms interpolated, longer gaps stay null).
5. Classifier: seven features of the 16-point curve
     onset   mean of points 0-2          offset  mean of points 13-15
     mean    mean level                  slope   linear-fit slope over the syllable
     curv    quadratic coefficient (+ = dip then rise, - = rise then fall)
     peak    position of the maximum     dip     position of the minimum
   Each tone has a prototype value per feature and each feature a spread; the
   score of a tone is the Gaussian log-likelihood (diagonal, shared spreads),
   turned into probabilities with a softmax. Duration is used as a phonotactic
   prior only: a syllable much shorter than its neighbours is probably a dead
   syllable, which in Thai cannot carry mid or rising tone.
   The prior prototypes are the features of the app's canonical shapes
   (sound.ts toneShape, the templates in score.ts), so no training data is
   needed. `calibrate()` re-estimates prototypes and spreads from labelled
   curves (the qualification words); the result is saved to tone_model.json
   and printed on the audition page.
6. The app's own classifier (score.ts classifyTone: template distance over
   level and slope with a small register shift, softmax tau 0.008) is ported
   as app_classify(). A syllable matches only when both classifiers hear the
   expected tone; it is a confident miss (clip rejected) when either one gives
   another tone with probability above 0.7. So every reference curve shipped
   is one the app itself classifies as its tone.
"""

from __future__ import annotations

import json
import math
from dataclasses import asdict, dataclass, field
from pathlib import Path

import numpy as np

from ..providers.speech import TONES, tone_shape, voice_sex
from .encode import SR

HOP = 160  # 10 ms at 16 kHz
FRAME = 640
N_POINTS = 16
FEATURES = ("onset", "offset", "mean", "slope", "curv", "peak", "dip")
CONFIDENT = 0.7  # research report: reject a mismatch only above this confidence

# ---------- F0 ----------


@dataclass
class Track:
    f0: np.ndarray  # Hz, nan where unvoiced
    rms_db: np.ndarray  # frame energy relative to the clip's loudest frame
    hop_s: float = HOP / SR

    def to_npz(self, path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        np.savez_compressed(path, f0=self.f0, rms_db=self.rms_db)

    @staticmethod
    def from_npz(path: Path) -> "Track":
        d = np.load(path)
        return Track(d["f0"], d["rms_db"])


def f0_range(sex: str | None) -> tuple[float, float]:
    if sex == "f":
        return 110.0, 520.0
    if sex == "m":
        return 60.0, 320.0
    return 60.0, 520.0


def extract(x: np.ndarray, sr: int = SR, sex: str | None = None) -> Track:
    import librosa

    if sr != SR:
        x = librosa.resample(x, orig_sr=sr, target_sr=SR)
    x = np.asarray(x, dtype=np.float32)
    if len(x) < FRAME * 2:
        x = np.pad(x, (0, FRAME * 2 - len(x)))
    fmin, fmax = f0_range(sex)
    f0, vflag, vprob = librosa.pyin(x, fmin=fmin, fmax=fmax, sr=SR, frame_length=FRAME, hop_length=HOP,
                                    n_thresholds=50, resolution=0.1)
    rms = librosa.feature.rms(y=x, frame_length=FRAME, hop_length=HOP, center=True)[0]
    n = min(len(f0), len(rms))
    f0, rms, vprob = f0[:n].astype(float), rms[:n], vprob[:n]
    rms_db = 20 * np.log10(rms / (rms.max() + 1e-12) + 1e-9)
    f0[(rms_db < -35) | ~vflag[:n]] = np.nan
    f0 = _deoctave(f0)
    return Track(f0, rms_db)


def _deoctave(f0: np.ndarray) -> np.ndarray:
    """Drop octave jumps: frames > 7 st from a running median of voiced frames."""
    st = 12 * np.log2(f0 / 100.0)
    v = ~np.isnan(st)
    if v.sum() < 5:
        return f0
    out = f0.copy()
    idx = np.where(v)[0]
    vals = st[idx]
    k = 7
    for j, i in enumerate(idx):
        lo, hi = max(0, j - k), min(len(idx), j + k + 1)
        if abs(vals[j] - np.median(vals[lo:hi])) > 7:
            out[i] = np.nan
    return out


# ---------- speaker profiles ----------

SPAN_ST = 10.0  # app score.ts DEFAULT_SPAN_ST: floor = mid - 5 st, ceiling = mid + 5 st
DEFAULT_MID = {"m": 120.0, "f": 210.0}  # app score.ts DEFAULT_MID_HZ


@dataclass
class Profile:
    """A voice's mid-tone level. Curves are semitones around it:
    0 = mid - 5 st, 1 = mid + 5 st (the app's rangeFromMid)."""
    voice: str
    mid_hz: float
    source: str  # mid-syllables | range | default (+ ":qualification" when from the audition)
    frames: int = 0

    def norm(self, hz) -> np.ndarray:
        return (12 * np.log2(np.asarray(hz, float) / self.mid_hz) + SPAN_ST / 2) / SPAN_ST

    @property
    def floor_hz(self) -> float:
        return self.mid_hz * 2 ** (-SPAN_ST / 24)

    @property
    def ceil_hz(self) -> float:
        return self.mid_hz * 2 ** (SPAN_ST / 24)


def default_profile(voice: str) -> Profile:
    return Profile(voice, DEFAULT_MID[voice_sex(voice)], "default")


def _syllable_hz(tr: "Track", a: int, b: int) -> np.ndarray:
    """Voiced F0 in the middle half of a syllable (edges carry consonant effects)."""
    f = tr.f0[a:b]
    f = f[~np.isnan(f)]
    if len(f) < 4:
        return np.array([])
    q = len(f) // 4
    return f[q:len(f) - q] if len(f) - 2 * q >= 2 else f


def estimate_profile(voice: str, clips: list[tuple["Track", list[str] | None, list[dict] | None]],
                     source: str = "", min_mid_syl: int = 5) -> Profile:
    """Mid level = median F0 of the voice's mid-tone syllables (expected tone
    mid, from the text) across its clips; if there are too few, the geometric
    midpoint of its 5th-95th percentile F0; else the app's default by sex."""
    mids: list[np.ndarray] = []
    allv: list[np.ndarray] = []
    for tr, tones, words in clips:
        v = tr.f0[~np.isnan(tr.f0)]
        allv.append(v)
        if not tones or "mid" not in tones:
            continue
        spans, _ = segment(tr, len(tones), words)
        if len(spans) != len(tones):
            continue
        for (a, b), t in zip(spans, tones):
            if t == "mid":
                hz = _syllable_hz(tr, a, b)
                if len(hz):
                    mids.append(hz)
    suffix = f":{source}" if source else ""
    if len(mids) >= min_mid_syl:
        vals = np.concatenate(mids)
        return Profile(voice, float(np.median(vals)), "mid-syllables" + suffix, int(len(vals)))
    vals = np.concatenate(allv) if allv else np.array([])
    if len(vals) >= 200:
        lo, hi = np.percentile(vals, 5), np.percentile(vals, 95)
        return Profile(voice, float(np.sqrt(lo * hi)), "range" + suffix, int(len(vals)))
    return default_profile(voice)


def load_profiles(path: Path) -> dict[str, Profile]:
    if not path.exists():
        return {}
    out = {}
    for k, v in json.loads(path.read_text(encoding="utf8")).items():
        try:
            out[k] = Profile(v["voice"], float(v["mid_hz"]), v.get("source", "file"), int(v.get("frames", 0)))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def save_profiles(path: Path, profiles: dict[str, Profile]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({k: {**asdict(v), "floor_hz": round(v.floor_hz, 2), "ceil_hz": round(v.ceil_hz, 2)}
                                for k, v in profiles.items()}, indent=1), encoding="utf8")


# ---------- segmentation ----------


def _runs(mask: np.ndarray, a: int, b: int, min_len: int = 3) -> list[list[int]]:
    out, s = [], None
    for i in range(a, b):
        if mask[i] and s is None:
            s = i
        elif not mask[i] and s is not None:
            if i - s >= min_len:
                out.append([s, i])
            s = None
    if s is not None and b - s >= min_len:
        out.append([s, b])
    return out


def _split_span(tr: Track, a: int, b: int, k: int) -> list[tuple[int, int]]:
    """Split frames [a, b) into k syllables at voicing gaps, then energy dips."""
    voiced = ~np.isnan(tr.f0)
    runs = _runs(voiced, a, b)
    if not runs:
        runs = _runs(tr.rms_db > -30, a, b) or [[a, b]]
    # merge the closest neighbours while there are too many
    while len(runs) > k:
        gaps = [runs[i + 1][0] - runs[i][1] for i in range(len(runs) - 1)]
        # a very short run is merged first, whatever its gap
        lens = [r[1] - r[0] for r in runs]
        sm = int(np.argmin(lens))
        if lens[sm] < 6:
            j = sm - 1 if sm == len(runs) - 1 or (sm > 0 and gaps[sm - 1] <= gaps[sm]) else sm
        else:
            j = int(np.argmin(gaps))
        runs[j] = [runs[j][0], runs[j + 1][1]]
        del runs[j + 1]
    # split the longest run at its deepest energy dip while there are too few
    e = np.convolve(tr.rms_db, np.ones(3) / 3, mode="same")
    while len(runs) < k:
        j = int(np.argmax([r[1] - r[0] for r in runs]))
        s, t = runs[j]
        if t - s < 4:
            break
        lo, hi = s + max(2, int(0.2 * (t - s))), t - max(2, int(0.2 * (t - s)))
        if hi <= lo:
            cut = (s + t) // 2
        else:
            seg = e[lo:hi]
            m = int(np.argmin(seg))
            depth = min(e[s:lo + m + 1].max(), e[lo + m:t].max()) - seg[m]
            cut = lo + m if depth > 3 else (s + t) // 2
        runs[j:j + 1] = [[s, cut], [cut, t]]
    return [(r[0], r[1]) for r in runs]


def segment(tr: Track, n_syl: int, words: list[dict] | None = None) -> tuple[list[tuple[int, int]], str]:
    n = len(tr.f0)
    words = [w for w in (words or []) if w.get("end", 0) > w.get("start", 0)]
    if words and len(words) <= n_syl:
        spans = [(max(0, int(w["start"] / tr.hop_s)), min(n, int(math.ceil(w["end"] / tr.hop_s)))) for w in words]
        spans = [s for s in spans if s[1] - s[0] >= 3]
        if spans:
            # share the syllables out over the words by duration, at least one each
            durs = np.array([b - a for a, b in spans], float)
            share = np.ones(len(spans), int)
            for _ in range(n_syl - len(spans)):
                share[int(np.argmax(durs / (share + 1)))] += 1
            out: list[tuple[int, int]] = []
            for (a, b), k in zip(spans, share):
                out += _split_span(tr, a, b, int(k))
            if len(out) == n_syl:
                return out, "stt-words"
    return _split_span(tr, 0, n, n_syl), "energy"


# ---------- curves ----------


def syllable_curve(tr: Track, a: int, b: int, prof: Profile) -> list[float | None] | None:
    f0 = tr.f0[a:b]
    idx = np.where(~np.isnan(f0))[0]
    if len(idx) < 4:
        return None
    if idx[-1] - idx[0] >= 10:  # skip consonant transitions at the edges
        idx = idx[(idx >= idx[0] + 1) & (idx <= idx[-1] - 1)]
    s, t = idx[0], idx[-1]
    seg = f0[s:t + 1]
    v = prof.norm(seg)
    good = ~np.isnan(v)
    pos = np.arange(len(v))
    filled = np.interp(pos, pos[good], v[good])
    # gaps longer than 5 frames (50 ms) stay null
    gap = np.zeros(len(v), bool)
    run = 0
    for i in range(len(v)):
        run = run + 1 if not good[i] else 0
        if run > 5:
            gap[i - run + 1:i + 1] = True
    q = np.linspace(0, len(v) - 1, N_POINTS)
    pts = np.interp(q, pos, filled)
    holes = np.interp(q, pos, gap.astype(float)) > 0.5
    return [None if h else round(float(p), 4) for p, h in zip(pts, holes)]


def _filled(curve: list[float | None]) -> np.ndarray:
    c = np.array([np.nan if p is None else p for p in curve], float)
    g = ~np.isnan(c)
    if not g.any():
        return np.full(N_POINTS, 0.5)
    pos = np.arange(N_POINTS)
    return np.interp(pos, pos[g], c[g])


# ---------- classifier ----------


def features(curve) -> dict[str, float]:
    v = _filled(curve) if not isinstance(curve, np.ndarray) else curve
    t = np.linspace(0, 1, len(v))
    sm = np.convolve(np.pad(v, 1, mode="edge"), np.ones(3) / 3, mode="valid")
    c2, c1, _ = np.polyfit(t, v, 2)
    slope = np.polyfit(t, v, 1)[0]
    return {
        "onset": float(v[:3].mean()),
        "offset": float(v[-3:].mean()),
        "mean": float(v.mean()),
        "slope": float(slope),
        "curv": float(c2),
        "peak": float(np.argmax(sm) / (len(v) - 1)),
        "dip": float(np.argmin(sm) / (len(v) - 1)),
    }


def template(tone: str) -> np.ndarray:
    """The app's canonical shape (sound.ts toneShape, score.ts toneTemplates)."""
    return tone_shape(tone, N_POINTS)


# ---------- the app's classifier, ported (app/src/audio/score.ts classifyTone) ----------

APP_CLASSIFIER = {"slope": 0.4, "maxShift": 0.1, "shiftPenalty": 0.3, "tau": 0.008}


def _deltas(v: np.ndarray) -> np.ndarray:
    n = len(v)
    out = np.empty(n)
    for i in range(n):
        a, b = max(0, i - 1), min(n - 1, i + 1)
        out[i] = (v[b] - v[a]) / (b - a) * (n - 1)
    return out


_APP_T = {t: tone_shape(t, N_POINTS) for t in TONES}
_APP_DT = {t: _deltas(v) for t, v in _APP_T.items()}


def app_classify(curve, w: dict = APP_CLASSIFIER) -> tuple[str, dict[str, float]]:
    """Exactly what the app computes for a learner contour, so the pipeline's
    reference curves classify the same way on both sides."""
    c = np.clip(_filled(curve) if not isinstance(curve, np.ndarray) else curve, 0, 1)
    dc = _deltas(c)
    dist = {}
    for t in TONES:
        T = _APP_T[t]
        shift = float(np.clip(np.mean(c - T), -w["maxShift"], w["maxShift"]))
        lvl = float(np.mean((c - shift - T) ** 2))
        slope = float(np.mean((dc - _APP_DT[t]) ** 2))
        dist[t] = lvl + w["slope"] * slope + w["shiftPenalty"] * shift * shift
    mn = min(dist.values())
    ex = {t: math.exp(-(dist[t] - mn) / w["tau"]) for t in TONES}
    z = sum(ex.values())
    probs = {t: ex[t] / z for t in TONES}
    return max(probs, key=probs.get), probs


PRIOR_SIGMA = {"onset": 0.13, "offset": 0.13, "mean": 0.11, "slope": 0.22, "curv": 0.6, "peak": 0.35, "dip": 0.35}
SIGMA_FLOOR = {"onset": 0.05, "offset": 0.05, "mean": 0.05, "slope": 0.08, "curv": 0.2, "peak": 0.15, "dip": 0.15}


@dataclass
class ToneModel:
    proto: dict[str, dict[str, float]]
    sigma: dict[str, float]
    source: str = "prior"
    weights: dict[str, float] = field(default_factory=lambda: {"peak": 0.5, "dip": 0.5})

    @staticmethod
    def prior() -> "ToneModel":
        return ToneModel({t: features(template(t)) for t in TONES}, dict(PRIOR_SIGMA), "prior")

    def classify(self, curve, dur_rel: float | None = None) -> tuple[str, float, dict[str, float], dict[str, float]]:
        f = features(curve)
        logp = {}
        for t in TONES:
            s = 0.0
            for k in FEATURES:
                z = (f[k] - self.proto[t][k]) / self.sigma[k]
                s -= 0.5 * self.weights.get(k, 1.0) * z * z
            if dur_rel is not None and dur_rel < 0.55 and t in ("mid", "rising"):
                s -= 1.0  # short = probably a dead syllable: no mid or rising tone
            logp[t] = s
        m = max(logp.values())
        ex = {t: math.exp(v - m) for t, v in logp.items()}
        z = sum(ex.values())
        probs = {t: ex[t] / z for t in TONES}
        best = max(probs, key=probs.get)
        return best, probs[best], probs, f

    def to_json(self) -> dict:
        return {"proto": self.proto, "sigma": self.sigma, "source": self.source, "weights": self.weights}

    @staticmethod
    def from_json(d: dict) -> "ToneModel":
        return ToneModel(d["proto"], d["sigma"], d.get("source", "file"), d.get("weights", {"peak": 0.5, "dip": 0.5}))

    def table(self) -> str:
        head = "tone     " + " ".join(f"{k:>7}" for k in FEATURES)
        rows = [f"{t:<8} " + " ".join(f"{self.proto[t][k]:7.2f}" for k in FEATURES) for t in TONES]
        rows.append("spread   " + " ".join(f"{self.sigma[k]:7.2f}" for k in FEATURES))
        return "\n".join([head, *rows])


def calibrate(labelled: list[tuple[list, str]], base: ToneModel | None = None, min_per_tone: int = 4) -> ToneModel:
    """Re-estimate prototypes (per-tone feature means) and shared spreads (pooled
    within-tone standard deviation) from curves with known tones. Tones with
    too few examples keep the base prototype."""
    base = base or ToneModel.prior()
    by: dict[str, list[dict]] = {t: [] for t in TONES}
    for curve, tone in labelled:
        if curve is not None and tone in by:
            by[tone].append(features(curve))
    proto = {t: dict(base.proto[t]) for t in TONES}
    resid: dict[str, list[float]] = {k: [] for k in FEATURES}
    for t, fs in by.items():
        if len(fs) < min_per_tone:
            continue
        for k in FEATURES:
            vals = np.array([f[k] for f in fs])
            proto[t][k] = float(vals.mean())
            resid[k] += list(vals - vals.mean())
    sigma = {}
    for k in FEATURES:
        sigma[k] = max(SIGMA_FLOOR[k], float(np.std(resid[k]))) if len(resid[k]) >= 10 else base.sigma[k]
    return ToneModel(proto, sigma, f"calibrated:{len(labelled)}")


def load_model(path: Path | None) -> ToneModel:
    if path and path.exists():
        try:
            return ToneModel.from_json(json.loads(path.read_text(encoding="utf8")))
        except Exception:
            pass
    return ToneModel.prior()


# ---------- clip analysis ----------


@dataclass
class SylResult:
    expected: str | None
    tone: str | None
    conf: float
    probs: dict[str, float]
    curve: list[float | None] | None
    dur_s: float
    dur_rel: float
    app_tone: str | None = None
    app_probs: dict[str, float] = field(default_factory=dict)

    @property
    def match(self) -> bool:
        """Both the feature classifier and the app's classifier hear the expected tone."""
        return self.tone is not None and self.tone == self.expected and (self.app_tone in (None, self.expected))

    @property
    def confident_miss(self) -> bool:
        if self.tone is None or self.expected is None:
            return False
        feat = self.tone != self.expected and self.conf > CONFIDENT
        app = self.app_tone is not None and self.app_tone != self.expected and self.app_probs.get(self.app_tone, 0) > CONFIDENT
        return feat or app


@dataclass
class ClipPitch:
    voice: str
    method: str
    syllables: list[SylResult]

    @property
    def tones(self) -> list[str | None]:
        return [s.tone for s in self.syllables]

    @property
    def curves(self) -> list[list[float | None] | None]:
        return [s.curve for s in self.syllables]

    @property
    def score(self) -> float:
        if not self.syllables:
            return 0.0
        return sum(s.match for s in self.syllables) / len(self.syllables)

    def passed(self, strict: bool) -> bool:
        syl = self.syllables
        if not syl:
            return False
        if strict:
            return all(s.curve is not None and not s.confident_miss for s in syl)
        judged = [s for s in syl if s.dur_rel >= 0.5]
        misses = sum(s.confident_miss for s in judged)
        return misses <= max(0, int(0.1 * len(syl))) and self.score >= 0.7

    def to_json(self) -> dict:
        return {"voice": self.voice, "method": self.method, "score": round(self.score, 3),
                "syllables": [{"expected": s.expected, "tone": s.tone, "conf": round(s.conf, 3), "app": s.app_tone,
                               "dur": round(s.dur_s, 3), "curve": s.curve} for s in self.syllables]}


def analyse(tr: Track, expected: list[str], prof: Profile, model: ToneModel, words: list[dict] | None = None,
            voice: str = "") -> ClipPitch:
    n = max(1, len(expected))
    spans, method = segment(tr, n, words)
    durs = [(b - a) * tr.hop_s for a, b in spans]
    med = float(np.median(durs)) if durs else 1.0
    out = []
    for i, (a, b) in enumerate(spans):
        exp = expected[i] if i < len(expected) else None
        curve = syllable_curve(tr, a, b, prof)
        rel = durs[i] / med if med > 0 else 1.0
        if curve is None:
            out.append(SylResult(exp, None, 0.0, {}, None, durs[i], rel))
            continue
        tone, conf, probs, _ = model.classify(curve, rel if len(spans) > 1 else None)
        at, ap = app_classify(curve)
        out.append(SylResult(exp, tone, conf, probs, curve, durs[i], rel, at, ap))
    return ClipPitch(voice, method, out)


# ---------- across voices ----------


def agreement(results: list[ClipPitch]) -> tuple[float, list[str]]:
    """Four-voice agreement: mean over syllables of the share of voices that
    give the majority label. Returns (agreement, outlier voices). A voice is an
    outlier where at least three voices agree on a syllable and it does not, or
    where its curve is far from the others' median curve."""
    res = [r for r in results if r.syllables]
    if len(res) < 2:
        return 1.0, []
    n = min(len(r.syllables) for r in res)
    shares, outliers = [], set()
    for i in range(n):
        labels = [r.syllables[i].tone for r in res]
        counts = {t: labels.count(t) for t in set(labels) if t}
        if not counts:
            shares.append(0.0)
            continue
        top = max(counts, key=counts.get)
        shares.append(counts[top] / len(res))
        if counts[top] >= 3:
            outliers |= {r.voice for r in res if r.syllables[i].tone != top}
    med = median_curves([r.curves for r in res])
    for r in res:
        d = []
        for c, m in zip(r.curves, med):
            if c is None or m is None:
                continue
            a = np.array([np.nan if p is None else p for p in c], float)
            b = np.array([np.nan if p is None else p for p in m], float)
            ok = ~np.isnan(a) & ~np.isnan(b)
            if ok.any():
                d.append(float(np.sqrt(np.mean((a[ok] - b[ok]) ** 2))))
        if d and np.mean(d) > 0.3 and len(res) >= 3:
            outliers.add(r.voice)
    return float(np.mean(shares)) if shares else 0.0, sorted(outliers)


def median_curves(per_voice: list[list[list[float | None] | None]]) -> list[list[float | None] | None]:
    """Element-wise median over voices, nulls ignored (needs two values),
    clipped to 0..1 for the app."""
    if not per_voice:
        return []
    n = max(len(c) for c in per_voice)
    out: list[list[float | None] | None] = []
    for i in range(n):
        cols = [c[i] for c in per_voice if i < len(c) and c[i] is not None]
        if not cols:
            out.append(None)
            continue
        pts: list[float | None] = []
        for j in range(N_POINTS):
            vals = [c[j] for c in cols if c[j] is not None]
            need = 2 if len(cols) >= 2 else 1
            pts.append(round(float(np.clip(np.median(vals), 0, 1)), 3) if len(vals) >= need else None)
        out.append(pts)
    return out
