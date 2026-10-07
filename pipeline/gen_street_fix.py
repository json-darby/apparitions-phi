"""Second take on the two stretches where the street drifts into a view down the road.

Writes a full alternative set to generated/street-v3/ (the first take stays in
generated/street/ for comparison). Unchanged sections are copied. Remade:
  02-food      from the hotel's right edge (single-sided starter)
  03-pharmacy  two-sided starter: the new food's right edge and the bar's left edge,
               so it joins the untouched bar exactly
  07-taxi      from the market's right edge
  08-end       from the new taxi's right edge
Every call goes through the ledger and its budget stop.
"""

from __future__ import annotations

import io
import shutil
import sys
import time
from pathlib import Path

from PIL import Image

from gen_street_vertex import PLACES, SHARED, png
from phi_pipeline.config import MODELS, PRICES
from phi_pipeline.ledger import Ledger

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "generated" / "street"
OUT = ROOT / "generated" / "street-v3"
KEEP = 0.4

FLAT = (
    "The camera looks perfectly square-on at the building fronts, its view parallel to the shopfronts, exactly like the existing part: "
    "every facade is flat to the camera, all vertical lines are vertical, the roof line and kerb line run straight across the frame and level. "
    "We never look down the road: no vanishing point, no receding row of buildings, no street disappearing into the distance, no corner. "
    "The row of shophouses continues unbroken. Every new shopfront is different from the ones already shown. "
)
LINE = dict(PLACES)


def starter(left: Image.Image | None, right: Image.Image | None, size: tuple[int, int]) -> Image.Image:
    w, h = size
    k = int(w * KEEP)
    out = Image.new("RGB", (w, h), (0, 0, 0))
    if left is not None:
        out.paste(left.crop((left.width - k, 0, left.width, h)), (0, 0))
    if right is not None:
        out.paste(right.crop((0, 0, k, h)), (w - k, 0))
    return out


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    for p in SRC.glob("*.png"):
        if p.stem not in ("02-food", "03-pharmacy", "07-taxi", "08-end", "street") and not (OUT / p.name).exists():
            shutil.copy2(p, OUT / p.name)
    todo = [n for n in ("02-food", "03-pharmacy", "07-taxi", "08-end") if not (OUT / f"{n}.png").exists()]
    print(f"{len(todo)} images to make, estimate ${len(todo) * PRICES.image_ref:.2f}")
    if not todo:
        return
    from phi_pipeline.providers.media import VertexMedia

    ledger = Ledger(dry=False)
    media = VertexMedia(ledger)
    get = lambda n: Image.open(OUT / f"{n}.png").convert("RGB")

    def make(name: str, st: Image.Image, two_sided: bool) -> None:
        if (OUT / f"{name}.png").exists():
            return
        if two_sided:
            lead = ("This image shows the left and right parts of a photograph with a blank black gap between them. Fill the black gap so the "
                    "two parts join into one seamless photograph of the same street, exactly matching both: the same camera height, kerb line, "
                    "cable lines, haze, wetness and lighting. The existing parts must stay exactly as they are. ")
        else:
            lead = ("This image is the left-hand part of a photograph, with the rest blank black. Fill the black area by continuing the same "
                    "street to the right, exactly matching the existing part: the same camera height, kerb line, cable lines, haze, wetness and "
                    "lighting. The existing part must stay exactly as it is. ")
        prompt = lead + FLAT + SHARED + " " + LINE[name]
        for attempt in range(3):
            try:
                img = media.image(stage="street", prompt=prompt, refs=[png(st)], model=MODELS.image_ref, aspect="16:9")
                break
            except Exception as e:
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    time.sleep(20 * (attempt + 1))
                    continue
                raise
        else:
            sys.exit(f"{name}: still rate limited")
        im = Image.open(io.BytesIO(img.data)).convert("RGB")
        im.save(OUT / f"{name}.png", "PNG")
        print(f"saved {name} {im.size}")
        time.sleep(3)

    size = get("01-hotel").size
    make("02-food", starter(get("01-hotel"), None, size), False)
    make("03-pharmacy", starter(get("02-food"), get("04-bar"), size), True)
    make("07-taxi", starter(get("06-market"), None, size), False)
    make("08-end", starter(get("07-taxi"), None, size), False)
    print(ledger.summary())


if __name__ == "__main__":
    main()
