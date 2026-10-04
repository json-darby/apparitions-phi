"""Static Thai orthography tables used by the rule-based tone calculator.

Everything here is a fact about the Thai writing system (consonant classes,
final-sound groups, vowel forms, tone marks). No word lists are copied from any
course; the irregular-word table lives in ``tones.py``.
"""

from __future__ import annotations

# --- consonant classes -----------------------------------------------------

MID = "mid"
HIGH = "high"
LOW = "low"

MID_CLASS = set("กจฎฏดตบปอ")
HIGH_CLASS = set("ขฃฉฐถผฝศษสห")
LOW_CLASS = set("คฅฆงชซฌญฑฒณทธนพฟภมยรลวฬฮ")

CONSONANTS = MID_CLASS | HIGH_CLASS | LOW_CLASS

CLASS_OF: dict[str, str] = {}
for _c in MID_CLASS:
    CLASS_OF[_c] = MID
for _c in HIGH_CLASS:
    CLASS_OF[_c] = HIGH
for _c in LOW_CLASS:
    CLASS_OF[_c] = LOW

#: Low-class "single" (unpaired) consonants: sonorants. A silent ห in front
#: of these makes the syllable high class (หมา, หนู, หลับ), and a hidden-vowel
#: high or mid consonant in front of them does the same (ตลาด, ขนม, อร่อย).
SONORANTS = set("งญณนมยรลวฬ")

# --- clusters --------------------------------------------------------------

#: True initial clusters: both consonants are sounded, tone follows the first.
TRUE_CLUSTERS = {
    "กร", "กล", "กว", "ขร", "ขล", "ขว", "คร", "คล", "คว",
    "ตร", "ปร", "ปล", "พร", "พล", "ผล",
    # loanword clusters
    "บร", "บล", "ดร", "ฟร", "ฟล", "ทร",
}
#: Clusters where the ร is silent (จริง jing, สร้าง sâang, ศรี sǐi).
SILENT_R_CLUSTERS = {"จร", "ซร", "ศร", "สร"}
#: ทร read as ซ (ทราย saai, ทรง song). Low class either way.
TR_AS_S = "ทร"

# --- finals ----------------------------------------------------------------

FINAL_K = set("กขฃคฅฆ")
FINAL_T = set("จฉชซฌฎฏฐฑฒดตถทธศษส")
FINAL_P = set("บปพฟภ")
FINAL_N = set("ญณนรลฬ")
FINAL_M = set("ม")
FINAL_NG = set("ง")
FINAL_Y = set("ย")
FINAL_W = set("ว")

STOP_FINALS = FINAL_K | FINAL_T | FINAL_P
SONORANT_FINALS = FINAL_N | FINAL_M | FINAL_NG | FINAL_Y | FINAL_W
FINALS = STOP_FINALS | SONORANT_FINALS

FINAL_SOUND: dict[str, str] = {}
for _set, _snd in (
    (FINAL_K, "k"), (FINAL_T, "t"), (FINAL_P, "p"), (FINAL_N, "n"),
    (FINAL_M, "m"), (FINAL_NG, "ng"), (FINAL_Y, "y"), (FINAL_W, "w"),
):
    for _c in _set:
        FINAL_SOUND[_c] = _snd

STOP_SOUNDS = {"k", "t", "p"}

# --- vowels and signs ------------------------------------------------------

PREPOSED = set("เแโใไ")
SARA_A = "ะ"            # ะ
MAI_HAN_AKAT = "ั"      # ั
SARA_AA = "า"           # า
SARA_AM = "ำ"           # ำ
SARA_I = "ิ"            # ิ
SARA_II = "ี"           # ี
SARA_UE = "ึ"           # ึ
SARA_UEE = "ื"          # ื
SARA_U = "ุ"            # ุ
SARA_UU = "ู"           # ู
PHINTHU = "ฺ"           # ฺ
MAI_TAI_KHU = "็"       # ็
LAKKHANGYAO = "ๅ"       # ๅ
THANTHAKHAT = "์"       # ์ (karan)
NIKHAHIT = "ํ"          # ํ
YAMAKKAN = "๎"          # ๎
MAIYAMOK = "ๆ"          # ๆ
PAIYANNOI = "ฯ"         # ฯ
RU = "ฤ"
LU = "ฦ"

ABOVE_BELOW_VOWELS = set("ัิีึืุู็")

MAI_EK = "่"            # ่
MAI_THO = "้"           # ้
MAI_TRI = "๊"           # ๊
MAI_CHATTAWA = "๋"      # ๋
TONE_MARKS = {MAI_EK, MAI_THO, MAI_TRI, MAI_CHATTAWA}

COMBINING = set("ัิีึืฺุู็่้๊๋์ํ๎")

THAI_DIGITS = "๐๑๒๓๔๕๖๗๘๙"

# --- tones -----------------------------------------------------------------

TONES = ("mid", "low", "falling", "high", "rising")

#: pythainlp.util.tone_detector letters -> app tone names
PYTHAINLP_TONE = {"m": "mid", "l": "low", "f": "falling", "h": "high", "r": "rising"}


def rule_tone(cls: str, live: bool, long: bool, mark: str | None) -> str:
    """The standard tone rule: consonant class x live/dead x length x mark."""
    if mark == MAI_EK:
        return "falling" if cls == LOW else "low"
    if mark == MAI_THO:
        return "high" if cls == LOW else "falling"
    if mark == MAI_TRI:
        return "high"
    if mark == MAI_CHATTAWA:
        return "rising"
    if live:
        return "rising" if cls == HIGH else "mid"
    # dead syllable
    if cls == LOW:
        return "falling" if long else "high"
    return "low"
