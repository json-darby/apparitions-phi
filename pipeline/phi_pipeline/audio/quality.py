"""Per-clip quality checks beyond STT and pitch.

  clipping     raw TTS output (before any gain): runs of 3+ samples at full
               scale. Fails at 3 runs or 0.1% of samples.
  truncation   raw TTS output: the last 20 ms still within 25 dB of the
               loudest frame, i.e. the clip stops mid-sound.
  silence      shipped clip: the longest pause inside the speech. Fails above
               0.5 s (normal) / 0.75 s (slow) for words, 0.8 s / 1.2 s for
               sentences and lines.
  loudness     every shipped clip is normalised to -16 LUFS (pyloudnorm,
               BS.1770); the raw and shipped loudness are recorded, and the
               spread of raw loudness per voice is the audition's stability score.
  duration     slow / normal must be 1.15-1.7x for Chirp (speaking_rate 0.75
               gives about 1.33x) and 1.1-2.0x for Gemini voices (pace set by
               prompt); each voice's length must sit within 0.67-1.5x of the
               median of the voices saying the same text at the same speed;
               syllables must last 60 ms to 1.2 s on average.
  glitch       DNSMOS (Microsoft, MIT licence, the ONNX models bundled in the
               `speechmos` pip package, run locally on CPU with onnxruntime):
               a clip whose overall MOS is more than max(0.7, 4 robust SDs,
               i.e. 4 x 1.4826 x MAD) below its own voice's median is rejected as
               a glitch (needs 8+ clips of the voice). Only the primary
               sig_bak_ovr model is run (about 0.3 s a clip); P.808 is skipped.
"""

from __future__ import annotations

import os
import threading

import numpy as np

from .encode import SR

CLIP_LEVEL = 0.99
GLITCH_DROP = 0.7


def clipping(x: np.ndarray) -> dict:
    a = np.abs(x) >= CLIP_LEVEL
    n_full = int(a.sum())
    runs = 0
    if n_full:
        d = np.diff(np.concatenate([[0], a.astype(np.int8), [0]]))
        starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
        runs = int(np.sum((ends - starts) >= 3))
    frac = n_full / max(1, len(x))
    return {"clipping": "fail" if (runs >= 3 or frac > 0.001) else "pass", "clipRuns": runs, "clipFrac": round(frac, 5)}


def _frames_db(x: np.ndarray, sr: int, ms: float = 10) -> np.ndarray:
    hop = max(1, int(sr * ms / 1000))
    n = len(x) // hop
    if n == 0:
        return np.array([-120.0])
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(rms / (rms.max() + 1e-12) + 1e-12)


def truncation(x: np.ndarray, sr: int) -> dict:
    db = _frames_db(x, sr)
    tail = float(np.max(db[-2:])) if len(db) >= 2 else 0.0
    return {"truncation": "fail" if tail > -25 else "pass", "tailDb": round(tail, 1)}


def raw_checks(x: np.ndarray, sr: int) -> dict:
    return {**clipping(x), **truncation(x, sr)}


def internal_silence(x: np.ndarray, sr: int = SR) -> float:
    """Longest stretch below -40 dB (re the loudest frame) inside the speech."""
    db = _frames_db(x, sr)
    on = np.where(db > -40)[0]
    if len(on) < 2:
        return 0.0
    quiet = db[on[0]:on[-1] + 1] <= -40
    best = run = 0
    for q in quiet:
        run = run + 1 if q else 0
        best = max(best, run)
    return best * 0.01


def silence_limit(speed: str, sentence: bool) -> float:
    base = 0.8 if sentence else 0.5
    return base * (1.5 if speed == "slow" else 1.0)


def speech_seconds(x: np.ndarray, sr: int = SR) -> float:
    db = _frames_db(x, sr)
    on = np.where(db > -40)[0]
    return float((on[-1] - on[0] + 1) * 0.01) if len(on) else 0.0


def slow_ratio_ok(ratio: float, chirp: bool) -> bool:
    lo, hi = (1.15, 1.7) if chirp else (1.1, 2.0)
    return lo <= ratio <= hi


def voice_spread_ok(dur: float, median: float) -> bool:
    return median <= 0 or 0.67 <= dur / median <= 1.5


def syllable_rate_ok(dur: float, n_syl: int) -> bool:
    if not n_syl:
        return True
    per = dur / n_syl
    return 0.06 <= per <= 1.2


# ---------- MOS ----------

_mos_lock = threading.Lock()
_mos_sess = None


def mos_available() -> bool:
    try:
        import onnxruntime  # noqa: F401
        import speechmos  # noqa: F401

        return True
    except Exception:
        return False


def _session():
    global _mos_sess
    with _mos_lock:
        if _mos_sess is None:
            import onnxruntime as ort
            import speechmos

            so = ort.SessionOptions()
            so.intra_op_num_threads = int(os.environ.get("PHI_MOS_THREADS", "2"))
            path = os.path.join(os.path.dirname(speechmos.__file__), "dnsmos_models", "sig_bak_ovr.onnx")
            _mos_sess = ort.InferenceSession(path, so, providers=["CPUExecutionProvider"])
        return _mos_sess


_POLY_OVR = np.poly1d([-0.06766283, 1.11546468, 0.04602535])
_POLY_SIG = np.poly1d([-0.08397278, 1.22083953, 0.0052439])


def mos(x: np.ndarray, sr: int = SR) -> dict:
    """DNSMOS P.835 (SIG and OVRL, 1-5). Short clips are looped to the
    model's 9.01 s window, as the reference implementation does."""
    if sr != SR:
        raise ValueError("DNSMOS needs 16 kHz")
    need = int(9.01 * SR)
    y = np.asarray(x, np.float32)
    if len(y) == 0:
        return {"mos": 0.0, "mosSig": 0.0}
    y = np.clip(y, -1, 1)
    while len(y) < need:
        y = np.concatenate([y, y])
    seg = y[:need][None, :]
    sig, bak, ovr = _session().run(None, {"input_1": seg})[0][0]
    return {"mos": round(float(_POLY_OVR(ovr)), 3), "mosSig": round(float(_POLY_SIG(sig)), 3)}


def glitch(score: float | None, voice_stats: tuple[float, float] | float | None) -> str:
    """voice_stats: (median, MAD) of the voice's MOS. A clip fails when it is
    more than max(0.7, 4 robust standard deviations) below the median."""
    if score is None or voice_stats is None:
        return "n/a"
    med, mad = voice_stats if isinstance(voice_stats, tuple) else (voice_stats, 0.0)
    return "fail" if score < med - max(GLITCH_DROP, 4 * 1.4826 * mad) else "pass"
