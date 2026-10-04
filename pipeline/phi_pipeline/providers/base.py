"""The provider contract. Every stage talks to Google through these three
interfaces, never directly, so the whole pipeline runs end to end in dry-run
mode (mock providers, no network, no cost) and switches to Vertex at the very
end by setting credentials.

Implementations:
  providers/text.py    MockText,   VertexText    (Gemini text, structured JSON)
  providers/speech.py  MockSpeech, VertexSpeech  (Chirp 3 HD TTS, Gemini TTS, Chirp STT)
  providers/media.py   MockMedia,  VertexMedia   (Gemini image, Omni video)

Every Vertex call goes through Ledger.reserve() first and Ledger.record() after.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from typing import Any, Protocol

from ..config import load_env
from ..ledger import Ledger


@dataclass
class TextResult:
    data: Any  # parsed JSON
    model: str
    tokens_in: int
    tokens_out: int


@dataclass
class Audio:
    """Encoded audio as returned by TTS (OGG Opus unless said otherwise)."""
    data: bytes
    mime: str  # "audio/ogg" | "audio/wav" | "audio/mpeg"
    seconds: float
    voice: str
    model: str


@dataclass
class Transcript:
    text: str
    confidence: float
    words: list[dict] = field(default_factory=list)  # [{"word", "start", "end"}] seconds


@dataclass
class Image:
    data: bytes
    mime: str


@dataclass
class Video:
    data: bytes
    mime: str
    seconds: float


class TextProvider(Protocol):
    def generate_json(self, *, stage: str, model: str, system: str, prompt: str, schema: dict, temperature: float = 0.7) -> TextResult: ...


class SpeechProvider(Protocol):
    def list_voices(self, language: str = "th-TH") -> list[dict]: ...
    def tts(self, *, stage: str, text: str, voice: str, rate: float = 1.0, model: str | None = None, style: str | None = None) -> Audio: ...
    def stt(self, *, stage: str, audio: Audio, language: str = "th-TH", model: str | None = None) -> Transcript: ...


class MediaProvider(Protocol):
    def image(self, *, stage: str, prompt: str, refs: list[bytes] | None = None, model: str | None = None, aspect: str = "1:1") -> Image: ...
    def video(self, *, stage: str, prompt: str, refs: list[bytes] | None = None, seconds: int = 8, draft: bool = True, model: str | None = None) -> Video: ...


@dataclass
class Providers:
    text: TextProvider
    speech: SpeechProvider
    media: MediaProvider
    ledger: Ledger
    dry: bool


def credentials_present() -> bool:
    load_env()
    return bool(os.environ.get("PHI_GCP_PROJECT") or os.environ.get("PHI_API_KEY"))


def get_providers(dry: bool) -> Providers:
    """dry=True: mocks, no network. dry=False: Vertex, needs credentials."""
    load_env()
    ledger = Ledger(dry=dry)
    if dry:
        from .media import MockMedia
        from .speech import MockSpeech
        from .text import MockText
        return Providers(MockText(ledger), MockSpeech(ledger), MockMedia(ledger), ledger, True)
    if not credentials_present():
        raise SystemExit(
            "No credentials. Put PHI_GCP_PROJECT (with gcloud application-default login) or PHI_API_KEY "
            "in phi-project/pipeline/.env.local, or run with --dry-run."
        )
    from .media import VertexMedia
    from .speech import VertexSpeech
    from .text import VertexText
    return Providers(VertexText(ledger), VertexSpeech(ledger), VertexMedia(ledger), ledger, False)
