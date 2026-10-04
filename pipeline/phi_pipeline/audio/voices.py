"""Voice audition and qualification.

Every th-TH Chirp 3 HD voice that list_voices returns, plus 6 Gemini TTS
prebuilt voices (3 female, 3 male; --gemini to change), each say:

  pairs      60 tone-minimal-pair words (fixed list below), normal and slow
  sentences  20 everyday sentences (course example sentences without a
             gendered ending when there are 20, else the fixed list below)
  endings    the polite endings in the voice's own gender only
             (male ครับ; female ค่ะ / คะ), alone and after สวัสดี / ขอบคุณ
  numbers    10 numbers and prices

Automatic scores per voice
  tone       pitch tone accuracy on the 60 pair words (normal speed); 95% is
             the bar for tone training. Scored by the prior classifier and by
             a leave-one-voice-out calibrated classifier (prototypes learnt from
             every other voice's pair words, never this voice's); the better
             of the two counts, since neither has seen this voice's labels.
  cer        STT character error rate on sentences, endings and numbers
             (pair words are not transcribed: it keeps the audition under $2,
             and every course clip is transcribed later anyway)
  mos        DNSMOS overall quality, median over the voice's samples
  consistency  slow vs normal: share of pair words given the same tone, and
             loudness stability (standard deviation of raw LUFS)
Eligible = tone >= 95%, CER <= 10%, every ending transcribed correctly.
Rank (per gender) = 0.4 tone + 0.25 (1 - 5 CER) + 0.25 MOS (scaled 1-4.5)
+ 0.1 consistency.

Outputs
  work/voices/audition.html   page with a player for every sample, scores,
                              ranking; ineligible voices greyed. Writes nothing.
  work/voices/audition.json   the same data
  <state>/profiles.json       each voice's mid-tone level from its tone words
  <state>/tone_model.json     classifier calibrated on all eligible voices
  pipeline/voices.json        picks (auto: top two eligible per gender; owner
                              picks with --pick are never overwritten by auto)
"""

from __future__ import annotations

import html
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..providers.speech import GEMINI_AUDITION, est_seconds, is_chirp, star, stt_cost, tts_cost, voice_sex
from . import check as chk
from . import pitch, texts as tx, tts

M, L, F, H, R = "mid", "low", "falling", "high", "rising"

# 60 words in tone-minimal sets (a fixed list of common minimal sets written for
# Phi; tones by the spelling rules). 16 mid, 9 low, 13 falling, 8 high, 14 rising.
TONE_WORDS: list[tuple[str, str, str]] = [
    ("มา", "maa", M), ("ม้า", "máa", H), ("หมา", "mǎa", R),
    ("ข่าว", "khàao", L), ("ข้าว", "khâao", F), ("ขาว", "khǎao", R),
    ("ใกล้", "glâi", F), ("ไกล", "glai", M),
    ("ไม่", "mâi", F), ("ไม้", "máai", H), ("ไหม", "mǎi", R), ("ใหม่", "mài", L),
    ("คา", "khaa", M), ("ข่า", "khàa", L), ("ค่า", "khâa", F), ("ค้า", "kháa", H), ("ขา", "khǎa", R),
    ("เสือ", "sʉ̌a", R), ("เสื้อ", "sʉ̂a", F),
    ("นา", "naa", M), ("หน้า", "nâa", F), ("น้า", "náa", H), ("หนา", "nǎa", R),
    ("ปา", "bpaa", M), ("ป่า", "bpàa", L), ("ป้า", "bpâa", F),
    ("ซวย", "suay", M), ("สวย", "sǔay", R),
    ("เข่า", "khào", L), ("เข้า", "khâo", F), ("เขา", "khǎo", R),
    ("สี่", "sìi", L), ("ซี่", "sîi", F), ("สี", "sǐi", R),
    ("ห้า", "hâa", F), ("หา", "hǎa", R),
    ("รู", "ruu", M), ("รู้", "rúu", H),
    ("ยา", "yaa", M), ("อย่า", "yàa", L), ("ย่า", "yâa", F),
    ("พา", "phaa", M), ("ผ้า", "phâa", F),
    ("นำ", "nam", M), ("น้ำ", "náam", H),
    ("วาน", "waan", M), ("หวาน", "wǎan", R),
    ("มี", "mii", M), ("หมี", "mǐi", R),
    ("ปู", "bpuu", M), ("ปู่", "bpùu", L),
    ("ลา", "laa", M), ("ล่า", "lâa", F),
    ("เหล็ก", "lèk", L), ("เล็ก", "lék", H),
    ("ชาย", "chaai", M), ("ฉาย", "chǎai", R),
    ("ทราย", "saai", M), ("ซ้าย", "sáai", H), ("สาย", "sǎai", R),
]
assert len(TONE_WORDS) == 60

SENTENCES = [
    "วันนี้อากาศร้อนมาก", "ห้องน้ำอยู่ที่ไหน", "ขอน้ำเปล่าหนึ่งขวด", "อันนี้ราคาเท่าไหร่", "ไม่เผ็ดได้ไหม",
    "พูดช้าๆ หน่อยได้ไหม", "ไปสนามบินเท่าไหร่", "เลี้ยวซ้ายที่ไฟแดง", "จอดตรงนี้ก็ได้", "ขอบิลด้วย",
    "อร่อยมาก", "มีห้องว่างไหม", "เช็กเอาต์กี่โมง", "ร้านขายยาอยู่ใกล้ไหม", "ปวดหัวนิดหน่อย",
    "ลดหน่อยได้ไหม", "แพงไปหน่อย", "เจอกันพรุ่งนี้", "ขอโทษ มาสายนิดหน่อย", "ยินดีที่ได้รู้จัก",
]

ENDINGS = {
    "m": [("ครับ", [H]), ("สวัสดีครับ", [L, L, M, H]), ("ขอบคุณครับ", [L, M, H])],
    "f": [("ค่ะ", [F]), ("คะ", [H]), ("สวัสดีค่ะ", [L, L, M, F]), ("ขอบคุณค่ะ", [L, M, F])],
}

NUMBERS = [
    ("เจ็ด", [L]), ("สิบเอ็ด", [L, L]), ("ยี่สิบห้า", [F, L, F]), ("หกร้อย", [L, H]), ("ห้าสิบบาท", [F, L, L]),
    ("สี่สิบบาท", [L, L, L]), ("สามร้อยบาท", [R, H, L]), ("เก้าสิบเก้าบาท", [F, L, F, L]),
    ("หนึ่งร้อยยี่สิบบาท", [L, H, F, L, L]), ("สองพันห้าร้อย", [R, M, F, H]),
]

TONE_BAR = 0.95
CER_BAR = 0.10


@dataclass
class Sample:
    group: str  # pair | sentence | ending | number
    sid: str
    thai: str
    tones: list[str] | None
    speeds: tuple[str, ...]
    stt: bool


def samples_for(sex: str, course: dict | None = None, words: int = 60, sentences: int = 20, numbers: int = 10) -> list[Sample]:
    """The audition set. `words`/`sentences`/`numbers` shorten it (tests only);
    a shortened word list keeps the tones balanced."""
    pairs = list(enumerate(TONE_WORDS))
    if words < len(pairs):
        by: dict[str, list] = {}
        for i, w in pairs:
            by.setdefault(w[2], []).append((i, w))
        pairs = sorted([x for lst in by.values() for x in lst[: max(1, words // 5)]])
    out = [Sample("pair", f"p{i:02d}", w, [t], ("normal", "slow"), False) for i, (w, _, t) in pairs]
    sents = []
    for it in (course or {}).get("items", []):
        ex = it.get("example") or {}
        if ex.get("thai") and not tx.text_sex(ex["thai"]) and ex["thai"] not in sents:
            sents.append(ex["thai"])
    sents = (sents[:20] if len(sents) >= 20 else SENTENCES)[:sentences]
    out += [Sample("sentence", f"s{i:02d}", s, None, ("normal",), True) for i, s in enumerate(sents)]
    out += [Sample("ending", f"e{i}", w, t, ("normal",), True) for i, (w, t) in enumerate(ENDINGS[sex])]
    out += [Sample("number", f"n{i}", w, t, ("normal",), True) for i, (w, t) in enumerate(NUMBERS[:numbers])]
    return out


def _clip(voice: str, s: Sample, speed: str) -> tx.Clip:
    t = tx.AudioText("audition", s.sid, s.thai, s.tones, [voice], f"audition:{s.sid}")
    base = tx.clips_for(t, {"cast": {voice: voice}})
    c = next(c for c in base if c.speed == speed)
    c.rel = f"clips/{_vid(voice)}/{s.sid}.{speed}.ogg"
    return c


def _vid(voice: str) -> str:
    return ("chirp-" if is_chirp(voice) else "gemini-") + star(voice)


def estimate(voices: list[dict], course: dict | None = None, **limits) -> float:
    usd = 0.0
    for v in voices:
        for s in samples_for(v["gender"], course, **limits):
            for sp in s.speeds:
                rate = 0.75 if sp == "slow" else 1.0
                usd += tts_cost(s.thai, v["name"], rate)
                if s.stt:
                    usd += stt_cost(max(1.0, est_seconds(s.thai, rate)))
    return usd


# ---------- picks ----------


def parse_picks(items: list[str]) -> dict[str, str]:
    out = {}
    for it in items or []:
        if "=" not in it:
            raise SystemExit(f"--pick expects slot=voice, got {it!r}")
        k, v = it.split("=", 1)
        out[k.strip()] = v.strip()
    return out


def write_picks(path: Path, picks: dict[str, str], source: str, keep_owner: bool = True) -> dict:
    cur = json.loads(path.read_text(encoding="utf8")) if path.exists() else {}
    cur.setdefault("cast", {})
    src = cur.setdefault("source", {})
    for k, v in picks.items():
        if keep_owner and source == "auto" and src.get(k) == "owner":
            continue
        if k in tx.CHIRP_SLOTS + tx.EXTRA_SLOTS:
            cur[k] = v
        elif k in tx.CAST_SEX:
            cur["cast"][k] = v
        else:
            raise SystemExit(f"unknown slot {k!r}: use f1 f2 m1 m2 x1 x2 or a cast id ({', '.join(tx.CAST_SEX)})")
        src[k] = source
    cur["pickedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(cur, ensure_ascii=False, indent=1), encoding="utf8")
    return cur


def auto_picks(ranked: dict[str, list[dict]]) -> dict[str, str]:
    """Top two eligible Chirp voices per gender -> f1 f2 / m1 m2; best eligible
    Gemini voice per gender -> x1 (f) / x2 (m); then one distinct, gender-matched
    Gemini voice per cast member, eligible voices first, defaults otherwise."""
    picks: dict[str, str] = {}
    for sex, slots in (("f", ("f1", "f2")), ("m", ("m1", "m2"))):
        el = [v["name"] for v in ranked.get(sex, []) if v["eligible"] and v["engine"] == "chirp"]
        for slot, name in zip(slots, el):
            picks[slot] = name
    used: set[str] = set()
    for sex, slot in (("f", "x1"), ("m", "x2")):
        el = [v["name"] for v in ranked.get(sex, []) if v["eligible"] and v["engine"] == "gemini"]
        if el:
            picks[slot] = el[0]
            used.add(el[0])
    auditioned = {v["name"]: v["eligible"] for vs in ranked.values() for v in vs if v["engine"] == "gemini"}
    for cast, sex in tx.CAST_SEX.items():
        el = [v["name"] for v in ranked.get(sex, []) if v["eligible"] and v["engine"] == "gemini" and v["name"] not in used]
        default = tx.DEFAULT_VOICES["cast"][cast]
        if default not in used and auditioned.get(default, True):
            choice = default  # eligible, or not auditioned (kept, checked clip by clip later)
        else:
            choice = el[0] if el else default
        picks[cast] = choice
        used.add(choice)
    return picks


# ---------- audition ----------


def run(providers, args=None) -> dict:
    from .run import _arg, load_course, resolve_paths

    p = resolve_paths(providers.dry, args)
    picks = _arg(args, "pick")
    if picks:
        cur = write_picks(p.voices, parse_picks(picks), "owner")
        print(f"voices: picks saved to {p.voices}")
        return {"picks": cur, "path": str(p.voices)}

    course = None
    if p.course.exists():
        try:
            course = load_course(p.course)
        except Exception:
            course = None
    speech = providers.speech
    chirp = speech.list_voices("th-TH")
    mx = _arg(args, "max_voices")
    if mx:
        chirp = chirp[:mx]
    gem_names = _arg(args, "gemini") or GEMINI_AUDITION
    cands = [{"name": v["name"], "gender": v.get("gender") or voice_sex(v["name"]), "engine": "chirp"} for v in chirp]
    cands += [{"name": g, "gender": voice_sex(g), "engine": "gemini"} for g in gem_names]
    limits = {k: _arg(args, k) for k in ("words", "sentences", "numbers") if _arg(args, k) is not None}
    est = estimate(cands, course, **limits)
    budget = _arg(args, "audition_budget", 2.5)
    print(f"voices: auditioning {sum(c['engine'] == 'chirp' for c in cands)} Chirp 3 HD + "
          f"{sum(c['engine'] == 'gemini' for c in cands)} Gemini voices; estimate ${est:.2f} at list price"
          f"{' (dry run: $0)' if providers.dry else ''}")
    if not providers.dry and est > budget and not _arg(args, "yes", False):
        raise SystemExit(f"voices: estimate ${est:.2f} is over the audition budget ${budget:.2f}; "
                         "use --max-voices or --audition-budget/--yes")

    root = p.audition
    manifest = tts.Manifest(root / "manifest.json")
    cache = chk.Cache(p.state / "analysis.json")
    workers = _arg(args, "workers", 2)
    do_mos = not _arg(args, "no_mos", False)

    plan = [(v, s, sp) for v in cands for s in samples_for(v["gender"], course, **limits) for sp in s.speeds]
    clips = [_clip(v["name"], s, sp) for v, s, sp in plan]
    tts.generate(speech, clips, root, manifest, stage="voices", workers=workers)
    from .run import Paths, _analyse_all

    ap = Paths(root, p.course, p.course_out, p.state, p.voices, root)
    stt_clips = [c for (v, s, sp), c in zip(plan, clips) if s.stt]
    no_stt = [c for (v, s, sp), c in zip(plan, clips) if not s.stt]
    an = _analyse_all(providers, stt_clips, ap, cache, workers, do_mos)
    an.update(_analyse_no_stt(providers, no_stt, ap, cache, workers, do_mos))

    # pitch ranges from each voice's pair words (balanced over the five tones)
    profiles = pitch.load_profiles(p.state / "profiles.json")
    for v in cands:
        data = [(an[c.rel].track, s.tones, an[c.rel].words) for (vv, s, sp), c in zip(plan, clips)
                if vv is v and s.tones and c.rel in an]
        pr = pitch.estimate_profile(v["name"], data, "qualification")
        if pr.source != "default":
            profiles[v["name"]] = pr
    pitch.save_profiles(p.state / "profiles.json", profiles)

    prior = pitch.ToneModel.prior()
    rows: dict[str, dict] = {}
    curves: dict[str, list[tuple[list, str, str]]] = {}  # voice -> [(curve, tone, speed)]
    for (v, s, sp), c in zip(plan, clips):
        a = an.get(c.rel)
        row = rows.setdefault(v["name"], {**v, "samples": []})
        if a is None:
            row["samples"].append({"group": s.group, "id": s.sid, "thai": s.thai, "speed": sp, "rel": c.rel, "error": "missing"})
            continue
        prof = profiles.get(v["name"]) or pitch.default_profile(v["name"])
        cp = pitch.analyse(a.track, s.tones, prof, prior, a.words, v["name"]) if s.tones else None
        if cp and s.group == "pair" and cp.syllables and cp.syllables[0].curve is not None:
            curves.setdefault(v["name"], []).append((cp.syllables[0].curve, s.tones[0], sp))
        m = manifest.get(c.rel) or {}
        row["samples"].append({
            "group": s.group, "id": s.sid, "thai": s.thai, "speed": sp, "rel": c.rel,
            "expected": s.tones, "heard": cp.tones if cp else None, "pitchScore": cp.score if cp else None,
            "stt": (a.entry.get("stt") or {}).get("text"), "cmp": a.entry.get("cmp"),
            "mos": a.entry.get("mos"), "lufsRaw": m.get("lufsRaw"), "seconds": a.entry.get("speech"),
            "clipping": m.get("clipping"), "truncation": m.get("truncation"),
        })

    # leave-one-voice-out calibrated accuracy
    for name, row in rows.items():
        mine = curves.get(name, [])
        others = [(cv, t) for n2, lst in curves.items() if n2 != name for cv, t, _ in lst]
        acc_prior = _acc(prior, [x for x in mine if x[2] == "normal"])
        acc_lovo = _acc(pitch.calibrate(others), [x for x in mine if x[2] == "normal"]) if len(curves) >= 4 else None
        row["tonePrior"] = acc_prior
        row["toneLovo"] = acc_lovo
        row["tone"] = max(acc_prior, acc_lovo or 0.0)
        row["toneSlow"] = _acc(prior, [x for x in mine if x[2] == "slow"])
        _score(row)

    eligible_curves = [(cv, t) for n, lst in curves.items() if rows[n]["eligible"] for cv, t, _ in lst]
    model = pitch.calibrate(eligible_curves) if len(eligible_curves) >= 50 else prior
    (p.state / "tone_model.json").parent.mkdir(parents=True, exist_ok=True)
    (p.state / "tone_model.json").write_text(json.dumps(model.to_json(), indent=1), encoding="utf8")

    ranked: dict[str, list[dict]] = {"f": [], "m": []}
    for row in rows.values():
        ranked.setdefault(row["gender"], []).append(row)
    for sex in ranked:
        ranked[sex].sort(key=lambda r: (not r["eligible"], -r["rank_score"]))
        for i, r in enumerate(ranked[sex], 1):
            r["rank"] = i
    pk = auto_picks(ranked)
    cur = write_picks(p.voices, pk, "auto")
    data = {"generatedAt": time.strftime("%Y-%m-%dT%H:%M:%S"), "dry": providers.dry, "estimate_usd": round(est, 3),
            "bars": {"tone": TONE_BAR, "cer": CER_BAR}, "ranked": ranked, "picks": cur,
            "model": {"source": model.source, "table": model.table()}, "ledger": providers.ledger.summary()}
    root.mkdir(parents=True, exist_ok=True)
    (root / "audition.json").write_text(json.dumps(data, ensure_ascii=False, indent=1, default=float), encoding="utf8")
    (root / "audition.html").write_text(render_html(data), encoding="utf8")
    n_el = sum(r["eligible"] for r in rows.values())
    print(f"voices: {n_el}/{len(rows)} eligible; page {root / 'audition.html'}; picks {p.voices}")
    return {"eligible": n_el, "voices": len(rows), "page": str(root / "audition.html"), "picks": cur,
            "estimate_usd": round(est, 3)}


def _analyse_no_stt(providers, clips, ap, cache, workers, do_mos):
    from concurrent.futures import ThreadPoolExecutor

    def job(c):
        f = ap.public / c.rel
        if not f.exists():
            return c.rel, None
        return c.rel, chk.analyse(providers.speech, f.read_bytes(), intended=c.text.thai, kind="item", voice=c.voice,
                                  sex=voice_sex(c.voice), cache=cache, f0_dir=ap.state / "f0", stage="voices",
                                  do_stt=False, do_mos=do_mos)

    out = {}
    with ThreadPoolExecutor(max_workers=max(1, workers)) as ex:
        for rel, a in ex.map(job, clips):
            if a is not None:
                out[rel] = a
    cache.save()
    return out


def _acc(model: pitch.ToneModel, items: list[tuple]) -> float:
    if not items:
        return 0.0
    return sum(model.classify(cv)[0] == t for cv, t, *_ in items) / len(items)


def _score(row: dict) -> None:
    ss = row["samples"]
    stt = [s for s in ss if s.get("cmp")]
    cers = [s["cmp"]["cer"] for s in stt]
    row["cer"] = round(float(np.mean(cers)), 4) if cers else 1.0
    endings = [s for s in ss if s["group"] == "ending"]
    row["endingsOk"] = bool(endings) and all((s.get("cmp") or {}).get("stt") == "pass" for s in endings)
    row["endingsPitch"] = round(float(np.mean([s["pitchScore"] or 0 for s in endings])), 3) if endings else None
    nums = [s for s in ss if s["group"] == "number"]
    row["numbersPitch"] = round(float(np.mean([s["pitchScore"] or 0 for s in nums])), 3) if nums else None
    mos = [s["mos"] for s in ss if s.get("mos") is not None]
    row["mos"] = round(float(np.median(mos)), 2) if mos else None
    pairs = {}
    for s in ss:
        if s["group"] == "pair" and s.get("heard"):
            pairs.setdefault(s["id"], {})[s["speed"]] = s["heard"][0]
    both = [d for d in pairs.values() if "normal" in d and "slow" in d]
    row["slowAgree"] = round(sum(d["normal"] == d["slow"] for d in both) / len(both), 3) if both else 0.0
    lr = [s["lufsRaw"] for s in ss if s.get("lufsRaw") is not None]
    row["loudnessSd"] = round(float(np.std(lr)), 2) if lr else None
    row["clipping"] = sum(s.get("clipping") == "fail" for s in ss)
    row["truncation"] = sum(s.get("truncation") == "fail" for s in ss)
    why = []
    if row["tone"] < TONE_BAR:
        why.append(f"tone {row['tone']:.0%} < 95%")
    if row["cer"] > CER_BAR:
        why.append(f"CER {row['cer']:.0%} > 10%")
    if not row["endingsOk"]:
        why.append("polite endings not transcribed correctly")
    row["why"] = why
    row["eligible"] = not why
    mos_s = min(1.0, max(0.0, ((row["mos"] or 1.0) - 1.0) / 3.5))
    loud_s = 1.0 if row["loudnessSd"] is None else max(0.0, 1 - row["loudnessSd"] / 6)
    cons = 0.7 * row["slowAgree"] + 0.3 * loud_s
    row["consistency"] = round(cons, 3)
    row["rank_score"] = round(0.4 * row["tone"] + 0.25 * max(0.0, 1 - 5 * row["cer"]) + 0.25 * mos_s + 0.1 * cons, 4)


# ---------- page ----------

_CSS = """
:root{--bg:#050505;--fg:#e8e8e8;--dim:#8a8a8a;--rule:#222;--ok:#2ee6a0;--bad:#ff5a6e;--acc:#2e9bff}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.45 Inter,system-ui,-apple-system,Segoe UI,sans-serif;padding:24px 16px}
main{max-width:1100px;margin:0 auto}h1{font-size:34px;letter-spacing:-.02em;margin:0 0 4px}h2{font-size:22px;margin:36px 0 8px}
.lab{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim)}p{color:var(--dim);max-width:70ch}
table{width:100%;border-collapse:collapse;margin:8px 0 16px;font-variant-numeric:tabular-nums}th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-weight:500;color:var(--dim);font-size:12px}tr.no{opacity:.38}tr.no td:first-child::after{content:" not eligible";color:var(--bad);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
.ok{color:var(--ok)}.bad{color:var(--bad)}code{color:var(--acc)}details{border-top:1px solid var(--rule);padding:8px 0}details.no{opacity:.45}
summary{cursor:pointer;font-weight:600}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:8px 16px;margin-top:8px}
.s{border:1px solid var(--rule);border-radius:6px;padding:6px 8px}.s .t{font-size:18px}.s small{color:var(--dim);display:block}
audio{width:100%;height:30px;margin-top:4px}pre{color:var(--dim);font-size:12px;overflow-x:auto}
@media (max-width:700px){table{font-size:12px}th:nth-child(n+7),td:nth-child(n+7){display:none}}
"""


def _pct(x) -> str:
    return "–" if x is None else f"{x:.0%}"


def render_html(data: dict) -> str:
    e = html.escape
    out = [f"<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
           f"<title>Phi voice audition</title><style>{_CSS}</style></head><body><main>",
           "<div class='lab'>Phi · Phase 4 · voices</div><h1>Voice audition</h1>",
           f"<p>Generated {e(data['generatedAt'])}{' (dry run, mock voices)' if data['dry'] else ''}. Scores are automatic: "
           "tone = pitch classifier on 60 tone-pair words (95% bar for tone training), CER = speech-to-text character error "
           "rate on sentences, endings and numbers, MOS = DNSMOS quality (1-5, local model), consistency = slow vs normal "
           "tone agreement and loudness stability. No AI model judged the tones. Listen, then pick by ear.</p>",
           "<p>This page writes nothing. Save your picks with "
           "<code>run.py voices --pick f1=&lt;voice&gt; f2=… m1=… m2=… x1=… x2=… nok=…</code>. "
           "Until then the automatic pick (top two eligible per gender) is used.</p>"]
    picks = data.get("picks", {})
    out.append("<h2>Current picks</h2><table><tr><th>slot</th><th>voice</th><th>source</th></tr>")
    src = picks.get("source", {})
    for k in tx.CHIRP_SLOTS + tx.EXTRA_SLOTS:
        if k in picks:
            out.append(f"<tr><td>{k}</td><td>{e(picks[k])}</td><td>{e(src.get(k, 'default'))}</td></tr>")
    for k, v in picks.get("cast", {}).items():
        out.append(f"<tr><td>{e(k)}</td><td>{e(v)}</td><td>{e(src.get(k, 'default'))}</td></tr>")
    out.append("</table>")
    for sex, title in (("f", "Female voices"), ("m", "Male voices")):
        rows = data["ranked"].get(sex, [])
        out.append(f"<h2>{title}</h2><table><tr><th>#</th><th>voice</th><th>engine</th><th>tone</th><th>tone slow</th>"
                   "<th>CER</th><th>MOS</th><th>consistency</th><th>loud sd</th><th>why not</th></tr>")
        for r in rows:
            cls = "" if r["eligible"] else " class='no'"
            out.append(f"<tr{cls}><td>{r['rank']}</td><td>{e(r['name'])}</td><td>{r['engine']}</td>"
                       f"<td class='{'ok' if r['tone'] >= TONE_BAR else 'bad'}'>{_pct(r['tone'])}</td><td>{_pct(r['toneSlow'])}</td>"
                       f"<td>{_pct(r['cer'])}</td><td>{r['mos'] if r['mos'] is not None else '–'}</td>"
                       f"<td>{_pct(r['consistency'])}</td><td>{r['loudnessSd'] if r['loudnessSd'] is not None else '–'}</td>"
                       f"<td>{e('; '.join(r['why']))}</td></tr>")
        out.append("</table>")
        for r in rows:
            out.append(f"<details class='{'' if r['eligible'] else 'no'}'><summary>{r['rank']}. {e(r['name'])} "
                       f"<span class='lab'>{r['engine']} · {'eligible' if r['eligible'] else 'not eligible'}</span></summary><div class='grid'>")
            for s in r["samples"]:
                exp = " ".join(s.get("expected") or [])
                got = " ".join(t or "?" for t in (s.get("heard") or []))
                good = (s.get("expected") == s.get("heard")) if s.get("expected") else None
                mark = "" if good is None else ("<span class='ok'>✓</span>" if good else "<span class='bad'>✗</span>")
                stt = s.get("stt")
                out.append(f"<div class='s'><span class='t'>{e(s['thai'])}</span> {mark}<small>{s['group']} · {s['speed']}"
                           + (f" · tone {e(exp)} → {e(got)}" if exp else "")
                           + (f" · heard “{e(stt)}”" if stt is not None else "")
                           + (f" · MOS {s['mos']}" if s.get("mos") is not None else "")
                           + f"</small><audio controls preload='none' src='{e(s['rel'])}'></audio></div>")
            out.append("</div></details>")
    out.append(f"<h2>Tone classifier</h2><p>{e(data['model']['source'])}</p><pre>{e(data['model']['table'])}</pre>")
    out.append("</main></body></html>")
    return "".join(out)
