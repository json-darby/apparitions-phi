"""Rule-based tone calculator: class x live/dead x length x mark, leaders, clusters, irregulars."""

from __future__ import annotations

import pytest

import _thai_seed  # noqa: F401  (puts the pipeline on sys.path)
from phi_pipeline.thai import tones as T
from phi_pipeline.thai.syllables import normalize_thai, readings
from phi_pipeline.thai.tables import CLASS_OF, HIGH, LOW, MID, rule_tone

M, L, F, H, R = "mid", "low", "falling", "high", "rising"


def best(thai: str) -> list[str]:
    return T.tones_of(thai)


# --- the rule table itself ---------------------------------------------------

@pytest.mark.parametrize(
    "cls,live,long,mark,expected",
    [
        (MID, True, True, None, M), (HIGH, True, True, None, R), (LOW, True, True, None, M),
        (MID, False, False, None, L), (HIGH, False, True, None, L),
        (LOW, False, False, None, H), (LOW, False, True, None, F),
        (MID, True, True, "่", L), (HIGH, True, True, "่", L), (LOW, True, True, "่", F),
        (MID, True, True, "้", F), (HIGH, True, True, "้", F), (LOW, True, True, "้", H),
        (MID, True, True, "๊", H), (MID, True, True, "๋", R),
        (MID, False, False, "่", L), (LOW, False, False, "่", F), (LOW, False, True, "้", H),
    ],
)
def test_rule_table(cls, live, long, mark, expected):
    assert rule_tone(cls, live, long, mark) == expected


def test_consonant_classes_complete():
    assert len(CLASS_OF) == 44
    assert CLASS_OF["ก"] == MID and CLASS_OF["ข"] == HIGH and CLASS_OF["ค"] == LOW
    assert CLASS_OF["อ"] == MID and CLASS_OF["ห"] == HIGH and CLASS_OF["ฮ"] == LOW


# --- five-tone families --------------------------------------------------------

@pytest.mark.parametrize(
    "thai,tone",
    [
        # mid class: all five via marks
        ("กา", M), ("ก่า", L), ("ก้า", F), ("ก๊า", H), ("ก๋า", R),
        # high class
        ("ขา", R), ("ข่า", L), ("ข้า", F),
        # low class
        ("คา", M), ("ค่า", F), ("ค้า", H),
        # the classic five-tone set on มา/หมา
        ("มา", M), ("หม่า", L), ("ม่า", F), ("ม้า", H), ("หมา", R),
    ],
)
def test_five_tone_families(thai, tone):
    assert best(thai) == [tone]


# --- dead syllables: stop finals and short vowels ------------------------------

@pytest.mark.parametrize(
    "thai,tone",
    [
        ("กัด", L), ("กาด", L), ("คัด", H), ("คาด", F),
        ("ขัด", L), ("ขาด", L),
        ("คะ", H), ("กะ", L), ("ขะ", L), ("นะ", H),
        ("รัก", H), ("มาก", F), ("ลูก", F), ("ทุก", H), ("รถ", H), ("ลด", H),
        ("จอด", L), ("บาท", L), ("สิบ", L), ("หก", L), ("แปด", L), ("เจ็ด", L),
        ("ชอบ", F), ("พูด", F), ("เมฆ", F), ("โชค", F),
        ("เพราะ", H), ("และ", H), ("เกาะ", L),
    ],
)
def test_dead_syllables(thai, tone):
    assert best(thai) == [tone]


# --- live syllables and sonorant finals -----------------------------------------

@pytest.mark.parametrize(
    "thai,tone",
    [
        ("ดี", M), ("คน", M), ("ผม", R), ("สาม", R), ("สอง", R), ("ขาว", R),
        ("ไป", M), ("ใจ", M), ("เอา", M), ("ทำ", M), ("จำ", M), ("ไทย", M),
        ("เลย", M), ("เคย", M), ("เดิน", M), ("เรียน", M), ("เสือ", R), ("หัว", R), ("ตัว", M),
    ],
)
def test_live_syllables(thai, tone):
    assert best(thai) == [tone]


# --- leading ห and อ -----------------------------------------------------------

@pytest.mark.parametrize(
    "thai,tone",
    [
        ("หมา", R), ("หนู", R), ("หลับ", L), ("หน่อย", L), ("ใหม่", L), ("หม้อ", F),
        ("ไหน", R), ("หญิง", R), ("หวาน", R), ("หรือ", R), ("เหมือน", R), ("หมด", L),
        ("อย่า", L), ("อยู่", L), ("อย่าง", L), ("อยาก", L),
    ],
)
def test_leading_h_and_o(thai, tone):
    assert best(thai) == [tone]


def test_h_before_non_sonorant_is_sounded():
    syl = readings("หก")[0].syllables[0]
    assert syl.onset == "ห" and syl.lead is None and syl.tone == L


# --- clusters --------------------------------------------------------------------

@pytest.mark.parametrize(
    "thai,tone",
    [
        ("ครับ", H), ("กล้วย", F), ("ปลา", M), ("ขวา", R), ("พระ", H), ("ใกล้", F),
        ("ไกล", M), ("เปล่า", L), ("ตรง", M), ("ใคร", M), ("กว่า", L), ("ครู", M),
        ("ความ", M), ("เปรี้ยว", F),
        # silent ร clusters and ทร = ซ
        ("จริง", M), ("สร้าง", F), ("ศรี", R), ("ทราบ", F), ("ทราย", M), ("เสร็จ", L),
    ],
)
def test_clusters(thai, tone):
    assert best(thai) == [tone]


# --- ไม้ไต่คู้, karan, silent letters ----------------------------------------------

@pytest.mark.parametrize(
    "thai,tones",
    [
        ("เป็น", [M]), ("เด็ก", [L]), ("เล็ก", [H]), ("แข็ง", [R]), ("เผ็ด", [L]), ("แท็กซี่", [H, F]),
        ("เบียร์", [M]), ("จันทร์", [M]), ("ศาสตร์", [L]), ("สตางค์", [L, M]), ("อาจารย์", [M, M]),
        ("ชาติ", [F]), ("ญาติ", [F]), ("เหตุ", [L]), ("บาร์", [M]), ("ลิฟต์", [H]),
    ],
)
def test_short_vowel_marks_and_silent_letters(thai, tones):
    assert best(thai) == tones


# --- hidden vowels and leading across them -----------------------------------------

@pytest.mark.parametrize(
    "thai,tones",
    [
        ("สวัสดี", [L, L, M]), ("ตลาด", [L, L]), ("ขนม", [L, R]), ("อร่อย", [L, L]),
        ("สนุก", [L, L]), ("ฉลาด", [L, L]), ("สบาย", [L, M]), ("ถนน", [L, R]),
        ("จมูก", [L, L]), ("สมุด", [L, L]), ("มะม่วง", [H, F]), ("ทหาร", [H, R]),
        ("ฝรั่ง", [L, L]), ("สนาม", [L, R]),
    ],
)
def test_hidden_vowels(thai, tones):
    assert best(thai) == tones


# --- irregulars (exceptions table) ---------------------------------------------------

@pytest.mark.parametrize(
    "thai,tones",
    [
        ("ก็", [F]), ("เขา", [R]), ("เพชร", [H]), ("เท่าไร", [F, L]), ("ตำรวจ", [M, L]),
        ("บริษัท", [M, H, L]), ("สามารถ", [R, F]), ("ประโยชน์", [L, L]),
        ("ฉัน", [R]), ("ไหม", [R]), ("น้ำ", [H]), ("ไม้", [H]), ("คุณ", [M]), ("หนังสือ", [R, R]),
    ],
)
def test_irregulars(thai, tones):
    assert best(thai) == tones


def test_exceptions_table_parses():
    for word, readings_ in T.EXCEPTIONS.items():
        assert readings_, word
        for r in readings_:
            assert r and all(t in ("mid", "low", "falling", "high", "rising") for _, t in r), word


def test_colloquial_alternative_is_a_lower_ranked_reading():
    rs = T.word_readings("เขา")
    assert rs[0].tones == [R] and not rs[0].alt
    assert any(r.tones == [H] and r.alt for r in rs)


# --- repetition, abbreviation, numbers, phrases ----------------------------------------

def test_mai_yamok_repeats_previous_word():
    assert best("ดีๆ") == [M, M]
    assert best("ช้าๆ") == [H, H]
    assert best("จริงๆ") == [M, M]


def test_paiyannoi_is_silent():
    assert best("กรุงเทพฯ") == [M, F]


def test_numbers_are_read_out():
    assert best("21") == [F, L, L]          # ยี่สิบเอ็ด
    assert best("๓") == [R]                 # สาม


def test_phrases():
    assert best("อันนี้เท่าไหร่") == [M, H, F, L]
    assert best("ลดหน่อยได้ไหม") == [H, L, F, R]
    assert best("อยู่ที่ไหน") == [L, F, R]


def test_normalisation_of_typing_order():
    # tone mark typed before the vowel, and sara am typed as nikhahit + aa
    assert normalize_thai("ก่ี") == "กี่"
    assert normalize_thai("ทํา") == "ทำ"
    assert best("ก่ี") == [L]


# --- second opinion --------------------------------------------------------------------

def test_second_opinion_agrees_on_plain_syllables():
    for w, tone in [("ข่า", L), ("ม้า", H), ("ไก่", L), ("หมา", R), ("กาด", L)]:
        syl = readings(w)[0].syllables[0]
        assert T.second_opinion(syl) == tone, w


def test_second_opinion_skips_hidden_vowel_syllables():
    syls = readings("สวัสดี")[0].syllables
    assert T.second_opinion(syls[0]) is None  # hidden-a ส
    assert T.second_opinion(syls[1]) is None  # วัส takes its class from ส
