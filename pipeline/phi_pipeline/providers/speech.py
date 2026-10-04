"""Speech providers: MockSpeech (offline, no cost) and VertexSpeech (Google).

VertexSpeech
  * Chirp 3 HD voices through Cloud Text-to-Speech (`th-TH-Chirp3-HD-<Star>`).
    Slow speech is generated natively with `AudioConfig.speaking_rate` (0.75):
    Google documents pace control (speaking_rate 0.25-2.0) for Chirp 3 HD
    voices; they do not take SSML or the `pitch` field. Never time-stretched.
  * Gemini TTS. gemini-3.8-flash-tts (MODELS.tts_gemini, Google's stable
    flagship voice model) is served only through Vertex AI generate_content at
    the "global" location, with response_modalities=["AUDIO"], a prebuilt
    voice (e.g. "Kore") and the style as an instruction before the text. The
    older Gemini TTS models in CLOUD_TTS_GEMINI go through Cloud TTS
    (`VoiceSelectionParams.model_name`, style in `SynthesisInput.prompt`).
    Checked against Google's docs and on the project, 3 Oct 2026.
  * Speech-to-Text v2 `recognize` with model chirp_3 (fallback chirp_2) in a
    location that serves it, th-TH, word time offsets requested.
  * Every call: Ledger.reserve() before (estimate) and Ledger.record() after
    (actual units: characters for Chirp TTS, seconds for Gemini TTS and STT).
  * Rate limits: exponential back-off on 429 / 503 / deadline errors.

Output encoding: Chirp is asked for LINEAR16 by default, not OGG_OPUS. Every
clip is trimmed and loudness-normalised to -16 LUFS before it ships (see
audio/encode.py), which means decoding and re-encoding anyway; starting from
lossless PCM avoids an Opus -> Opus generation loss. Characters are billed the
same either way. Set PHI_TTS_ENCODING=OGG_OPUS to receive Opus directly.

Credentials: PHI_GCP_PROJECT with Application Default Credentials (gcloud
auth application-default login), or PHI_API_KEY. Cloud TTS accepts plain API
keys; Speech-to-Text v2 may not, and a Vertex "express mode" key is for Vertex
AI only, so the ADC route is the one to use for the audio stages.

MockSpeech
  TTS returns real audio: a voiced harmonic "vowel" per syllable whose F0
  follows the syllable's expected tone shape (the app's toneShape()) inside a
  per-voice register (female higher, male lower), with jitter, per-syllable
  offsets and declination so the pitch checker is exercised for real. Faults
  can be injected per text (wrong tone, clipping, long silence, truncation,
  glitch noise, slow-speed errors, wrong transcript).
"""

from __future__ import annotations

import hashlib
import os
import random
import time
from typing import Any

import numpy as np

from ..config import MODELS, PRICES
from .base import Audio, Transcript

# ---------- voices ----------

# Gender of the prebuilt star-named voices shared by Chirp 3 HD and Gemini TTS
# (Google's published list).
VOICE_SEX: dict[str, str] = {
    **{n: "f" for n in [
        "Achernar", "Aoede", "Autonoe", "Callirrhoe", "Despina", "Erinome", "Gacrux", "Kore", "Laomedeia",
        "Leda", "Pulcherrima", "Sulafat", "Vindemiatrix", "Zephyr"]},
    **{n: "m" for n in [
        "Achird", "Algenib", "Algieba", "Alnilam", "Charon", "Enceladus", "Fenrir", "Iapetus", "Orus", "Puck",
        "Rasalgethi", "Sadachbia", "Sadaltager", "Schedar", "Umbriel", "Zubenelgenubi"]},
}

# Gemini TTS voices auditioned by default (3 female, 3 male).
GEMINI_AUDITION = ["Kore", "Aoede", "Leda", "Charon", "Puck", "Orus"]

SLOW_RATE = 0.75
SLOW_STYLE = "Say this in Thai slowly and clearly, one syllable at a time but still natural, with careful tones:"
NORMAL_STYLE = "Say this in Thai naturally and clearly, at an everyday speaking pace:"


# Gemini TTS models Cloud Text-to-Speech serves (docs.cloud.google.com/text-to-speech/docs/gemini-tts).
# Any other Gemini TTS model is called through Vertex AI.
CLOUD_TTS_GEMINI = frozenset({"gemini-2.5-flash-tts", "gemini-2.5-pro-tts", "gemini-2.5-flash-lite-preview-tts",
                              "gemini-3.1-flash-tts-preview"})


def _retry_genai(fn, *, what: str, tries: int = 6):
    """Back off on rate limits and transient errors from google-genai."""
    delay = 2.0
    for i in range(tries):
        try:
            return fn()
        except Exception as e:  # noqa: BLE001 - only transient codes are retried
            code = getattr(e, "code", None) or getattr(e, "status_code", None)
            if code not in (429, 500, 502, 503, 504) or i == tries - 1:
                raise
            time.sleep(delay + random.uniform(0, delay / 2))
            delay = min(60.0, delay * 2)
    raise RuntimeError(f"{what}: retries exhausted")  # pragma: no cover


def star(voice: str) -> str:
    """'th-TH-Chirp3-HD-Kore' -> 'Kore'; 'Kore' -> 'Kore'."""
    return voice.rsplit("-", 1)[-1]


def voice_sex(voice: str) -> str:
    s = VOICE_SEX.get(star(voice))
    if s:
        return s
    return "f" if int(hashlib.sha1(voice.encode()).hexdigest(), 16) % 2 == 0 else "m"


def is_chirp(voice: str) -> bool:
    return voice.startswith(MODELS.tts_main_prefix) or "Chirp3-HD" in voice


def est_seconds(text: str, rate: float = 1.0) -> float:
    """Rough spoken length of Thai text: ~9 characters a second at normal pace."""
    n = len([c for c in text if not c.isspace()])
    return max(0.6, n / 9.0 / max(rate, 0.25) + 0.3)


def tts_cost(text: str, voice: str, rate: float = 1.0) -> float:
    if is_chirp(voice):
        return len(text) * PRICES.chirp_char
    return est_seconds(text, rate) * PRICES.gemini_tts_second


def stt_cost(seconds: float) -> float:
    return seconds * PRICES.stt_second


# ---------- tone shapes (mirror of app/src/audio/sound.ts toneShape) ----------

TONES = ("mid", "low", "falling", "high", "rising")


def tone_shape(tone: str, n: int = 16) -> np.ndarray:
    t = np.linspace(0, 1, n)
    if tone == "mid":
        v = 0.52 - 0.06 * t
    elif tone == "low":
        v = 0.38 - 0.18 * t
    elif tone == "falling":
        v = 0.68 + 0.14 * np.sin(np.pi * np.minimum(1, t * 1.6)) - 0.5 * t * t
    elif tone == "high":
        v = 0.58 + 0.3 * t - 0.08 * t * t
    elif tone == "rising":
        v = 0.36 - 0.12 * np.sin(np.pi * np.minimum(1, t * 1.4)) + 0.52 * t * t
    else:
        raise ValueError(tone)
    return np.clip(v, 0, 1)


WRONG_TONE = {"mid": "falling", "low": "high", "falling": "rising", "high": "low", "rising": "mid"}


def _register(voice: str) -> tuple[float, float]:
    """Mock speaker: (mid-tone level in Hz, tonal span in semitones), stable
    per voice. toneShape value v maps to mid * 2^((v - 0.5) * span / 12), so a
    10-semitone span reproduces the app's normalisation exactly; spans of
    8.5-12 st test robustness to speakers with narrower or wider ranges."""
    h = int(hashlib.sha1(voice.encode()).hexdigest(), 16)
    j = ((h % 1000) / 1000 - 0.5)  # -0.5..0.5
    span = 10.25 + 3.5 * ((h // 1000 % 100) / 100 - 0.5)
    mid = (215 + 40 * j) if voice_sex(voice) == "f" else (118 + 20 * j)
    return mid, span


# ---------- mock ----------


class MockSpeech:
    """Offline speech provider that produces analysable audio."""

    SR = 24000
    FAULTS = ("tone", "stt", "clip", "silence", "trunc", "glitch", "slow")

    def __init__(self, ledger, seed: int = 0):
        self.ledger = ledger
        self.seed = seed
        self.hints: dict[str, list[str]] = {}
        self.faults: dict[str, dict[str, int]] = {k: {} for k in self.FAULTS}
        self.calls = {"tts": 0, "stt": 0}
        self.chirp_voices = [f"{MODELS.tts_main_prefix}{n}" for n in
                             ["Achernar", "Callirrhoe", "Kore", "Aoede", "Alnilam", "Iapetus", "Charon", "Puck"]]

    # --- test hooks ---
    def hint(self, text: str, tones: list[str]) -> None:
        """Tell the mock the tones it should speak for this text."""
        if tones:
            self.hints[text] = list(tones)

    def inject(self, kind: str, text: str, voice: str | None = None, times: int = 1_000_000) -> None:
        """Make the next `times` calls for `text` (optionally one voice) faulty.
        text "*" with a voice makes every text in that voice faulty."""
        key = f"{text}|{voice}" if voice else text
        self.faults[kind][key] = times

    def _take(self, kind: str, text: str, voice: str = "") -> bool:
        f = self.faults[kind]
        for key in (f"{text}|{voice}", text, f"*|{voice}"):
            if f.get(key, 0) > 0:
                f[key] -= 1
                return True
        return False

    # --- provider ---
    def list_voices(self, language: str = "th-TH") -> list[dict]:
        return [{"name": v, "gender": voice_sex(v), "engine": "chirp3-hd", "language": language} for v in self.chirp_voices]

    def _tones_for(self, text: str) -> list[str]:
        if text in self.hints:
            return self.hints[text]
        try:  # the Thai builder's tone calculator, when present
            from ..thai import tones as thai_tones  # type: ignore

            fn = getattr(thai_tones, "tones_of", None) or getattr(thai_tones, "word_tones", None)
            if fn:
                got = fn(text)
                if got:
                    return list(got)
        except Exception:
            pass
        n = max(1, round(len([c for c in text if "ก" <= c <= "ฮ"]) / 1.6))
        h = int(hashlib.sha1(text.encode()).hexdigest(), 16)
        return [TONES[(h >> (3 * i)) % 5] for i in range(n)]

    def synth(self, text: str, voice: str, rate: float = 1.0, tones: list[str] | None = None, seed: int | None = None) -> np.ndarray:
        """The mock voice itself (float at self.SR). Public for tests."""
        sr = self.SR
        tones = tones or self._tones_for(text)
        rng = np.random.default_rng(seed if seed is not None else
                                    int(hashlib.sha1(f"{self.seed}|{text}|{voice}|{rate}".encode()).hexdigest()[:8], 16))
        mid, span_st = _register(voice)
        parts = [np.zeros(int(0.15 * sr))]
        n = len(tones)
        for i, tone in enumerate(tones):
            dur = 0.27 / rate * rng.uniform(0.96, 1.04)
            m = int(dur * sr)
            t = np.linspace(0, 1, m)
            shape = np.interp(t, np.linspace(0, 1, 16), tone_shape(tone))
            v = shape + rng.uniform(-0.03, 0.03) - 0.05 * (i / max(1, n - 1)) + 0.012 * np.sin(2 * np.pi * rng.uniform(4, 6) * t * dur)
            f0 = mid * 2 ** ((v - 0.5) * span_st / 12) * (1 + 0.004 * rng.standard_normal(m))
            ph = 2 * np.pi * np.cumsum(f0) / sr + rng.uniform(0, 6)
            sig = np.zeros(m)
            # vowel-like spectrum: formant peaks on a 1/k spectral tilt
            fmts = [(rng.uniform(600, 800), 150), (rng.uniform(1100, 1400), 200), (2600, 300)]
            for k in range(1, 60):
                fk = k * float(np.mean(f0))
                if fk > sr / 2 - 500:
                    break
                amp = (1 + 3 * sum(np.exp(-((fk - F) / bw) ** 2) for F, bw in fmts)) / k
                sig += amp * np.sin(k * ph)
            env = np.minimum(1, np.minimum(t * dur / 0.02, (1 - t) * dur / 0.035))
            sig *= env * (1 + 0.03 * rng.standard_normal(m))
            sig /= np.max(np.abs(sig)) + 1e-9
            parts.append(0.5 * sig)
            if i < n - 1:
                gap = int(0.06 / rate * sr)
                g = 0.004 * rng.standard_normal(gap)
                burst = int(0.015 * sr)
                g[gap // 2: gap // 2 + burst] += 0.05 * rng.standard_normal(min(burst, gap - gap // 2))
                parts.append(g)
        parts.append(np.zeros(int(0.2 * sr)))
        x = np.concatenate(parts)
        x += 10 ** (-60 / 20) * rng.standard_normal(len(x))
        return x.astype(np.float32)

    def tts(self, *, stage: str, text: str, voice: str, rate: float = 1.0, model: str | None = None,
            style: str | None = None) -> Audio:
        from ..audio.encode import wav_bytes

        self.calls["tts"] += 1
        gem = not is_chirp(voice)
        mdl = model or (MODELS.tts_gemini if gem else voice)
        self.ledger.reserve(stage, "gemini_tts" if gem else "tts", mdl, tts_cost(text, voice, rate))
        tones = self._tones_for(text)
        eff_rate = rate
        if gem and style and "slow" in style.lower():
            eff_rate = min(rate, SLOW_RATE)
        if self._take("slow", text, voice) and eff_rate < 1:
            eff_rate = 0.4  # far too slow: a duration outlier
        if self._take("tone", text, voice):
            tones = [WRONG_TONE[t] for t in tones]
        x = self.synth(text, voice, eff_rate, tones)
        sr = self.SR
        if self._take("clip", text, voice):
            x = np.clip(x * 5, -1, 1)
        if self._take("silence", text, voice):
            mid = len(x) // 2
            if len(tones) > 1:  # in the gap after the first syllable
                mid = int((0.15 + 0.27 / eff_rate) * sr) + int(0.03 / eff_rate * sr)
            x = np.concatenate([x[:mid], np.zeros(int(1.3 * sr), np.float32), x[mid:]])
        if self._take("trunc", text, voice):
            end = int((0.15 + (0.27 / eff_rate + 0.06 / eff_rate) * (len(tones) - 1) + 0.27 / eff_rate * 0.6) * sr)
            x = x[:end]
        if self._take("glitch", text, voice):
            rng = np.random.default_rng(1)
            x = x + 0.35 * rng.standard_normal(len(x)).astype(np.float32)
            clicks = rng.integers(0, len(x), 60)
            x[clicks] = 0.95
            x = np.clip(x, -1, 1)
        secs = len(x) / sr
        units = {"seconds": round(secs, 2)} if gem else {"characters": len(text)}
        self.ledger.record(stage, "gemini_tts" if gem else "tts", mdl, units, tts_cost(text, voice, rate), note=voice)
        return Audio(wav_bytes(x, sr), "audio/wav", secs, voice, mdl)

    def stt(self, *, stage: str, audio: Audio, language: str = "th-TH", model: str | None = None) -> Transcript:
        from ..audio.encode import SR, decode, read_opus_tags

        self.calls["stt"] += 1
        mdl = model or MODELS.stt
        self.ledger.reserve(stage, "stt", mdl, stt_cost(audio.seconds))
        tags = read_opus_tags(audio.data)
        text = tags.get("PHI_TEXT", "")
        voice = tags.get("PHI_VOICE", "")
        x = decode(audio.data, SR)
        words = _voiced_runs(x, SR)
        if text and self._take("stt", text, voice):
            text = _corrupt(text)
        self.ledger.record(stage, "stt", mdl, {"seconds": round(audio.seconds, 2)}, stt_cost(audio.seconds))
        return Transcript(text=text, confidence=0.93 if text else 0.0, words=words)

    def stt_many(self, *, stage: str, audios: list[Audio], language: str = "th-TH", model: str | None = None) -> list[Transcript]:
        return [self.stt(stage=stage, audio=a, language=language, model=model) for a in audios]


def _corrupt(text: str) -> str:
    """A plausible STT miss that changes the sounds: the first consonant heard
    as another one (ก -> ด, or ม when it already sounds like d/t)."""
    for i, c in enumerate(text):
        if "ก" <= c <= "ฮ":
            r = "ม" if c in "ดตฎฏ" else "ด"
            return text[:i] + r + text[i + 1:]
    return text + "ด"


def _voiced_runs(x: np.ndarray, sr: int) -> list[dict]:
    """Mock word times: energetic runs (like a recogniser's word boundaries)."""
    hop = int(0.01 * sr)
    n = len(x) // hop
    if n < 3:
        return []
    rms = np.sqrt(np.mean(x[: n * hop].reshape(n, hop) ** 2, axis=1))
    on = rms > rms.max() * 0.12
    out, start = [], None
    for i, o in enumerate(list(on) + [False]):
        if o and start is None:
            start = i
        elif not o and start is not None:
            if i - start >= 5:
                out.append({"word": "", "start": start * hop / sr, "end": i * hop / sr})
            start = None
    return out


# ---------- Vertex ----------


def _retry(fn, *, what: str, tries: int = 6):
    """Back off on rate limits and transient errors."""
    try:
        from google.api_core import exceptions as gx

        transient: tuple = (gx.ResourceExhausted, gx.ServiceUnavailable, gx.DeadlineExceeded,
                            gx.InternalServerError, gx.TooManyRequests)
    except Exception:  # pragma: no cover
        transient = ()
    delay = 2.0
    for i in range(tries):
        try:
            return fn()
        except transient as e:  # type: ignore[misc]
            if i == tries - 1:
                raise
            time.sleep(delay + random.uniform(0, delay / 2))
            delay = min(60.0, delay * 2)
    raise RuntimeError(f"{what}: retries exhausted")  # pragma: no cover


class VertexSpeech:
    """Google Cloud TTS (Chirp 3 HD + Gemini TTS) and Speech-to-Text v2. Never
    run in tests: all tests use MockSpeech."""

    def __init__(self, ledger):
        from ..config import load_env

        load_env()
        self.ledger = ledger
        self.project = os.environ.get("PHI_GCP_PROJECT")
        self.api_key = os.environ.get("PHI_API_KEY")
        # chirp_3 is served from the "us" / "eu" multi-regions; chirp_2 from
        # us-central1, europe-west4 and asia-southeast1. Thai on chirp_3 is
        # unverified (run sheet); stt() falls back to chirp_2 automatically.
        self.stt_location = os.environ.get("PHI_STT_LOCATION", "us")
        self.stt_fallback_location = os.environ.get("PHI_STT_FALLBACK_LOCATION", "asia-southeast1")
        self.encoding = os.environ.get("PHI_TTS_ENCODING", "LINEAR16").upper()
        self._tts = None
        self._gen = None
        self._stt: dict[str, Any] = {}
        self._stt_model_ok: dict[str, bool] = {}

    # --- clients ---
    def _client_options(self, endpoint: str | None = None):
        from google.api_core.client_options import ClientOptions

        kw: dict[str, Any] = {}
        if endpoint:
            kw["api_endpoint"] = endpoint
        if not self.project and self.api_key:
            kw["api_key"] = self.api_key
        if self.project:
            kw["quota_project_id"] = self.project
        return ClientOptions(**kw)

    def tts_client(self):
        if self._tts is None:
            from google.cloud import texttospeech

            self._tts = texttospeech.TextToSpeechClient(client_options=self._client_options())
        return self._tts

    def gen_client(self):
        if self._gen is None:
            from google import genai

            loc = os.environ.get("PHI_TTS_GEMINI_LOCATION", "global")
            self._gen = (genai.Client(vertexai=True, project=self.project, location=loc) if self.project
                         else genai.Client(vertexai=True, api_key=self.api_key))
        return self._gen

    def _gemini_vertex(self, text: str, voice: str, prompt: str, model: str) -> bytes:
        from google.genai import types

        cfg = types.GenerateContentConfig(
            response_modalities=["AUDIO"],
            speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(
                prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=star(voice)))))
        res = _retry_genai(lambda: self.gen_client().models.generate_content(
            model=model, contents=f"{prompt} {text}", config=cfg), what="gemini tts")
        part = res.candidates[0].content.parts[0].inline_data
        data = part.data
        if data[:4] != b"RIFF":  # raw PCM (audio/L16): 24 kHz mono
            from ..audio.encode import pcm16_to_wav

            data = pcm16_to_wav(data, 24000)
        return data

    def stt_second(self, *, stage: str, audio: Audio) -> Transcript:
        """A second, independent listener for a clip the recogniser disputes: Gemini writes down what it
        hears. Chirp speech-to-text leans on a language model and, with no context, turns a rare word into
        a common one (กินกุ้ง came back as กลิ่นกุ้ง from four voices, 4 Oct 2026). Used only on clips that
        failed the first comparison; a few hundred tokens a clip."""
        from google.genai import types

        from .text import text_cost

        model = MODELS.generate
        self.ledger.reserve(stage, "text", model, 0.002)
        cfg = types.GenerateContentConfig(
            temperature=0.0, max_output_tokens=1024,
            thinking_config=types.ThinkingConfig(thinking_level="low"),
            system_instruction=("You transcribe short Thai audio clips. Write exactly what is said, in Thai script, "
                                "sound by sound: never replace an unusual word with a more common one, never add or "
                                "drop words. Numbers as Thai words. Output the transcription only."))
        res = _retry_genai(lambda: self.gen_client().models.generate_content(
            model=model, contents=[types.Part.from_bytes(data=audio.data, mime_type=audio.mime), "Transcribe this clip."],
            config=cfg), what="second listener")
        um = getattr(res, "usage_metadata", None)
        t_in = int(getattr(um, "prompt_token_count", 0) or 0)
        t_out = int((getattr(um, "candidates_token_count", 0) or 0) + (getattr(um, "thoughts_token_count", 0) or 0))
        # audio input is billed above the text rate: counted twice to stay on the safe side
        self.ledger.record(stage, "text", model, {"in": t_in, "out": t_out}, text_cost(model, 2 * t_in, t_out), note="second listener")
        return Transcript(text=(res.text or "").strip(), confidence=0.0, words=[])

    def stt_client(self, location: str):
        if location not in self._stt:
            from google.cloud import speech_v2

            ep = None if location == "global" else f"{location}-speech.googleapis.com"
            self._stt[location] = speech_v2.SpeechClient(client_options=self._client_options(ep))
        return self._stt[location]

    # --- voices ---
    def list_voices(self, language: str = "th-TH") -> list[dict]:
        from google.cloud import texttospeech as t

        res = _retry(lambda: self.tts_client().list_voices(language_code=language), what="list_voices")
        out = []
        for v in res.voices:
            if "Chirp3-HD" not in v.name or language not in list(v.language_codes):
                continue
            g = {t.SsmlVoiceGender.FEMALE: "f", t.SsmlVoiceGender.MALE: "m"}.get(v.ssml_gender) or voice_sex(v.name)
            out.append({"name": v.name, "gender": g, "engine": "chirp3-hd", "language": language,
                        "rate_hz": v.natural_sample_rate_hertz})
        return sorted(out, key=lambda d: d["name"])

    # --- TTS ---
    def tts(self, *, stage: str, text: str, voice: str, rate: float = 1.0, model: str | None = None,
            style: str | None = None) -> Audio:
        from google.cloud import texttospeech as t

        gem = not is_chirp(voice)
        enc_name = self.encoding
        enc = getattr(t.AudioEncoding, enc_name)
        if gem:
            mdl = model or MODELS.tts_gemini
            kind = "gemini_tts"
            prompt = style or (SLOW_STYLE if rate < 1 else NORMAL_STYLE)
            inp = t.SynthesisInput(text=text, prompt=prompt)
            sel = t.VoiceSelectionParams(language_code="th-TH", name=star(voice), model_name=mdl)
            # Gemini TTS pace is set by the prompt; speaking_rate is left at 1.
            cfg = t.AudioConfig(audio_encoding=enc, sample_rate_hertz=24000)
        else:
            mdl = voice
            kind = "tts"
            inp = t.SynthesisInput(text=text)
            sel = t.VoiceSelectionParams(language_code="th-TH", name=voice)
            cfg = t.AudioConfig(audio_encoding=enc, speaking_rate=rate, sample_rate_hertz=24000)
        est = tts_cost(text, voice, rate)
        self.ledger.reserve(stage, kind, mdl, est * (1.5 if gem else 1.0))
        if gem and mdl not in CLOUD_TTS_GEMINI:
            data = self._gemini_vertex(text, voice, prompt, mdl)
            enc_name = "LINEAR16"  # always WAV from this route
        else:
            data = _retry(lambda: self.tts_client().synthesize_speech(input=inp, voice=sel, audio_config=cfg, timeout=60),
                          what="tts").audio_content
        if enc_name == "LINEAR16":
            mime = "audio/wav"  # LINEAR16 responses carry a WAV header
            if data[:4] != b"RIFF":
                from ..audio.encode import pcm16_to_wav

                data = pcm16_to_wav(data, 24000)
            secs = max(0.0, (len(data) - 44) / 2 / 24000)
        elif enc_name == "PCM":
            from ..audio.encode import pcm16_to_wav

            data = pcm16_to_wav(data, 24000)
            mime, secs = "audio/wav", (len(data) - 44) / 2 / 24000
        else:
            mime = "audio/ogg" if enc_name == "OGG_OPUS" else "audio/mpeg"
            secs = est_seconds(text, rate)
        if gem:
            units, usd = {"seconds": round(secs, 2), "characters": len(text)}, secs * PRICES.gemini_tts_second
        else:
            units, usd = {"characters": len(text)}, len(text) * PRICES.chirp_char
        self.ledger.record(stage, kind, mdl, units, usd, note=voice)
        return Audio(data, mime, secs, voice, mdl)

    # --- STT ---
    def _recognize(self, content: bytes, model: str, location: str, word_times: bool):
        from google.cloud import speech_v2 as s

        rec = f"projects/{self.project or '-'}/locations/{location}/recognizers/_"
        feats = s.RecognitionFeatures(enable_word_time_offsets=word_times, enable_word_confidence=word_times)
        cfg = s.RecognitionConfig(auto_decoding_config=s.AutoDetectDecodingConfig(), model=model,
                                  language_codes=["th-TH"], features=feats)
        req = s.RecognizeRequest(recognizer=rec, config=cfg, content=content)
        return _retry(lambda: self.stt_client(location).recognize(request=req, timeout=60), what="stt")  # a hung call froze a run (4 Oct 2026)

    def stt(self, *, stage: str, audio: Audio, language: str = "th-TH", model: str | None = None) -> Transcript:
        from google.api_core import exceptions as gx

        attempts = [(model or MODELS.stt, self.stt_location), (MODELS.stt_fallback, self.stt_fallback_location)]
        self.ledger.reserve(stage, "stt", attempts[0][0], stt_cost(max(audio.seconds, 1.0)))
        last: Exception | None = None
        for mdl, loc in attempts:
            if self._stt_model_ok.get(f"{mdl}@{loc}") is False:
                continue
            for word_times in (True, False):
                try:
                    res = self._recognize(audio.data, mdl, loc, word_times)
                except (gx.InvalidArgument, gx.NotFound, gx.FailedPrecondition, gx.PermissionDenied) as e:
                    last = e
                    msg = str(e).lower()
                    if word_times and ("word" in msg or "feature" in msg):
                        continue  # model refuses word offsets: try without
                    self._stt_model_ok[f"{mdl}@{loc}"] = False
                    break
                self._stt_model_ok[f"{mdl}@{loc}"] = True
                billed = audio.seconds
                try:
                    billed = float(res.metadata.total_billed_duration.total_seconds()) or audio.seconds
                except Exception:
                    pass
                self.ledger.record(stage, "stt", mdl, {"seconds": round(billed, 2)}, stt_cost(billed), note=loc)
                return _to_transcript(res)
        raise RuntimeError(f"STT failed on {attempts}: {last}")

    def stt_many(self, *, stage: str, audios: list[Audio], language: str = "th-TH", model: str | None = None) -> list[Transcript]:
        # Sync recognize per clip. BatchRecognize with DYNAMIC_BATCHING is
        # cheaper but needs the audio in a Cloud Storage bucket; it is not used
        # so no bucket has to be set up. Clips are already trimmed of edge
        # silence, which is the main per-second saving.
        return [self.stt(stage=stage, audio=a, language=language, model=model) for a in audios]


def _to_transcript(res) -> Transcript:
    texts, confs, words = [], [], []
    for r in res.results:
        if not r.alternatives:
            continue
        a = r.alternatives[0]
        texts.append(a.transcript)
        confs.append(a.confidence)
        for w in a.words:
            words.append({"word": w.word, "start": w.start_offset.total_seconds(), "end": w.end_offset.total_seconds(),
                          "confidence": getattr(w, "confidence", 0.0)})
    return Transcript(text="".join(texts), confidence=float(np.mean(confs)) if confs else 0.0, words=words)
