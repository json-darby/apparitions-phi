"""Thai syllable segmentation for the tone calculator.

Thai spelling does not mark syllable boundaries, hides some vowels (สวัสดี is
sà-wàt-dii, ขนม is khà-nǒm) and lets a letter serve twice (ผลไม้ phǒn-lá-máai).
So this module does not return one answer: it enumerates the plausible
*readings* of a word, each a list of spoken syllables with a cost, cheapest
first. PyThaiNLP's syllable tokenizer is used as a hint (readings that agree
with its boundaries are cheaper); our own grammar fixes what it cannot do
(hidden vowels, leading consonants, linking syllables, silent letters).

The romanisation then picks the reading that matches (see ``checks.tone_check``).
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass, replace
from functools import lru_cache
from typing import Iterable

from .tables import (
    ABOVE_BELOW_VOWELS,
    CLASS_OF,
    CONSONANTS,
    FINAL_SOUND,
    FINALS,
    HIGH,
    LOW,
    LU,
    MAI_HAN_AKAT,
    MAI_TAI_KHU,
    MID,
    NIKHAHIT,
    PREPOSED,
    RU,
    SARA_A,
    SARA_AA,
    SARA_AM,
    SILENT_R_CLUSTERS,
    SONORANTS,
    STOP_SOUNDS,
    THANTHAKHAT,
    TONE_MARKS,
    TR_AS_S,
    TRUE_CLUSTERS,
    LAKKHANGYAO,
    rule_tone,
)

# ---------------------------------------------------------------------------
# data


@dataclass(frozen=True)
class Syllable:
    """One spoken syllable and the spelling evidence for its tone."""

    text: str                 # written letters this syllable covers ('' for a linking syllable)
    start: int
    end: int
    onset: str                # sounding initial letter(s), e.g. 'ม', 'คร'
    cls: str                  # consonant class used for the tone (after leading rules)
    vowel: str                # 'a', 'aa', 'o', 'ai', 'am', 'ao', 'iia', ...
    long: bool
    final: str | None         # 'k' 't' 'p' 'n' 'm' 'ng' 'y' 'w' or None (open)
    mark: str | None = None   # tone mark character, if written
    kind: str = "regular"     # regular | implicit_o | hidden_a | linking | exception
    lead: str | None = None   # 'ห' / 'อ' (silent leader) or 'hidden' (class from previous syllable)
    final_letter: str | None = None   # written final consonant (for linking syllables)
    fixed_tone: str | None = None     # exception syllables carry their tone
    roman: str | None = None          # exception syllables carry their romanisation
    core: str = ""            # the written syllable without silent tails, for second opinions

    @property
    def live(self) -> bool:
        if self.final in STOP_SOUNDS:
            return False
        if self.final is not None:
            return True
        return self.long

    @property
    def tone(self) -> str:
        if self.fixed_tone:
            return self.fixed_tone
        return rule_tone(self.cls, self.live, self.long, self.mark)

    def describe(self) -> str:
        if self.kind == "exception":
            return f"{self.text or '·'}={self.roman}({self.tone})"
        bits = [self.cls]
        if self.lead:
            bits.append(f"lead {self.lead}")
        bits.append("live" if self.live else "dead")
        if not self.live:
            bits.append("long" if self.long else "short")
        if self.mark:
            bits.append({"่": "mai ek", "้": "mai tho", "๊": "mai tri", "๋": "mai chattawa"}[self.mark])
        if self.kind in ("hidden_a", "linking"):
            bits.append(self.kind.replace("_", " "))
        return f"{self.text or '(' + self.onset + 'a)'}:{self.tone}[{', '.join(bits)}]"


@dataclass(frozen=True)
class Reading:
    syllables: tuple[Syllable, ...]
    cost: float
    alt: bool = False  # uses a non-primary exception reading (e.g. colloquial kháo for เขา)

    @property
    def tones(self) -> list[str]:
        return [s.tone for s in self.syllables]

    def describe(self) -> str:
        return " ".join(s.describe() for s in self.syllables)


# ---------------------------------------------------------------------------
# normalisation

_ZW = dict.fromkeys(map(ord, "​‌‍⁠﻿"), None)


def normalize_thai(text: str) -> str:
    """Canonical form used by the analysers (not a fix for bad input: script_check reports that)."""
    t = unicodedata.normalize("NFC", text).translate(_ZW)
    t = t.replace(NIKHAHIT + SARA_AA, SARA_AM)          # ํ + า -> ำ
    t = t.replace("เเ", "แ")                            # two sara e -> sara ae
    # tone mark typed before an above/below vowel -> vowel first
    t = re.sub(r"([่-๋])([ัิีึืุู])", r"\2\1", t)
    # tone mark typed after sara am's nikhahit position is handled by NFC; ensure ่ำ order
    return t


# ---------------------------------------------------------------------------
# grammar helpers

_POST_VOWELS = {SARA_A, SARA_AA, SARA_AM, LAKKHANGYAO}


def _is_cons(s: str, i: int) -> bool:
    return 0 <= i < len(s) and s[i] in CONSONANTS


def _onset_context(s: str, q: int) -> bool:
    """True when the consonant at q must start a syllable (a vowel/tone sign follows it)."""
    nxt = s[q + 1] if q + 1 < len(s) else ""
    return bool(nxt) and (nxt in ABOVE_BELOW_VOWELS or nxt in TONE_MARKS or nxt in _POST_VOWELS)


def _silent_tail(s: str, e: int, closed: bool = True) -> int:
    """Skip letters cancelled by ์ (karan): 'ร์', 'ทร์', 'ติ์'.

    After an open syllable only one letter can be silent (เบียร์, บาร์); two-letter
    tails follow a written final (จันทร์, ศาสตร์), so แพทย์ is phâet, not phae."""
    n = len(s)
    # consonant + ิ/ุ + consonant + ์ (กษัตริย์, ...ริย์)
    if closed and e + 3 < n and _is_cons(s, e) and s[e + 1] in "ิุ" and _is_cons(s, e + 2) and s[e + 3] == THANTHAKHAT:
        return e + 4
    for ln in ((1, 2) if closed else (1,)):
        j = e + ln
        if all(_is_cons(s, e + x) for x in range(ln)):
            if j < n and s[j] == THANTHAKHAT:
                return j + 1
            if j + 1 < n and s[j] in "ิุ" and s[j + 1] == THANTHAKHAT:
                return j + 2
    return e


def _finals(s: str, q: int) -> list[tuple[str, str, int, float]]:
    """Possible written finals at q: (sound, letter, end, cost)."""
    out: list[tuple[str, str, int, float]] = []
    n = len(s)
    # silent ิ / ุ after a final at the end of a word or before a consonant (ชาติ, เหตุ, ญาติ)
    if (
        q + 1 < n and s[q] in "ตทธ" and s[q + 1] in "ิุ"
        and (q + 2 == n or s[q + 2] in CONSONANTS or s[q + 2] in PREPOSED)
    ):
        # after ต it is almost always silent (ชาติ ญาติ เหตุ ธาตุ เกียรติ ประวัติ);
        # after other letters usually sounded (สมาธิ sà-maa-thí, สาธุ, อายุ)
        out.append((FINAL_SOUND[s[q]], s[q], q + 2, 0.0 if s[q] == "ต" else 1.0))
    if q < n and s[q] in FINALS and not _onset_context(s, q):
        if q + 1 < n and s[q + 1] == THANTHAKHAT:
            # silent letter; in loans the real final may follow it (กอล์ฟ gɔ́ɔp, ฟอร์ม, การ์ด, เสิร์ฟ)
            r = q + 2
            if r < n and s[r] in FINALS and not _onset_context(s, r) and s[r + 1 : r + 2] != THANTHAKHAT:
                out.append((FINAL_SOUND[s[r]], s[r], _silent_tail(s, r + 1), 0.3))
            return out
        e = q + 1
        out.append((FINAL_SOUND[s[q]], s[q], _silent_tail(s, e), 0.0))
        # silent ร after a final (เพชร, สมัคร, จักร, บุตร, มิตร)
        if e < n and s[e] == "ร" and not _onset_context(s, e) and (
            e + 1 == n or s[e + 1] in CONSONANTS or s[e + 1] in PREPOSED
        ):
            out.append((FINAL_SOUND[s[q]], s[q], e + 1, 0.8))
        # doubled final at the end of a word: ยุทธ yút, พุทธ phút (second letter silent)
        if e + 1 == n and s[e] in FINALS and FINAL_SOUND.get(s[e]) == FINAL_SOUND[s[q]] in STOP_SOUNDS:
            out.append((FINAL_SOUND[s[q]], s[q], e + 1, 0.8))
    return out


_O_LEAD_WORDS = ("อย่า", "อยู่", "อยาก")  # อย่าง starts with อย่า


def _onsets(s: str, k: int) -> list[tuple[str, str, str | None, int, float]]:
    """(onset, class, lead, next index, cost) for the consonant(s) at k."""
    c = s[k]
    out = [(c, CLASS_OF[c], None, k + 1, 0.0)]
    if _is_cons(s, k + 1):
        d = s[k + 1]
        pair = c + d
        if c == "ห" and d in SONORANTS:
            out.append((d, HIGH, "ห", k + 2, -0.3))
        elif c == "อ" and d == "ย" and s.startswith(_O_LEAD_WORDS, k):
            # silent อ before ย: only อย่า อยู่ อย่าง อยาก (อยุธยา is à-yút-thá-yaa)
            out.append((d, MID, "อ", k + 2, -0.3))
        elif pair == TR_AS_S:
            out.append(("ซ", LOW, None, k + 2, 0.2))
            out.append((pair, LOW, None, k + 2, 0.6))  # loans: ทรัมเป็ต
        elif pair in TRUE_CLUSTERS:
            cost = 0.4 if pair in ("ผล", "บร", "บล", "ดร", "ฟร", "ฟล") else 0.0
            out.append((pair, CLASS_OF[c], None, k + 2, cost))
        elif pair in SILENT_R_CLUSTERS:
            out.append((c, CLASS_OF[c], None, k + 2, 0.0))
    return out


# vowel form: (vowel, long, next index, final mode, fixed final, cost)
# final mode: 'open' (no written final), 'opt' (final optional), 'req' (final required)
_VF = tuple[str, bool, int, str, "str | None", float]


def _vowel_forms(s: str, p: int, pre: str | None, v1: str | None, mark: str | None) -> list[_VF]:
    n = len(s)
    ch = s[p] if p < n else ""
    ch2 = s[p + 1] if p + 1 < n else ""
    out: list[_VF] = []
    if pre is None:
        if v1 is None:
            if ch == SARA_A:
                out.append(("a", False, p + 1, "open", None, 0.0))
            elif ch == SARA_AA:
                out.append(("aa", True, p + 1, "opt", None, 0.0))
            elif ch == SARA_AM:
                out.append(("am", False, p + 1, "open", "m", 0.0))
            elif ch == "อ" and not _onset_context(s, p):
                out.append(("aaw", True, p + 1, "opt", None, 0.0))
            elif ch == RU:
                long = ch2 == LAKKHANGYAO
                out.append(("rʉ" if long else "ri", long, p + 2 if long else p + 1, "opt", None, 0.4))
            if ch == "ว" and _finals(s, p + 1) and not _onset_context(s, p):
                out.append(("uua", True, p + 1, "req", None, 0.2))
            if ch == "ร" and ch2 == "ร":
                out.append(("a", False, p + 2, "opt", "n", 0.3))  # กรรม, สรร, ธรรม
            if ch == "ร" and not _onset_context(s, p) and (p + 1 == n or ch2 in CONSONANTS or ch2 in PREPOSED):
                out.append(("aaw", True, p + 1, "open", "n", 1.0))  # ละคร, อักษร, พร
            if _is_cons(s, p):
                out.append(("o", False, p, "req", None, 0.6))   # implicit o: คน, ผม
            if mark is None:
                out.append(("a", False, p, "open", None, 1.5))  # hidden a: ส|วัส, ข|นม
        elif v1 == MAI_HAN_AKAT:
            if ch == "ว":
                if ch2 == SARA_A:
                    out.append(("ua", False, p + 2, "open", None, 0.0))
                else:
                    out.append(("uua", True, p + 1, "opt", None, 0.0))
            out.append(("a", False, p, "req", None, 0.0))
        elif v1 == "ิ":
            out.append(("i", False, p, "opt", None, 0.0))
        elif v1 == "ี":
            out.append(("ii", True, p, "opt", None, 0.0))
        elif v1 == "ึ":
            out.append(("ʉ", False, p, "opt", None, 0.0))
        elif v1 == "ื":
            if ch == "อ":
                out.append(("ʉʉ", True, p + 1, "opt", None, 0.0))
            out.append(("ʉʉ", True, p, "req", None, 0.2))
        elif v1 == "ุ":
            out.append(("u", False, p, "opt", None, 0.0))
        elif v1 == "ู":
            out.append(("uu", True, p, "opt", None, 0.0))
        elif v1 == MAI_TAI_KHU:
            if ch == "อ":
                out.append(("aw", False, p + 1, "req", None, 0.0))  # ล็อก
            else:
                out.append(("aw", False, p, "open", None, 0.5))
    elif pre == "เ":
        if v1 is None:
            if ch == SARA_AA and ch2 == SARA_A:
                out.append(("aw", False, p + 2, "open", None, 0.0))
            elif ch == SARA_AA:
                out.append(("ao", False, p + 1, "open", "w", 0.0))
            elif ch == "อ" and ch2 == SARA_A:
                out.append(("oe", False, p + 2, "open", None, 0.0))
            elif ch == "อ" and not _onset_context(s, p):
                out.append(("ooe", True, p + 1, "open", None, 0.0))
                if _finals(s, p + 1):
                    out.append(("ooe", True, p + 1, "req", None, 0.3))  # loans: เทอม thəəm
            elif ch == SARA_A:
                out.append(("e", False, p + 1, "open", None, 0.0))
            if ch == "ย" and not _onset_context(s, p):
                out.append(("ooe", True, p + 1, "open", "y", 0.1))  # เลย, เคย
            if ch not in (SARA_AA, SARA_A):
                out.append(("ee", True, p, "opt", None, 0.2 if ch in ("อ", "ย") else 0.0))
        elif v1 == "ี":
            if ch == "ย" and ch2 == SARA_A:
                out.append(("ia", False, p + 2, "open", None, 0.0))
            elif ch == "ย":
                out.append(("iia", True, p + 1, "opt", None, 0.0))
        elif v1 == "ื":
            if ch == "อ" and ch2 == SARA_A:
                out.append(("ʉa", False, p + 2, "open", None, 0.0))
            elif ch == "อ":
                out.append(("ʉʉa", True, p + 1, "opt", None, 0.0))
        elif v1 == "ิ":
            out.append(("ooe", True, p, "req", None, 0.0))       # เกิด, เดิน
        elif v1 == MAI_TAI_KHU:
            out.append(("e", False, p, "req", None, 0.0))        # เป็น, เจ็ด
    elif pre == "แ":
        if v1 is None:
            if ch == SARA_A:
                out.append(("ae", False, p + 1, "open", None, 0.0))
            else:
                out.append(("aae", True, p, "opt", None, 0.0))
        elif v1 == MAI_TAI_KHU:
            out.append(("ae", False, p, "req", None, 0.0))       # แข็ง
    elif pre == "โ":
        if v1 is None:
            if ch == SARA_A:
                out.append(("o", False, p + 1, "open", None, 0.0))
            else:
                out.append(("oo", True, p, "opt", None, 0.0))
    elif pre in ("ไ", "ใ"):
        if v1 is None:
            out.append(("ai", False, p, "open", "y", 0.0))
            if pre == "ไ" and ch == "ย" and not _onset_context(s, p):
                out.append(("ai", False, p + 1, "open", "y", 0.0))  # ไทย: silent ย
    return out


def _syllables_at(s: str, i: int) -> list[tuple[Syllable, int, float]]:
    n = len(s)
    out: list[tuple[Syllable, int, float]] = []
    k = i
    pre = None
    if s[k] in PREPOSED:
        pre = s[k]
        k += 1
        if k >= n:
            return out
    # ฤ / ฦ standing alone: rʉ́ / lʉ́ (ฤดู), long with ๅ
    if pre is None and s[k] in (RU, LU):
        long = k + 1 < n and s[k + 1] == LAKKHANGYAO
        e = k + 2 if long else k + 1
        onset = "ร" if s[k] == RU else "ล"
        syl = Syllable(s[i:e], i, e, onset, LOW, "ʉʉ" if long else "ʉ", long, None, core=s[i:e])
        out.append((syl, e, 0.3))
        return out
    if s[k] not in CONSONANTS:
        return out
    for onset, cls, lead, m, ocost in _onsets(s, k):
        p = m
        v1 = None
        mark = None
        if p < n and s[p] in ABOVE_BELOW_VOWELS:
            v1 = s[p]
            p += 1
        if p < n and s[p] in TONE_MARKS:
            mark = s[p]
            p += 1
        if p < n and s[p] in ABOVE_BELOW_VOWELS and v1 is None:
            # tolerate tone-before-vowel order (script_check reports it)
            v1 = s[p]
            p += 1
        for vowel, long, q, mode, fixed_final, vcost in _vowel_forms(s, p, pre, v1, mark):
            kind = "regular"
            if vowel == "o" and pre is None and v1 is None and q == p:
                kind = "implicit_o"
            if vowel == "a" and pre is None and v1 is None and q == p and mode == "open":
                kind = "hidden_a"
                if lead is not None or len(onset) > 1:
                    continue
            base = ocost + vcost
            ends: list[tuple[str | None, str | None, int, float]] = []
            if mode in ("open", "opt"):
                ends.append((fixed_final, None, _silent_tail(s, q, closed=False), 0.0))
            if mode in ("opt", "req"):
                for snd, letter, e, fcost in _finals(s, q):
                    ends.append((snd, letter, e, fcost))
            for final, letter, e, fcost in ends:
                if mode == "opt" and final is None and fixed_final is not None:
                    final = fixed_final
                text = s[i:e]
                core = re.sub(r"[ก-ฮ]{1,2}[ิุ]?์$", "", text)
                syl = Syllable(
                    text=text, start=i, end=e, onset=onset, cls=cls, vowel=vowel, long=long,
                    final=final, mark=mark, kind=kind, lead=lead, final_letter=letter, core=core,
                )
                out.append((syl, e, base + fcost))
    return out


# ---------------------------------------------------------------------------
# exceptions are injected by tones.py: {word: [list of (roman, tone) per syllable] per reading}

ExceptionTable = dict[str, list[list[tuple[str, str]]]]


def _exception_units(s: str, i: int, table: ExceptionTable, keys: tuple[str, ...]):
    out = []
    for key in keys:
        if s.startswith(key, i):
            e = i + len(key)
            if e < len(s) and (s[e] in ABOVE_BELOW_VOWELS or s[e] in TONE_MARKS or s[e] in _POST_VOWELS
                               or s[e] == THANTHAKHAT or s[e + 1 : e + 2] == THANTHAKHAT):
                continue  # not a syllable boundary: ไหม is not a prefix of ไหม้, ฉัน of ฉันท์
            for idx, sylls in enumerate(table[key]):
                syls = []
                for r, t in sylls:
                    syls.append(Syllable(
                        text=key if len(syls) == 0 else "", start=i, end=e, onset="", cls=MID,
                        vowel="", long=False, final=None, kind="exception", fixed_tone=t, roman=r,
                    ))
                # the whole word's text sits on the first syllable; give each a readable label
                syls = [replace(x, text=f"{key}#{j + 1}" if len(syls) > 1 else key) for j, x in enumerate(syls)]
                out.append((tuple(syls), e, -1.0 if idx == 0 else 1.5, idx > 0))
    return out


# ---------------------------------------------------------------------------
# word readings

_TOP_K = 16
_KEEP = 40          # partial readings kept per position
LINK_COST = 2.0     # a linking syllable (ผลไม้ phǒn-lá-máai) is unusual but regular


LEAD_OPTIONAL = 0.8   # cost of the less usual choice at a possible leading-consonant site
#: Off by default: the leading rule is applied strictly (always after a hidden 'a',
#: never after a written -ะ/-ำ or a linking syllable) and the words that break it
#: are listed in tones.EXCEPTIONS_ROMAN. Turning this on accepts both readings
#: everywhere, which lets real errors through (ตลาด as dtà-lâat).
OPTIONAL_LEADS = False


def _lead_sites(syls: list[Syllable]) -> list[tuple[int, bool]]:
    """Places where the leading-consonant rule may apply: (index of the led syllable, preferred?).

    A high- or mid-class syllable with a short 'a' in front of a single low sonorant
    can give the next syllable high class. With a hidden 'a' this is the normal
    reading (ตลาด dtà-làat, ขนม khà-nǒm, อร่อย à-ròi, เสนอ sà-nə̌ə); in Pali/Sanskrit
    words it does not apply (สมาชิก sà-maa-chík, ขโมย khà-mooi). After a written
    -ะ or -ำ it is the exception (ประโยค bprà-yòok, สำเร็จ sǎm-rèt, but กำไร gam-rai).
    """
    sites = []
    for j in range(len(syls) - 1):
        a, b = syls[j], syls[j + 1]
        if not (
            a.cls in (HIGH, MID) and len(a.onset) <= 2
            and b.kind in ("regular", "implicit_o") and b.lead is None
            and len(b.onset) == 1 and b.onset in SONORANTS
        ):
            continue
        if a.kind == "hidden_a" and len(a.onset) == 1:
            sites.append((j + 1, True))
        elif OPTIONAL_LEADS and a.kind == "linking":
            sites.append((j + 1, False))   # ศาสนา sàat-sà-nǎa
        elif OPTIONAL_LEADS and a.kind == "regular" and a.vowel in ("a", "am") and not a.long \
                and a.final_letter is None and a.mark is None:
            sites.append((j + 1, False))
    return sites


def _postprocess(syls: list[Syllable]) -> list[tuple[list[Syllable], float]]:
    """Apply the leading-consonant rule; returns variants with their extra cost."""
    sites = _lead_sites(syls)
    if not sites:
        return [(list(syls), 0.0)]
    sites = sites[:4]
    if not OPTIONAL_LEADS:
        out = list(syls)
        for idx, preferred in sites:
            if preferred:
                out[idx] = replace(out[idx], cls=HIGH, lead="hidden")
        return [(out, 0.0)]
    variants = []
    for mask in range(1 << len(sites)):
        out = list(syls)
        extra = 0.0
        for bit, (idx, preferred) in enumerate(sites):
            led = bool(mask >> bit & 1)
            if led:
                out[idx] = replace(out[idx], cls=HIGH, lead="hidden")
            if led != preferred:
                extra += LEAD_OPTIONAL
        variants.append((out, extra))
    return variants


def _hint_penalty(syls: Iterable[Syllable], word: str, hint: tuple[int, ...]) -> float:
    if not hint:
        return 0.0
    bounds = {s.end for s in syls if s.kind != "linking"}
    return 0.7 * sum(1 for b in hint if b not in bounds)


@lru_cache(maxsize=4096)
def _tokenizer_bounds(word: str) -> tuple[int, ...]:
    try:
        from pythainlp.tokenize import syllable_tokenize

        parts = syllable_tokenize(word)
    except Exception:  # pragma: no cover - tokenizer optional
        return ()
    if "".join(parts) != word:
        return ()
    bounds, pos = [], 0
    for p in parts[:-1]:
        pos += len(p)
        bounds.append(pos)
    return tuple(bounds)


def readings(
    word: str,
    exceptions: ExceptionTable | None = None,
    top: int = _TOP_K,
    use_hint: bool = True,
) -> list[Reading]:
    """All plausible readings of one Thai word (no spaces), cheapest first."""
    s = normalize_thai(word)
    n = len(s)
    if n == 0:
        return [Reading((), 0.0)]
    table = exceptions or {}
    keys_by_first: dict[str, tuple[str, ...]] = {}
    for key in sorted(table, key=len, reverse=True):
        keys_by_first.setdefault(key[0], ())
        keys_by_first[key[0]] += (key,)

    memo: dict[int, list[tuple[float, tuple[Syllable, ...], bool]]] = {}

    def suffix(i: int) -> list[tuple[float, tuple[Syllable, ...], bool]]:
        if i == n:
            return [(0.0, (), False)]
        if i in memo:
            return memo[i]
        res: list[tuple[float, tuple[Syllable, ...], bool]] = []
        exc = _exception_units(s, i, table, keys_by_first.get(s[i], ()))
        for syls, j, cost, alt in exc:
            for c2, rest, alt2 in suffix(j):
                res.append((cost + c2, syls + rest, alt or alt2))
        # a listed irregular word is read only as listed (ก็ is never gàw)
        for syl, j, cost in ([] if exc else _syllables_at(s, i)):
            cost += 0.1
            if syl.kind == "hidden_a" and j == n:
                cost += 1.0  # a word rarely ends in a hidden vowel
            for c2, rest, alt2 in suffix(j):
                res.append((cost + c2, (syl,) + rest, alt2))
            # linking syllable: the final letter also starts a hidden-'a' syllable (ผลไม้, ราชการ)
            if syl.final_letter and j < n and syl.end == j:
                link = Syllable(
                    text="", start=j, end=j, onset=syl.final_letter, cls=CLASS_OF[syl.final_letter],
                    vowel="a", long=False, final=None, kind="linking",
                )
                for c2, rest, alt2 in suffix(j):
                    res.append((cost + LINK_COST + c2, (syl, link) + rest, alt2))
        # a preposed vowel written before two consonants may belong to the second:
        # เสนอ = ส(a) + เนอ, แสดง = ส(a) + แดง, เฉพาะ = ฉ(a) + เพาะ, เมล็ด = ม(a) + เล็ด
        if (
            not exc and s[i] in PREPOSED and i + 2 < n and s[i + 1] in CONSONANTS and s[i + 2] in CONSONANTS
            and not any(len(o) > 1 or ld for o, _c, ld, _m, _x in _onsets(s, i + 1)[1:])
        ):
            c = s[i + 1]
            first = Syllable(
                text=s[i : i + 2], start=i, end=i + 2, onset=c, cls=CLASS_OF[c], vowel="a",
                long=False, final=None, kind="hidden_a", core="",
            )
            v = s[i] + s[i + 2 :]
            for syl2, ev, cost2 in _syllables_at(v, 0):
                e = ev + i + 1
                text = s[i] + s[i + 2 : e]
                syl2 = replace(syl2, text=text, start=i, end=e, core="")
                strong = syl2.vowel not in ("ee", "aae", "oo", "ai")
                if CLASS_OF[c] == LOW and not (MAI_TAI_KHU in text):
                    continue  # low-class first letter: only with ไม้ไต่คู้ (เมล็ด má-lét), not เวลา
                cost = (0.4 if strong else 1.0) + cost2 + 0.2
                for c2, rest, alt2 in suffix(e):
                    res.append((cost + c2, (first, syl2) + rest, alt2))
        res.sort(key=lambda r: r[0])
        # dedupe identical tone/boundary signatures
        seen, kept = set(), []
        for r in res:
            sig = tuple((x.start, x.end, x.tone, x.kind) for x in r[1])
            if sig in seen:
                continue
            seen.add(sig)
            kept.append(r)
            if len(kept) >= _KEEP:
                break
        memo[i] = kept
        return kept

    hint = _tokenizer_bounds(s) if use_hint else ()
    out = []
    for cost, syls, alt in suffix(0):
        for variant, extra in _postprocess(list(syls)):
            syls2 = tuple(variant)
            out.append(Reading(syls2, cost + extra + _hint_penalty(syls2, s, hint), alt))
    out.sort(key=lambda r: r.cost)
    seen, final = set(), []
    for r in out:
        sig = tuple((x.text, x.tone) for x in r.syllables)
        if sig in seen:
            continue
        seen.add(sig)
        final.append(r)
        if len(final) >= top:
            break
    if not final and table:
        return readings(word, None, top, use_hint)  # an exception key cut the word badly
    return final


def syllabify(word: str, exceptions: ExceptionTable | None = None) -> list[Syllable]:
    """The best reading's syllables."""
    rs = readings(word, exceptions)
    return list(rs[0].syllables) if rs else []
