"""Every text in course.json that needs audio, with stable ids, voices and
paths (CONTRACT.md layout: audio/<kind>/<id>/<voice>.<speed>.ogg), matching
what the app's sound service requests.

What gets audio (keys are always "<voice>.<speed>", paths relative to app/public/)
  item     item.media.audio. Each voice says the item the way a screen asks
           for it in that voice's sex: male voices with ครับ appended, female
           voices with ค่ะ (คะ when polite = "question"), and forms.m / forms.f
           where the words differ (app repo.ts sayForm). Items said by one sex
           only (`speaker`) get that sex's voices only. x1 (female) and x2 (male)
           are extra Gemini training voices under the same rule.
           media.pitch: one 16-point curve per syllable of item.thai, without
           the polite ending, the median over the Chirp voices that say item.thai.
  letter   letter.media.audio: the letter's spoken name (letter.nameThai /
           thaiName when the text builder gives it, else the bare consonant
           syllable, e.g. กอ).
  line     course.lines[id].audio. Sentences get 2 voices, not 4 (owner's
           choice, to halve their cost; single words keep all 4 for tone
           training). An NPC line: the cast member's own Gemini voice
           ("nok.normal") plus one Chirp voice of that sex. A learner line
           ("you") with forms: f1 says forms.f, m1 says forms.m. A line only one
           sex says: that sex's two Chirp voices. Any other line: f1 and m1.
           Sentences are made at normal speed only (owner's choice): the app
           plays them slowed with pitch kept (AudioSound SLOW_STRETCH). Words,
           letter names and tone drills keep a natively spoken slow clip, where
           each syllable and tone is said in full.
           The app falls back to the nearest voice of the same sex.
           Every other phrase a screen plays is a line too, created here when
           missing: "example.<itemId>" (item.example) and
           "pattern.<patternId>.<n>" (pattern example n, tiles joined with no
           space as the app's patternThai() does). Their files sit under
           audio/example/<itemId>/ and audio/pattern/<patternId>.<n>/.
  tone     course.toneSets entries (tone-pair syllables), when present.

Check refs (course.checks): item:<id>, letter:<id>, line:<lineId>, tone:<id>.
"""

from __future__ import annotations

import json
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

from ..config import MODELS, PIPELINE
from ..providers.speech import NORMAL_STYLE, SLOW_RATE, SLOW_STYLE, is_chirp, voice_sex

CHIRP_SLOTS = ("f1", "f2", "m1", "m2")
EXTRA_SLOTS = ("x1", "x2")
SPEEDS = ("normal", "slow")

# The cast's speech sex (app/src/content/street-seed.ts NPC_SEX).
CAST_SEX = {"nok": "f", "ton": "m", "ploy": "f", "lek": "m", "mai": "f", "bank": "m", "fah": "f", "pim": "f"}

# Defaults until the audition picks (pipeline/voices.json overrides them).
# Gemini voices are gender-matched to the cast (seed.ts CAST: age and manner).
DEFAULT_VOICES = {
    "f1": "th-TH-Chirp3-HD-Achernar",
    "f2": "th-TH-Chirp3-HD-Callirrhoe",
    "m1": "th-TH-Chirp3-HD-Alnilam",
    "m2": "th-TH-Chirp3-HD-Iapetus",
    "x1": "Autonoe",
    "x2": "Orus",
    "cast": {
        "nok": "Gacrux",  # 50s food vendor, mature
        "ton": "Charon",  # 40s taxi driver, informative, patient
        "ploy": "Leda",  # 20s receptionist, youthful
        "lek": "Puck",  # 30s market trader, upbeat
        "mai": "Kore",  # 30s pharmacist, firm and calm
        "bank": "Achird",  # late-20s bar regular, friendly
        "fah": "Despina",  # late-20s bar regular, smooth, dry
        "pim": "Sulafat",  # 30s guide and narrator, warm
    },
}

SLOT_SEX = {"f1": "f", "f2": "f", "x1": "f", "m1": "m", "m2": "m", "x2": "m"}

ENDINGS = {"m": ("ครับ", "khráp", "high"), "fs": ("ค่ะ", "khâ", "falling"), "fq": ("คะ", "khá", "high")}

_MARKS = {"̀": "low", "́": "high", "̂": "falling", "̌": "rising"}


def roman_tones(roman: str) -> list[str]:
    """Tones from Paiboon-style romanisation: no mark = mid, grave = low,
    circumflex = falling, acute = high, caron = rising (CONTRACT.md)."""
    out = []
    for word in (roman or "").replace("-", " ").split():
        word = "".join(c for c in unicodedata.normalize("NFD", word) if c.isalpha() or c in _MARKS)
        if not any(c.isalpha() for c in word):
            continue
        tone = "mid"
        for c in word:
            if c in _MARKS:
                tone = _MARKS[c]
        out.append(tone)
    return out


def tones_from_spelling(thai: str) -> list[str] | None:
    """Fallback when a text has no tones or romanisation: the Thai builder's
    rule-based tone calculator (phi_pipeline.thai.tones), when present."""
    try:
        from ..thai.tones import tones_of  # type: ignore

        got = tones_of(thai)
        return list(got) or None
    except Exception:
        return None


MALE_WORDS = {"ครับ", "ผม", "นะครับ", "ครับผม"}
FEMALE_WORDS = {"ค่ะ", "คะ", "ฉัน", "นะคะ", "ดิฉัน"}


def text_sex(thai: str) -> str | None:
    """Which sex says this sentence: from its polite ending, else from a pronoun or ending anywhere in it
    (ผมกินไก่ is a man's sentence: a woman's voice must not say it). None when it could be either."""
    t = thai.strip().rstrip("?!. ")
    if t.endswith("ครับ"):
        return "m"
    if t.endswith("ค่ะ") or t.endswith("คะ"):
        return "f"
    try:
        from pythainlp.tokenize import word_tokenize

        words = set(word_tokenize(t, keep_whitespace=False))
    except Exception:  # noqa: BLE001
        words = set(t.split())
    m, f = bool(words & MALE_WORDS), bool(words & FEMALE_WORDS)
    return "m" if m and not f else "f" if f and not m else None


# ---------- voices config ----------


def voices_path(dry: bool) -> Path:
    from ..config import WORK

    return (WORK / "dry" / "voices.json") if dry else (PIPELINE / "voices.json")


def load_voices(dry: bool, path: Path | None = None) -> dict:
    cfg = json.loads(json.dumps(DEFAULT_VOICES))
    p = path or voices_path(dry)
    if p.exists():
        got = json.loads(p.read_text(encoding="utf8"))
        for k, v in got.items():
            if k == "cast" and isinstance(v, dict):
                cfg["cast"].update(v)
            elif k in CHIRP_SLOTS + EXTRA_SLOTS and isinstance(v, str):
                cfg[k] = v
    return cfg


def slot_voice(cfg: dict, slot: str) -> str:
    if slot in cfg and isinstance(cfg[slot], str):
        return cfg[slot]
    return cfg["cast"][slot]


# ---------- texts and clips ----------


@dataclass
class AudioText:
    kind: str  # item | letter | line | example | pattern | tone
    owner: str  # item / letter / tone id, or the line id for example, pattern and line
    thai: str
    tones: list[str] | None
    slots: list[str]
    ref: str  # key in course.checks
    group: str = ""  # sex group when one record is said differently by sex
    pitch_n: int | None = None  # syllables that feed media.pitch (item.thai without the ending)
    say: str | None = None  # what the voice is given instead of `thai` (pipeline/say.json), same sounds

    @property
    def spoken(self) -> str:
        """The text sent to the voice and compared with the transcription."""
        return self.say or self.thai

    @property
    def dir(self) -> str:
        if self.kind == "example":
            return f"audio/example/{self.owner.split('.', 1)[1]}"
        if self.kind == "pattern":
            return f"audio/pattern/{self.owner.split('.', 1)[1]}"
        if self.kind == "line":
            return f"audio/lines/{self.owner}"
        return f"audio/{self.kind}/{self.owner}"

    @property
    def key(self) -> str:
        return f"{self.dir}#{self.group}" if self.group else self.dir

    @property
    def is_line(self) -> bool:
        return self.kind in ("line", "example", "pattern")

    @property
    def strict(self) -> bool:
        """Short texts (words, letter names) are judged syllable by syllable."""
        return self.tones is not None and len(self.tones) <= 4 and self.kind in ("item", "letter", "tone")


@dataclass
class Clip:
    text: AudioText
    slot: str
    speed: str
    voice: str  # provider voice name
    rel: str  # path relative to app/public
    rate: float = 1.0
    style: str | None = None
    model: str | None = None
    meta: dict = field(default_factory=dict)

    @property
    def chirp(self) -> bool:
        return is_chirp(self.voice)

    @property
    def media_key(self) -> str:
        return f"{self.slot}.{self.speed}"


def _slots_for_sex(sex: str | None, extras: bool = False) -> list[str]:
    slots = [s for s in CHIRP_SLOTS if sex is None or SLOT_SEX[s] == sex]
    if extras:
        slots += [s for s in EXTRA_SLOTS if sex is None or SLOT_SEX[s] == sex]
    return slots


def _line_slots(sex: str | None) -> list[str]:
    """Two voices per sentence: both of one sex, or one woman and one man."""
    return _slots_for_sex(sex) if sex else ["f1", "m1"]


def say_form(item: dict, sex: str) -> tuple[str, list[str] | None]:
    """app/src/content/repo.ts sayForm(): (thai, tones) said by `sex`."""
    forms = item.get("forms")
    if forms:
        thai, tones = forms[sex]["thai"], roman_tones(forms[sex].get("roman", ""))
        if forms[sex]["thai"] == item["thai"] and item.get("tones"):
            tones = list(item["tones"])
    else:
        thai, tones = item["thai"], list(item.get("tones") or []) or roman_tones(item.get("roman", ""))
    pol = item.get("polite")
    if pol:
        # a woman says คะ after นะ (นะคะ, never นะค่ะ)
        e = ENDINGS["m" if sex == "m" else ("fq" if pol == "question" or thai.endswith("นะ") else "fs")]
        thai += e[0]
        tones = tones + [e[2]] if tones else tones
    return thai, (tones or None)


def ensure_lines(course: dict) -> int:
    """Create or refresh the example.<itemId> and pattern.<patternId>.<n> lines.
    A line whose text changed loses its audio. Returns lines added or changed."""
    lines = course.setdefault("lines", {})
    want: dict[str, dict] = {}
    for it in course.get("items", []):
        ex = it.get("example")
        if ex and ex.get("thai"):
            want[f"example.{it['id']}"] = {"thai": ex["thai"], "roman": ex.get("roman", "")}
    for p in course.get("patterns", []):
        for n, tiles in enumerate(p.get("examples") or []):
            want[f"pattern.{p['id']}.{n}"] = {"thai": "".join(t["thai"] for t in tiles),
                                               "roman": " ".join(t.get("roman", "") for t in tiles)}
    changed = 0
    for lid in [k for k in lines if (k.startswith("example.") or k.startswith("pattern.")) and k not in want]:
        del lines[lid]
        changed += 1
    for lid, w in want.items():
        cur = lines.get(lid)
        if cur and cur.get("thai") == w["thai"]:
            continue
        lines[lid] = {"thai": w["thai"], "roman": w["roman"], "speaker": "you", "audio": {}}
        changed += 1
    return changed


def collect(course: dict) -> list[AudioText]:
    out: list[AudioText] = []
    for it in course.get("items", []):
        iid = it["id"]
        sp = it.get("speaker")
        n = len(it.get("tones") or []) or None
        if not it.get("polite") and not it.get("forms"):
            tones = list(it.get("tones") or []) or roman_tones(it.get("roman", "")) or None
            out.append(AudioText("item", iid, it["thai"], tones, _slots_for_sex(sp, extras=True), f"item:{iid}", pitch_n=n))
            continue
        for sex in ("f", "m"):
            if sp and sp != sex:
                continue
            thai, tones = say_form(it, sex)
            base = it["forms"][sex]["thai"] if it.get("forms") else it["thai"]
            out.append(AudioText("item", iid, thai, tones, _slots_for_sex(sex, extras=True), f"item:{iid}", group=sex,
                                 pitch_n=n if base == it["thai"] else None))
    for le in course.get("letters", []):
        name = le.get("nameThai") or le.get("thaiName")
        tones = roman_tones(le.get("name", "")) or None
        if not name:
            if le.get("cls") not in ("mid", "high", "low"):
                continue  # vowels and tone marks need a spoken name from the text builder
            name = le["char"] + "อ"
            tones = tones[:1] if tones else None
        if not tones or len(tones) != len(tones_from_spelling(name) or tones):
            tones = tones_from_spelling(name) or tones
        out.append(AudioText("letter", le["id"], name, tones, list(CHIRP_SLOTS), f"letter:{le['id']}",
                             pitch_n=len(tones) if tones else None))
    for lid, line in (course.get("lines") or {}).items():
        kind = "example" if lid.startswith("example.") else "pattern" if lid.startswith("pattern.") else "line"
        spk = line.get("speaker", "you")
        tones = list(line.get("tones") or []) or roman_tones(line.get("roman", "")) or tones_from_spelling(line["thai"])
        forms = line.get("forms") or {}
        if spk in CAST_SEX or (spk and spk != "you"):
            sex = CAST_SEX.get(spk) or text_sex(line["thai"])
            # the character's own voice only (other voices of that sex are added if it fails: alt_slots)
            out.append(AudioText(kind, lid, line["thai"], tones, [spk], f"line:{lid}"))
        elif forms.get("m") and forms.get("f") and forms["m"].get("thai") != forms["f"].get("thai"):
            for sex in ("f", "m"):
                fm = forms[sex]
                t = list(fm.get("tones") or []) or roman_tones(fm.get("roman", "")) or None
                out.append(AudioText(kind, lid, fm["thai"], t, _line_slots(sex)[:1], f"line:{lid}", group=sex))
        else:
            out.append(AudioText(kind, lid, line["thai"], tones, _line_slots(text_sex(line["thai"])), f"line:{lid}"))
    for ts in course.get("toneSets") or []:
        tones = list(ts.get("tones") or []) or roman_tones(ts.get("roman", "")) or None
        out.append(AudioText("tone", ts["id"], ts["thai"], tones, list(CHIRP_SLOTS) + list(EXTRA_SLOTS), f"tone:{ts['id']}",
                             pitch_n=len(tones) if tones else None))
    return out


def clips_for(t: AudioText, cfg: dict) -> list[Clip]:
    out = []
    speeds = ("normal",) if t.is_line else SPEEDS
    for slot in t.slots:
        voice = slot_voice(cfg, slot)
        for speed in speeds:
            chirp = is_chirp(voice)
            rate = SLOW_RATE if (speed == "slow" and chirp) else 1.0
            style = None if chirp else (SLOW_STYLE if speed == "slow" else NORMAL_STYLE)
            model = None if chirp else MODELS.tts_gemini
            out.append(Clip(t, slot, speed, voice, f"{t.dir}/{slot}.{speed}.ogg", rate, style, model))
    return out


def all_clips(course: dict, cfg: dict) -> tuple[list[AudioText], list[Clip]]:
    texts = collect(course)
    clips = [c for t in texts for c in clips_for(t, cfg)]
    return texts, clips


def summary(texts: list[AudioText], clips: list[Clip]) -> dict:
    by: dict[str, int] = {}
    for t in texts:
        by[t.kind] = by.get(t.kind, 0) + 1
    chirp_chars = sum(len(c.text.spoken) for c in clips if c.chirp)
    gem = [c for c in clips if not c.chirp]
    return {"texts": len(texts), "by_kind": by, "clips": len(clips), "chirp_clips": len(clips) - len(gem),
            "gemini_clips": len(gem), "chirp_characters": chirp_chars}


def slot_sex(cfg: dict, slot: str) -> str:
    if slot in SLOT_SEX:
        return SLOT_SEX[slot]
    return CAST_SEX.get(slot) or voice_sex(slot_voice(cfg, slot))


def load_say(dry: bool, path: Path | None = None) -> dict[str, str]:
    """pipeline/say.json: check ref -> the spelling handed to the voice when it cannot read the
    course's own (a rare letter's name, a lone particle). Same sounds, different letters; the app
    still shows the course text."""
    p = path or (PIPELINE / "say.json")
    if dry and path is None or not p.exists():
        return {}
    return {k: v for k, v in json.loads(p.read_text(encoding="utf8")).items() if isinstance(v, str) and v}


def alt_slots(t: AudioText, cfg: dict) -> list[str]:
    """Other course voices of the same sex(es) as the text's own, tried when none of its clips is clean.
    Sentences stay within f1 f2 m1 m2: the app tells a line's male and female builds apart by those names."""
    sexes = {slot_sex(cfg, s) for s in t.slots}
    pool = CHIRP_SLOTS if t.is_line else CHIRP_SLOTS + EXTRA_SLOTS
    return [s for s in pool if SLOT_SEX[s] in sexes and s not in t.slots]
