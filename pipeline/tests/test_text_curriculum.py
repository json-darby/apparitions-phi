"""The master curriculum: counts, pacing, ids, and agreement with the plan and the app."""

from __future__ import annotations

import collections
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from phi_pipeline.text import curriculum as cur


def test_rules_and_moves_name_real_entries():
    assert cur.unused_rules() == []
    assert cur.unused_moves() == []


def test_plan_list_is_parsed_not_retyped():
    raw = cur.plan_word_list()
    themes = collections.Counter(t for t, _ in raw)
    # the plan's own counts per theme (0 to 10 and the clock words expanded)
    assert themes["greetings"] == 18
    assert themes["verbs"] == 30
    assert themes["food"] == 45
    assert themes["numbers"] == 26
    assert themes["time"] == 24
    assert themes["signs"] == 24
    assert ("numbers", "1,000") in raw


def test_overall_counts():
    k = cur.counts(60)
    assert 620 <= k["items"] <= 700, k["items"]  # about 650
    assert 70 <= k["patterns"] <= 85  # about 75
    assert k["letters"] == 76  # 44 consonants, 28 vowel forms, 4 tone marks
    assert k["culture"] == 60
    k30 = cur.counts(30)
    assert 350 <= k30["items"] <= 400  # about 360 after overlaps
    assert k30["culture"] == 30
    assert k30["letters"] >= 44 + 4  # every consonant and tone mark by day 30


def test_letter_table():
    ls = cur.letters()
    cons = [l for l in ls if l.cls in ("mid", "high", "low")]
    assert len(cons) == 44
    assert collections.Counter(l.cls for l in cons) == {"low": 24, "high": 11, "mid": 9}
    assert len([l for l in ls if l.cls == "vowel"]) == 28
    assert len([l for l in ls if l.cls == "tonemark"]) == 4
    assert all(l.day <= 20 for l in cons)
    assert len({l.id for l in ls}) == len(ls)
    by_id = {l.id: l for l in ls}
    assert all(x in by_id for l in ls for x in l.lookalikes)
    # the spine's script column: day 1 mid class, day 3 low class sonorants, day 8 high class
    assert {l.char for l in cons if l.day == 1} == set("กจดตบปอ")
    assert {l.char for l in cons if l.day == 3} == set("งนมยรลว")
    assert {l.char for l in cons if l.day == 8} == set("ขฉถผฝสห")
    assert {l.char for l in cons if l.day == 11} == set("คชทพฟซฮ")


def test_per_day_pacing():
    per = cur.counts(60)["per_day"]
    for d in range(1, 61):
        assert per[d] <= cur.day_cap(d) + 2, (d, per[d])
    assert all(per[d] >= 8 for d in range(1, 29) if cur.day_info(d).checkpoint is None)
    assert per[30] == 0  # the final assessment adds nothing new


def test_ids_unique_and_kebab():
    es = cur.entries()
    ids = [e.id for e in es]
    assert len(ids) == len(set(ids))
    assert all(re.fullmatch(r"[a-z0-9]+(-[a-z0-9]+)*", i) for i in ids)
    assert len({(e.theme == "classifiers", e.en) for e in es}) == len(es)


def test_seed_ids_survive():
    ids = {e.id for e in cur.entries()}
    for sid in ["hello", "thank-you", "khrap", "kha-statement", "kha-question", "i-male", "i-female", "khaw", "mai-not",
                "mai-q", "how-much", "n1", "n10", "baht", "cl-bottle", "stop-here", "where-is", "toilet", "horse", "dog"]:
        assert sid in ids, sid


def test_survival_early_and_situations_covered():
    by = {e.en: e for e in cur.entries()}
    assert by["hello"].day == 1 and by["thank you"].day == 1 and by["male polite ending"].day == 1
    assert by["0"].day == 3 and by["10"].day == 3
    assert by["how much is this"].day <= 5
    assert by["use the meter please"].day <= 11  # Meter's Running
    assert by["left"].day == 11 and by["stop here"].day == 11
    assert by["headache"].day <= 19 and by["medicine"].day <= 19
    assert by["no problem (accepting a no)"].day <= 22
    assert all(e.day == 24 for e in cur.entries() if e.theme == "cannabis")


def test_adult_flags():
    es = cur.entries()
    adult = {e.en for e in es if e.adult}
    assert "can I have your number" in adult
    assert all(e.adult for e in es if e.theme == "cannabis")
    # refusals and safety lines are open to everyone
    for safe in ["no thank you", "I'm not interested", "I'm with someone", "please stop", "not tonight"]:
        assert safe not in adult, safe
    assert all(e.day >= 21 for e in es if e.adult)


def test_extension_follows_spine():
    ext = [e for e in cur.entries() if e.day > 30]
    assert 270 <= len(ext) <= 320
    assert {e.day for e in ext} == set(range(31, 61))
    plan_en = {en for _, en in cur.plan_word_list()}
    assert not ({e.en for e in ext} & plan_en)  # new entries only


def test_spine_read_from_app():
    sp = cur.spine()
    assert len(sp) == 60
    assert sp[0].culture == "The wai"
    assert sp[20].checkpoint == "week"
    assert sp[59].checkpoint == "final"


def test_patterns():
    ps = cur.patterns()
    assert len({p.id for p in ps}) == len(ps)
    # every plan pattern is in the course; two sit after day 30 because their words are taught later
    # (4 Oct 2026: "please don't do X" with อย่า on day 50, "I think that X" with คิดว่า on day 31)
    assert sum(1 for p in ps if p.day <= 30) == len(cur.plan_patterns()) - 2 >= 45
    assert {p.en for p in ps if p.day > 30} >= {"please don't do X", "I think that X"}
    for sid in ["p-khaw", "p-mai-q", "p-mai-not", "p-how-much", "p-count"]:
        assert sid in {p.id for p in ps}


def test_culture_topics():
    cs = cur.culture_topics()
    assert [c.day for c in cs] == list(range(1, 61))
    assert len({c.id for c in cs}) == 60
    legal = {c.title for c in cs if c.legal}
    assert "Current cannabis law" in legal and "Respect for the monarchy" in legal


def test_tasks():
    ts = cur.tasks()
    street = [t for t in ts if t.chapter is None and t.day <= 30]
    assert len(street) == 25
    assert {t.chapter for t in ts if t.chapter} == {"meters-running", "after-hours", "door-to-door"}
    ext = [t for t in ts if t.day > 30]
    assert 10 <= len(ext) <= 14
    assert len({t.id for t in ts}) == len(ts)
    assert all(t.place in ("food", "taxi", "hotel", "market", "bar", "pharmacy") for t in ts)
    assert all(t.person in ("nok", "ton", "ploy", "lek", "mai", "bank", "fah", "pim") for t in ts)
    for seed in ["hotel-hello", "food-water", "market-mango", "taxi-stop-here", "pharmacy-headache", "meters-running-2",
                 "after-hours-1", "d2d-bar"]:
        assert seed in {t.id for t in ts}


@pytest.mark.parametrize("roman,tones", [
    ("sà-wàt-dii", ["low", "low", "mid"]),
    ("an-níi thâo-rài", ["mid", "high", "falling", "low"]),
    ("nám-khǎeng", ["high", "rising"]),
    ("nʉ̀ng", ["low"]),
])
def test_tones_from_roman(roman, tones):
    from phi_pipeline.text.common import tones_from_roman

    assert tones_from_roman(roman) == tones
