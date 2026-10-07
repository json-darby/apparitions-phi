"""Media providers: Gemini image on Vertex, and an offline mock.

Images are on hold until the owner agrees a style, and video is not part of
this run at all, so VertexMedia.video refuses. The image call exists so the
probe can confirm the model is enabled; it goes through the ledger like every
other paid call.
"""

from __future__ import annotations

import os
import struct
import zlib

from ..config import MODELS, PRICES, load_env
from ..ledger import Ledger
from .base import Image, Video


def _png(w: int, h: int, grey: int = 0) -> bytes:
    """A tiny solid PNG, so mocks return a real image."""
    raw = b"".join(b"\x00" + bytes([grey]) * w for _ in range(h))

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


class MockMedia:
    def __init__(self, ledger: Ledger):
        self.ledger = ledger

    def image(self, *, stage: str, prompt: str, refs: list[bytes] | None = None, model: str | None = None, aspect: str = "1:1") -> Image:
        self.ledger.record(stage, "image", model or MODELS.image, {"images": 1}, 0.0, "mock")
        return Image(_png(64, 64, 16), "image/png")

    def video(self, **_: object) -> Video:
        raise RuntimeError("Video is not part of this run.")


class VertexMedia:
    def __init__(self, ledger: Ledger):
        load_env()
        from google import genai  # imported here so dry runs never need it

        self.ledger = ledger
        project = os.environ.get("PHI_GCP_PROJECT")
        key = os.environ.get("PHI_API_KEY")
        if project:
            self.client = genai.Client(vertexai=True, project=project, location=os.environ.get("PHI_GCP_LOCATION") or "global")
        elif key:
            self.client = genai.Client(vertexai=True, api_key=key)
        else:
            raise SystemExit("VertexMedia: no PHI_GCP_PROJECT or PHI_API_KEY set.")

    def image(self, *, stage: str, prompt: str, refs: list[bytes] | None = None, model: str | None = None, aspect: str = "1:1", size: str | None = None, price: float | None = None) -> Image:
        from google.genai import types

        m = model or MODELS.image
        if price is None:
            price = PRICES.image_ref if m == MODELS.image_ref else PRICES.image
        self.ledger.reserve(stage, "image", m, price)
        parts: list = [types.Part.from_bytes(data=r, mime_type="image/png") for r in (refs or [])]
        parts.append(prompt)
        resp = self.client.models.generate_content(
            model=m,
            contents=parts,
            config=types.GenerateContentConfig(response_modalities=["IMAGE"], image_config=types.ImageConfig(aspect_ratio=aspect, **({"image_size": size} if size else {}))),
        )
        for cand in resp.candidates or []:
            for part in (cand.content.parts if cand.content else []) or []:
                if part.inline_data and part.inline_data.data:
                    self.ledger.record(stage, "image", m, {"images": 1}, price)
                    return Image(part.inline_data.data, part.inline_data.mime_type or "image/png")
        self.ledger.record(stage, "image", m, {"images": 0}, price, "no image returned")
        raise RuntimeError(f"{m}: no image in the response")

    def video(self, **_: object) -> Video:
        raise RuntimeError("Video is not part of this run.")
