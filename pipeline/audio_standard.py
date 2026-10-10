"""Hold every clip the app plays to one standard, judged by what a listener
hears: each clip begins and ends in silence (nothing is cut into), the clearly
audible voice arrives 80 to 255 ms after it starts (80 ms of silence, then at
most 150 ms of a soft first sound such as h, s or a nasal), it dies away within
355 ms of the end, and its loudness is -16 LUFS within 1.2 LU (encode.normalise:
a burst that would pass the -2 dBFS ceiling is turned down by the look-ahead
limiter, never clipped), and no decoded peak reaches full scale.

Clips made before the pipeline trimmed (OpusTags SOI_*) carried up to 1.4 s of
silence before the voice, and some of their trims cut into the first sound. A
clip made by the pipeline as it is now (tags PHI_*) is trimmed with an 80 ms
margin, so it is never cut into: when one starts at once, that is how the voice
starts it (a hiss like ส or ซ, a burst rising from quiet). So:

  measure   report every played clip against the standard
  retake    re-record through the normal pipeline every older clip whose first
            10 ms is already sound (up to three takes); follow with run.py
            audio-check on the owners it touched
  even      bring every clip to the standard from its original: exactly 80 ms of
            silence before and after the voice, a soft edge where the voice
            begins and ends, loudness matched, tags kept. Originals stay in
            work/audio-before-standard/, so every clip is encoded once from them.

    pipeline/.venv/Scripts/python.exe pipeline/audio_standard.py measure|retake|even
"""
from __future__ import annotations

import argparse
import io
import json
import shutil
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import soundfile as sf

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from phi_pipeline.audio import encode  # noqa: E402

PUBLIC = ROOT.parent / "app" / "public"
COURSE = PUBLIC / "content" / "course.json"
BACKUP = ROOT / "work" / "audio-before-standard"
PAD = 0.08          # silence before and after the voice, as encode.trim
SURE = -35.0        # surely voice: 50 ms averaging within 35 dB of the loudest 10 ms
CUT_IN = -40.0      # a first 10 ms this loud is the middle of a sound
LEAD_REACH = 15     # frames: a soft first sound lasts well under 150 ms before the voice is sure
TAIL_REACH = 25     # frames: the fade of a last syllable, or a final stop or nasal, within 250 ms
KBPS = 32           # the one re-encode at a higher rate, so nothing is lost to it
SAFE_PEAK = 10 ** (-0.1 / 20)  # decoded peaks stay under full scale, where playback would clip
LOUD_TOL = 1.2      # LU either side of -16: EBU R128 allows 1 LU, and a clip of a second measures less steadily


def played(course: dict) -> list[str]:
    refs: set[str] = set()
    for k in ("items", "letters", "patterns"):
        for it in course.get(k, []):
            refs |= {p for p in (it.get("media") or {}).get("audio", {}).values() if p}
    for line in (course.get("lines") or {}).values():
        refs |= {p for p in (line.get("audio") or {}).values() if p}
    return sorted(refs)


def original(rel: str) -> Path:
    """The clip as it was before `even` (the clip itself where it never went through `even`)."""
    return BACKUP / rel if (BACKUP / rel).exists() else PUBLIC / rel


def load(path: Path) -> tuple[np.ndarray, int]:
    x, sr = sf.read(path, dtype="float32")
    return (x.mean(1) if x.ndim > 1 else x), sr


def frames_db(x: np.ndarray, sr: int) -> np.ndarray:
    """Level of each 10 ms frame in dB under the loudest one."""
    hop = int(0.01 * sr)
    n = len(x) // hop
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1) + 1e-12)
    return 20 * np.log10(rms / (rms.max() + 1e-12))


def smoothed(db: np.ndarray, k: int) -> np.ndarray:
    """A running mean over k frames, the ends extended with their own level (not 0 dB, the loudest)."""
    return np.convolve(np.pad(db, k // 2, mode="edge"), np.ones(k) / k, mode="valid")


def sure_voice(db: np.ndarray) -> np.ndarray:
    """Frames that are surely voice: sustained over 50 ms, so a lone breath or click is not."""
    return np.where(smoothed(db, 5) > SURE)[0]


def voice_span(db: np.ndarray) -> tuple[int, int]:
    """First and last 10 ms frame of the voice: from what is surely voice, outwards through frames that
    stand clear of the clip's own background (10 dB over the quietest tenth of its non-speech frames,
    never under -60 dB, and anything within 40 dB of the voice counts), no further than a soft first
    sound or a last syllable's fade can last. So those stay, and the breath or hiss around them goes."""
    room = db[(db > -90) & (db < -30)]
    gate = min(max((float(np.percentile(room, 10)) if len(room) else -90.0) + 10, -60.0), -40.0)
    sure = sure_voice(db)
    if not len(sure):
        sure = np.arange(len(db))
    smooth = smoothed(db, 3)
    a, b = int(sure[0]), int(sure[-1])
    a0, b0 = a, b
    while a > 0 and a0 - a < LEAD_REACH and smooth[a - 1] > gate:
        a -= 1
    while b < len(db) - 1 and b - b0 < TAIL_REACH and smooth[b + 1] > gate:
        b += 1
    return a, b


# ---------- measure ----------

def measure_one(rel: str) -> dict:
    x, sr = load(PUBLIC / rel)
    db = frames_db(x, sr)
    sure = sure_voice(db)
    first_sure, last_sure = (int(sure[0]), int(sure[-1])) if len(sure) else (0, len(db) - 1)
    src = original(rel)
    odb = db if src == PUBLIC / rel else frames_db(*load(src))
    return {
        "rel": rel,
        "to_voice": first_sure * 0.01,                       # play pressed -> clearly audible voice
        "after_voice": (len(db) - 1 - last_sure) * 0.01,     # last clear voice -> end of clip
        "edge_in": float(db[:5].max()), "edge_out": float(db[-5:].max()),  # first and last 50 ms
        "lufs": float(encode.lufs(x, sr)), "peak": float(np.max(np.abs(x))),
        # of the original: did an older trim cut into the word?
        "first": float(odb[0]), "fresh": "PHI_TEXT" in encode.read_opus_tags(src.read_bytes()),
    }


def measure_all(rels: list[str]) -> list[dict]:
    with ThreadPoolExecutor(8) as ex:
        return list(ex.map(measure_one, rels))


def on_standard(m: dict) -> bool:
    silent_edges = m["edge_in"] < -40 and m["edge_out"] < -40 and m["peak"] <= SAFE_PEAK
    prompt = PAD - 0.025 <= m["to_voice"] <= PAD + LEAD_REACH * 0.01 + 0.025
    ends = PAD - 0.025 <= m["after_voice"] <= PAD + TAIL_REACH * 0.01 + 0.025
    # at the loudness target, or held under it only where a burst needed more than the limiter gives
    peak_at_target = m["peak"] * 10 ** ((encode.TARGET_LUFS - m["lufs"]) / 20)
    beyond_limiter = peak_at_target > encode.PEAK_CEILING * 10 ** (encode.LIMIT_MAX_DB / 20) * 0.85
    loud = abs(m["lufs"] - encode.TARGET_LUFS) <= LOUD_TOL or (m["lufs"] < encode.TARGET_LUFS and beyond_limiter)
    return silent_edges and prompt and ends and loud


def cut_in(m: dict) -> bool:
    """An older clip whose first 10 ms was already sound: its trim cut into the word."""
    return m["first"] > CUT_IN and not m["fresh"]


def summary(ms: list[dict]) -> str:
    V = np.array([m["to_voice"] for m in ms]) * 1000
    E = np.array([m["after_voice"] for m in ms]) * 1000
    U = np.array([m["lufs"] for m in ms])
    loud_edges = sum(1 for m in ms if m["edge_in"] >= -40 or m["edge_out"] >= -40)
    return (f"{len(ms)} clips | to voice ms {V.min():.0f}..{V.max():.0f} (median {np.median(V):.0f}) | "
            f"after voice ms {E.min():.0f}..{E.max():.0f} | edges not silent {loud_edges} | LUFS {U.min():.1f}..{U.max():.1f} | "
            f"on standard {sum(on_standard(m) for m in ms)} | older cut-in starts {sum(cut_in(m) for m in ms)}")


# ---------- even ----------

def tags_of(rel: str) -> dict[str, str]:
    t = encode.read_opus_tags(original(rel).read_bytes())
    return {k: v for k, v in t.items() if k.startswith(("SOI_", "PHI_"))}


def evened(x: np.ndarray, sr: int) -> np.ndarray:
    """Exactly 80 ms of silence, the voice, 80 ms of silence. The margins are digital silence, not the
    original's: what lay outside the voice was hiss, breath or a mouth click. A 5 ms soft edge where the
    voice begins and 10 ms where it ends, so a voice that starts at once (a hiss like ส or ซ) does not
    click against the silence before it."""
    hop = int(0.01 * sr)
    first, last = voice_span(frames_db(x, sr))
    voice = x[first * hop:min(len(x), (last + 1) * hop)].astype(np.float32).copy()
    fi, fo = int(0.005 * sr), int(0.01 * sr)
    voice[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
    voice[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32)
    pad = np.zeros(int(PAD * sr), np.float32)
    y, _, _ = encode.normalise(np.concatenate([pad, voice, pad]), sr)
    return y


def even_one(rel: str) -> tuple[str, str]:
    try:
        bk = BACKUP / rel
        if not bk.exists():
            bk.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(PUBLIC / rel, bk)
        x, sr = load(bk)
        y = evened(x, sr)
        out = encode.encode_ogg(y, sr, tags=tags_of(rel), kbps=KBPS)
        z, zr = sf.read(io.BytesIO(out), dtype="float32")
        # the codec moves loudness and peaks a little (its speech mode filters the lowest frequencies,
        # which can lift a peak by 2 dB). Where the decoded clip drifted off target, or a peak came near
        # full scale (where playback clips), aim again with this clip's own overshoot allowed for
        for _ in range(5):
            drift = encode.TARGET_LUFS - encode.lufs(z, zr)
            peak = float(np.max(np.abs(z)))
            if abs(drift) <= 0.3 and peak <= SAFE_PEAK:
                break
            overshoot = peak / max(float(np.max(np.abs(y))), 1e-9)
            ceiling = min(encode.PEAK_CEILING, SAFE_PEAK * 0.95 / overshoot)
            y, _, _ = encode.normalise(y, sr, target=encode.lufs(y, sr) + drift, ceiling=ceiling)
            out = encode.encode_ogg(y, sr, tags=tags_of(rel), kbps=KBPS)
            z, zr = sf.read(io.BytesIO(out), dtype="float32")
        # the encode must decode to the same length, give or take the codec's frame
        if abs(len(z) / zr - len(y) / sr) > 0.03:
            return rel, f"length changed {len(y) / sr:.2f}s -> {len(z) / zr:.2f}s"
        (PUBLIC / rel).write_bytes(out)
        return rel, "ok"
    except Exception as e:  # noqa: BLE001
        return rel, f"error {type(e).__name__}: {e}"


# ---------- retake ----------

def retake(rels: list[str], workers: int = 2) -> dict[str, str]:
    from run import providers_for
    from phi_pipeline.audio import run as ar, texts as tx, tts

    pr = providers_for(False)
    p = ar.resolve_paths(False, None)
    course = json.loads(COURSE.read_text(encoding="utf8"))
    tx.ensure_lines(course)
    cfg = tx.load_voices(False, p.voices)
    by_rel = {c.rel: c for t in ar._texts(course, p, False, None) for c in tx.clips_for(t, cfg)}
    man = tts.Manifest(p.state / "manifest.json")
    out = {r: "no clip definition" for r in rels if r not in by_rel}
    todo = [r for r in rels if r in by_rel]
    for attempt in (0, 1, 2):
        if not todo:
            break
        res = tts.generate(pr.speech, [by_rel[r] for r in todo], p.public, man, workers=workers, attempt=attempt, force=True)
        for g in res:
            if g.status != "made":
                out[g.clip.rel] = f"{g.status}: {g.error}"
            else:
                # a fresh take replaces the original that `even` works from
                (BACKUP / g.clip.rel).unlink(missing_ok=True)
        made = [g.clip.rel for g in res if g.status == "made"]
        # a fresh take is never cut by the trim, but another try is cheap where it starts at once
        still = [m["rel"] for m in measure_all(made) if m["first"] > CUT_IN]
        out.update({r: f"retaken (take {attempt + 1})" for r in made if r not in still})
        todo = still
        print(f"take {attempt + 1}: {len(made)} made, {len(still)} start at once")
    out.update({r: "starts at once in all 3 takes (the voice's own start)" for r in todo})
    man.save()
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["measure", "retake", "even"])
    ap.add_argument("--report", type=Path, default=ROOT / "work" / "audio-standard.json")
    a = ap.parse_args()
    rels = played(json.loads(COURSE.read_text(encoding="utf8")))
    ms = measure_all(rels)
    print("now:  ", summary(ms))
    if a.cmd == "measure":
        a.report.write_text(json.dumps(ms), encoding="utf8")
        off = [m for m in ms if not on_standard(m)]
        for m in off[:10]:
            print("   off:", m["rel"], {k: round(v, 3) if isinstance(v, float) else v for k, v in m.items() if k != "rel"})
        return
    if a.cmd == "retake":
        targets = [m["rel"] for m in ms if cut_in(m)]
        print(f"retaking {len(targets)} older clips that start mid-sound")
        out = retake(targets)
        a.report.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf8")
        print(Counter(v.split(" (")[0].split(":")[0] for v in out.values()))
        return
    left = [m["rel"] for m in ms if cut_in(m)]
    if left:
        raise SystemExit(f"{len(left)} older clips start mid-sound: run retake first ({left[:3]})")
    print(f"evening {len(rels)} clips from their originals")
    with ThreadPoolExecutor(8) as ex:
        res = list(ex.map(even_one, rels))
    bad = [r for r in res if r[1] != "ok"]
    print(f"done: {len(res) - len(bad)} ok, {len(bad)} problems")
    for r in bad[:20]:
        print("  ", *r)
    print("after:", summary(measure_all(rels)))


if __name__ == "__main__":
    main()
