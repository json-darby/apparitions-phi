"""Gesture key poses on Vertex (Gemini image), for RIFE to fill in between.

palm (Fah) and handover (Nok): the first key is made from the person's reference
sheet and neutral portrait; each next key is an edit of the one before, so the
camera, light and person stay locked and RIFE has small, clean steps to fill.
walk (you, anonymous): one sheet of eight poses of a single stride, cut into frames.
Every call goes through the ledger and its budget stop. Files that exist are
skipped; delete one to remake it (and every key after it).

    python gen_gestures_vertex.py palm handover walk [--dry]
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
GEN = ROOT / "generated"
OUT = GEN / "keys"

LOOK = (
    "Photorealistic, plain matte near-black background (#0a0a0a), completely even, nothing behind the person. One large soft key light from "
    "the front-left, a faint white rim light from behind, no coloured light, neutral white balance. 85 mm lens at f/8, everything sharp. "
    "Real skin texture. No text, no logos, no watermark. Square 1:1."
)
KEEP = (
    " Keep everything else exactly the same: the same person, face, hair, clothing, camera position, framing, lighting and background. "
    "Only this change, as the next moment of one continuous movement."
)

MOVES = {
    "palm": {
        "who": "fah",
        "first": "Match the attached reference sheet and portrait exactly: the same woman, face, hair and clothing. Medium close-up: her head and "
        "upper body to mid-chest, centred, facing the camera, looking straight into the lens, relaxed neutral expression, both hands down out of "
        "frame. " + LOOK,
        "keys": [
            "Her expression falls: the inner ends of her eyebrows lift, the corners of her mouth drop slightly, still looking into the lens.",
            "She begins to raise her right hand, open palm facing the camera, now at the height of her collarbone in front of her.",
            "Her open right palm rises to the height of her face and moves toward the lens, fingers slightly spread, her sad eyes still on the lens beside it.",
            "Her open right palm is pressed flat against the camera lens as if against glass, large in the lower left of the frame, fingers spread, skin flattened against the glass, her sad face visible beside it.",
            "Her palm stays pressed flat on the glass; she lowers her eyes and looks down.",
        ],
    },
    "handover": {
        "who": "nok",
        "first": "Match the attached reference sheet and portrait exactly: the same woman, face, hair, apron and clothing. Medium shot: her head and "
        "upper body to the waist, centred, facing the camera, a warm everyday smile, hands down out of frame. " + LOOK,
        "keys": [
            "She lifts a white plastic takeaway bag holding a clear food box into the frame with her right hand, at waist height, still smiling at the lens.",
            "She holds the bag out toward the camera, arm half extended, the bag at chest height and nearer the lens.",
            "Her arm is fully extended toward the camera; the bag is close to the lens and fills the lower third of the frame, her smiling face behind it.",
            "Same, with a small nod of her head, as if saying here you go.",
        ],
    },
}

WALK = (
    "Walk cycle reference sheet photograph. Eight photographs in a grid of four columns and two rows, all exactly the same size, reading left "
    "to right, top row then bottom row. Each shows the same original fictional adult Thai man in his thirties, full body from head to feet, "
    "seen exactly side-on, walking to the right at a relaxed pace, at the same scale and position in every cell, feet on the same ground line. "
    "The eight cells are the eight moments of one stride: contact (right heel touching down in front), down (weight on the right leg, knee "
    "bent), passing (left leg swinging past), up (rising on the right toes), then contact, down, passing and up with the left leg. Arms swing "
    "naturally opposite the legs. Plain dark trousers, dark long-sleeved top, dark trainers, no logos. Plain matte near-black background, one "
    "soft key light from the front-left, a faint white rim light from behind. Photorealistic, sharp, no text, no labels, no borders between cells. "
    "Wide 16:9."
)


def png(p: Path | Image.Image) -> bytes:
    im = Image.open(p) if isinstance(p, Path) else p
    b = io.BytesIO()
    im.convert("RGB").save(b, "PNG")
    return b.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("moves", nargs="+", choices=["palm", "handover", "walk"])
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()

    jobs = []
    for mv in a.moves:
        if mv == "walk":
            jobs.append(("walk", OUT / "walk" / "sheet.png", MODELS.image_ref, PRICES.image_ref))
            continue
        spec = MOVES[mv]
        jobs.append((mv, OUT / mv / "k0.png", MODELS.image_ref, PRICES.image_ref))
        for i in range(len(spec["keys"])):
            jobs.append((mv, OUT / mv / f"k{i + 1}.png", MODELS.image, PRICES.image))
    todo = [j for j in jobs if not j[1].exists()]
    print(f"{len(todo)} images to make, estimate ${sum(j[3] for j in todo):.2f}")
    if a.dry or not todo:
        return

    from phi_pipeline.providers.media import VertexMedia

    ledger = Ledger(dry=False)
    media = VertexMedia(ledger)

    def call(prompt: str, refs: list[bytes], model: str, aspect: str) -> Image.Image:
        for attempt in range(3):
            try:
                img = media.image(stage="gestures", prompt=prompt, refs=refs, model=model, aspect=aspect)
                return Image.open(io.BytesIO(img.data)).convert("RGB")
            except Exception as e:  # 429s from the shared project: back off
                if "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e):
                    time.sleep(20 * (attempt + 1))
                    continue
                raise
        sys.exit("still rate limited, stopping")

    for mv, path, model, _ in jobs:
        if path.exists():
            continue
        path.parent.mkdir(parents=True, exist_ok=True)
        if mv == "walk":
            im = call(WALK, [], model, "16:9")
        else:
            spec = MOVES[mv]
            k = int(path.stem[1:])
            if k == 0:
                who = spec["who"]
                refs = [png(GEN / "refs" / f"{who}.png"), png(GEN / "portraits" / who / "neutral.png")]
                im = call(spec["first"], refs, model, "1:1")
            else:
                prev = path.parent / f"k{k - 1}.png"
                im = call("Edit this photograph. " + spec["keys"][k - 1] + KEEP, [png(prev)], model, "1:1")
        im.save(path, "PNG")
        print(f"saved {path.relative_to(ROOT)} {im.size}")
        time.sleep(3)
    print(ledger.summary())


if __name__ == "__main__":
    main()
