"""Audio encoding helpers: decode anything to float PCM, loudness-normalise,
trim, and encode to OGG Opus mono with the ffmpeg binary bundled in
imageio-ffmpeg (free, no system install needed).

Every clip the app ships goes through `finish()`:

  decode -> trim edge silence (keeps a short pad) -> loudness-normalise to
  about -16 LUFS (pyloudnorm, ITU-R BS.1770) -> peak guard at -1 dBFS ->
  Opus 24 kbps mono.

At 24 kbps a 1.5 s word is about 4.5 KB, so 28,000 clips come to about
100-130 MB; `PHI_OPUS_KBPS` lowers it (20 kbps is still clean for speech).
"""

from __future__ import annotations

import io
import os
import struct
import subprocess
from dataclasses import dataclass

import numpy as np

SR = 16000  # analysis rate (pitch, STT, MOS)
OUT_SR = 24000  # Opus input rate for the shipped files
TARGET_LUFS = -16.0
PEAK_CEILING = 10 ** (-1.0 / 20)  # -1 dBFS


def opus_kbps() -> int:
    return int(os.environ.get("PHI_OPUS_KBPS", "24"))


_FFMPEG: str | None = None


def ffmpeg() -> str:
    global _FFMPEG
    if _FFMPEG is None:
        import imageio_ffmpeg

        _FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
    return _FFMPEG


def _run(args: list[str], data: bytes) -> bytes:
    p = subprocess.run([ffmpeg(), "-hide_banner", "-loglevel", "error", *args], input=data, capture_output=True)
    if p.returncode != 0:
        raise RuntimeError(f"ffmpeg failed: {p.stderr.decode('utf8', 'replace')[:400]}")
    return p.stdout


def wav_bytes(x: np.ndarray, sr: int) -> bytes:
    """Float [-1, 1] mono -> 16-bit PCM WAV bytes."""
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    hdr = b"RIFF" + struct.pack("<I", 36 + len(pcm)) + b"WAVE"
    hdr += b"fmt " + struct.pack("<IHHIIHH", 16, 1, 1, sr, sr * 2, 2, 16)
    hdr += b"data" + struct.pack("<I", len(pcm))
    return hdr + pcm


def decode(data: bytes, sr: int = SR) -> np.ndarray:
    """Any container ffmpeg reads -> float32 mono at `sr`."""
    if data[:4] == b"RIFF" and sr is not None:
        # fast path for our own WAVs at the right rate
        try:
            import soundfile as sf

            x, r = sf.read(io.BytesIO(data), dtype="float32", always_2d=True)
            x = x.mean(axis=1)
            if r == sr:
                return x
        except Exception:
            pass
    out = _run(["-i", "pipe:0", "-ac", "1", "-ar", str(sr), "-f", "f32le", "pipe:1"], data)
    return np.frombuffer(out, dtype="<f4").astype(np.float32)


def pcm16_to_wav(data: bytes, sr: int) -> bytes:
    """Raw little-endian 16-bit mono PCM (Gemini TTS 'PCM') -> WAV."""
    x = np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768
    return wav_bytes(x, sr)


def encode_ogg(x: np.ndarray, sr: int, tags: dict[str, str] | None = None, kbps: int | None = None) -> bytes:
    """Float mono -> OGG Opus bytes. `tags` become Opus comment tags."""
    meta: list[str] = []
    for k, v in (tags or {}).items():
        meta += ["-metadata", f"{k}={v}"]
    return _run(
        ["-f", "wav", "-i", "pipe:0", "-ac", "1", "-c:a", "libopus", "-b:a", f"{kbps or opus_kbps()}k",
         "-application", "voip", "-frame_duration", "20", *meta, "-f", "ogg", "pipe:1"],
        wav_bytes(x, sr),
    )


def read_opus_tags(data: bytes) -> dict[str, str]:
    """Parse the OpusTags comment packet (RFC 7845 §5.2). Small, so it sits in
    the first OGG pages; only single-page comment packets are handled."""
    i = data.find(b"OpusTags")
    if i < 0:
        return {}
    try:
        p = i + 8
        (vlen,) = struct.unpack_from("<I", data, p)
        p += 4 + vlen
        (n,) = struct.unpack_from("<I", data, p)
        p += 4
        out = {}
        for _ in range(n):
            (ln,) = struct.unpack_from("<I", data, p)
            p += 4
            s = data[p:p + ln].decode("utf8", "replace")
            p += ln
            if "=" in s:
                k, v = s.split("=", 1)
                out[k.upper()] = v
        return out
    except struct.error:
        return {}


# ---------- loudness and trimming ----------


def lufs(x: np.ndarray, sr: int) -> float:
    """Integrated loudness (BS.1770). Short clips are looped to the 400 ms gate."""
    import pyloudnorm

    if len(x) == 0 or np.max(np.abs(x)) < 1e-6:
        return -70.0
    y = x
    need = int(0.45 * sr)
    if len(y) < need:
        y = np.tile(y, int(np.ceil(need / len(y))))
    v = pyloudnorm.Meter(sr).integrated_loudness(y.astype(np.float64))
    return float(v) if np.isfinite(v) else -70.0


def normalise(x: np.ndarray, sr: int, target: float = TARGET_LUFS) -> tuple[np.ndarray, float, float]:
    """Gain to `target` LUFS, then a peak guard at -1 dBFS (gain only, never a
    clipper, so the tone shapes are untouched). Returns (audio, lufs_before,
    lufs_after)."""
    before = lufs(x, sr)
    if before <= -69:
        return x, before, before
    y = x * (10 ** ((target - before) / 20))
    pk = float(np.max(np.abs(y))) if len(y) else 0.0
    if pk > PEAK_CEILING:
        y = y * (PEAK_CEILING / pk)
    return y.astype(np.float32), before, lufs(y, sr)


def trim(x: np.ndarray, sr: int, pad_s: float = 0.08, floor_db: float = -45.0) -> np.ndarray:
    """Trim leading and trailing silence (relative to the clip's peak frame)."""
    hop = int(0.01 * sr)
    if len(x) < hop * 3:
        return x
    n = len(x) // hop
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    db = 20 * np.log10(rms / (rms.max() + 1e-12))
    on = np.where(db > floor_db)[0]
    if not len(on):
        return x
    a = max(0, on[0] * hop - int(pad_s * sr))
    b = min(len(x), (on[-1] + 1) * hop + int(pad_s * sr))
    return x[a:b]


@dataclass
class Finished:
    ogg: bytes
    pcm: np.ndarray  # analysis copy at SR, after processing
    seconds: float
    lufs_raw: float
    lufs_out: float


def to_float(data: bytes, mime: str, sr: int) -> np.ndarray:
    if mime in ("audio/l16", "audio/pcm"):
        return np.frombuffer(data, dtype="<i2").astype(np.float32) / 32768
    return decode(data, sr)


def finish(raw: np.ndarray, sr: int, tags: dict[str, str] | None = None) -> Finished:
    """Raw TTS audio (float, any rate) -> shipped OGG + analysis PCM."""
    y = trim(raw, sr)
    y, before, after = normalise(y, sr)
    if sr != OUT_SR:
        y_out = _resample(y, sr, OUT_SR)
    else:
        y_out = y
    ogg = encode_ogg(y_out, OUT_SR, tags=tags)
    pcm = _resample(y, sr, SR) if sr != SR else y
    return Finished(ogg, pcm, len(y) / sr, before, after)


def _resample(x: np.ndarray, a: int, b: int) -> np.ndarray:
    if a == b:
        return x
    from scipy.signal import resample_poly
    from math import gcd

    g = gcd(a, b)
    return resample_poly(x, b // g, a // g).astype(np.float32)
