"""Shared pieces of the text stage: where state lives, romanisation helpers,
item shaping and line composition (a port of the app's compose/sayForm).

State lives in work/text/ for real runs and work/dry/text/ for dry runs, so
fake content can never mix with real content. Every file is plain JSON and is
rewritten atomically, so an interrupted run resumes where it stopped.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import unicodedata
from pathlib import Path

from ..config import WORK

TONES = ["mid", "low", "falling", "high", "rising"]
VOICES = ["f1", "f2", "m1", "m2"]
SPEEDS = ["normal", "slow"]
ENDING_IDS = ["khrap", "kha-statement", "kha-question"]
ENDINGS = {
    "m": {"thai": "ครับ", "roman": "khráp", "tones": ["high"], "id": "khrap"},
    "fs": {"thai": "ค่ะ", "roman": "khâ", "tones": ["falling"], "id": "kha-statement"},
    "fq": {"thai": "คะ", "roman": "khá", "tones": ["high"], "id": "kha-question"},
}
# Cast speech forms (app/src/content/street-seed.ts NPC_SEX)
NPC_SEX = {"nok": "f", "ton": "m", "ploy": "f", "lek": "m", "mai": "f", "bank": "m", "fah": "f", "pim": "f"}
CAST = {
    "nok": "Nok, woman in her fifties, food-stall owner, warm and quick",
    "ton": "Ton, man in his forties, taxi driver, patient",
    "ploy": "Ploy, woman in her twenties, hotel receptionist, precise",
    "lek": "Lek, man in his thirties, market trader, fast talker, teasing",
    "mai": "Mai, woman in her thirties, pharmacist, calm",
    "bank": "Bank, man in his late twenties, bar regular, easy laugh",
    "fah": "Fah, woman in her late twenties, bar regular, direct, dry humour",
    "pim": "Pim, woman in her thirties, guide and narrator, unhurried",
}


# ---------------------------------------------------------------- state

def text_root(dry: bool) -> Path:
    return WORK / "dry" / "text" if dry else WORK / "text"


def read_json(path: Path, default):
    if not path.exists():
        return default
    try:
        return json.loads(path.read_text(encoding="utf8"))
    except json.JSONDecodeError:
        return default


def write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf8")
    os.replace(tmp, path)


class Store:
    """The text stage's working state for one mode (dry or real)."""

    def __init__(self, dry: bool):
        self.dry = dry
        self.root = text_root(dry)
        self.root.mkdir(parents=True, exist_ok=True)

    # items and patterns: one file per day
    def day_path(self, kind: str, day: int) -> Path:
        return self.root / kind / f"day{day:02d}.json"

    def load_day(self, kind: str, day: int) -> dict:
        return read_json(self.day_path(kind, day), {"day": day, kind: {}, "attempts": {}, "errors": {}})

    def save_day(self, kind: str, day: int, data: dict) -> None:
        write_json(self.day_path(kind, day), data)

    def culture(self) -> dict:
        return read_json(self.root / "culture.json", {"notes": {}, "attempts": {}, "errors": {}})

    def save_culture(self, data: dict) -> None:
        write_json(self.root / "culture.json", data)

    def task(self, tid: str) -> dict:
        return read_json(self.root / "tasks" / f"{tid}.json", {})

    def save_task(self, tid: str, data: dict) -> None:
        write_json(self.root / "tasks" / f"{tid}.json", data)

    def verify(self) -> dict:
        return read_json(self.root / "verify.json", {})

    def save_verify(self, data: dict) -> None:
        write_json(self.root / "verify.json", data)

    def all_items(self, upto: int = 999) -> list[dict]:
        out = []
        for f in sorted((self.root / "items").glob("day*.json")):
            d = read_json(f, {})
            if d.get("day", 999) <= upto:
                out += list(d.get("items", {}).values())
        return out


def content_hash(obj) -> str:
    return hashlib.sha1(json.dumps(obj, ensure_ascii=False, sort_keys=True).encode("utf8")).hexdigest()[:12]


# ---------------------------------------------------------------- romanisation

_MARKS = {"̀": "low", "̂": "falling", "́": "high", "̌": "rising"}


def syllables(roman: str) -> list[str]:
    return [s for s in re.split(r"[\s\-]+", roman.strip()) if s]


def tones_from_roman(roman: str) -> list[str]:
    """One tone per syllable, read off the diacritics (mid has none)."""
    out = []
    for syl in syllables(roman):
        nfd = unicodedata.normalize("NFD", syl)
        tone = "mid"
        for ch in nfd:
            if ch in _MARKS:
                tone = _MARKS[ch]
        out.append(tone)
    return out


def is_thai_text(s: str) -> bool:
    return bool(s) and all(("฀" <= ch <= "๿") or ch in " " for ch in s)


# ---------------------------------------------------------------- items

WORD_SKILLS = ["hear", "say", "read", "tone"]
PHRASE_SKILLS = ["hear", "say", "read"]
ENDING_SKILLS = {"khrap": ["hear", "say", "tone"], "kha-statement": ["hear", "say", "tone"], "kha-question": ["hear", "tone"]}


def empty_media() -> dict:
    return {"audio": {f"{v}.{s}": None for v in VOICES for s in SPEEDS}, "pitch": None, "image": None, "animation": None}


def shape_item(raw: dict, entry: dict, allowed_ids: set[str]) -> dict:
    """A generated item in the exact shape of the app's Item (types.ts)."""
    roman = " ".join(raw.get("roman", "").split())
    kind = "phrase" if " " in roman else "word"
    it: dict = {
        "id": entry["id"],
        "kind": kind,
        "thai": raw.get("thai", "").strip(),
        "roman": roman,
        "tones": list(raw.get("tones", [])),
        "en": entry["en"],
        "theme": entry["theme"],
        "day": entry["day"],
    }
    if raw.get("polite") in ("statement", "question"):
        it["polite"] = raw["polite"]
    if raw.get("speaker") in ("m", "f"):
        it["speaker"] = raw["speaker"]
    forms = raw.get("forms") or {}
    m, f = forms.get("m") or {}, forms.get("f") or {}
    if m.get("thai") and f.get("thai") and m["thai"] != f["thai"]:
        it["forms"] = {"m": {"thai": m["thai"].strip(), "roman": " ".join(m.get("roman", "").split())},
                       "f": {"thai": f["thai"].strip(), "roman": " ".join(f.get("roman", "").split())}}
    if raw.get("hook"):
        it["hook"] = raw["hook"].strip()
    ex = raw.get("example") or {}
    if ex.get("thai"):
        it["example"] = {"thai": ex["thai"].strip(), "roman": " ".join(ex.get("roman", "").split()), "en": ex.get("en", "").strip()}
    cl = (raw.get("classifier") or "").strip()
    if cl and cl in allowed_ids and cl != entry["id"]:
        it["classifier"] = cl
    contrasts = [c for c in raw.get("contrasts", []) if c in allowed_ids and c != entry["id"]]
    if contrasts:
        it["contrasts"] = sorted(set(contrasts))
    it["survival"] = bool(entry.get("survival"))
    if entry.get("adult"):
        it["adult"] = True
    it["skills"] = ENDING_SKILLS.get(entry["id"], WORD_SKILLS if kind == "word" else PHRASE_SKILLS)
    it["tags"] = list(entry.get("tags", []))
    it["status"] = "draft"
    it["media"] = empty_media()
    return it


def say_form(it: dict, who: str) -> dict:
    """The app's sayForm: the learner's Thai with the polite ending for their identity."""
    base = it["forms"][who] if it.get("forms") else {"thai": it["thai"], "roman": it["roman"]}
    tones = tones_from_roman(base["roman"])
    if not it.get("polite"):
        return {"thai": base["thai"], "roman": base["roman"], "tones": tones}
    # a woman says คะ after นะ (นะคะ, never นะค่ะ)
    q = it["polite"] == "question" or base["thai"].endswith("นะ")
    e = ENDINGS["m"] if who == "m" else ENDINGS["fq" if q else "fs"]
    return {"thai": base["thai"] + e["thai"], "roman": f"{base['roman']} {e['roman']}", "tones": tones + e["tones"]}


PRONOUN = {"m": ("ผม", "phǒm"), "f": ("ฉัน", "chǎn")}
_NUM_ID = re.compile(r"n(\d+)$")
_MULTIPLIERS = {10, 100, 1000, 10000, 100000, 1000000}
_ENDS_POLITE = ("ครับ", "ค่ะ", "คะ")


def _number_syllables(items: dict[str, dict]) -> dict[str, str]:
    """Thai number syllable -> romanisation, taken from the course's own number items."""
    table: dict[str, str] = {}
    for iid, it in items.items():
        if not _NUM_ID.match(iid):
            continue
        thai, rom = it["thai"], it["roman"].split("-")
        syl = re.findall(r"ศูนย์|หนึ่ง|สอง|สาม|สี่|ห้า|หก|เจ็ด|แปด|เก้า|สิบ|เอ็ด|ยี่|ร้อย|พัน|หมื่น|แสน|ล้าน", thai)
        if "".join(syl) == thai and len(syl) == len(rom):
            table.update(zip(syl, rom))
    return table


def _read_number(run: list[str], items: dict[str, dict]) -> dict | None:
    """A run of number items said as one number (3 100 5 10 -> สามร้อยห้าสิบ, 2 10 -> ยี่สิบ, 10 1 -> สิบเอ็ด).
    Only when the run has a ten, hundred, ... in it: a run of bare digits (a phone number) is read digit by digit."""
    vals = [int(_NUM_ID.match(p).group(1)) for p in run]
    if len(vals) < 2 or not any(v in _MULTIPLIERS for v in vals):
        return None
    total = cur = 0
    for v in vals:
        if v in _MULTIPLIERS:
            total += (cur or 1) * v
            cur = 0
        else:
            cur += v
    value = total + cur
    from pythainlp.util import num_to_thaiword

    thai = num_to_thaiword(value)
    table = _number_syllables(items)
    syl = re.findall("|".join(sorted(table, key=len, reverse=True)), thai) if table else []
    if not syl or "".join(syl) != thai:
        return None
    roman = "-".join(table[s] for s in syl)
    return {"thai": thai, "roman": roman}


def _in_line_form(it: dict, who: str, standalone: bool) -> dict:
    """The form of one item inside a line. An item's forms are how it is said ON ITS OWN: some add the
    speaker's pronoun (เอา -> ผมเอา, ดนตรี -> ผมชอบดนตรี). Inside a longer line the plain word is used,
    or 'not want' came out as ไม่ผมเอา (seen on the real run, 4 Oct 2026). Items that are themselves whole
    sentences with a pronoun (ผมชอบเมืองไทย) keep the speaker's form."""
    plain = {"thai": it["thai"], "roman": it["roman"]}
    if not it.get("forms"):
        return plain
    f = it["forms"][who]
    if standalone:
        return f
    adds_pronoun = f["thai"] != it["thai"] and f["thai"].startswith(PRONOUN[who][0]) and not it["thai"].startswith(PRONOUN["m"][0])
    return plain if adds_pronoun else f


def compose(parts: list[str], who: str, ending: str | None, items: dict[str, dict]) -> dict:
    """Build a line from item ids. '_' puts a space between phrases; 'I' is the
    speaker's own pronoun. ending: 's', 'q' or None. Mirrors street-seed.ts."""
    ids: list[str] = []
    thai, roman, tones = "", [], []
    space = False
    words = [p for p in parts if p != "_"]
    standalone = len(words) == 1
    prev_pronoun = False
    i = 0
    while i < len(parts):
        p0 = parts[i]
        if p0 == "_":
            space = True
            i += 1
            continue
        p = ("i-male" if who == "m" else "i-female") if p0 == "I" else p0
        it = items.get(p)
        if it is None:
            raise KeyError(p)
        # a run of number items is said as one number
        run = [p]
        if _NUM_ID.match(p):
            j = i + 1
            while j < len(parts) and parts[j] != "_" and _NUM_ID.match(parts[j]) and parts[j] in items:
                run.append(parts[j])
                j += 1
        num = _read_number(run, items) if len(run) > 1 else None
        if num:
            form, step = num, len(run)
        else:
            form, step = _in_line_form(it, who, standalone), 1
            run = [p]
        # "I" just before a form that already starts with the pronoun: say it once
        pr = PRONOUN[who]
        if prev_pronoun and form["thai"].startswith(pr[0]) and form["thai"] != pr[0]:
            form = {"thai": form["thai"][len(pr[0]):], "roman": form["roman"].split(" ", 1)[1] if form["roman"].startswith(pr[1] + " ") else form["roman"]}
        thai += (" " if space and thai else "") + form["thai"]
        roman.append(form["roman"])
        tones += tones_from_roman(form["roman"])
        ids += run
        prev_pronoun = p in ("i-male", "i-female")
        space = False
        i += step
    # never a second polite ending (an item like ขอโทษนะครับ already carries one)
    if ending in ("s", "q") and not thai.endswith(_ENDS_POLITE):
        # after นะ a woman says คะ, never ค่ะ (นะคะ, not นะค่ะ)
        e = ENDINGS["m"] if who == "m" else ENDINGS["fq" if ending == "q" or thai.endswith("นะ") else "fs"]
        thai += e["thai"]
        roman.append(e["roman"])
        tones += e["tones"]
        ids.append(e["id"])
    return {"thai": thai, "roman": " ".join(roman), "tones": tones, "items": ids}
