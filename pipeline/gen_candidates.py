"""Make N candidate edits of one image on Vertex, for picking by eye.

    python gen_candidates.py SRC OUT_PREFIX N "prompt" [--model ref|flash] [--aspect 1:1] [--size 4K] [--ref EXTRA ...]
Writes OUT_PREFIX-a.png, -b.png, ... Each call goes through the ledger and its stop.
"""

from __future__ import annotations

import argparse
import io
import sys
import time
from pathlib import Path

from PIL import Image

from phi_pipeline.config import MODELS, PRICES
from phi_pipeline.ledger import Ledger


def png(p: Path) -> bytes:
    b = io.BytesIO()
    Image.open(p).convert("RGB").save(b, "PNG")
    return b.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("n", type=int)
    ap.add_argument("prompt")
    ap.add_argument("--model", choices=["ref", "flash"], default="flash")
    ap.add_argument("--aspect", default="1:1")
    ap.add_argument("--size", default=None)
    ap.add_argument("--ref", nargs="*", default=[])
    a = ap.parse_args()
    from phi_pipeline.providers.media import VertexMedia

    ledger = Ledger(dry=False)
    media = VertexMedia(ledger)
    model = MODELS.image_ref if a.model == "ref" else MODELS.image
    price = (0.24 if a.size == "4K" else PRICES.image_ref) if a.model == "ref" else PRICES.image
    refs = ([png(Path(a.src))] if a.src != "-" else []) + [png(Path(r)) for r in a.ref]
    for i in range(a.n):
        out = Path(f"{a.out}-{'abcdefgh'[i]}.png")
        if out.exists():
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        for attempt in range(3):
            try:
                img = media.image(stage="candidates", prompt=a.prompt, refs=refs, model=model, aspect=a.aspect, size=a.size, price=price)
                break
            except Exception as e:
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    time.sleep(20 * (attempt + 1))
                    continue
                raise
        else:
            sys.exit("still rate limited")
        Image.open(io.BytesIO(img.data)).convert("RGB").save(out, "PNG")
        print("saved", out)
        time.sleep(3)
    print(ledger.summary())


if __name__ == "__main__":
    main()
