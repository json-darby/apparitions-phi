"""VertexSpeech request building, with fake Google clients: no network, no
credentials, no cost. Checks the Chirp 3 HD / Gemini TTS / STT v2 requests
and that every call is reserved and recorded in the ledger."""

from __future__ import annotations

import datetime as dt
import re
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# Temporary folders live under pipeline/work/test-audio (the project's own work
# area), not the system temp folder.
_TEST_ROOT = Path(__file__).resolve().parents[1] / "work" / "test-audio"


def _fresh(name: str) -> Path:
    import shutil

    d = _TEST_ROOT / re.sub(r"[^A-Za-z0-9_.-]", "_", name)
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    return d

from phi_pipeline import config, ledger
from phi_pipeline.audio.encode import wav_bytes
from phi_pipeline.config import MODELS
from phi_pipeline.providers.base import Audio
from phi_pipeline.providers.speech import VertexSpeech


class FakeTTS:
    def __init__(self):
        self.calls = []

    def synthesize_speech(self, input, voice, audio_config, **kw):
        self.calls.append((input, voice, audio_config))
        import numpy as np

        return SimpleNamespace(audio_content=wav_bytes(np.zeros(24000, dtype="float32"), 24000))

    def list_voices(self, language_code):
        from google.cloud import texttospeech as t

        mk = lambda n, g: SimpleNamespace(name=n, language_codes=["th-TH"], ssml_gender=g, natural_sample_rate_hertz=24000)
        return SimpleNamespace(voices=[mk("th-TH-Chirp3-HD-Kore", t.SsmlVoiceGender.FEMALE),
                                       mk("th-TH-Chirp3-HD-Puck", t.SsmlVoiceGender.MALE),
                                       mk("th-TH-Standard-A", t.SsmlVoiceGender.FEMALE)])


class FakeSTT:
    def __init__(self, fail_models=()):
        self.requests = []
        self.fail_models = fail_models

    def recognize(self, request, **kw):
        from google.api_core import exceptions as gx

        self.requests.append(request)
        if request.config.model in self.fail_models:
            raise gx.InvalidArgument("model not available for th-TH in this location")
        w = SimpleNamespace(word="มาก", start_offset=dt.timedelta(seconds=0.1), end_offset=dt.timedelta(seconds=0.5), confidence=0.9)
        alt = SimpleNamespace(transcript="มาก", confidence=0.88, words=[w])
        return SimpleNamespace(results=[SimpleNamespace(alternatives=[alt])],
                               metadata=SimpleNamespace(total_billed_duration=dt.timedelta(seconds=1)))


class FakeGen:
    """google-genai client stand-in: models.generate_content returns one WAV part."""

    def __init__(self):
        self.calls = []
        self.models = self

    def generate_content(self, model, contents, config):
        self.calls.append((model, contents, config))
        import numpy as np

        part = SimpleNamespace(inline_data=SimpleNamespace(data=wav_bytes(np.zeros(24000, dtype="float32"), 24000),
                                                           mime_type="audio/wav"))
        return SimpleNamespace(candidates=[SimpleNamespace(content=SimpleNamespace(parts=[part]))])


@pytest.fixture()
def vx(monkeypatch):
    tmp_path = _fresh("vertex")
    monkeypatch.setattr(ledger, "WORK", tmp_path)
    monkeypatch.setattr(ledger, "LEDGER", tmp_path / "ledger.jsonl")
    monkeypatch.setenv("PHI_GCP_PROJECT", "test-project")
    monkeypatch.setenv("PHI_BUDGET_USD", "1")
    led = ledger.Ledger(dry=False)
    v = VertexSpeech(led)
    v._tts = FakeTTS()
    v._gen = FakeGen()  # never reach the network from a test
    return v, led


def test_audio_vertex_chirp_slow_is_native_rate(vx):
    v, led = vx
    a = v.tts(stage="audio", text="มาก", voice="th-TH-Chirp3-HD-Kore", rate=0.75)
    inp, sel, cfg = v._tts.calls[-1]
    assert sel.name == "th-TH-Chirp3-HD-Kore" and sel.language_code == "th-TH" and not sel.model_name
    assert cfg.speaking_rate == pytest.approx(0.75)
    assert a.mime == "audio/wav" and a.seconds == pytest.approx(1.0, abs=0.01)
    assert led.spent == pytest.approx(3 * config.PRICES.chirp_char)


def test_audio_vertex_gemini_tts_uses_model_and_prompt(vx):
    # gemini-3.8-flash-tts is served by Vertex AI generate_content, not Cloud TTS
    v, led = vx
    v.tts(stage="audio", text="สวัสดีค่ะ", voice="Kore", rate=0.75, model=MODELS.tts_gemini, style="Say it slowly and clearly:")
    assert not v._tts.calls
    model, contents, cfg = v._gen.calls[-1]
    assert model == MODELS.tts_gemini == "gemini-3.8-flash-tts"
    assert contents.startswith("Say it slowly") and contents.endswith("สวัสดีค่ะ")
    assert list(cfg.response_modalities) == ["AUDIO"]
    assert cfg.speech_config.voice_config.prebuilt_voice_config.voice_name == "Kore"
    assert led.spent == pytest.approx(1.0 * config.PRICES.gemini_tts_second, rel=0.05)


def test_audio_vertex_older_gemini_tts_goes_through_cloud_tts(vx):
    v, _ = vx
    v.tts(stage="audio", text="สวัสดีค่ะ", voice="Kore", rate=0.75, model="gemini-2.5-flash-tts", style="Say it slowly and clearly:")
    assert not v._gen.calls
    inp, sel, cfg = v._tts.calls[-1]
    assert sel.model_name == "gemini-2.5-flash-tts" and sel.name == "Kore"
    assert inp.prompt.startswith("Say it slowly") and inp.text == "สวัสดีค่ะ"


def test_audio_vertex_list_voices_filters_chirp3_hd(vx):
    v, _ = vx
    vs = v.list_voices("th-TH")
    assert [x["name"] for x in vs] == ["th-TH-Chirp3-HD-Kore", "th-TH-Chirp3-HD-Puck"]
    assert [x["gender"] for x in vs] == ["f", "m"]


def test_audio_vertex_stt_chirp3_then_fallback(vx):
    v, led = vx
    fake = FakeSTT(fail_models=(MODELS.stt,))
    v._stt = {"us": fake, "asia-southeast1": fake}
    tr = v.stt(stage="audio-check", audio=Audio(b"OggS....", "audio/ogg", 1.0, "x", ""))
    assert tr.text == "มาก" and tr.words[0]["start"] == pytest.approx(0.1)
    models = [r.config.model for r in fake.requests]
    assert models[0] == MODELS.stt and models[-1] == MODELS.stt_fallback
    last = fake.requests[-1]
    assert list(last.config.language_codes) == ["th-TH"] and last.config.features.enable_word_time_offsets
    assert last.recognizer == "projects/test-project/locations/asia-southeast1/recognizers/_"
    assert led.spent == pytest.approx(config.PRICES.stt_second)


def test_audio_vertex_budget_cap(vx, monkeypatch):
    v, led = vx
    monkeypatch.setenv("PHI_BUDGET_USD", "0.00001")
    with pytest.raises(ledger.BudgetExceeded):
        v.tts(stage="audio", text="สวัสดีครับ", voice="th-TH-Chirp3-HD-Puck")
    assert not v._tts.calls  # refused before any request
