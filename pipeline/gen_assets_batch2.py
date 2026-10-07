"""Second asset batch on Vertex (Gemini image), one call at a time through the ledger:

1. The whole street as ONE wide 4K photograph (no chained sections, so one camera,
   one perspective, one light): generated/street-one/street.png
2. Nok's hand-over keys k3 and k4 again, with natural bag handles.
3. The fifteen objects for "Object turn", replacing the online filler:
   generated/objects/<id>.png

Files that exist are skipped; delete one to remake it.
    python gen_assets_batch2.py [--dry]
"""

from __future__ import annotations

import argparse
import io
import sys
import time
from pathlib import Path

from PIL import Image

from gen_gestures_vertex import KEEP as EDIT_KEEP
from phi_pipeline.config import MODELS, PRICES
from phi_pipeline.ledger import Ledger

ROOT = Path(__file__).resolve().parent.parent
GEN = ROOT / "generated"
PRICE_4K = 0.24

STREET = (
    "One single photorealistic night photograph, a very wide panorama of one side of a quiet side street (soi) in Bangkok, about 10 pm, just "
    "after rain. The camera stands on the opposite pavement and looks perfectly square-on at one continuous row of old two- and three-storey "
    "concrete shophouses: every facade is flat to the camera, all vertical lines are vertical, the roof line and the kerb run straight and "
    "level across the whole frame. No street corners, no side streets, no view down the road, no vanishing point. 35 mm look at f/8, deep focus, "
    "everything sharp. Bottom fifth: wet dark tarmac and the near kerb reflecting every light. Top: upper windows, air-conditioning units and "
    "tangled black overhead power cables against a dark hazy sky. Thin haze. Practical light only, from the shops and street lamps. From left "
    "to right along the row, evenly spaced, with shuttered shopfronts between them: "
    "(1) a small hotel entrance with glass doors glowing white-blue, a short canopy and two potted palms; "
    "(2) a street-food cart under a red-and-white striped awning, a glass case lit from inside, bare warm bulbs, steam from a wok, red plastic stools, warm amber light; "
    "(3) a small pharmacy with a glass front, shelves lit cold white, a glowing green-white cross; "
    "(4) a small open-front bar with one pink neon strip, a wooden counter and stools, shelves of unlabelled bottles; "
    "(5) a narrow calm shop with wooden shelves of small glass jars and potted green plants, soft green light inside; "
    "(6) night-market stalls under two parasols with hanging bulbs and racks of folded shirts, warm amber light; "
    "(7) a taxi rank at the kerb, one parked taxi with an unlit roof sign, a pole and a street lamp casting a cone of cool blue light. "
    "Each of the seven has one blank sign board above it and a clear lit patch of pavement in front where one person could stand. "
    "No people, no animals, no moving vehicles. No brand names, logos or readable text anywhere. Real textures: stained concrete, rust, "
    "peeling paint, puddles. Ultra-wide 21:9."
)

NOK = {
    "k3": "Her arm is extended toward the camera, holding the white plastic takeaway bag by both of its loop handles gathered together in her right "
    "fist, the handles rising naturally from the top of the bag into her hand. The bag is nearer the lens, about a quarter of the frame, its "
    "food box visible through the plastic, her smiling face clearly visible above and beside it.",
    "k4": "Same moment, the bag held the same way by both gathered loop handles in her fist, with a small nod of her head as if saying here you go.",
}

OBJ = (
    "Single object centred on a plain matte near-black background (#0a0a0a), seen from slightly above, the object filling about 70% of the "
    "frame. One large soft key light from the front-left, a faint white rim light from behind, neutral white balance, no coloured light. "
    "85 mm lens at f/8, everything sharp. No hands, no people, no text, no logos, no labels, no watermark. Photorealistic. Square 1:1. "
)
OBJECTS = {
    "bottle": "A plain clear plastic water bottle with a blank white label, cap on.",
    "chilli": "A small pile of fresh red and green Thai bird's-eye chillies.",
    "coins": "A small stack and scatter of invented silver and gold coins with abstract lotus patterns and plain numerals, no portraits, not real currency.",
    "dish": "A plate of Thai fried rice with sliced cucumber and a lime wedge.",
    "garland": "A Thai jasmine flower garland (phuang malai) with white jasmine buds and a red rose and marigold tassel.",
    "ice": "A tall glass of tube ice, cylinders of ice with a hole through the middle.",
    "mango": "A plate of mango sticky rice: sliced ripe yellow mango beside white sticky rice with coconut cream.",
    "noodles": "A bowl of Thai noodle soup with thin rice noodles, sliced pork, bean sprouts and herbs.",
    "padthai": "A plate of pad thai with shrimp, crushed peanuts, bean sprouts and a lime wedge.",
    "somtam": "A plate of green papaya salad (som tam) with tomatoes, long beans, peanuts and dried shrimp.",
    "spirithouse": "A small Thai spirit house on its pedestal, ornate gold and red, with tiny offerings and a garland. The whole object, from the top of its roof to the foot of the pedestal, is fully inside the frame with clear space all round; it fills about 60% of the frame height.",
    "stall": "A small street-market stall table under a parasol with hanging bulbs, seen as one compact object.",
    "temple": "A small model of the tiered red and gold roof of a Thai temple with curved gable finials (chofa), the whole roof fully inside the frame with clear space all round, nothing cut off at any edge, no pillars or walls below it.",
    "thaitea": "A clear plastic cup of orange Thai iced tea with a swirl of milk, ice and a straw.",
    "tuktuk": "A Thai tuk-tuk (auto rickshaw), three-quarter view, no logos and no number plates.",
}


def png(p: Path | Image.Image) -> bytes:
    im = Image.open(p) if isinstance(p, Path) else p
    b = io.BytesIO()
    im.convert("RGB").save(b, "PNG")
    return b.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()
    jobs = [("street", GEN / "street-one" / "street.png", MODELS.image_ref, PRICE_4K)]
    jobs += [(f"nok-{k}", GEN / "keys" / "handover" / f"{k}.png", MODELS.image, PRICES.image) for k in NOK]
    jobs += [(f"obj-{k}", GEN / "objects" / f"{k}.png", MODELS.image, PRICES.image) for k in OBJECTS]
    todo = [j for j in jobs if not j[1].exists()]
    print(f"{len(todo)} images to make, estimate ${sum(j[3] for j in todo):.2f}")
    if a.dry or not todo:
        return
    from phi_pipeline.providers.media import VertexMedia

    ledger = Ledger(dry=False)
    media = VertexMedia(ledger)

    def call(**kw) -> Image.Image:
        for attempt in range(3):
            try:
                img = media.image(stage="batch2", **kw)
                return Image.open(io.BytesIO(img.data)).convert("RGB")
            except Exception as e:
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    time.sleep(20 * (attempt + 1))
                    continue
                raise
        sys.exit("still rate limited, stopping")

    for name, path, model, price in jobs:
        if path.exists():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        if name == "street":
            im = call(prompt=STREET, refs=[], model=model, aspect="21:9", size="4K", price=price)
        elif name.startswith("nok-"):
            k = name[4:]
            prev = path.parent / f"k{int(k[1:]) - 1}.png"
            im = call(prompt="Edit this photograph. " + NOK[k] + EDIT_KEEP, refs=[png(prev)], model=model, aspect="1:1")
        else:
            im = call(prompt=OBJ + OBJECTS[name[4:]], refs=[], model=model, aspect="1:1")
        im.save(path, "PNG")
        print(f"saved {path.relative_to(ROOT)} {im.size}")
        time.sleep(3)
    print(ledger.summary())


if __name__ == "__main__":
    main()
