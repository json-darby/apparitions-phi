"""Cast portraits on Vertex (Gemini image), following GEMINI_PROMPTS.md.

Per person: a reference sheet (the identity), a neutral portrait made with the
sheet attached, then five edits of the neutral so the head never moves between
expressions. Every call goes through the ledger and its budget stop. Files that
already exist are skipped, so a rerun never pays twice; delete a file to remake it.

    python gen_portraits_vertex.py pim            # one person
    python gen_portraits_vertex.py pim --dry      # print the prompts, no calls
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

LOOK = (
    "Photorealistic studio portrait photograph, head and shoulders, of an original fictional adult (not based on any real person). "
    "Shot on a full-frame camera with an 85 mm lens at f/8, so the whole head is sharp from the tip of the nose to the ears and hair. "
    "The person faces the camera straight on, head level, centred. The top of the head sits about 8% below the top edge of the frame; "
    "the eyes sit 38% down from the top; the shoulders reach the bottom edge. Plain matte near-black background (#0a0a0a), completely even, "
    "with no gradient, vignette, haze or smoke. Lighting: one large soft key light from the front-left, slightly above eye level, giving gentle "
    "modelling and a soft shadow on the right cheek. A faint white rim light from behind separates the hair and shoulders from the background. "
    "No coloured light, neutral white balance. Real skin texture with visible pores and fine lines, no retouching, no beauty filter, natural matte skin. "
    "One small catchlight in each eye. Square 1:1. No text, no watermark, no logos, no hands in frame, nothing covering the eyes."
)

PEOPLE = {
    "nok": "A Thai woman in her mid fifties. Round, warm face with deep laugh lines at the eyes and mouth, sun-touched skin, faint freckles on the cheeks. Short, practical, layered black hair with a little grey at the temples, tucked behind her ears. Small gold stud earrings. A faded navy cotton t-shirt under a striped blue-and-white cotton apron tied at the neck. Quick, warm, a little tired.",
    "ton": "A Thai man in his mid forties. Broad, calm face, heavy-lidded patient eyes, light stubble on the jaw, a small scar through the left eyebrow. Short neat black hair with a little grey. Dark sunglasses pushed up on top of his head, resting in the hair. A light blue short-sleeved polo shirt, collar open, slightly creased. Patient, quietly amused.",
    "ploy": "A Thai woman in her mid twenties. Oval face, smooth skin, neat defined eyebrows, composed and precise. Black hair pulled back tightly into a low bun at the nape, no loose strands. Small pearl stud earrings. A fitted dark navy reception uniform jacket with a stand-up mandarin collar and a plain blank brass pin on the lapel.",
    "lek": "A Thai man in his early thirties. Lean face, sharp cheekbones, quick teasing eyes, a slight crooked grin at rest, faint stubble. A plain dark grey baseball cap worn forward with no logo, the brim high enough that both eyes and eyebrows are fully visible. Short hair at the sides. A faded grey crew-neck t-shirt.",
    "mai": "A Thai woman in her mid thirties. Calm oval face, steady kind eyes, a few fine lines at the eyes. Long straight dark hair falling behind her shoulders, a centre parting. A crisp white pharmacist's coat over a pale blue collared blouse, a small plain white name badge with no readable text.",
    "bank": "A Thai man in his late twenties, clearly over 25. Open, friendly face, easy laugh lines, light stubble. Textured short black hair with volume on top, slightly tousled. A dark charcoal short-sleeved shirt open at the collar over a plain black t-shirt.",
    "fah": "A Thai woman in her late twenties, clearly over 25. Short black bob cut level with the jaw, a straight fringe just above the eyebrows. A direct, steady gaze with dry humour in it. Small silver hoop earrings that sit close to the earlobe. A plain black crew-neck t-shirt.",
    "theo": "A Black man in his late twenties, clearly over 25, a Londoner who has lived in Thailand for a few years. Shoulder-length locs tied back loosely, a couple falling at the temples but never over the eyes. A short neat beard, warm relaxed eyes, an easy half-smile, a small silver stud in his left ear. A plain dark green t-shirt under an open, short-sleeved, light linen shirt. Easy-going, knowledgeable, unhurried.",
    "pim": "A Thai woman in her mid thirties. Relaxed, open face, thoughtful eyes, a few faint freckles. Shoulder-length dark hair tucked behind her right ear, loose on the left. An off-white linen shirt with a soft collar, top button open. Unhurried and friendly.",
}

KEEP = " Keep everything else identical: the same person, head position and size in the frame, hair, clothing, lighting, background and camera."
EDITS = {
    "smile": "Edit this photograph. Change only the expression to a warm, natural smile: lips parted slightly showing a little of the top teeth, cheeks lifted, eyes narrowed a little by the smile with soft crinkles at the corners, still looking into the lens." + KEEP,
    "puzzled": "Edit this photograph. Change only the expression to quizzical and puzzled, not angry and not frowning: the left eyebrow clearly raised high, the right eyebrow level and relaxed, the eyes slightly narrowed, lips closed and pulled a little to one side, as if hearing something odd. Head tilted about 5 degrees." + KEEP,
    "sad": "Edit this photograph. Change only the expression to quietly sad: the inner ends of the eyebrows raised, the corners of the mouth turned slightly down, the gaze lowered a little below the lens." + KEEP,
    "closed": "Edit this photograph. Change only the eyes: gently closed, eyelids relaxed as if mid-blink, the face otherwise exactly as it is." + KEEP,
    "turn": "Edit this photograph. Turn the person's head and shoulders about 30 degrees to their left (toward the right side of the picture), a gentle three-quarter view with both eyes and both cheeks still clearly visible, with the eyes still looking at the lens. The head stays the same size, at the same height in the frame, centred on the same point. Keep the same person, hair, clothing, lighting direction, background and camera.",
}
EXTRA = {
    ("nok", "smile"): " This is her everyday face at the stall, quick and genuine.",
    ("ton", "smile"): " A patient, amused half-smile, mouth closed.",
    ("ton", "puzzled"): " Squinting slightly, as if he did not catch the address.",
    ("ploy", "smile"): " A polite, professional smile, mouth closed.",
    ("lek", "puzzled"): " Mock surprise, both eyebrows up, about to haggle.",
}


def sheet_prompt(desc: str) -> str:
    return (
        f"Character reference sheet photograph of an original fictional adult: {desc} Three photographs side by side on one wide image: "
        "front view, three-quarter view turned 40 degrees to their left, and full profile facing left. Head and shoulders in each, identical "
        "outfit, hair and expression (relaxed, mouth closed) in all three, all at the same scale and eye height. Plain dark grey studio background, "
        "soft even studio lighting, neutral white balance, real skin texture, sharp focus throughout, 85 mm lens, f/8. Photorealistic. "
        "No text, labels, borders or watermark. Wide frame."
    )


def neutral_prompt(desc: str) -> str:
    return (
        f"Match the attached reference sheet exactly: the same face, bone structure, skin, hair and clothing. {desc} "
        "Relaxed neutral expression, mouth gently closed, jaw relaxed, eyes open and looking straight into the lens. " + LOOK
    )


def save_png(data: bytes, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    Image.open(io.BytesIO(data)).convert("RGB").save(path, "PNG")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("who", nargs="+", choices=sorted(PEOPLE))
    ap.add_argument("--dry", action="store_true")
    a = ap.parse_args()

    jobs = []
    for who in a.who:
        desc = PEOPLE[who]
        ref = GEN / "refs" / f"{who}.png"
        neu = GEN / "portraits" / who / "neutral.png"
        jobs.append((ref, MODELS.image_ref, PRICES.image_ref, sheet_prompt(desc), [], "16:9"))
        jobs.append((neu, MODELS.image, PRICES.image, neutral_prompt(desc), [ref], "1:1"))
        for ex, p in EDITS.items():
            jobs.append((GEN / "portraits" / who / f"{ex}.png", MODELS.image, PRICES.image, p + EXTRA.get((who, ex), ""), [neu], "1:1"))

    todo = [j for j in jobs if not j[0].exists()]
    est = sum(j[2] for j in todo)
    print(f"{len(todo)} images to make, estimate ${est:.2f}")
    if a.dry:
        for j in todo:
            print(f"\n--- {j[0].relative_to(ROOT)} ({j[1]}, {j[5]})\n{j[3]}")
        return

    from phi_pipeline.providers.media import VertexMedia

    ledger = Ledger(dry=False)
    media = VertexMedia(ledger)
    for path, model, _price, prompt, refs, aspect in todo:
        ref_bytes = []
        for r in refs:
            if not r.exists():
                sys.exit(f"missing {r}, stopping")
            buf = io.BytesIO()
            Image.open(r).convert("RGB").save(buf, "PNG")
            ref_bytes.append(buf.getvalue())
        for attempt in range(3):
            try:
                img = media.image(stage="portraits", prompt=prompt, refs=ref_bytes, model=model, aspect=aspect)
                break
            except Exception as e:  # 429s from the shared project: back off, never hammer
                msg = str(e)
                if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
                    time.sleep(20 * (attempt + 1))
                    continue
                raise
        else:
            sys.exit(f"{path.name}: still rate limited, stopping")
        save_png(img.data, path)
        print(f"saved {path.relative_to(ROOT)}")
        time.sleep(3)
    print(ledger.summary())


if __name__ == "__main__":
    main()
