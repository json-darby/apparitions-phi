"""Generate every clip.

  * Four Chirp 3 HD voices x two speeds (slow generated natively at
    speaking_rate 0.75, never stretched); the cast's lines in their own Gemini
    TTS voice; x1/x2 Gemini training voices on items.
  * Resumable: a manifest (work/.../manifest.json) records a hash of the text,
    voice, speed, rate, style, model and encoder settings for every file. A
    clip whose file exists with the same hash is skipped, so a re-run after a
    crash or a budget stop costs nothing for what is done.
  * A small thread pool (Chirp 4 workers, Gemini 2), with back-off on rate
    limits inside the provider. A budget stop ends the run cleanly.
  * Every clip: raw checks (clipping, truncation) on the TTS output, then trim,
    -16 LUFS, Opus 24 kbps mono (encode.finish). The intended Thai is written
    into the file's Opus tags (PHI_TEXT), which is how the mock recogniser
    "hears" it and makes every clip self-describing.
"""

from __future__ import annotations

import hashlib
import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Callable

from ..ledger import BudgetExceeded
from . import encode, quality
from .texts import Clip

ENC_VERSION = "1"
_GEMINI_SEM = threading.Semaphore(2)


def clip_hash(c: Clip) -> str:
    s = f"{ENC_VERSION}|{c.text.spoken}|{c.voice}|{c.speed}|{c.rate}|{c.style}|{c.model}|{encode.opus_kbps()}"
    return hashlib.sha1(s.encode("utf8")).hexdigest()[:16]


class Manifest:
    """What was generated: rel path -> {hash, attempt, text, voice, raw checks, loudness...}."""

    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self.data: dict[str, dict] = {}
        if path.exists():
            try:
                self.data = json.loads(path.read_text(encoding="utf8"))
            except json.JSONDecodeError:
                self.data = {}

    def get(self, rel: str) -> dict | None:
        with self._lock:
            return self.data.get(rel)

    def put(self, rel: str, entry: dict) -> None:
        with self._lock:
            self.data[rel] = entry

    def update(self, rel: str, **kw) -> None:
        with self._lock:
            self.data.setdefault(rel, {}).update(kw)

    def save(self) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.data, ensure_ascii=False, indent=0), encoding="utf8")
            tmp.replace(self.path)


def for_attempt(c: Clip, attempt: int) -> Clip:
    """A regeneration asks for a slightly different take: deterministic voices
    would otherwise return the same audio."""
    if attempt <= 0:
        return c
    if c.chirp:
        return replace(c, rate=round(c.rate - 0.03 * attempt, 2))
    return replace(c, style=(c.style or "") + " Take care to pronounce every tone clearly.")


@dataclass
class GenResult:
    clip: Clip
    status: str  # made | skipped | error | budget
    error: str | None = None


def make_one(speech, c: Clip, public_root: Path, manifest: Manifest, *, stage: str = "audio", attempt: int = 0,
             force: bool = False) -> GenResult:
    path = public_root / c.rel
    h = clip_hash(c)
    m = manifest.get(c.rel)
    if not force and path.exists() and m and m.get("hash") == h and m.get("attempt", 0) >= attempt:
        return GenResult(c, "skipped")
    take = for_attempt(c, attempt)
    hint = getattr(speech, "hint", None)
    if hint and c.text.tones:
        hint(c.text.spoken, c.text.tones)
    sem = _GEMINI_SEM if not c.chirp else None
    if sem:
        sem.acquire()
    try:
        audio = speech.tts(stage=stage, text=c.text.spoken, voice=c.voice, rate=take.rate, model=take.model, style=take.style)
    finally:
        if sem:
            sem.release()
    raw = encode.to_float(audio.data, audio.mime, encode.OUT_SR)
    raw_q = quality.raw_checks(raw, encode.OUT_SR)
    fin = encode.finish(raw, encode.OUT_SR, tags={"PHI_TEXT": c.text.spoken, "PHI_VOICE": c.voice, "PHI_SLOT": c.slot})
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(fin.ogg)
    manifest.put(c.rel, {
        "hash": h, "attempt": attempt, "text": c.text.spoken, "voice": c.voice, "slot": c.slot, "speed": c.speed,
        "rate": take.rate, "seconds": round(fin.seconds, 3), "bytes": len(fin.ogg),
        "lufsRaw": round(fin.lufs_raw, 2), "lufs": round(fin.lufs_out, 2), **raw_q,
        "fileSha": hashlib.sha1(fin.ogg).hexdigest()[:16],
    })
    return GenResult(c, "made")


def generate(speech, clips: list[Clip], public_root: Path, manifest: Manifest, *, stage: str = "audio",
             workers: int = 4, attempt: int = 0, force: bool = False,
             progress: Callable[[int, int], None] | None = None) -> list[GenResult]:
    results: list[GenResult] = []
    stop = threading.Event()

    def job(c: Clip) -> GenResult:
        if stop.is_set():
            return GenResult(c, "budget", "stopped: budget cap reached")
        try:
            return make_one(speech, c, public_root, manifest, stage=stage, attempt=attempt, force=force)
        except BudgetExceeded as e:
            stop.set()
            return GenResult(c, "budget", str(e))
        except Exception as e:  # one bad clip must not stop the run
            return GenResult(c, "error", f"{type(e).__name__}: {e}")

    done = 0
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        futs = [ex.submit(job, c) for c in clips]
        for f in as_completed(futs):
            results.append(f.result())
            done += 1
            if done % 200 == 0:
                manifest.save()
            if progress:
                progress(done, len(clips))
    manifest.save()
    return results
