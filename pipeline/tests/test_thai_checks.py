"""Text checks: tone, syllables, words, taught, endings, script, and check_item on the seed set."""

from __future__ import annotations

import pytest

from _thai_seed import seed_items, seed_places, seed_tiles
from phi_pipeline.text.checks import (
    Issue,
    check_item,
    endings_check,
    script_check,
    taught_check,
    tone_check,
    word_check,
)

SEED = seed_items()


def fails(issues: list[Issue], check: str | None = None) -> list[Issue]:
    return [i for i in issues if i.severity == "fail" and (check is None or i.check == check)]


# --- seed set ----------------------------------------------------------------

def test_seed_parsed():
    assert len(SEED) >= 75
    assert {"hello", "how-much-this", "mai-wood", "water", "ice"} <= {i["id"] for i in SEED}


@pytest.mark.parametrize("item", SEED, ids=[i["id"] for i in SEED])
def test_seed_item_passes(item):
    issues = check_item(item, known=set())
    assert not fails(issues), [i.detail for i in fails(issues)]
    assert not issues, [i.detail for i in issues]   # not even a warning


@pytest.mark.parametrize("thai,roman", seed_tiles() + seed_places())
def test_seed_tiles_and_signs_pass_tone_check(thai, roman):
    assert not fails(tone_check(thai, roman, None))


# --- tone_check failures ----------------------------------------------------------

def test_wrong_diacritic_fails():
    issues = tone_check("ขา", "khâa", ["falling"])
    assert fails(issues, "tone")
    assert "rising" in fails(issues, "tone")[0].detail


def test_mid_low_confusion_fails():
    assert fails(tone_check("ไก่", "gai", ["mid"]), "tone")        # should be gài
    assert fails(tone_check("กิน", "gìn", ["low"]), "tone")        # should be gin


def test_missing_diacritic_fails():
    assert fails(tone_check("สวัสดี", "sa-wat-dii", ["mid", "mid", "mid"]), "tone")


def test_tones_list_disagreeing_with_roman_fails():
    issues = tone_check("ขา", "khǎa", ["mid"])
    assert fails(issues, "tone")
    assert any("tones[]" in i.detail for i in fails(issues))


def test_wrong_syllable_count_fails():
    issues = tone_check("สวัสดี", "sà-wàt", ["low", "low"])
    assert fails(issues, "syllables")
    issues = tone_check("ขอบคุณ", "khàwp-khun", ["low", "mid", "mid"])
    assert fails(issues, "syllables")


def test_hidden_vowel_leading_error_caught():
    # ตลาด is dtà-làat; a generator that forgets the leading rule writes dtà-lâat
    assert not fails(tone_check("ตลาด", "dtà-làat", ["low", "low"]))
    assert fails(tone_check("ตลาด", "dtà-lâat", ["low", "falling"]), "tone")
    assert fails(tone_check("ขนม", "khà-nom", ["low", "mid"]), "tone")


def test_linking_syllable_accepted_when_romanised():
    assert not fails(tone_check("ผลไม้", "phǒn-lá-máai", ["rising", "high", "high"]))
    assert not fails(tone_check("มหาวิทยาลัย", "má-hǎa-wít-thá-yaa-lai", ["high", "rising", "high", "high", "mid", "mid"]))


def test_irregular_ko():
    assert not fails(tone_check("ก็", "gâw", ["falling"]))
    assert fails(tone_check("ก็", "gàw", ["low"]), "tone")


def test_colloquial_reading_warns_not_fails():
    issues = tone_check("เขา", "kháo", ["high"])
    assert not fails(issues)
    assert any(i.severity == "warn" and "colloquial" in i.detail for i in issues)
    assert not tone_check("เขา", "khǎo", ["rising"])


def test_second_opinion_disagreement_is_warn():
    # pythainlp's tone_detector reads เธอ as falling; the rules (correctly) say mid
    issues = tone_check("เธอ", "thoe", ["mid"])
    assert not fails(issues)
    assert any(i.severity == "warn" and "tone_detector" in i.detail for i in issues)
    # its known blind spots (ขอ read as dead) are not reported as disagreements
    assert not tone_check("ขอ", "khǎw", ["rising"])


def test_repetition_mark():
    assert not fails(tone_check("ช้าๆ", "cháa-cháa", ["high", "high"]))
    assert not fails(tone_check("ช้าๆ", "cháa cháa", ["high", "high"]))
    assert fails(tone_check("ช้าๆ", "cháa", ["high"]), "syllables")


def test_numbers_in_thai_are_read_out():
    assert not fails(tone_check("20 บาท", "yîi-sìp bàat", ["falling", "low", "low"]))


def test_sentence_with_particles():
    roman = "khǎw náam nòi khráp"
    assert not fails(tone_check("ขอน้ำหน่อยครับ", roman, ["rising", "high", "low", "high"]))
    assert not fails(tone_check("ไปไหนคะ", "bpai nǎi khá", ["mid", "rising", "high"]))


# --- word_check ----------------------------------------------------------------

def test_word_check_real_words_pass():
    for t in ("สวัสดี", "ขอบคุณครับ", "อันนี้เท่าไหร่", "ไม่เป็นไรค่ะ", "เบียร์สองขวด"):
        assert not word_check(t), t


def test_word_check_invented_word_fails():
    issues = word_check("ฟลุ่บเง็กครับ")
    assert fails(issues, "words")


def test_word_check_extra_words():
    assert fails(word_check("ฟลุ่บเง็ก"), "words")
    assert not word_check("ฟลุ่บเง็ก", extra_words={"ฟลุ่บเง็ก"})


# --- taught_check -----------------------------------------------------------------

def test_taught_only_known_and_new():
    known = {"ขอ", "น้ำ"}
    assert not taught_check("ขอน้ำหน่อยครับ", known, {"หน่อย"})
    issues = taught_check("ขอเบียร์หน่อยค่ะ", known, {"หน่อย"})
    assert [i.detail for i in fails(issues, "taught")] == ["'เบียร์' has not been taught yet"]


def test_taught_known_phrases_cover_their_words():
    known = {"อันนี้เท่าไหร่", "ขอ"}
    assert not taught_check("อันนี้", known, set())
    assert not taught_check("เท่าไหร่ครับ", known, set())


def test_taught_numbers_need_number_words():
    assert fails(taught_check("2 ขวด", {"ขวด"}, set()), "taught")
    assert not taught_check("2 ขวด", {"ขวด", "สอง"}, set())


# --- endings_check -----------------------------------------------------------------

@pytest.mark.parametrize(
    "thai,speaker,polite",
    [
        ("ขอบคุณครับ", "m", "statement"),
        ("ขอบคุณค่ะ", "f", "statement"),
        ("ไปไหนคะ", "f", "question"),
        ("อันนี้เท่าไหร่คะ", "f", None),
        ("ลดหน่อยได้ไหมครับ", "m", "question"),
        ("ขอบคุณนะคะ", "f", None),
        ("ผมไม่เข้าใจครับ", "m", None),
        ("ค่ะ", "f", None),
        ("คะ", "f", None),
        ("ครับผม", "m", None),
        ("ไม่เป็นไรค่ะ ไปไหนคะ", "f", None),
        ("คุณคะ", "f", "statement"),  # calling someone: a term of address takes คะ
        ("พี่คะ", "f", None),
    ],
)
def test_endings_ok(thai, speaker, polite):
    assert not fails(endings_check(thai, speaker, polite)), endings_check(thai, speaker, polite)


@pytest.mark.parametrize(
    "thai,speaker,polite,needle",
    [
        ("ผมไม่เข้าใจค่ะ", None, None, "mixes"),
        ("ขอบคุณค่ะ", "m", None, "male speaker"),
        ("ขอบคุณครับ", "f", None, "female speaker"),
        ("ไปไหนค่ะ", "f", None, "questions take คะ"),
        ("อันนี้เท่าไหร่ค่ะ", "f", "question", "questions take คะ"),
        ("ขอบคุณคะ", "f", "statement", "statements take ค่ะ"),
        ("ขอบคุณนะค่ะ", "f", None, "นะคะ"),
        ("ดิฉันชอบครับ", None, None, "mixes"),
    ],
)
def test_endings_fail(thai, speaker, polite, needle):
    issues = fails(endings_check(thai, speaker, polite), "endings")
    assert issues and any(needle in i.detail for i in issues), issues


def test_question_mark_counts_as_question():
    assert fails(endings_check("กินข้าวแล้วค่ะ?", "f", None), "endings")


# --- script_check -------------------------------------------------------------------

def test_script_clean():
    for t in ("สวัสดีครับ", "อันนี้เท่าไหร่คะ?", "20 บาท", "ดีๆ", "กรุงเทพฯ", "เบียร์"):
        assert not script_check(t), (t, script_check(t))


@pytest.mark.parametrize(
    "thai,needle",
    [
        ("hello สวัสดี", "Latin"),
        ("ก่่า", "doubled tone mark"),
        ("ก่้า", "two tone marks"),
        ("่กา", "stray tone mark"),
        ("กา ิ", "stray vowel"),
        ("ก่ี", "wrong order"),
        ("เเมว", "use แ"),
        ("ทํา", "use ำ"),
        ("สวัส​ดี", "invisible"),
        ("สวัสดี😀", "outside Thai"),
        ("ก็่", "ไม้ไต่คู้"),
        ("", "empty"),
    ],
)
def test_script_failures(thai, needle):
    issues = fails(script_check(thai), "script")
    assert issues and any(needle in i.detail for i in issues), script_check(thai)


# --- check_item ------------------------------------------------------------------------

def test_check_item_forms_and_example():
    item = {
        "id": "i-am-hungry",
        "thai": "หิวข้าว",
        "roman": "hǐu khâao",
        "tones": ["rising", "falling"],
        "polite": "statement",
        "forms": {
            "m": {"thai": "ผมหิวข้าวครับ", "roman": "phǒm hǐu khâao khráp"},
            "f": {"thai": "ฉันหิวข้าวค่ะ", "roman": "chǎn hǐu khâao khâ"},
        },
        "example": {"thai": "ผมหิวข้าวครับ", "roman": "phǒm hǐu khâao khráp", "en": "I'm hungry"},
    }
    known = {"ผม", "ฉัน", "ข้าว"}
    assert not fails(check_item(item, known)), fails(check_item(item, known))


def test_check_item_reports_each_problem():
    item = {
        "id": "bad",
        "thai": "ผมหิวข้าวค่ะ",
        "roman": "phǒm hiu khâao khâ",       # missing caron on hǐu
        "tones": ["rising", "mid", "falling", "falling"],
        "speaker": "m",
        "example": {"thai": "ฉันอยากกินเบียร์ค่ะ", "roman": "chǎn yàak gin bia khâ", "en": "x"},
    }
    issues = check_item(item, known={"ฉัน", "กิน"})
    checks = {i.check for i in fails(issues)}
    assert {"tone", "endings", "taught"} <= checks
    assert any(i.detail.startswith("example:") for i in fails(issues, "taught"))


def test_tokenizer_slip_repaired_for_endings():
    from phi_pipeline.thai.tones import tokenize

    # newmm alone gives ไป|ไห|นคะ, hiding the ending
    assert tokenize("ไปไหนคะ") == ["ไป", "ไหน", "คะ"]
    assert fails(endings_check("ไปไหนค่ะ", "f", None), "endings")
    assert not word_check("ไปไหนคะ")


def test_taught_free_particles_only():
    assert not taught_check("กินข้าวนะคะ", {"กิน", "ข้าว"}, set())
    # ไหม is a word to teach, not a free particle
    assert fails(taught_check("กินข้าวไหม", {"กิน", "ข้าว"}, set()), "taught")
