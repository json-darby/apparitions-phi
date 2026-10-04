"""Back-transcription check: transcribe every clip with Chirp speech-to-text,
normalise both sides and compare with the intended Thai.

Normalisation (both sides): Unicode NFC and PyThaiNLP's mark-order fix,
Thai digits -> Arabic, "฿120" / "120 บาท" -> words, digits -> Thai number words
(num_to_thaiword), ๆ expanded to the repeated word, spaces, zero-width
characters and punctuation removed, Latin lower-cased, and the loanwords the
recogniser writes in Latin letters (ATM, Wi-Fi) put back into Thai.

The recogniser writes numbers as digits whatever was said, so what it heard
is also read in the other ways it could have been spoken (heard_forms): a
digit run digit by digit (phone numbers), a clock time ("14:00 น.") in each
way Thai says that hour, a letter name with its bare letter ("พ. สำเภา")
spelled out. Any reading that matches counts.

Verdicts
  exact        identical after normalisation: pass
  sound-alike  identical once both are romanised without tones (PyThaiNLP
               royin, with r and l merged): pass. STT here checks consonants
               and vowels; a homophone or a different tone mark is the pitch
               check's business, and a single word gives the recogniser no
               context to pick the right homophone (คลับ comes back as ครับ).
  near         character error rate within the kind's allowance (sentences
               and lines 8%, letter names 34%: "กอ ไก่" often comes back as
               "ก ไก่"): pass
  fail         anything else
"""

from __future__ import annotations

import re
import unicodedata
from functools import lru_cache

MAX_CER = {"item": 0.0, "tone": 0.0, "letter": 0.34, "example": 0.08, "pattern": 0.08, "line": 0.08}

_PUNCT = re.compile(r"[\s​‌‍﻿.,!?;:\"'“”‘’()\[\]{}\-–—…/\\|*_~`^]+")

# Loanwords the course writes in Thai and the recogniser writes in Latin letters (seen on the real run).
LATIN = {"atm": "เอทีเอ็ม", "wifi": "ไวไฟ"}

# Two spellings of one spoken word: the question particle is written เหรอ and หรอ alike (not หรอก).
SPELLINGS = [(re.compile("หรอ(?!ก)"), "เหรอ")]

_DIGIT_WORDS = ("ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า")
_CLOCK = re.compile(r"(\d{1,2})[:.](\d{2})(?:\s*น\.?(?![ก-๙]))?")
_BARE_LETTER = re.compile(r"\s*([ก-ฮ])\.?\s+(\S.*)$")


def _expand_mai_yamok(text: str) -> str:
    if "ๆ" not in text:
        return text
    try:
        from pythainlp.tokenize import word_tokenize

        toks = word_tokenize(text.replace(" ๆ", "ๆ"), keep_whitespace=False)
    except Exception:
        return text.replace("ๆ", "")
    out: list[str] = []
    for t in toks:
        if t == "ๆ" and out:
            out.append(out[-1])
        elif t.endswith("ๆ") and len(t) > 1:
            out += [t[:-1], t[:-1]]
        else:
            out.append(t)
    return "".join(out)


def _numbers_to_words(text: str) -> str:
    from pythainlp.util import num_to_thaiword

    text = re.sub(r"฿\s*([\d,]+(?:\.\d+)?)", lambda m: m.group(1) + "บาท", text)

    def words(m: re.Match) -> str:
        s = m.group(0).replace(",", "")
        try:
            if "." in s:
                a, b = s.split(".", 1)
                return num_to_thaiword(int(a)) + "จุด" + "".join(num_to_thaiword(int(c)) for c in b)
            return num_to_thaiword(int(s))
        except Exception:
            return s

    return re.sub(r"\d[\d,]*(?:\.\d+)?", words, text)


def _arabic(text: str) -> str:
    t = unicodedata.normalize("NFC", text or "")
    try:
        from pythainlp.util import normalize as thai_norm, thai_digit_to_arabic_digit

        t = thai_digit_to_arabic_digit(thai_norm(t))
    except Exception:
        pass
    return t


@lru_cache(maxsize=20000)
def normalise(text: str) -> str:
    t = _numbers_to_words(_arabic(text))
    t = _expand_mai_yamok(t)
    t = _PUNCT.sub("", t).lower()
    t = re.sub(r"[a-z]+", lambda m: LATIN.get(m.group(0), m.group(0)), t)
    for pat, to in SPELLINGS:
        t = pat.sub(to, t)
    return t


def _clock_forms(h: int, m: int) -> list[str]:
    """The ways Thai says the time a recogniser wrote as H:MM. It writes ตีสอง, สองโมงเช้า and
    บ่ายสองโมง alike as digits, so every reading whose spoken number fits that hour is offered."""
    from pythainlp.util import num_to_thaiword as w

    if h > 24 or m > 59:
        return []
    mins = [""] if m == 0 else [w(m) + "นาที"] + (["ครึ่ง"] if m == 30 else [])
    hours = [w(h) + "นาฬิกา"]
    if h in (0, 24):
        hours.append("เที่ยงคืน")
    if h == 12:
        hours += ["เที่ยง", "เที่ยงวัน"]
    for n in sorted({h, h - 6, h - 12, h - 18} & set(range(1, 13))):
        x = w(n)
        hours += [f"ตี{x}", f"{x}โมงเช้า", f"{x}โมง", f"บ่าย{x}โมง", f"บ่าย{x}", f"{x}โมงเย็น", f"{x}ทุ่ม"]
        if n == 1:
            hours += ["บ่ายโมง", "ทุ่มหนึ่ง", "ทุ่มนึง"]
    return [a + b for a in hours for b in mins]


def heard_forms(heard: str, kind: str = "item") -> list[str]:
    """Every normalised reading of what the recogniser wrote; the plain one comes first."""
    raw = _arabic(heard)
    out = [normalise(raw)]

    def add(s: str) -> None:
        n = normalise(s)
        if n not in out:
            out.append(n)

    if re.search(r"\d", raw):
        joined = re.sub(r"(?<=\d)[\s\-](?=\d)", "", raw)
        add(re.sub(r"\d", lambda m: _DIGIT_WORDS[int(m.group(0))], joined))
        m = _CLOCK.search(raw)
        if m:
            for form in _clock_forms(int(m.group(1)), int(m.group(2))):
                add(raw[: m.start()] + form + raw[m.end():])
    if kind == "letter":
        m = _BARE_LETTER.match(raw)
        if m:
            add(m.group(1) + "อ" + m.group(2))
    return out


@lru_cache(maxsize=20000)
def sound(text: str) -> str:
    """Toneless romanisation for the sound-alike comparison (r and l merged)."""
    try:
        from pythainlp.transliterate import romanize

        return re.sub(r"\s+", "", romanize(text, engine="royin")).replace("r", "l")
    except Exception:
        return text


def cer(ref: str, hyp: str) -> float:
    if not ref:
        return 0.0 if not hyp else 1.0
    prev = list(range(len(hyp) + 1))
    for i, a in enumerate(ref, 1):
        cur = [i]
        for j, b in enumerate(hyp, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a != b)))
        prev = cur
    return prev[-1] / len(ref)


def compare(intended: str, heard: str, kind: str = "item") -> dict:
    a = normalise(intended)
    forms = heard_forms(heard, kind)
    b = forms[0]
    if a in forms:
        return {"stt": "pass", "verdict": "exact", "cer": 0.0}
    # Speech-to-text often returns nothing at all for a lone short word (seen for ไป, มา on the real run).
    # Nothing heard is not a wrong word: Chirp reads exactly the text it is given, and silent or broken
    # clips are caught by the silence, duration and truncation checks. Recorded as unverified, not failed.
    if not b and kind in ("item", "letter", "tone") and len(a) <= 8:
        return {"stt": "n/a", "verdict": "empty", "cer": None}
    e = round(min(cer(a, f) for f in forms), 4)
    if a and any(f and sound(a) == sound(f) for f in forms):
        return {"stt": "pass", "verdict": "sound-alike", "cer": e}
    if e <= MAX_CER.get(kind, 0.0):
        return {"stt": "pass", "verdict": "near", "cer": e}
    return {"stt": "fail", "verdict": "fail", "cer": e}
