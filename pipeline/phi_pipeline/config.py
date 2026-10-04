"""Pipeline settings: models, regions, prices, paths and the spending cap.

Nothing here holds a secret. Credentials are read only at run time, from
`pipeline/.env.local` (git-ignored) or the environment:

  PHI_GCP_PROJECT   Google Cloud project to bill (uses gcloud Application Default Credentials)
  PHI_GCP_LOCATION  region for Gemini calls (default "global")
  PHI_API_KEY       alternative: a Vertex API key (express mode) instead of ADC
  PHI_BUDGET_USD    hard cap on spend for this pipeline (default 30, the owner's limit)

Prices are list prices from the research report of 2 Oct 2026 (USD). They are
used to estimate before running and to stop when the cap is reached. Re-check
them before a bulk run; Gemini text and TTS prices double on 1 Jan 2027.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PIPELINE = Path(__file__).resolve().parent.parent
PROJECT = PIPELINE.parent  # phi-project
APP = PROJECT / "app"
WORK = PIPELINE / "work"  # intermediate files, safe to delete
OUT_CONTENT = APP / "public" / "content"  # what the app loads
OUT_AUDIO = APP / "public" / "audio"
OUT_PACKS = APP / "public" / "packs"
LEDGER = WORK / "ledger.jsonl"


def load_env() -> None:
    """Read pipeline/.env.local into the environment (KEY=VALUE lines)."""
    f = PIPELINE / ".env.local"
    if not f.exists():
        return
    for line in f.read_text(encoding="utf8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class Models:
    # text
    generate: str = "gemini-3.8-flash"
    # the second, different model that checks spelling, meaning, register and endings (never tones)
    check: str = "gemini-2.5-pro"
    # speech
    tts_main_prefix: str = "th-TH-Chirp3-HD-"  # Cloud TTS Chirp 3 HD voices
    tts_gemini: str = "gemini-3.8-flash-tts"  # extra voices and the cast's own voices; Vertex AI, location global
    stt: str = "chirp_3"
    stt_fallback: str = "chirp_2"
    # images and clips
    image_ref: str = "gemini-3-pro-image"  # reference sheets: consistency matters most
    image: str = "gemini-3.1-flash-image"  # portraits, scenes, objects
    video: str = "gemini-omni-1.1-flash-preview"  # gesture clips; ID may change on the Agent Platform
    live: str = "gemini-3.8-live"


MODELS = Models()


@dataclass(frozen=True)
class Prices:
    """USD list prices."""
    text_in: dict = field(default_factory=lambda: {"gemini-3.8-flash": 0.75e-6, "gemini-2.5-pro": 1.25e-6})
    text_out: dict = field(default_factory=lambda: {"gemini-3.8-flash": 3.75e-6, "gemini-2.5-pro": 10e-6})
    # Chirp 3 HD: 1M characters a month free, then $30 per 1M. The estimate assumes nothing is free.
    chirp_char: float = 30e-6
    # Gemini 3.8 Flash TTS: $9 per 1M audio tokens until 31 Dec 2026 ($18 from 1 Jan 2027), ~25 tokens a second
    gemini_tts_second: float = 9e-6 * 25
    # Speech-to-Text Chirp: $0.016 a minute
    stt_second: float = 0.016 / 60
    image_ref: float = 0.134
    image: float = 0.067
    video_second_draft: float = 0.034  # 360p
    video_second_final: float = 0.10  # 720p
    live_minute: float = 0.023  # audio in + out


PRICES = Prices()


def budget_usd() -> float:
    return float(os.environ.get("PHI_BUDGET_USD", "30"))


def course_days() -> int:
    return int(os.environ.get("PHI_COURSE_DAYS", "60"))
