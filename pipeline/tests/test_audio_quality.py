"""Per-clip quality checks on mock audio with injected faults (clipping,
silence, truncation, glitch, wrong speed), loudness normalisation and the
STT normalisation rules."""

from __future__ import annotations

import re
import sys
from pathlib import Path

import numpy as np
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

from phi_pipeline.audio import encode, quality
from phi_pipeline.audio import stt_check as S
from phi_pipeline.audio.check import voice_mos_median
from phi_pipeline.providers.speech import MockSpeech

V = "th-TH-Chirp3-HD-Kore"


class _NoLedger:
    dry = True

    def reserve(self, *a, **k):
        pass

    def record(self, *a, **k):
        pass


@pytest.fixture()
def mock():
    m = MockSpeech(_NoLedger())
    m.hint("มาก", ["falling"])
    m.hint("สวัสดี", ["low", "low", "mid"])
    return m


def _raw(m, text, rate=1.0):
    a = m.tts(stage="t", text=text, voice=V, rate=rate)
    return encode.to_float(a.data, a.mime, encode.OUT_SR)


def test_audio_quality_clean_clip_passes(mock):
    x = _raw(mock, "สวัสดี")
    q = quality.raw_checks(x, encode.OUT_SR)
    assert q["clipping"] == "pass" and q["truncation"] == "pass"
    f = encode.finish(x, encode.OUT_SR)
    assert abs(f.lufs_out - encode.TARGET_LUFS) < 0.5
    assert np.max(np.abs(f.pcm)) <= encode.PEAK_CEILING + 1e-3
    assert quality.internal_silence(f.pcm) <= quality.silence_limit("normal", False)
    assert f.ogg[:4] == b"OggS" and len(f.ogg) < 8000  # ~1 s at 24 kbps
    assert encode.read_opus_tags(encode.encode_ogg(f.pcm, encode.SR, {"PHI_TEXT": "สวัสดี"}))["PHI_TEXT"] == "สวัสดี"


def test_audio_quality_catches_clipping(mock):
    mock.inject("clip", "สวัสดี", times=1)
    assert quality.raw_checks(_raw(mock, "สวัสดี"), encode.OUT_SR)["clipping"] == "fail"


def test_audio_quality_catches_truncation(mock):
    mock.inject("trunc", "สวัสดี", times=1)
    assert quality.raw_checks(_raw(mock, "สวัสดี"), encode.OUT_SR)["truncation"] == "fail"


def test_audio_quality_catches_long_silence(mock):
    mock.inject("silence", "สวัสดี", times=1)
    f = encode.finish(_raw(mock, "สวัสดี"), encode.OUT_SR)
    assert quality.internal_silence(f.pcm) > quality.silence_limit("slow", True)


def test_audio_quality_duration_rules(mock):
    n = encode.finish(_raw(mock, "มาก"), encode.OUT_SR).pcm
    s = encode.finish(_raw(mock, "มาก", 0.75), encode.OUT_SR).pcm
    ratio = quality.speech_seconds(s) / quality.speech_seconds(n)
    assert quality.slow_ratio_ok(ratio, chirp=True), ratio
    mock.inject("slow", "มาก", times=1)
    too_slow = encode.finish(_raw(mock, "มาก", 0.75), encode.OUT_SR).pcm
    assert not quality.slow_ratio_ok(quality.speech_seconds(too_slow) / quality.speech_seconds(n), chirp=True)
    assert quality.voice_spread_ok(1.0, 1.1) and not quality.voice_spread_ok(2.0, 1.0)
    assert quality.syllable_rate_ok(0.9, 3) and not quality.syllable_rate_ok(5.0, 1)


@pytest.mark.skipif(not quality.mos_available(), reason="DNSMOS not installed")
def test_audio_quality_glitch_from_mos(mock):
    words = ["มาก", "สวัสดี", "มา", "ไป", "ดี", "น้ำ", "ข้าว", "ไก่", "หมา"]
    scores = []
    for w in words:
        f = encode.finish(_raw(mock, w), encode.OUT_SR)
        scores.append(quality.mos(f.pcm)["mos"])
    stats = voice_mos_median(scores)
    assert stats is not None
    mock.inject("glitch", "มาก", times=1)
    g = quality.mos(encode.finish(_raw(mock, "มาก"), encode.OUT_SR).pcm)["mos"]
    assert quality.glitch(g, stats) == "fail"
    assert sum(quality.glitch(s, stats) == "pass" for s in scores) >= len(scores) - 1
    assert quality.glitch(g, None) == "n/a"


# ---------- STT normalisation ----------


def test_audio_stt_normalise_and_compare():
    assert S.normalise("ห้าสิบ บาท") == S.normalise("50 บาท") == S.normalise("฿50")
    assert S.normalise("๑๒๐") == S.normalise("หนึ่งร้อยยี่สิบ")
    assert S.normalise("ช้าๆ หน่อย") == S.normalise("ช้าช้าหน่อย")
    assert S.normalise("สวัสดี ครับ!") == "สวัสดีครับ"
    assert S.compare("สวัสดีครับ", "สวัสดี ครับ")["verdict"] == "exact"
    assert S.compare("ค่า", "ฆ่า")["verdict"] == "sound-alike"  # homophone: pitch decides the tone
    r = S.compare("ข้าว", "ดาว")
    assert r["stt"] == "fail" and r["cer"] > 0
    assert S.compare("กอ ไก่", "ก ไก่", kind="letter")["stt"] == "pass"
    assert S.compare("วันนี้อากาศร้อนมาก", "วันนี้อากาศร้อนมา", kind="line")["stt"] == "pass"
    assert S.compare("ไม่เผ็ด", "ไม่เป็ด", kind="item")["stt"] == "fail"
    assert S.cer("abc", "abd") == pytest.approx(1 / 3)


def test_audio_mock_stt_returns_text_or_corruption(mock):
    from phi_pipeline.audio.tts import Manifest, make_one
    from phi_pipeline.audio.texts import AudioText, clips_for

    t = AudioText("item", "big", "มาก", ["falling"], ["f1"], "item:big")
    c = clips_for(t, {"f1": V, "cast": {}})[0]
    d = _fresh("mock-stt")
    make_one(mock, c, d, Manifest(d / "m.json"))
    data = (d / c.rel).read_bytes()
    from phi_pipeline.providers.base import Audio

    a = Audio(data, "audio/ogg", 1.0, V, "")
    assert mock.stt(stage="t", audio=a).text == "มาก"
    mock.inject("stt", "มาก", times=1)
    heard = mock.stt(stage="t", audio=a).text
    assert heard != "มาก" and S.compare("มาก", heard)["stt"] == "fail"
    assert mock.stt(stage="t", audio=a).words  # word times for segmentation
