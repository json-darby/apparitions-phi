"""The Street as one continuous night soi, on Vertex (Gemini image).

Ten images: the hotel section first (it sets the look), then each next section
made by filling a starter image (the right 40% of the previous section, the rest
black), so neighbours share real pixels and join without a seam; the start
section extends the hotel to the left the same way; the skyline stands alone.
Every call goes through the ledger and its budget stop. Files that exist are
skipped, so a rerun never pays twice; delete a file to remake it.

    python gen_street_vertex.py          # make what is missing
    python gen_street_vertex.py --dry    # estimate only
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

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "generated" / "street"
KEEP = 0.4  # share of the previous section carried into the next starter

SHARED = (
    "Photorealistic night photograph of a quiet side street (soi) in Bangkok, about 10 pm, just after rain. Shot from eye level across the "
    "street with a 35 mm lens at f/8, deep focus, everything sharp from the near kerb to the upper floors. Straight-on view of the shopfronts, "
    "camera level, no tilt. Bottom fifth: wet dark tarmac and the near kerb, reflecting the lights. Middle: the ground floors of old two- and "
    "three-storey concrete shophouses. Top: upper windows, air-conditioning units and tangled black overhead power cables against a dark hazy "
    "sky. Thin haze. Practical light only, from the shops, signs and street lamps; no flash. No people, no vehicles moving, no animals. No brand "
    "names, logos or readable text anywhere: every sign board is blank. Real textures: stained concrete, rust, peeling paint, puddles. Wide 16:9."
)

CONTINUE = (
    "This image is the {side}-hand part of a photograph, with the rest blank black. Fill the black area by continuing the same street to the "
    "{dir}, exactly matching the existing part: the same camera height, horizon, kerb line, cable lines, haze, wetness, colour of the night and "
    "lighting. The join must be seamless and the existing part must stay exactly as it is. The row of shophouses continues unbroken along "
    "the same straight kerb: no street corners, no side streets, no turning roads, the street does not bend or recede. Every new shopfront "
    "is different from the ones already shown; never repeat a doorway, sign, plant pot or shop. "
)

PLACES = [
    ("01-hotel", "In the centre, a small hotel entrance: glass doors glowing white-blue from inside, a short canopy, two potted palms. Above the door a blank, lit sign board. In front of the entrance, a clear patch of wet pavement lit by the doorway, where one person could stand. Cool blue-white light spilling onto the street."),
    ("02-food", "Next, a street-food cart under a red-and-white striped awning, a glass display case lit from inside, a string of bare warm bulbs, steam rising from a wok, six red plastic stools. A blank sign board above. A clear lit patch of pavement in front where one person could stand. Warm amber light."),
    ("03-pharmacy", "Next, a small pharmacy with a glass front, neat shelves lit cold white behind the glass, a glowing green-white cross above the door. A blank sign board. A clear lit patch of pavement in front where one person could stand. Cold white-cyan light."),
    ("04-bar", "Next, a small open-front bar: one pink neon strip along the ceiling, a wooden counter with four stools, shelves of unlabelled bottles, empty and calm. A blank sign board. A clear lit patch of pavement in front where one person could stand. Soft pink light."),
    ("05-shop", "Next, a narrow, calm shopfront: wooden shelves of small glass jars, several potted green plants, a small counter, soft green light inside. Tidy and relaxed. No symbols and no text. A blank sign board. A clear lit patch of pavement in front where one person could stand."),
    ("06-market", "Next, night-market stalls under two parasols with hanging bulbs, racks of folded shirts, a folding table. A blank sign board. A clear lit patch of pavement in front where one person could stand. Warm amber light."),
    ("07-taxi", "Next, a taxi rank at the kerb: one parked taxi with an unlit roof sign, a pole with a blank sign, a street lamp casting a cone of cool light. A clear lit patch of pavement by the pole where one person could stand. Cool blue light."),
    ("08-end", "Next, the row of shophouses goes on, all shuttered and unlit, one dim lamp, growing darker and hazier until it fades to black at the right edge."),
]
START = ("00-start", "Before this, a dark corner with a shuttered shop and one street lamp, fading to black at the left edge.")
SKY = "Photorealistic night skyline of distant Bangkok towers seen over low rooftops, a few lit windows, a hazy orange-grey city sky, no moon, no text, no logos, plain and even, very wide 21:9."


def png(im: Image.Image) -> bytes:
    b = io.BytesIO()
    im.convert("RGB").save(b, "PNG")
    return b.getvalue()


def starter(prev: Image.Image, keep_right: bool) -> Image.Image:
    """The previous section's edge on a black canvas of the same size."""
    w, h = prev.size
    k = int(w * KEEP)
    out = Image.new("RGB", (w, h), (0, 0, 0))
    if keep_right:  # continue to the right: the previous right edge goes on the left
        out.paste(prev.crop((w - k, 0, w, h)), (0, 0))
    else:  # continue to the left: the previous left edge goes on the right
        out.paste(prev.crop((0, 0, k, h)), (w - k, 0))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    names = [p[0] for p in PLACES] + [START[0], "sky"]
    todo = [n for n in names if not (OUT / f"{n}.png").exists()]
    print(f"{len(todo)} images to make, estimate ${len(todo) * PRICES.image_ref:.2f}")
    if a.dry or not todo:
        return

    from phi_pipeline.providers.media import VertexMedia

    ledger = Ledger(dry=False)
    media = VertexMedia(ledger)

    def make(name: str, prompt: str, refs: list[Image.Image], aspect: str = "16:9") -> Image.Image:
        path = OUT / f"{name}.png"
        if path.exists():
            return Image.open(path).convert("RGB")
        for attempt in range(3):
            try:
                img = media.image(stage="street", prompt=prompt, refs=[png(r) for r in refs], model=MODELS.image_ref, aspect=aspect)
                break
            except Exception as e:  # 429s from the shared project: back off, never hammer
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    time.sleep(20 * (attempt + 1))
                    continue
                raise
        else:
            sys.exit(f"{name}: still rate limited, stopping")
        im = Image.open(io.BytesIO(img.data)).convert("RGB")
        im.save(path, "PNG")
        print(f"saved {path.relative_to(ROOT)} {im.size}")
        time.sleep(3)
        return im

    look = make(PLACES[0][0], SHARED + " " + PLACES[0][1], [])
    prev = look
    for name, line in PLACES[1:]:
        prev = make(name, CONTINUE.format(side="left", dir="right") + SHARED + " " + line, [starter(prev, True)])
    make(START[0], CONTINUE.format(side="right", dir="left") + SHARED + " " + START[1], [starter(look, False)])
    make("sky", SKY, [], aspect="21:9")
    print(ledger.summary())


if __name__ == "__main__":
    main()
