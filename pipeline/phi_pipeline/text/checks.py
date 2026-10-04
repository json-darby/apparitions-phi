"""Rule-based checks on generated Thai text (Phase 4, Step 2).

Every check returns a list of ``Issue``. ``fail`` means the item must be
regenerated; ``warn`` is logged but does not block.

- tone_check     tones computed from the Thai spelling vs the romanisation and tones[]
- word_check     every word is in PyThaiNLP's word list (or Phi's allow-list)
- taught_check   a sentence uses only taught words
- endings_check  male/female polite endings and pronouns
- script_check   Thai script hygiene

No AI model is involved anywhere here.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from typing import Iterable

from ..thai import tones as T
from ..thai.roman import parse_roman
from ..thai.syllables import Reading, normalize_thai
from ..thai.tables import (
    ABOVE_BELOW_VOWELS,
    CONSONANTS,
    MAI_TAI_KHU,
    NIKHAHIT,
    PREPOSED,
    THANTHAKHAT,
    TONE_MARKS,
    TONES,
)


@dataclass
class Issue:
    check: str      # "tone" | "syllables" | "words" | "taught" | "endings" | "script"
    severity: str   # "fail" | "warn"
    detail: str


def _fail(check: str, detail: str) -> Issue:
    return Issue(check, "fail", detail)


def _warn(check: str, detail: str) -> Issue:
    return Issue(check, "warn", detail)


# ---------------------------------------------------------------------------
# tone_check

MISMATCH = 10.0          # alignment penalty per syllable whose tone disagrees
UNLIKELY_READING = 1.0   # cost gap above which a reading picked by the romanisation is flagged


MAX_SPAN = 3   # adjacent word tokens that may be re-read as one unit (tokenizer slips: ไห|นคะ)
SPAN_COST = 0.3


def _spans(tokens: list[T.Token], i: int):
    """Units starting at token i: the token itself, or it glued to the next ones."""
    yield 1, tokens[i], 0.0
    text = tokens[i].text
    if text in ("ๆ", "ฯลฯ"):
        return
    for L in range(2, MAX_SPAN + 1):
        if i + L > len(tokens) or tokens[i + L - 1].text in ("ๆ", "ฯลฯ"):
            return
        text += tokens[i + L - 1].text
        yield L, T.Token(text, list(T.word_readings(text))), SPAN_COST


def _align(tokens: list[T.Token], rtones: list[str]):
    """Pick one reading per unit so the syllables line up with the romanisation.

    Returns a list of (unit, reading, start index) or None when no combination
    of readings has the romanisation's syllable count.
    """
    m = len(rtones)
    n = len(tokens)
    # best[i][j]: min penalty having used i tokens and j roman syllables
    INF = float("inf")
    best = [[INF] * (m + 1) for _ in range(n + 1)]
    back: list[list[tuple[int, int, T.Token, Reading] | None]] = [[None] * (m + 1) for _ in range(n + 1)]
    best[0][0] = 0.0
    for i in range(n):
        for j in range(m + 1):
            if best[i][j] == INF:
                continue
            for L, unit, extra in _spans(tokens, i):
                for r in unit.readings:
                    k = len(r.syllables)
                    if j + k > m:
                        continue
                    mism = sum(1 for a, b in zip(r.tones, rtones[j : j + k]) if a != b)
                    pen = best[i][j] + r.cost + extra + MISMATCH * mism
                    if pen < best[i + L][j + k]:
                        best[i + L][j + k] = pen
                        back[i + L][j + k] = (i, j, unit, r)
    if best[n][m] == INF:
        return None
    out = []
    i, j = n, m
    while i > 0:
        bi, bj, unit, r = back[i][j]  # type: ignore[misc]
        out.append((unit, r, bj))
        i, j = bi, bj
    out.reverse()
    return out


def _readable(tokens: list[T.Token]) -> str:
    parts = []
    for t in tokens:
        parts.append("-".join(s.text or "(" + s.onset + "a)" for s in t.best.syllables))
    return " ".join(parts)


def tone_check(thai: str, roman: str, tones: list[str] | None) -> list[Issue]:
    """Tones from the Thai spelling (rules) vs the romanisation's diacritics and tones[]."""
    issues: list[Issue] = []
    rp = parse_roman(roman or "")
    for p in rp.problems:
        issues.append(_fail("tone", f"romanisation: {p}"))
    rsyl = rp.syllables
    rtones = rp.tones

    if tones is not None:
        bad = [t for t in tones if t not in TONES]
        if bad:
            issues.append(_fail("tone", f"tones[] has unknown values {bad}"))
        if len(tones) != len(rsyl):
            issues.append(_fail(
                "syllables",
                f"tones[] has {len(tones)} entries but the romanisation '{roman}' has {len(rsyl)} syllables",
            ))
        else:
            for i, (a, b) in enumerate(zip(tones, rtones)):
                if a != b:
                    issues.append(_fail(
                        "tone", f"syllable {i + 1} '{rsyl[i].text}': romanisation marks {b} but tones[] says {a}"
                    ))
    if not rsyl:
        return issues

    tokens = T.analyse(thai)
    if not tokens:
        issues.append(_fail("syllables", "no Thai syllables found"))
        return issues

    path = _align(tokens, rtones)
    if path is None:
        n_best = sum(len(t.best.syllables) for t in tokens)
        issues.append(_fail(
            "syllables",
            f"the Thai spelling reads as {n_best} syllables ({_readable(tokens)}) "
            f"but the romanisation '{roman}' has {len(rsyl)}",
        ))
        return issues

    for tok, reading, j in path:
        k = len(reading.syllables)
        for x, (syl, rs) in enumerate(zip(reading.syllables, rsyl[j : j + k])):
            if syl.tone != rs.tone:
                issues.append(_fail(
                    "tone",
                    f"'{rs.text}' is marked {rs.tone} but the spelling gives {syl.tone}: {syl.describe()}",
                ))
            else:
                op = T.second_opinion(syl)
                if op and op != syl.tone:
                    issues.append(_warn(
                        "tone",
                        f"'{syl.text}' ({rs.text}): rules give {syl.tone}, pythainlp tone_detector gives {op}",
                    ))
        if reading.alt:
            issues.append(_warn(
                "tone",
                f"'{tok.text}' matches only a colloquial reading "
                f"({'-'.join(s.roman or '' for s in reading.syllables)}); standard is "
                f"{'-'.join(s.roman or '' for s in tok.readings[0].syllables)}",
            ))
        else:
            same_len = [r for r in tok.readings if len(r.syllables) == k]
            if same_len and reading.cost - same_len[0].cost >= UNLIKELY_READING:
                issues.append(_warn(
                    "tone",
                    f"'{tok.text}' matches the romanisation only as an unlikely reading "
                    f"({reading.describe()}); likelier: {same_len[0].describe()}",
                ))
    return issues


# ---------------------------------------------------------------------------
# word_check

PARTICLES = set(T.PARTICLES)

#: Sentence-final particles a line may always use, taught or not.
TAUGHT_FREE = {
    "ครับ", "ค่ะ", "คะ", "ค่า", "นะ", "นะคะ", "นะครับ", "ครับผม", "จ้ะ", "จ๊ะ", "จ้า", "จ๋า",
    "ฮะ", "สิ", "ซิ", "เถอะ", "หรอก", "ล่ะ", "น่ะ", "นะจ๊ะ", "ละ", "แหละ",
}

# Words the PyThaiNLP list lacks that Phi uses on purpose: cast names, loanwords, street words.
ALLOWED_WORDS = {
    # cast (nicknames)
    "นก", "ต้น", "พลอย", "เล็ก", "ใหม่", "แบงค์", "แบงก์", "ฟ้า", "พิม",
    # loanwords and everyday street vocabulary
    "เบียร์", "แท็กซี่", "บาร์", "กาแฟ", "โอเค", "เมนู", "ไวไฟ", "ลิฟต์", "ช็อกโกแลต",
    "ไอติม", "เช็คบิล", "เช็กบิล", "แกร็บ", "สตางค์", "โรงแรม", "ห้องน้ำ",
    "ส้มตำ", "ต้มยำ", "ผัดไทย", "ข้าวผัด", "น้ำแข็ง", "เท่าไหร่", "อันนี้",
    "ไม่เป็นไร", "ไม่ใช่", "ไม่เผ็ด", "แพงไป", "ตรงไป", "ปวดหัว",
}


_dictionary = T._dictionary


def _content_tokens(thai: str) -> list[str]:
    return [t for t in T.tokenize(thai) if t not in ("ๆ", "ฯลฯ") and re.search(r"[ก-๛]", t)]


def word_check(thai: str, extra_words: set[str] = frozenset()) -> list[Issue]:
    """Every word must be in PyThaiNLP's word list, the particle list, or the allow-list."""
    vocab = _dictionary()
    allowed = PARTICLES | ALLOWED_WORDS | set(extra_words)
    unknown = [t for t in _content_tokens(thai) if t not in vocab and t not in allowed]
    issues = []
    seen = set()
    for t in unknown:
        if t in seen:
            continue
        seen.add(t)
        issues.append(_fail("words", f"'{t}' is not in the Thai word list (invented word or misspelling?)"))
    return issues


# ---------------------------------------------------------------------------
# taught_check


def _expand(words: Iterable[str]) -> set[str]:
    out: set[str] = set()
    for w in words:
        w = normalize_thai(w).strip()
        if not w:
            continue
        for chunk in w.split():
            out.add(chunk)
        out.update(_content_tokens(w))
    return out


def taught_check(thai: str, known: set[str], new: set[str]) -> list[Issue]:
    """The sentence may use only known + new words (particles always allowed)."""
    from pythainlp.tokenize import word_tokenize
    from pythainlp.util import dict_trie

    vocab = _expand(known) | _expand(new) | TAUGHT_FREE
    trie = dict_trie(vocab)
    text = T.expand_numbers(normalize_thai(thai))
    issues: list[Issue] = []
    untaught: list[str] = []
    for chunk in re.split(r"[\s\?\!\.,;:\"'“”‘’()\[\]…\-ๆฯ]+", text):
        if not chunk:
            continue
        toks = word_tokenize(chunk, custom_dict=trie, engine="newmm", keep_whitespace=False)
        run = ""
        for t in toks + [None]:
            if t is not None and t not in vocab:
                run += t
                continue
            if run:
                # re-split the untaught span with the full dictionary for a readable report
                untaught.extend(_content_tokens(run) or [run])
                run = ""
    seen = set()
    for w in untaught:
        if w in seen:
            continue
        seen.add(w)
        issues.append(_fail("taught", f"'{w}' has not been taught yet"))
    return issues


# ---------------------------------------------------------------------------
# endings_check

MALE_MARKERS = {"ครับ", "ผม", "ครับผม", "นะครับ"}
FEMALE_MARKERS = {"ค่ะ", "คะ", "ดิฉัน", "นะคะ", "ค่า"}
# terms of address that take คะ when used alone to call someone (คุณคะ, พี่คะ)
VOCATIVES = {"คุณ", "พี่", "น้อง", "ป้า", "ลุง", "น้า", "อา", "ยาย", "ตา", "เจ๊", "เฮีย", "หมอ", "ครู"}

QUESTION_WORDS = {
    "ไหม", "มั้ย", "มั๊ย", "ไม๊", "หรือ", "หรือเปล่า", "รึเปล่า", "เปล่า", "อะไร", "ไหน", "ที่ไหน",
    "เท่าไหร่", "เท่าไร", "ทำไม", "ยังไง", "อย่างไร", "ใคร", "เมื่อไหร่", "เมื่อไร", "กี่",
    "บ้าง", "เหรอ", "หรอ", "ไง", "ได้ไหม", "หรือยัง",
}


def _split_particles(tokens: list[str]) -> list[str]:
    out = []
    for t in tokens:
        if t == "นะคะ":
            out += ["นะ", "คะ"]
        elif t == "นะครับ":
            out += ["นะ", "ครับ"]
        elif t == "ครับผม":
            out += ["ครับ", "ผม*"]  # ครับผม: ผม here is part of the polite reply
        else:
            out.append(t)
    return out


def _is_question(tokens: list[str]) -> bool:
    return any(t in QUESTION_WORDS for t in tokens)


def endings_check(thai: str, speaker: str | None, polite: str | None) -> list[Issue]:
    """Male lines use ครับ/ผม; female lines use ค่ะ for statements and คะ for questions; never mixed."""
    issues: list[Issue] = []
    text = normalize_thai(thai)
    toks = _split_particles(T.tokenize(text))
    male = sorted({t.rstrip("*") for t in toks if t in MALE_MARKERS or t == "ผม*"})
    female = sorted({t for t in toks if t in FEMALE_MARKERS})
    if male and female:
        issues.append(_fail("endings", f"mixes male ({' '.join(male)}) and female ({' '.join(female)}) forms in one line"))
    if speaker == "m" and female:
        issues.append(_fail("endings", f"male speaker uses female form(s) {' '.join(female)}"))
    if speaker == "f" and male:
        issues.append(_fail("endings", f"female speaker uses male form(s) {' '.join(male)}"))
    if speaker == "m" and "ฉัน" in toks:
        issues.append(_warn("endings", "male speaker uses ฉัน (Phi teaches ผม for men)"))
    if speaker == "m" and "ดิฉัน" in toks:
        issues.append(_fail("endings", "male speaker uses ดิฉัน"))

    # ค่ะ vs คะ, clause by clause (a clause runs up to each ending particle)
    qmarks = [m.start() for m in re.finditer(r"\?", text)]
    clause: list[str] = []
    endings_seen = 0
    for idx, t in enumerate(toks):
        if t in ("ค่ะ", "คะ", "ค่า"):
            endings_seen += 1
            prev = clause[-1] if clause else None
            is_last = all(x in ("ค่ะ", "คะ", "ค่า", "นะ") for x in toks[idx + 1 :])
            question = _is_question(clause) or (is_last and (polite == "question" or bool(qmarks)))
            if clause:
                if t in ("ค่ะ", "ค่า") and prev == "นะ":
                    issues.append(_fail("endings", "นะค่ะ is wrong: after นะ the ending is คะ (นะคะ)"))
                elif t in ("ค่ะ", "ค่า") and question:
                    issues.append(_fail("endings", "question ends with ค่ะ; questions take คะ"))
                # คะ is also right after a term of address on its own: คุณคะ, พี่คะ ("excuse me?")
                elif t == "คะ" and not question and prev not in ("นะ", "จ๊ะ", "จ้ะ") and not all(x in VOCATIVES for x in clause):
                    issues.append(_fail("endings", "statement ends with คะ; statements take ค่ะ (คะ only in questions or after นะ)"))
            clause = []
        else:
            clause.append(t)

    if polite == "statement" and toks and toks[-1] in QUESTION_WORDS and toks[-1] not in ("หรือ", "เปล่า"):
        issues.append(_warn("endings", f"marked as a statement but ends with the question word {toks[-1]}"))
    if polite == "question" and toks and not _is_question(toks) and "?" not in text:
        issues.append(_warn("endings", "marked as a question but has no question word"))
    return issues


# ---------------------------------------------------------------------------
# script_check

_ALLOWED_PUNCT = set(" ?!.,;:\"'“”‘’()-…/%")
_INVISIBLE = {"​", "‌", "‍", "⁠", "﻿", " ", "\t", "\n", "\r"}


def script_check(thai: str) -> list[Issue]:
    """Thai script only (plus digits, space, punctuation); well-formed combining marks."""
    issues: list[Issue] = []
    if not thai or not thai.strip():
        return [_fail("script", "Thai text is empty")]
    if unicodedata.normalize("NFC", thai) != thai:
        issues.append(_warn("script", "text is not in NFC form"))
    if thai != thai.strip():
        issues.append(_warn("script", "leading or trailing whitespace"))
    if "  " in thai:
        issues.append(_warn("script", "double space"))
    latin = sorted({c for c in thai if c.isascii() and c.isalpha()})
    if latin:
        issues.append(_fail("script", f"Latin letters in the Thai: {''.join(latin)}"))
    invis = sorted({f"U+{ord(c):04X}" for c in thai if c in _INVISIBLE})
    if invis:
        issues.append(_fail("script", f"invisible or non-standard space characters: {', '.join(invis)}"))
    other = sorted({
        c for c in thai
        if not ("ก" <= c <= "๛") and not c.isdigit() and c not in _ALLOWED_PUNCT
        and c not in _INVISIBLE and not (c.isascii() and c.isalpha())
    })
    if other:
        issues.append(_fail("script", f"characters outside Thai script: {' '.join(other)} "
                                      f"({', '.join(f'U+{ord(c):04X}' for c in other)})"))
    unassigned = sorted({c for c in thai if "฻" <= c <= "฾" or c in "๜๝๞"})
    if unassigned:
        issues.append(_fail("script", "unassigned Thai code points"))

    s = thai
    for i, c in enumerate(s):
        prev = s[i - 1] if i > 0 else ""
        prev2 = s[i - 2] if i > 1 else ""
        if c in TONE_MARKS:
            if prev in TONE_MARKS:
                issues.append(_fail("script", f"doubled tone mark at position {i + 1}"))
            elif prev in CONSONANTS or (prev in ABOVE_BELOW_VOWELS and prev != MAI_TAI_KHU and prev2 in CONSONANTS):
                pass
            elif prev == MAI_TAI_KHU:
                issues.append(_fail("script", f"tone mark after ไม้ไต่คู้ at position {i + 1}"))
            else:
                issues.append(_fail("script", f"stray tone mark at position {i + 1} (not on a consonant)"))
            if i + 1 < len(s) and s[i + 1] in ABOVE_BELOW_VOWELS and s[i + 1] != MAI_TAI_KHU:
                issues.append(_fail("script", f"tone mark typed before its vowel at position {i + 1} (wrong order)"))
        elif c in ABOVE_BELOW_VOWELS:
            if prev in ABOVE_BELOW_VOWELS:
                issues.append(_fail("script", f"two vowel signs stacked at position {i + 1}"))
            elif prev in TONE_MARKS:
                pass  # reported above as wrong order
            elif prev not in CONSONANTS and prev not in "ฤฦ":
                issues.append(_fail("script", f"stray vowel sign at position {i + 1} (not on a consonant)"))
        elif c == THANTHAKHAT:
            if not (prev in CONSONANTS or (prev in "ิุ" and prev2 in CONSONANTS)):
                issues.append(_fail("script", f"stray karan (์) at position {i + 1}"))
        elif c == NIKHAHIT:
            nxt = s[i + 1] if i + 1 < len(s) else ""
            if nxt == "า":
                issues.append(_fail("script", f"sara am typed as ํ + า at position {i + 1}; use ำ"))
            else:
                issues.append(_warn("script", f"nikhahit (ํ) at position {i + 1}"))
        elif c in PREPOSED:
            nxt = s[i + 1] if i + 1 < len(s) else ""
            if c == "เ" and nxt == "เ":
                issues.append(_fail("script", f"two sara e (เเ) at position {i + 1}; use แ"))
            elif nxt not in CONSONANTS:
                issues.append(_fail("script", f"vowel {c} at position {i + 1} is not followed by a consonant"))
        elif c == "ำ" and prev not in CONSONANTS and prev not in TONE_MARKS:
            issues.append(_fail("script", f"stray ำ at position {i + 1}"))
    # more than one tone mark in one written syllable cluster (e.g. ก่้า)
    for m in re.finditer(r"[ก-ฮ][ัิีึืุู]?([่-๋])[ัิีึืุู]?([่-๋])", s):
        issues.append(_fail("script", f"two tone marks on one consonant: '{m.group(0)}'"))
    # dedupe
    out, seen = [], set()
    for x in issues:
        key = (x.check, x.severity, x.detail)
        if key not in seen:
            seen.add(key)
            out.append(x)
    return out


# ---------------------------------------------------------------------------
# check_item


def _prefixed(prefix: str, issues: list[Issue]) -> list[Issue]:
    return [Issue(i.check, i.severity, f"{prefix}: {i.detail}") for i in issues]


def check_item(item: dict, known: set[str]) -> list[Issue]:
    """Run every applicable check on an app Item dict.

    Uses: thai, roman, tones, forms {m,f}: {thai, roman}, example {thai, roman}, polite, speaker.
    ``known`` is the set of Thai words/phrases taught before this item.
    """
    issues: list[Issue] = []
    thai = item.get("thai") or ""
    roman = item.get("roman") or ""
    tones = item.get("tones")
    speaker = item.get("speaker")
    polite = item.get("polite")

    issues += script_check(thai)
    issues += tone_check(thai, roman, list(tones) if tones is not None else None)
    issues += word_check(thai)
    issues += endings_check(thai, speaker, polite)

    new_words = {thai}
    forms = item.get("forms") or {}
    for g in ("m", "f"):
        f = forms.get(g)
        if not f:
            continue
        ft, fr = f.get("thai") or "", f.get("roman") or ""
        new_words.add(ft)
        p = f"forms.{g}"
        issues += _prefixed(p, script_check(ft))
        issues += _prefixed(p, tone_check(ft, fr, None))
        issues += _prefixed(p, word_check(ft))
        issues += _prefixed(p, endings_check(ft, g, polite))

    ex = item.get("example")
    if ex:
        et, er = ex.get("thai") or "", ex.get("roman") or ""
        issues += _prefixed("example", script_check(et))
        issues += _prefixed("example", tone_check(et, er, None))
        issues += _prefixed("example", word_check(et))
        issues += _prefixed("example", endings_check(et, speaker, None))
        issues += _prefixed("example", taught_check(et, set(known), new_words))
    return issues
