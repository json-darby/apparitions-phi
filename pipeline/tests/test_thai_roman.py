"""Romanisation parser: syllables, tones, normalisation."""

from __future__ import annotations

import unicodedata

import pytest

import _thai_seed  # noqa: F401
from phi_pipeline.thai.roman import mark_tone, normalize_roman, parse_roman, same_roman, syllable_count


@pytest.mark.parametrize(
    "roman,tones",
    [
        ("sà-wàt-dii", ["low", "low", "mid"]),
        ("khǎw-thôot", ["rising", "falling"]),
        ("mâi châi", ["falling", "falling"]),
        ("an-níi thâo-rài", ["mid", "high", "falling", "low"]),
        ("lót nòi dâai mǎi", ["high", "low", "falling", "rising"]),
        ("nʉ̀ng", ["low"]),
        ("sʉ̌a", ["rising"]),
        ("gaa-fae", ["mid", "mid"]),
    ],
)
def test_tones_from_diacritics(roman, tones):
    p = parse_roman(roman)
    assert p.ok, p.problems
    assert p.tones == tones


def test_words_and_syllables():
    p = parse_roman("an-níi thâo-rài")
    assert [s.base for s in p.syllables] == ["an", "nii", "thao", "rai"]
    assert [s.word for s in p.syllables] == [0, 0, 1, 1]
    assert syllable_count("phèt nít-nòi") == 3


def test_nfc_and_nfd_inputs_agree():
    nfc = unicodedata.normalize("NFC", "khǎw-thôot")
    nfd = unicodedata.normalize("NFD", "khǎw-thôot")
    assert nfc != nfd
    assert parse_roman(nfc).tones == parse_roman(nfd).tones
    assert same_roman(nfc, nfd)


def test_ue_variants_are_normalised():
    # ɯ (IPA), ư (Vietnamese-style), ü all mean ʉ
    for variant in ("nɯ̀ng", "nừng", "nǜng"):
        p = parse_roman(variant)
        assert p.syllables[0].base == "nʉng", variant
        assert p.tones == ["low"], variant
    assert normalize_roman("Sʉ̌a") == unicodedata.normalize("NFC", "sʉ̌a")


def test_hyphen_variants_and_punctuation():
    assert parse_roman("khàwp–khun").tones == ["low", "mid"]       # en dash
    assert parse_roman("thâo-rài?").tones == ["falling", "low"]
    assert parse_roman("“sà-wàt-dii”").tones == ["low", "low", "mid"]


@pytest.mark.parametrize(
    "roman,problem",
    [
        ("khǎ̂w", "tone marks on one syllable"),
        ("kh-", "stray hyphen"),
        ("khā", "macron"),
        ("khaw2", "unexpected character"),
        ("", "empty"),
    ],
)
def test_problems_reported(roman, problem):
    p = parse_roman(roman)
    assert not p.ok
    assert any(problem in x for x in p.problems), p.problems


def test_mark_tone_roundtrip():
    for tone in ("mid", "low", "falling", "high", "rising"):
        assert parse_roman(mark_tone("khaao", tone)).tones == [tone]
    assert mark_tone("sʉa", "rising") == unicodedata.normalize("NFC", "sʉ̌a")
