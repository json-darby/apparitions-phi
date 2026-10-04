"""Pitch checker on mock-synthesised speech: the tone classifier must reach
95% on all five tones across voice registers and catch a wrong-tone clip."""

from __future__ import annotations

import random
import sys
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from phi_pipeline.audio import pitch as P
from phi_pipeline.audio.encode import SR, finish
from phi_pipeline.audio.texts import roman_tones
from phi_pipeline.providers.speech import TONES, WRONG_TONE, MockSpeech, tone_shape, voice_sex


class _NoLedger:
    dry = True

    def reserve(self, *a, **k):
        pass

    def record(self, *a, **k):
        pass


MOCK = MockSpeech(_NoLedger())
VOICES = ["th-TH-Chirp3-HD-Achernar", "th-TH-Chirp3-HD-Aoede", "th-TH-Chirp3-HD-Alnilam", "th-TH-Chirp3-HD-Charon",
          "Kore", "Puck"]  # female and male registers, Chirp and Gemini names


def _track(voice, tones, rate=1.0, seed=None, text="w"):
    x = MOCK.synth(text, voice, rate, tones, seed=seed)
    f = finish(x, MOCK.SR)
    return P.extract(f.pcm, SR, voice_sex(voice))


@pytest.fixture(scope="module")
def profiles():
    """Each voice's mid level from a small qualification-style set."""
    out = {}
    for v in VOICES:
        data = [(_track(v, [TONES[i % 5]], seed=100 + i, text=f"q{i}"), [TONES[i % 5]], None) for i in range(15)]
        out[v] = P.estimate_profile(v, data, "qualification")
        assert out[v].source != "default"
    return out


def test_audio_pitch_classifier_95_percent_all_tones(profiles):
    rng = random.Random(7)
    model = P.ToneModel.prior()
    per_tone = {t: [0, 0] for t in TONES}
    app_ok = n = 0
    for v in VOICES:
        for i in range(14):
            k = rng.choice([1, 1, 2, 3])
            tones = [TONES[(i + j) % 5] if j == 0 else rng.choice(TONES) for j in range(k)]
            rate = 0.75 if i % 3 == 0 else 1.0
            r = P.analyse(_track(v, tones, rate, seed=i, text=f"t{i}"), tones, profiles[v], model, voice=v)
            for s in r.syllables:
                per_tone[s.expected][0] += s.tone == s.expected
                per_tone[s.expected][1] += 1
                app_ok += s.app_tone == s.expected
                n += 1
    acc = {t: a / b for t, (a, b) in per_tone.items()}
    total = sum(a for a, _ in per_tone.values()) / n
    print("feature classifier accuracy by tone:", acc, "overall", total, "app classifier", app_ok / n)
    assert all(b >= 10 for _, b in per_tone.values())
    assert total >= 0.95 and min(acc.values()) >= 0.9
    assert app_ok / n >= 0.95


def test_audio_pitch_catches_wrong_tone(profiles):
    model = P.ToneModel.prior()
    for v in ("th-TH-Chirp3-HD-Achernar", "th-TH-Chirp3-HD-Charon"):
        expected = ["falling"]
        good = P.analyse(_track(v, expected, seed=1), expected, profiles[v], model, voice=v)
        bad = P.analyse(_track(v, [WRONG_TONE["falling"]], seed=1), expected, profiles[v], model, voice=v)
        assert good.passed(strict=True) and good.score == 1
        assert not bad.passed(strict=True) and bad.syllables[0].confident_miss
        two = ["low", "high"]
        bad2 = P.analyse(_track(v, ["low", "falling"], seed=2), two, profiles[v], model, voice=v)
        assert not bad2.passed(strict=True) and bad2.tones[0] == "low"


def test_audio_pitch_curve_shape_and_normalisation(profiles):
    v = "th-TH-Chirp3-HD-Alnilam"
    r = P.analyse(_track(v, ["low", "low", "mid"], seed=3), ["low", "low", "mid"], profiles[v], P.ToneModel.prior(), voice=v)
    assert len(r.curves) == 3 and all(len(c) == 16 for c in r.curves)
    mid = np.nanmean([p for p in r.curves[2] if p is not None])
    assert 0.35 < mid < 0.65  # mid tone sits near 0.5 of the mid +- 5 st range
    prof = P.Profile("x", 200.0, "test")
    assert prof.norm(200.0) == pytest.approx(0.5)
    assert prof.norm(200.0 * 2 ** (-5 / 12)) == pytest.approx(0.0)
    assert prof.norm(200.0 * 2 ** (5 / 12)) == pytest.approx(1.0)


def test_audio_pitch_templates_match_app():
    # app/src/audio/sound.ts toneShape (high = 0.58 + 0.3t - 0.08t^2), sampled at 16 points
    t = np.linspace(0, 1, 16)
    assert np.allclose(tone_shape("high"), np.clip(0.58 + 0.3 * t - 0.08 * t * t, 0, 1))
    assert np.allclose(tone_shape("mid"), 0.52 - 0.06 * t)
    for tone in TONES:
        got, probs = P.app_classify(tone_shape(tone))
        assert got == tone and probs[tone] > 0.9
        f_got, conf, _, _ = P.ToneModel.prior().classify(tone_shape(tone))
        assert f_got == tone and conf > 0.9


def test_audio_pitch_agreement_flags_outlier_voice(profiles):
    model = P.ToneModel.prior()
    res = []
    for v in VOICES[:4]:
        tones = ["rising"] if v != "th-TH-Chirp3-HD-Charon" else ["low"]
        res.append(P.analyse(_track(v, tones, seed=5), ["rising"], profiles[v], model, voice=v))
    agree, outliers = P.agreement(res)
    assert agree == pytest.approx(0.75) and outliers == ["th-TH-Chirp3-HD-Charon"]
    med = P.median_curves([r.curves for r in res])
    assert len(med) == 1 and len(med[0]) == 16


def test_audio_pitch_calibrate_and_table():
    lab = [(tone_shape(t) + np.random.default_rng(i).normal(0, 0.02, 16), t) for i in range(40) for t in TONES]
    m = P.calibrate(lab)
    assert m.source.startswith("calibrated")
    assert all(m.classify(tone_shape(t))[0] == t for t in TONES)
    assert "falling" in m.table()


def test_audio_roman_tones():
    assert roman_tones("sà-wàt-dii khráp") == ["low", "low", "mid", "high"]
    assert roman_tones("mǎa dtua níi nâa-rák") == ["rising", "mid", "high", "falling", "high"]
    assert roman_tones("sʉ̂a") == ["falling"]
