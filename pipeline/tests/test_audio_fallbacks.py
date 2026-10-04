"""What the audio check does before it gives a text up (added 4 Oct 2026 after the real run):
other voices when none of a text's own is clean, a second listener for clips the recogniser
disputes, and a voice spelling (say.json) for text the voice cannot read."""

from __future__ import annotations

import json

import pytest

from phi_pipeline.audio import run as arun
from phi_pipeline.audio import texts as tx
from phi_pipeline.audio.encode import read_opus_tags
from phi_pipeline.providers.base import Providers, Transcript
from phi_pipeline.providers.speech import MockSpeech

from test_audio_pipeline import F1, M1, Env, _fresh

DOG = "หมาตัวนี้น่ารัก"  # example.dog, voiced by f1 and m1


def _run(env) -> dict:
    arun.run_audio(env.providers, env.args())
    arun.run_audio_check(env.providers, env.args())
    return json.loads((env.state / "check-report.json").read_text(encoding="utf8"))


def test_audio_other_voices_when_none_is_clean(monkeypatch):
    env = Env(_fresh("alt-voices"), monkeypatch)
    # every take in its own two voices is clipped (a one-letter mishearing would pass: sentences allow 8%)
    env.speech.inject("clip", DOG, F1)
    env.speech.inject("clip", DOG, M1)
    rep = _run(env)
    course = env.load()
    audio = course["lines"]["example.dog"]["audio"]
    # both of its own voices failed twice; the other woman and the other man are tried and are clean
    assert audio["f1.normal"] is None and audio["m1.normal"] is None
    assert audio["f2.normal"] == "audio/example/dog/f2.normal.ogg" and audio["m2.normal"] == "audio/example/dog/m2.normal.ogg"
    assert "x1.normal" not in audio  # sentences stay within f1 f2 m1 m2
    assert course["checks"]["line:example.dog"]["audio"] == "pass"
    assert json.loads((env.state / "extra_slots.json").read_text(encoding="utf8")) == {"audio/example/dog": ["f2", "m2"]}
    assert rep["texts"]["audio/example/dog"]["clips"]["audio/example/dog/f2.normal.ogg"]["ok"]
    # a text with a clean clip is left alone, and a later run keeps the added voices without paying again
    assert set(course["lines"]["pattern.p-mai-not.0"]["audio"]) == {"f1.normal", "m1.normal"}
    calls = env.speech.calls["tts"]
    arun.run_audio(env.providers, env.args())
    arun.run_audio_check(env.providers, env.args())
    assert env.speech.calls["tts"] == calls
    assert env.load()["lines"]["example.dog"]["audio"]["f2.normal"]


class TwoEars(MockSpeech):
    """Mock speech with a second listener that always hears the text the clip was made from."""

    second_calls = 0

    def stt_second(self, *, stage: str, audio) -> Transcript:
        self.second_calls += 1
        return Transcript(text=read_opus_tags(audio.data).get("PHI_TEXT", ""), confidence=0.0, words=[])


def test_audio_second_listener_settles_a_disputed_clip(monkeypatch):
    env = Env(_fresh("second-listener"), monkeypatch)
    env.speech = TwoEars(env.led)
    env.providers = Providers(None, env.speech, None, env.led, True)
    env.speech.inject("stt", "ม้า")  # the recogniser mishears "horse" in every voice, every time
    rep = _run(env)
    course = env.load()
    assert any(i["id"] == "horse" for i in course["items"])  # not dropped
    assert course["checks"]["item:horse"]["stt"] == "pass" and course["checks"]["item:horse"]["audio"] == "pass"
    clip = rep["texts"]["audio/item/horse"]["clips"]["audio/item/horse/f1.normal.ogg"]
    assert clip["heard"] != "ม้า" and clip["heard2"] == "ม้า" and clip["verdict"] == "second:exact" and clip["ok"]
    # asked only about clips the first comparison failed
    assert "heard2" not in rep["texts"]["audio/item/dog"]["clips"]["audio/item/dog/f1.normal.ogg"]
    assert 0 < env.speech.second_calls <= 24


def test_audio_say_spelling_is_what_the_voice_gets(monkeypatch):
    env = Env(_fresh("say"), monkeypatch)
    monkeypatch.setattr(tx, "load_say", lambda dry, path=None: {"letter:l-gor": "กอ ไก่"})
    _run(env)
    manifest = json.loads((env.state / "manifest.json").read_text(encoding="utf8"))
    assert manifest["audio/letter/l-gor/f1.normal.ogg"]["text"] == "กอ ไก่"
    assert manifest["audio/item/horse/f1.normal.ogg"]["text"] == "ม้า"
    course = env.load()
    assert course["checks"]["letter:l-gor"]["audio"] == "pass"
    assert course["letters"][0]["media"]["audio"]["f1.normal"] == "audio/letter/l-gor/f1.normal.ogg"


@pytest.mark.parametrize("slots,is_line,want", [
    (["f1", "m1"], True, ["f2", "m2"]),
    (["nok"], True, ["f1", "f2"]),
    (["m1"], True, ["m2"]),
    (["f1", "f2", "m1", "m2"], False, ["x1", "x2"]),
    (["f1", "f2", "m1", "m2", "x1", "x2"], False, []),
])
def test_alt_slots(slots, is_line, want):
    t = tx.AudioText("line" if is_line else "letter", "x", "ก", None, slots, "line:x")
    assert tx.alt_slots(t, tx.load_voices(True)) == want
