"""Rule-based Thai tone calculator.

Tone = consonant class x live/dead (final sound and vowel length) x tone mark,
with the leading-consonant rules (silent ห and อ, hidden-vowel leaders),
clusters, ไม้ไต่คู้, ๆ, ฯ, silent letters, and an explicit table of words whose
spoken tone or syllable count differs from their spelling.

No model is asked anything: tones come from spelling. PyThaiNLP's
``tone_detector`` is consulted only as a second opinion (see ``second_opinion``).
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from functools import lru_cache

from . import syllables as S
from .roman import parse_roman
from .tables import PAIYANNOI, MAIYAMOK, PYTHAINLP_TONE, THAI_DIGITS

# ---------------------------------------------------------------------------
# Exceptions: written form -> readings (first is standard; the rest are accepted
# colloquial variants and raise a warning when used). Romanisation follows the
# Phi convention so the table is easy to read and to check.

EXCEPTIONS_ROMAN: dict[str, list[str]] = {
    # spoken tone differs from the spelling
    "ก็": ["gâw"],                     # spelled dead short mid (gàw), said falling
    "เขา": ["khǎo", "kháo"],            # regular rising; colloquially high
    "ฉัน": ["chǎn", "chán"],
    "ดิฉัน": ["dì-chǎn", "dì-chán"],
    "ไหม": ["mǎi", "mái"],
    "หรือ": ["rʉ̌ʉ", "rʉ́ʉ"],
    "เท่าไร": ["thâo-rài", "thâo-rai"],    # ไร is spelled mid but said low
    "ตำรวจ": ["dtam-rùat"],             # ร after ตำ behaves as if led
    "ประโยชน์": ["bprà-yòot"],
    "เพชร": ["phét"],                   # written long เ-, said short (high, not falling)
    "ช็อกโกแลต": ["chók-goo-láet"],
    # loanwords: low-class dead long syllables said high, -เตอร์ said falling
    "เทคโนโลยี": ["thék-noo-loo-yii"],
    "เทคนิค": ["thék-ník", "thék-nìk"],
    "เมตร": ["méet"],
    "กิโลเมตร": ["gì-loo-méet"],
    "เซนติเมตร": ["sen-dtì-méet"],
    "คอมพิวเตอร์": ["khawm-phiu-dtôe"],
    "เกียรติ": ["gìat"],
    "บัญญัติ": ["ban-yàt"],
    # the leading-consonant rule is applied strictly by the calculator; these break it.
    # (a) no leading after a hidden vowel (mostly Pali/Sanskrit)
    "สมาชิก": ["sà-maa-chík"],
    "สมาคม": ["sà-maa-khom"],
    "สมาธิ": ["sà-maa-thí"],
    "ขโมย": ["khà-mooi"],
    "อนามัย": ["à-naa-mai"],
    "จราจร": ["jà-raa-jawn"],
    "อเมริกา": ["à-mee-rí-gaa"],
    "อเมริกัน": ["à-mee-rí-gan"],
    "กวี": ["gà-wii"],
    "จินตนาการ": ["jin-dtà-naa-gaan"],
    "โฆษณา": ["khôot-sà-naa"],
    "อันตราย": ["an-dtà-raai"],
    "เจตนา": ["jèet-dtà-naa"],
    "เจริญ": ["jà-roen"],
    "อวัยวะ": ["à-wai-yá-wá"],
    # (b) leading after a written -ะ / -ำ or a linking syllable
    "ประโยค": ["bprà-yòok"],
    "ประมาท": ["bprà-màat"],
    "สำเร็จ": ["sǎm-rèt"],
    "สำรวจ": ["sǎm-rùat"],
    "ศาสนา": ["sàat-sà-nǎa"],
    "ฯลฯ": ["láe ʉ̀ʉn ʉ̀ʉn"],
    # syllable count or vowel not predictable from spelling
    "บริ": ["baw-rí"],                  # prefix: บริษัท baw-rí-sàt, บริการ, บริเวณ, บริหาร
    "สหรัฐ": ["sà-hà-rát"],
    "ภูมิ": ["phuum", "phuu-mí"],       # ภูมิใจ phuum-jai, อุณหภูมิ; ภูมิศาสตร์ phuu-mí-sàat
    "อนุ": ["à-nú"],                    # prefix: อนุญาต à-nú-yâat, อนุบาล, อนุมัติ, อนุรักษ์
    "ปริญญา": ["bpà-rin-yaa"],
    "ไปรษณีย์": ["bprai-sà-nii"],
    "สามารถ": ["sǎa-mâat"],
    "ภรรยา": ["phan-rá-yaa", "phan-yaa"],
    "กรุณา": ["gà-rú-naa"],
    "จักรยาน": ["jàk-grà-yaan"],
    "อนาคต": ["à-naa-khót"],          # น after อ is not led here
    "ธรรมดา": ["tham-má-daa"],
    "ธรรมชาติ": ["tham-má-châat"],
    "คุณภาพ": ["khun-ná-phâap", "khun-na-phâap"],
    "ราชการ": ["râat-chá-gaan"],
    "ประวัติศาสตร์": ["bprà-wàt-sàat", "bprà-wàt-dtì-sàat"],
    "โทรศัพท์": ["thoo-rá-sàp"],
    "พฤษภาคม": ["phrʉ́t-sà-phaa-khom"],
}


def _exception_table() -> S.ExceptionTable:
    table: S.ExceptionTable = {}
    for word, romans in EXCEPTIONS_ROMAN.items():
        readings = []
        for r in romans:
            p = parse_roman(r)
            readings.append([(s.base, s.tone) for s in p.syllables])
        table[S.normalize_thai(word)] = readings
    return table


EXCEPTIONS: S.ExceptionTable = _exception_table()

# ---------------------------------------------------------------------------
# tokens


@dataclass
class Token:
    text: str
    readings: list[S.Reading]

    @property
    def best(self) -> S.Reading:
        return self.readings[0]


_THAI_DIGIT_MAP = str.maketrans(THAI_DIGITS, "0123456789")


def expand_numbers(text: str) -> str:
    """Write digits out as Thai number words (so their tones can be checked)."""
    from pythainlp.util import num_to_thaiword

    t = text.translate(_THAI_DIGIT_MAP)

    def rep(m: re.Match) -> str:
        num = m.group(0).replace(",", "")
        try:
            return num_to_thaiword(int(num))
        except Exception:
            return m.group(0)

    return re.sub(r"\d[\d,]*", rep, t)


@lru_cache(maxsize=8192)
def word_readings(word: str) -> tuple[S.Reading, ...]:
    return tuple(S.readings(word, EXCEPTIONS))


#: Sentence particles; always treated as words (and as taught).
PARTICLES = frozenset({
    "ครับ", "ค่ะ", "คะ", "นะ", "จ้ะ", "จ๊ะ", "จ้า", "ฮะ", "ค่า", "นะคะ", "นะครับ", "ครับผม",
    "สิ", "ซิ", "เถอะ", "หรอก", "ล่ะ", "เลย", "จ๋า", "น่ะ", "นะจ๊ะ", "ไหม", "มั้ย",
    "หรือ", "เหรอ", "หรอ", "เปล่า", "หรือเปล่า", "ด้วย", "ละ", "แหละ",
})


def _segment(text: str, vocab: frozenset[str] | set[str], max_len: int = 24) -> list[str] | None:
    """Fewest-words segmentation of text into vocab words, or None."""
    n = len(text)
    best: list[tuple[int, int] | None] = [None] * (n + 1)   # (word count, previous index)
    best[0] = (0, -1)
    for i in range(n):
        if best[i] is None:
            continue
        for j in range(i + 1, min(n, i + max_len) + 1):
            if text[i:j] in vocab:
                cand = (best[i][0] + 1, i)
                if best[j] is None or cand[0] < best[j][0]:
                    best[j] = cand
    if best[n] is None:
        return None
    out, j = [], n
    while j > 0:
        i = best[j][1]
        out.append(text[i:j])
        j = i
    return out[::-1]


@lru_cache(maxsize=1)
def _vocab() -> frozenset[str]:
    return _dictionary() | PARTICLES


def _repair(words: list[str]) -> list[str]:
    """newmm sometimes cuts across a word to make an unknown chunk (ไปไหนคะ -> ไป|ไห|นคะ).
    Re-segment an unknown token together with its neighbours when that gives known words."""
    vocab = _vocab()
    words = list(words)
    i = 0
    while i < len(words):
        if words[i] in vocab:
            i += 1
            continue
        fixed = False
        for a, b in ((i, i + 1), (i - 1, i), (i - 1, i + 1), (i, i + 2), (i - 2, i)):
            if a < 0 or b >= len(words):
                continue
            seg = _segment("".join(words[a : b + 1]), vocab)
            if seg:
                words[a : b + 1] = seg
                i = a + len(seg)
                fixed = True
                break
        if not fixed:
            i += 1
    # a polite ending glued into a junk dictionary entry (ไห|นคะ: 'นคะ' is in the corpus)
    out: list[str] = []
    for w in words:
        for p in _ENDINGS:
            if w != p and w.endswith(p) and len(w) > len(p):
                rest = w[: -len(p)]
                if rest in vocab:
                    out += [rest, p]
                    break
                if out:
                    seg = _segment(out[-1] + rest, vocab)
                    if seg:
                        out[-1:] = seg
                        out.append(p)
                        break
        else:
            out.append(w)
    return out


_ENDINGS = ("ครับ", "ค่ะ", "คะ", "ค่า", "จ้ะ", "จ๊ะ")


def _split_words(chunk: str) -> list[str]:
    from pythainlp.tokenize import word_tokenize

    return _repair([w for w in word_tokenize(chunk, engine="newmm", keep_whitespace=False) if w.strip()])


def tokenize(thai: str) -> list[str]:
    """Word tokens of a Thai line (numbers expanded, ๆ kept as its own token)."""
    t = expand_numbers(S.normalize_thai(thai))
    t = t.replace("ฯลฯ", " ฯลฯ ")
    out: list[str] = []
    for chunk in re.split(r"[\s\?\!\.,;:\"'“”‘’()\[\]…\-]+", t):
        if not chunk:
            continue
        parts = re.split(r"(ๆ|ฯลฯ)", chunk)
        for part in parts:
            if not part:
                continue
            if part in ("ๆ", "ฯลฯ"):
                out.append(part)
            else:
                # ฯ (abbreviation mark) is silent: กรุงเทพฯ is read grung-thêep
                out.extend(_split_words(part.replace(PAIYANNOI, "")))
    return out


@lru_cache(maxsize=1)
def _dictionary() -> frozenset[str]:
    from pythainlp.corpus import thai_words

    return frozenset(thai_words())


def _merge_unknown(words: list[str]) -> list[str]:
    """newmm cuts words it does not know into fragments (บีม -> บี ม); glue runs
    of out-of-dictionary fragments back together so they are read as one unit."""
    vocab = _dictionary()
    out: list[str] = []
    prev_unknown = False
    for w in words:
        unknown = w not in vocab and w not in ("ๆ", "ฯลฯ") and w not in EXCEPTIONS
        if unknown and out and (prev_unknown or len(w) <= 2) and out[-1] not in ("ๆ", "ฯลฯ"):
            out[-1] += w
            prev_unknown = True
            continue
        out.append(w)
        prev_unknown = unknown
    return out


def analyse(thai: str) -> list[Token]:
    """Tokens with their candidate readings. ๆ repeats the previous token."""
    tokens: list[Token] = []
    for w in _merge_unknown(tokenize(thai)):
        if w == MAIYAMOK:
            if tokens:
                prev = tokens[-1]
                tokens.append(Token("ๆ", prev.readings))
            continue
        rs = list(word_readings(w))
        if not rs:
            rs = [S.Reading((), 99.0)]
        tokens.append(Token(w, rs))
    return tokens


def tones_of(thai: str) -> list[str]:
    """Best-guess tones for a Thai line from spelling alone."""
    out: list[str] = []
    for tok in analyse(thai):
        out.extend(tok.best.tones)
    return out


def syllables_of(thai: str) -> list[S.Syllable]:
    out: list[S.Syllable] = []
    for tok in analyse(thai):
        out.extend(tok.best.syllables)
    return out


# ---------------------------------------------------------------------------
# second opinion


def second_opinion(syl: S.Syllable) -> str | None:
    """pythainlp.util.tone_detector on the written syllable, when it is a plain
    one the detector can read (not a hidden-vowel, linking or exception syllable)."""
    if syl.kind not in ("regular", "implicit_o") or syl.lead == "hidden" or not syl.core:
        return None
    if syl.vowel in ("ri", "ʉ", "ʉʉ", "rʉ") and ("ฤ" in syl.core or "ฦ" in syl.core):
        return None
    if syl.final is not None and syl.final_letter is None and syl.vowel not in ("am", "ai", "ao", "ooe", "aaw", "a"):
        return None
    if syl.core != syl.text:  # silent tail present; the detector does not know ์
        return None
    if syl.final_letter and syl.text and syl.text[-1] != syl.final_letter:
        return None  # silent ร / ิ after the final
    if syl.onset == "ซ" and "ทร" in syl.text:
        return None
    # Known blind spots of pythainlp 5.x tone_detector (measured on its own
    # syllables_th list): two-letter open syllables (ขอ, เก, แฟ read as dead),
    # implicit-o syllables (ลด, คด read as long), ไม้ไต่คู้ (แท็ก read as long),
    # and อ + ั (อัน read as dead). Its answer there is noise, not a second opinion.
    if syl.kind == "implicit_o" or "็" in syl.core:
        return None
    if syl.final is None and len(syl.core) == 2 and syl.vowel not in ("a",):
        return None
    if syl.onset == "อ" and syl.vowel == "a" and syl.final in ("n", "m", "ng", "y", "w"):
        return None
    try:
        from pythainlp.util import tone_detector

        t = tone_detector(syl.core)
    except Exception:
        return None
    return PYTHAINLP_TONE.get(t)
