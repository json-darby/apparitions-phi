"""Clip analysis shared by the audio check and the voice audition: STT
back-transcription, F0 track, MOS, silences and lengths, cached by the
file's content hash so a re-run never pays for the same clip twice."""

from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

from ..providers.base import Audio
from . import encode, pitch, quality, stt_check
from .encode import SR


class Cache:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self.data: dict[str, dict] = {}
        if path.exists():
            try:
                self.data = json.loads(path.read_text(encoding="utf8"))
            except json.JSONDecodeError:
                self.data = {}

    def get(self, k: str) -> dict:
        with self._lock:
            return dict(self.data.get(k, {}))

    def put(self, k: str, v: dict) -> None:
        with self._lock:
            self.data[k] = v

    def save(self) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, ensure_ascii=False), encoding="utf8")
            tmp.replace(self.path)


def sha(data: bytes) -> str:
    return hashlib.sha1(data).hexdigest()[:16]


@dataclass
class Analysis:
    sha: str
    entry: dict  # stt, cmp, silence, speech, seconds, mos, mosSig
    track: pitch.Track
    pcm_seconds: float
    extra: dict = field(default_factory=dict)

    @property
    def words(self) -> list[dict]:
        return (self.entry.get("stt") or {}).get("words") or []


def analyse(speech, data: bytes, *, intended: str, kind: str, voice: str, sex: str, cache: Cache, f0_dir: Path,
            stage: str = "audio-check", do_stt: bool = True, do_mos: bool = True) -> Analysis:
    h = sha(data)
    e = cache.get(h)
    x = encode.decode(data, SR)
    secs = len(x) / SR
    if do_stt and "stt" not in e:
        tr = speech.stt(stage=stage, audio=Audio(data, "audio/ogg", secs, voice, ""))
        e["stt"] = {"text": tr.text, "confidence": round(float(tr.confidence or 0), 3), "words": tr.words}
    if "stt" in e:
        e["cmp"] = stt_check.compare(intended, e["stt"]["text"], kind)
        # A clip the recogniser disputes gets a second, independent listener (when the provider has one).
        # The recogniser turns rare words into common ones (กินกุ้ง -> กลิ่นกุ้ง from four voices); the clip
        # passes when either listener writes down the intended text.
        second = getattr(speech, "stt_second", None)
        if e["cmp"]["stt"] == "fail" and do_stt and second and "stt2" not in e:
            e["stt2"] = {"text": second(stage=stage, audio=Audio(data, "audio/ogg", secs, voice, "")).text}
        if e["cmp"]["stt"] == "fail" and "stt2" in e:
            c2 = stt_check.compare(intended, e["stt2"]["text"], kind)
            if c2["stt"] == "pass":
                e["cmp"] = {**c2, "verdict": "second:" + c2["verdict"]}
    if "silence" not in e:
        e["silence"] = round(quality.internal_silence(x), 3)
        e["speech"] = round(quality.speech_seconds(x), 3)
        e["seconds"] = round(secs, 3)
        e["lufs"] = round(encode.lufs(x, SR), 2)
    if do_mos and "mos" not in e and quality.mos_available():
        e.update(quality.mos(x))
    f0p = f0_dir / f"{h}.npz"
    track = None
    if f0p.exists():
        try:
            track = pitch.Track.from_npz(f0p)
        except Exception:  # noqa: BLE001 - a file cut short (e.g. disk full) is recomputed
            track = None
    if track is None:
        track = pitch.extract(x, SR, sex)
        track.to_npz(f0p)
    cache.put(h, e)
    return Analysis(h, e, track, secs)


def voice_mos_median(values: list[float]) -> tuple[float, float] | None:
    """(median, median absolute deviation) of a voice's MOS, or None under 8 clips."""
    vals = np.array([v for v in values if v is not None], float)
    if len(vals) < 8:
        return None
    med = float(np.median(vals))
    return med, float(np.median(np.abs(vals - med)))
