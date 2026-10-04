"""Audio stages, called by phi_pipeline/run.py:

  run_audio(providers, args)        generate every clip (resumable)
  run_audio_check(providers, args)  STT + pitch + quality checks, one retry,
                                    then course.json media.audio / media.pitch /
                                    checks / status
  run_voices(providers, args)       voice audition and picks (audio/voices.py)

`args` is an argparse.Namespace; every attribute is optional (see
add_arguments()). Dry runs (providers.dry) write audio only under
pipeline/work/dry/ and never into the app.
"""

from __future__ import annotations

import inspect
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from .. import config
from ..providers.speech import est_seconds, stt_cost, tts_cost, voice_sex
from . import check as chk
from . import pitch, quality, texts as tx, tts

CHECK_KEYS = ("stt", "pitch", "clipping", "truncation", "silence", "duration", "glitch", "agree")
# The F0 tone classifier was built on mock voices. On the real audition (3 Oct 2026) it called 47% of
# clips wrong whose transcription proved the word (and so its tone) was said right, and scored every
# Chirp voice ~60%. Until it is recalibrated on real voices its verdicts ("pitch", "agree") are recorded
# but do not reject clips; PHI_PITCH_GATE=1 turns the gate back on.
GATE_KEYS = CHECK_KEYS if os.environ.get("PHI_PITCH_GATE") == "1" else tuple(k for k in CHECK_KEYS if k not in ("pitch", "agree"))


def add_arguments(parser, stage: str = "audio") -> None:
    """Flags this module reads; run.py may call this for its subcommands."""
    parser.add_argument("--course", type=Path, help="course.json to read (default: the app's, or work/dry/content in dry runs)")
    parser.add_argument("--out", type=Path, help="public root the media paths are relative to (default app/public or work/dry)")
    parser.add_argument("--state", type=Path, help="work folder for manifests and caches")
    parser.add_argument("--only", nargs="*", help="kinds: item letter line example pattern tone")
    parser.add_argument("--ids", nargs="*", help="only these owner ids")
    parser.add_argument("--limit", type=int, help="first N texts only")
    parser.add_argument("--workers", type=int, default=2)  # low: the project is shared with the receptionist
    parser.add_argument("--force", action="store_true", help="regenerate even when a matching file exists")
    parser.add_argument("--no-retry", dest="no_retry", action="store_true")
    parser.add_argument("--no-mos", dest="no_mos", action="store_true", help="skip the DNSMOS glitch check")
    if stage == "voices":
        parser.add_argument("--pick", nargs="*", help="slot=voice, e.g. f1=th-TH-Chirp3-HD-Kore nok=Gacrux")
        parser.add_argument("--gemini", nargs="*", help="Gemini voices to audition (default 3 female + 3 male)")
        parser.add_argument("--max-voices", dest="max_voices", type=int, help="audition at most N Chirp voices")
        parser.add_argument("--audition-budget", dest="audition_budget", type=float, default=2.5)
        parser.add_argument("--yes", action="store_true", help="run even when the estimate is over --audition-budget")
        parser.add_argument("--words", type=int, help="shorter audition: N tone words (testing)")
        parser.add_argument("--sentences", type=int, help="shorter audition: N sentences (testing)")
        parser.add_argument("--numbers", type=int, help="shorter audition: N numbers (testing)")


def _arg(args, name, default=None):
    v = getattr(args, name, None) if args is not None else None
    return default if v is None else v


# ---------- paths and course I/O ----------


@dataclass
class Paths:
    public: Path
    course: Path
    course_out: Path
    state: Path
    voices: Path
    audition: Path


def _pack():
    try:
        from .. import pack  # type: ignore

        return pack
    except Exception:
        return None


def default_course(dry: bool) -> Path:
    pk = _pack()
    if pk and hasattr(pk, "course_path"):
        return Path(pk.course_path(dry))
    return (config.WORK / "dry" / "course.json") if dry else (config.OUT_CONTENT / "course.json")


def resolve_paths(dry: bool, args=None) -> Paths:
    w = config.WORK
    if dry:
        public = _arg(args, "out", w / "dry")
        course = _arg(args, "course", default_course(True))
        state = _arg(args, "state", w / "dry" / "audio-state")
        p = Paths(Path(public), Path(course), Path(course), Path(state), w / "dry" / "voices.json", w / "dry" / "voices")
        if _inside(p.public, config.APP):
            raise SystemExit("dry run refused: audio would be written into the app")
        if _inside(p.course_out, config.APP):
            p.course_out = default_course(True)
        return p
    public = _arg(args, "out", config.APP / "public")
    course = _arg(args, "course", default_course(False))
    state = _arg(args, "state", w / "audio")
    return Paths(Path(public), Path(course), Path(course), Path(state), config.PIPELINE / "voices.json", w / "voices")


def _inside(p: Path, root: Path) -> bool:
    try:
        Path(p).resolve().relative_to(Path(root).resolve())
        return True
    except ValueError:
        return False


def load_course(path: Path) -> dict:
    p = Path(path)
    if not p.exists():
        raise SystemExit(f"no course at {p}: run `pack` first (or pass --course)")
    return json.loads(p.read_text(encoding="utf8"))


def save_course(course: dict, path: Path) -> None:
    """Through pack.save_course() (validates against the contract, stamps the
    version) when the path is the pack's own; otherwise validate, stamp and
    write here."""
    pk = _pack()
    path = Path(path)
    for dry in (True, False):
        if pk and hasattr(pk, "save_course") and _same(path, default_course(dry)):
            pk.save_course(course, dry=dry)
            return
    try:
        from ..text.course_schema import validate_course

        errs = validate_course(course)
        if errs:
            print("course: contract warnings: " + "; ".join(errs[:10]))
    except Exception:
        pass
    if pk and hasattr(pk, "compute_version"):
        import datetime as _dt

        course["generatedAt"] = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
        course["version"] = pk.compute_version(course)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(course, ensure_ascii=False, indent=1), encoding="utf8")
    tmp.replace(path)


def _same(a: Path, b: Path) -> bool:
    try:
        return Path(a).resolve() == Path(b).resolve()
    except OSError:
        return False


def _select(texts: list[tx.AudioText], args) -> list[tx.AudioText]:
    only = _arg(args, "only")
    ids = _arg(args, "ids")
    out = [t for t in texts if (not only or t.kind in only) and (not ids or t.owner in ids)]
    lim = _arg(args, "limit")
    if lim:
        keep = []
        owners: list[str] = []
        for t in out:  # keep whole owners together (both sex groups)
            k = f"{t.kind}:{t.owner}"
            if k not in owners:
                if len(owners) >= lim:
                    continue
                owners.append(k)
            keep.append(t)
        out = keep
    return out


def _records(course: dict) -> dict[str, dict]:
    return {
        "item": {i["id"]: i for i in course.get("items", [])},
        "letter": {i["id"]: i for i in course.get("letters", [])},
        "pattern": {i["id"]: i for i in course.get("patterns", [])},
        "tone": {i["id"]: i for i in course.get("toneSets") or []},
    }


def _media(rec: dict) -> dict:
    m = rec.setdefault("media", {})
    m.setdefault("audio", {})
    m.setdefault("pitch", None)
    m.setdefault("image", None)
    m.setdefault("animation", None)
    return m


def _audio_dict(course: dict, recs: dict, t: tx.AudioText) -> dict:
    if t.kind in ("item", "letter"):
        return _media(recs[t.kind][t.owner])["audio"]
    if t.is_line:
        return course["lines"][t.owner].setdefault("audio", {})
    return recs["tone"][t.owner].setdefault("audio", {})


def _voices_block(cfg: dict) -> dict:
    out = {s: cfg[s] for s in tx.CHIRP_SLOTS + tx.EXTRA_SLOTS}
    out.update(cfg["cast"])
    return out


# ---------- stage: audio ----------


def run_audio(providers, args=None) -> dict:
    p = resolve_paths(providers.dry, args)
    course = load_course(p.course)
    tx.ensure_lines(course)
    cfg = tx.load_voices(providers.dry, p.voices)
    texts = _texts(course, p, providers.dry, args)
    clips = [c for t in texts for c in tx.clips_for(t, cfg)]
    manifest = tts.Manifest(p.state / "manifest.json")
    todo = [c for c in clips if _arg(args, "force", False) or not _done(c, p, manifest)]
    est = sum(tts_cost(c.text.spoken, c.voice, c.rate) for c in todo)
    info = tx.summary(texts, clips)
    print(f"audio: {info['texts']} texts, {info['clips']} clips ({len(todo)} to make), "
          f"{info['chirp_characters']} Chirp characters; estimate ${est:.2f} at list price"
          f"{' (dry run: $0)' if providers.dry else ''}")
    t0 = time.time()
    res = tts.generate(providers.speech, clips, p.public, manifest, stage="audio", workers=_arg(args, "workers", 2),
                       force=_arg(args, "force", False))
    counts: dict[str, int] = {}
    for r in res:
        counts[r.status] = counts.get(r.status, 0) + 1
    recs = _records(course)
    for c in clips:
        if (p.public / c.rel).exists():
            _audio_dict(course, recs, c.text)[c.media_key] = c.rel
    course["voices"] = _voices_block(cfg)
    save_course(course, p.course_out)
    errors = [{"clip": r.clip.rel, "error": r.error} for r in res if r.status in ("error", "budget")]
    out = {**info, "status": counts, "estimate_usd": round(est, 3), "seconds": round(time.time() - t0, 1),
           "errors": errors[:50], "course": str(p.course_out), "ledger": providers.ledger.summary()}
    _write(p.state / "audio-report.json", out)
    if any(r.status == "budget" for r in res):
        print("audio: stopped at the budget cap; re-run after raising PHI_BUDGET_USD to resume")
    return out


def _done(c: tx.Clip, p: Paths, manifest: tts.Manifest) -> bool:
    m = manifest.get(c.rel)
    return (p.public / c.rel).exists() and bool(m) and m.get("hash") == tts.clip_hash(c)


def _load_extra(p: Paths) -> dict[str, list[str]]:
    f = p.state / "extra_slots.json"
    try:
        return json.loads(f.read_text(encoding="utf8")) if f.exists() else {}
    except json.JSONDecodeError:
        return {}


def _texts(course: dict, p: Paths, dry: bool, args) -> list[tx.AudioText]:
    """The course's audio texts, with the voice spellings (pipeline/say.json) and the fallback voices
    an earlier check added (extra_slots.json in the state folder) applied."""
    say = tx.load_say(dry)
    extra = _load_extra(p)
    texts = tx.collect(course)
    for t in texts:
        t.say = say.get(t.key) or say.get(t.ref)
        t.slots = t.slots + [s for s in extra.get(t.key, []) if s not in t.slots]
    return _select(texts, args)


# ---------- stage: audio-check ----------


def _analyse_all(providers, clips: list[tx.Clip], p: Paths, cache: chk.Cache, workers: int, do_mos: bool) -> dict[str, chk.Analysis]:
    def job(c: tx.Clip):
        f = p.public / c.rel
        if not f.exists():
            return c.rel, None
        try:
            return c.rel, chk.analyse(providers.speech, f.read_bytes(), intended=c.text.spoken, kind=c.text.kind,
                                      voice=c.voice, sex=voice_sex(c.voice), cache=cache, f0_dir=p.state / "f0",
                                      do_mos=do_mos)
        except Exception as e:
            if type(e).__name__ == "BudgetExceeded":
                raise
            return c.rel, e

    out: dict[str, chk.Analysis] = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        for n, (rel, a) in enumerate(ex.map(job, clips), 1):
            if isinstance(a, chk.Analysis):
                out[rel] = a
            if n % 300 == 0:
                cache.save()  # a stopped run resumes without paying for the same transcriptions again
    cache.save()
    return out


def _profiles(clips: list[tx.Clip], an: dict[str, chk.Analysis], p: Paths) -> dict[str, pitch.Profile]:
    """Each voice's mid level: from the audition (qualification words) when
    there is one, else from the mid-tone syllables of its clips in this run."""
    saved = pitch.load_profiles(p.state / "profiles.json")
    data: dict[str, list] = {}
    for c in clips:
        if c.rel in an:
            data.setdefault(c.voice, []).append((an[c.rel].track, c.text.tones, an[c.rel].words))
    out = {}
    for v in {c.voice for c in clips}:
        if v in saved and saved[v].source.endswith("qualification"):
            out[v] = saved[v]
        else:
            out[v] = pitch.estimate_profile(v, data.get(v, []))
    pitch.save_profiles(p.state / "profiles.json", {**saved, **out})
    return out


def evaluate(t: tx.AudioText, clips: list[tx.Clip], an: dict[str, chk.Analysis], manifest: tts.Manifest,
             profiles: dict[str, pitch.Profile], model: pitch.ToneModel, mos_med: dict[str, float | None]) -> dict:
    per: dict[str, dict] = {}
    cps: dict[str, pitch.ClipPitch] = {}
    n_syl = len(t.tones or [])
    for c in clips:
        a = an.get(c.rel)
        if a is None:
            per[c.rel] = {"ok": False, "why": ["missing"]}
            continue
        m = manifest.get(c.rel) or {}
        e = a.entry
        r: dict = {"voice": c.voice, "slot": c.slot, "speed": c.speed}
        cmp = e.get("cmp") or {}
        r["stt"] = cmp.get("stt", "n/a")
        r["heard"] = (e.get("stt") or {}).get("text")
        if "stt2" in e:  # the second listener was asked (the first comparison failed)
            r["heard2"] = e["stt2"].get("text")
        r["verdict"] = cmp.get("verdict")
        r["cer"] = cmp.get("cer")
        r["sttConf"] = (e.get("stt") or {}).get("confidence")
        if t.tones:
            cp = pitch.analyse(a.track, t.tones, profiles.get(c.voice) or pitch.default_profile(c.voice), model, a.words, c.voice)
            cps[c.rel] = cp
            r["pitch"] = "pass" if cp.passed(t.strict) else "fail"
            r["pitchScore"] = round(cp.score, 3)
            r["tonesHeard"] = cp.tones
        else:
            r["pitch"] = "n/a"
        r["clipping"] = m.get("clipping", "n/a")
        r["truncation"] = m.get("truncation", "n/a")
        r["silence"] = "pass" if e["silence"] <= quality.silence_limit(c.speed, not t.strict) else "fail"
        r["silenceS"] = e["silence"]
        r["speechS"] = e["speech"]
        r["lufs"] = e.get("lufs")
        r["lufsRaw"] = m.get("lufsRaw")
        r["duration"] = "pass" if quality.syllable_rate_ok(e["speech"], n_syl) else "fail"
        r["mos"] = e.get("mos")
        r["glitch"] = quality.glitch(e.get("mos"), mos_med.get(c.voice))
        r["agree"] = "n/a"
        per[c.rel] = r
    by_slot: dict[str, dict[str, tx.Clip]] = {}
    for c in clips:
        by_slot.setdefault(c.slot, {})[c.speed] = c
    for slot, sp in by_slot.items():
        n, s = sp.get("normal"), sp.get("slow")
        if n and s and "speechS" in per.get(n.rel, {}) and "speechS" in per.get(s.rel, {}) and per[n.rel]["speechS"] > 0:
            ratio = per[s.rel]["speechS"] / per[n.rel]["speechS"]
            per[s.rel]["slowRatio"] = round(ratio, 3)
            if not quality.slow_ratio_ok(ratio, n.chirp):
                per[s.rel]["duration"] = "fail"
    for speed in tx.SPEEDS:
        group = [c for c in clips if c.chirp and c.speed == speed and "speechS" in per.get(c.rel, {})]
        if len(group) >= 3:
            med = float(np.median([per[c.rel]["speechS"] for c in group]))
            for c in group:
                if not quality.voice_spread_ok(per[c.rel]["speechS"], med):
                    per[c.rel]["duration"] = "fail"
    agree, median, curves = 1.0, None, []
    normal_chirp = [c for c in clips if c.chirp and c.speed == "normal" and c.rel in cps]
    if normal_chirp:
        res = [cps[c.rel] for c in normal_chirp]
        agree, outl = pitch.agreement(res)
        if len(res) >= 3:
            for c in normal_chirp:
                per[c.rel]["agree"] = "fail" if c.voice in outl else "pass"
        good = [cps[c.rel].curves for c in normal_chirp if per[c.rel]["pitch"] == "pass"]
        median = pitch.median_curves(good if len(good) >= 2 else [r.curves for r in res])
        n = t.pitch_n
        if n:
            curves = [cps[c.rel].curves[:n] for c in normal_chirp if per[c.rel]["pitch"] == "pass"]
    for r in per.values():
        if "why" not in r:
            r["why"] = [k for k in GATE_KEYS if r.get(k) == "fail"]
            r["ok"] = not r["why"]
    return {"per": per, "agree": round(agree, 3), "median": median, "pitch_curves": curves}


def run_audio_check(providers, args=None) -> dict:
    p = resolve_paths(providers.dry, args)
    course = load_course(p.course)
    tx.ensure_lines(course)
    cfg = tx.load_voices(providers.dry, p.voices)
    texts = _texts(course, p, providers.dry, args)
    clip_map = {t.key: tx.clips_for(t, cfg) for t in texts}
    clips = [c for cs in clip_map.values() for c in cs]
    manifest = tts.Manifest(p.state / "manifest.json")
    cache = chk.Cache(p.state / "analysis.json")
    workers = _arg(args, "workers", 2)
    do_mos = not _arg(args, "no_mos", False)
    pending_stt = [c for c in clips if (p.public / c.rel).exists()]
    est = sum(stt_cost((manifest.get(c.rel) or {}).get("seconds") or est_seconds(c.text.spoken, c.rate)) for c in pending_stt)
    print(f"audio-check: {len(clips)} clips; STT estimate up to ${est:.2f} (cached clips are free)"
          f"{' (dry run: $0)' if providers.dry else ''}")
    t0 = time.time()
    an = _analyse_all(providers, clips, p, cache, workers, do_mos)
    profiles = _profiles(clips, an, p)
    model = pitch.load_model(p.state / "tone_model.json")

    def mos_medians() -> dict[str, float | None]:
        vals: dict[str, list] = {}
        for c in clips:
            if c.rel in an:
                vals.setdefault(c.voice, []).append(an[c.rel].entry.get("mos"))
        return {v: chk.voice_mos_median(x) for v, x in vals.items()}

    mm = mos_medians()
    results = {k: evaluate(t, clip_map[t.key], an, manifest, profiles, model, mm) for k, t in ((t.key, t) for t in texts)}
    retried: list[str] = []
    if not _arg(args, "no_retry", False):
        # one regeneration per clip, ever: a clip already on its second take is final
        redo = [c for t in texts for c in clip_map[t.key] if not results[t.key]["per"][c.rel]["ok"]
                and (manifest.get(c.rel) or {}).get("attempt", 0) < 1]
        if redo:
            retried = [c.rel for c in redo]
            first = {c.rel: results[c.text.key]["per"][c.rel].get("why") for c in redo}
            print(f"audio-check: regenerating {len(redo)} failed clips once")
            tts.generate(providers.speech, redo, p.public, manifest, stage="audio-retry", workers=workers, attempt=1, force=True)
            an.update(_analyse_all(providers, redo, p, cache, workers, do_mos))
            mm = mos_medians()
            for t in texts:
                if any(c.rel in first for c in clip_map[t.key]):
                    results[t.key] = evaluate(t, clip_map[t.key], an, manifest, profiles, model, mm)
                    for c in clip_map[t.key]:
                        if c.rel in first:
                            results[t.key]["per"][c.rel]["firstWhy"] = first[c.rel]
        # A text with no clean normal-speed clip is tried once in the other course voices of its sex
        # (some voices clip or swallow a syllable on one phrase and not on the next). The voices added
        # are remembered, so later runs keep them.
        extra = _load_extra(p)
        added: list[tx.Clip] = []
        for t in texts:
            per = results[t.key]["per"]
            if any(per[c.rel]["ok"] for c in clip_map[t.key] if c.speed == "normal"):
                continue
            alts = tx.alt_slots(t, cfg)
            if not alts:
                continue
            t.slots = t.slots + alts
            extra[t.key] = extra.get(t.key, []) + alts
            new = [c for c in tx.clips_for(t, cfg) if c.slot in alts]
            clip_map[t.key] = clip_map[t.key] + new
            added += new
        if added:
            print(f"audio-check: trying {len(added)} clips in other voices for texts with no clean clip")
            clips += added
            tts.generate(providers.speech, added, p.public, manifest, stage="audio-retry", workers=workers)
            an.update(_analyse_all(providers, added, p, cache, workers, do_mos))
            mm = mos_medians()
            for t in texts:
                if any(c in added for c in clip_map[t.key]):
                    results[t.key] = evaluate(t, clip_map[t.key], an, manifest, profiles, model, mm)
            _write(p.state / "extra_slots.json", extra)
    summary = _write_course(course, texts, clip_map, results, retried, p)
    summary.update({"seconds": round(time.time() - t0, 1), "retried": len(retried), "course": str(p.course_out),
                    "ledger": providers.ledger.summary(), "model": model.source})
    _write(p.state / "check-report.json", {"summary": summary, "texts": {
        k: {"agree": r["agree"], "median": r["median"], "clips": r["per"]} for k, r in results.items()}})
    print(f"audio-check: {summary['refs_pass']} pass, {summary['refs_fail']} fail; "
          f"clips ok {summary['clips_ok']}/{summary['clips']}")
    return summary


def _write_course(course, texts, clip_map, results, retried, p: Paths) -> dict:
    recs = _records(course)
    checks = course.setdefault("checks", {})
    by_ref: dict[str, list[tuple[tx.AudioText, dict]]] = {}
    clips_ok = n_clips = 0
    wanted: dict[int, tuple[dict, set[str]]] = {}
    for t in texts:
        res = results[t.key]
        audio = _audio_dict(course, recs, t)
        keys = wanted.setdefault(id(audio), (audio, set()))[1]
        for c in clip_map[t.key]:
            r = res["per"][c.rel]
            n_clips += 1
            clips_ok += r["ok"]
            audio[c.media_key] = c.rel if r["ok"] else None
            keys.add(c.media_key)
        by_ref.setdefault(t.ref, []).append((t, res))
    # a voice a text no longer uses (e.g. a woman's take of a sentence with ผม in it) leaves the course
    for audio, keys in wanted.values():
        for k in [k for k in audio if k not in keys]:
            del audio[k]
    # media.pitch: per syllable of item.thai (no polite ending), median over the
    # Chirp voices that say item.thai and passed the pitch check
    pool: dict[tuple[str, str], list] = {}
    for t in texts:
        if t.pitch_n and t.kind in ("item", "letter", "tone"):
            pool.setdefault((t.kind, t.owner), []).extend(results[t.key].get("pitch_curves") or [])
    for (kind, owner), cs in pool.items():
        rec = recs[kind].get(owner)
        if rec is None:
            continue
        med = pitch.median_curves(cs) if cs else None
        if kind == "tone":
            rec["pitch"] = med
        else:
            _media(rec)["pitch"] = med
    n_pass = n_fail = 0
    failed: dict[str, set[str]] = {"item": set(), "letter": set(), "line": set()}
    for ref, group in by_ref.items():
        req = [(c, res["per"][c.rel]) for t, res in group for c in clip_map[t.key] if c.chirp]
        req = req or [(c, res["per"][c.rel]) for t, res in group for c in clip_map[t.key]]
        rs = [r for _, r in req]

        def agg(key: str) -> str:
            vals = [r.get(key, "n/a") for r in rs]
            if any(v == "fail" for v in vals):
                return "fail"
            return "pass" if any(v == "pass" for v in vals) else "n/a"

        scores = [r["pitchScore"] for r in rs if r.get("pitchScore") is not None]
        mos = [r["mos"] for r in rs if r.get("mos") is not None]
        lufs = [r["lufs"] for r in rs if r.get("lufs") is not None]
        conf = [r["sttConf"] for r in rs if r.get("sttConf") is not None]
        # every clip that ships passed its checks (failed ones are nulled above); the record stays as long as
        # each form of it (e.g. the male and the female build) keeps at least one clean normal-speed clip
        ok = all(any(res["per"][c.rel]["ok"] for c in clip_map[t.key] if c.speed == "normal") for t, res in group)
        entry = checks.setdefault(ref, {})
        entry.update({
            "stt": agg("stt"), "sttConf": round(float(np.mean(conf)), 3) if conf else None,
            "pitch": round(float(np.mean(scores)), 3) if scores else None,
            "agree": round(float(np.mean([res["agree"] for _, res in group])), 3),
            "clipping": agg("clipping"), "truncation": agg("truncation"), "silence": agg("silence"),
            "duration": agg("duration"), "glitch": agg("glitch"),
            "loudness": round(float(np.mean(lufs)), 2) if lufs else None,
            "mos": round(float(np.median(mos)), 2) if mos else None,
            "missing": sum("missing" in r.get("why", []) for r in rs),
            "audio": "pass" if ok else "fail",
        })
        if ok:
            n_pass += 1
        else:
            n_fail += 1
            kind, _, oid = ref.partition(":")
            if kind in failed:
                failed[kind].add(oid)
    dropped, dropped_tasks = drop_items(course, failed["item"])
    course["voices"] = _voices_block(tx.load_voices(False, p.voices))
    save_course(course, p.course_out)
    return {"refs_pass": n_pass, "refs_fail": n_fail, "clips": n_clips, "clips_ok": clips_ok,
            "dropped_items": sorted(dropped), "dropped_tasks": sorted(dropped_tasks),
            "failed_letters": sorted(failed["letter"]), "failed_lines": sorted(failed["line"])}


def drop_items(course: dict, ids: set[str]) -> tuple[set[str], list[str]]:
    """Items whose audio failed twice leave the course, as pack.py leaves out
    failed text: references to them are removed and any task that uses them
    is left out with its lines. Letters and patterns stay (their audio keys
    are null and their checks say fail): the alphabet and the frames are
    taught without sound rather than not at all."""
    ids = {i for i in ids if any(it["id"] == i for it in course.get("items", []))}
    if not ids:
        return set(), []
    course["items"] = [it for it in course["items"] if it["id"] not in ids]
    for it in course["items"]:
        if it.get("contrasts"):
            it["contrasts"] = [c for c in it["contrasts"] if c not in ids]
            if not it["contrasts"]:
                del it["contrasts"]
        if it.get("classifier") in ids:
            del it["classifier"]
    for n in course.get("culture", []):
        n["items"] = [i for i in n.get("items", []) if i not in ids]
    keep, gone = [], []
    for t in course.get("tasks", []):
        used = {x for n in t.get("nodes", {}).values() for x in n.get("items", []) + [i for o in n.get("options", []) for i in o.get("items", [])]}
        (gone if used & ids else keep).append(t)
    course["tasks"] = keep
    for t in gone:
        for lid in [k for k in course.get("lines", {}) if k.startswith(t["id"] + ".")]:
            del course["lines"][lid]
    return ids, [t["id"] for t in gone]


def _write(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1, default=str), encoding="utf8")


# ---------- stage: voices ----------


def run_voices(providers, args=None) -> dict:
    from . import voices

    return voices.run(providers, args)
