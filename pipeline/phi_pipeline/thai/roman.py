"""Parse Phi's tone-marked romanisation (Paiboon-style) into syllables and tones.

Convention (pipeline/CONTRACT.md): one tone diacritic per syllable on the
vowel: mid none, low grave (à), falling circumflex (â), high acute (á),
rising caron (ǎ). Syllables in a word are joined by '-', words by spaces,
ʉ is used for ึ/ื.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, field

GRAVE, ACUTE, CIRCUMFLEX, CARON, MACRON = "̀", "́", "̂", "̌", "̄"
DIAERESIS, HORN, TILDE, BREVE = "̈", "̛", "̃", "̆"

MARK_TONE = {GRAVE: "low", CIRCUMFLEX: "falling", ACUTE: "high", CARON: "rising"}
TONE_MARK = {v: k for k, v in MARK_TONE.items()}

VOWEL_LETTERS = set("aeiouʉ")
CONSONANT_LETTERS = set("bcdfghjklmnpqrstvwxyz")
HYPHENS = "-‐‑‒–−"
STRIP_PUNCT = "?!.,;:\"'“”‘’()[]…¿¡"

# letters that other systems use for ʉ, and IPA letters some generators emit
_LETTER_MAP = {
    "ɯ": "ʉ", "ɨ": "ʉ", "ư": "ʉ",
    "ɔ": "aw", "ə": "oe", "ɛ": "ae", "ŋ": "ng",
}


@dataclass
class RomanSyllable:
    text: str            # as written (NFC)
    base: str            # lowercase, tone mark removed, letters normalised
    tone: str            # mid | low | falling | high | rising
    word: int            # index of the space-separated word


@dataclass
class RomanParse:
    syllables: list[RomanSyllable] = field(default_factory=list)
    problems: list[str] = field(default_factory=list)

    @property
    def tones(self) -> list[str]:
        return [s.tone for s in self.syllables]

    @property
    def ok(self) -> bool:
        return not self.problems


def normalize_roman(text: str) -> str:
    """NFC, lowercase, unify hyphens and ʉ variants (keeps tone diacritics)."""
    t = unicodedata.normalize("NFD", text.strip().lower())
    # u + horn / diaeresis are ʉ in some systems
    t = t.replace("u" + HORN, "ʉ").replace("u" + DIAERESIS, "ʉ")
    for k, v in _LETTER_MAP.items():
        t = t.replace(k, v)
    for h in HYPHENS[1:]:
        t = t.replace(h, "-")
    t = re.sub(r"\s+", " ", t)
    return unicodedata.normalize("NFC", t)


def _parse_syllable(raw: str, word: int, problems: list[str]) -> RomanSyllable | None:
    d = unicodedata.normalize("NFD", raw)
    tones: list[str] = []
    base_chars: list[str] = []
    prev = ""
    for ch in d:
        if ch in MARK_TONE:
            if prev not in VOWEL_LETTERS:
                problems.append(f"'{raw}': tone mark not on a vowel")
            tones.append(MARK_TONE[ch])
            continue
        if ch == MACRON:
            problems.append(f"'{raw}': macron is not used (mid tone has no mark)")
            continue
        if unicodedata.combining(ch):
            problems.append(f"'{raw}': unexpected diacritic U+{ord(ch):04X}")
            continue
        base_chars.append(ch)
        prev = ch
    base = "".join(base_chars)
    if not base:
        problems.append(f"empty syllable in word {word + 1}")
        return None
    bad = [c for c in base if c not in VOWEL_LETTERS and c not in CONSONANT_LETTERS]
    if bad:
        problems.append(f"'{raw}': unexpected character(s) {''.join(sorted(set(bad)))!r}")
    if not any(c in VOWEL_LETTERS for c in base):
        problems.append(f"'{raw}': syllable has no vowel")
    if len(tones) > 1:
        problems.append(f"'{raw}': {len(tones)} tone marks on one syllable")
    tone = tones[0] if tones else "mid"
    return RomanSyllable(unicodedata.normalize("NFC", raw), unicodedata.normalize("NFC", base), tone, word)


def parse_roman(roman: str) -> RomanParse:
    """Split a romanisation into syllables with tones; problems are reported, not raised."""
    out = RomanParse()
    t = normalize_roman(roman)
    if not t:
        out.problems.append("romanisation is empty")
        return out
    words = [w.strip(STRIP_PUNCT) for w in t.split(" ")]
    words = [w for w in words if w]
    for wi, w in enumerate(words):
        if w.startswith("-") or w.endswith("-") or "--" in w:
            out.problems.append(f"'{w}': stray hyphen")
        for raw in w.split("-"):
            raw = raw.strip(STRIP_PUNCT)
            if not raw:
                continue
            syl = _parse_syllable(raw, wi, out.problems)
            if syl:
                out.syllables.append(syl)
    return out


def roman_tones(roman: str) -> list[str]:
    return parse_roman(roman).tones


def syllable_count(roman: str) -> int:
    return len(parse_roman(roman).syllables)


def same_roman(a: str, b: str) -> bool:
    """Equal after normalisation (NFC/NFD, ʉ variants, hyphen variants, case)."""
    return normalize_roman(a) == normalize_roman(b)


def mark_tone(base: str, tone: str) -> str:
    """Put a tone diacritic on a toneless syllable (first vowel of the nucleus)."""
    if tone == "mid":
        return base
    d = unicodedata.normalize("NFD", base)
    m = re.search(r"[aeiouʉ]+", d)
    if not m:
        return base
    # Paiboon puts the mark on the first vowel letter of the nucleus
    i = m.start()
    return unicodedata.normalize("NFC", d[: i + 1] + TONE_MARK[tone] + d[i + 1 :])
