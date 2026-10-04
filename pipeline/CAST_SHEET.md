# Phi cast sheet and asset pipeline

This is the owner's run sheet for Phase 3 assets: who the eight people are, the
prompts to run in Gemini (images) and Veo (clips), and how to turn the results
into the packs the app loads. Until a pack exists, the app draws a code-made
stand-in for every person, clip, scene and object, so nothing here blocks the build.

## Rules for every prompt

- Every person is **original, fictional and clearly an adult**. No prompt names,
  describes or is "in the style of" a real person, celebrity, influencer or
  public figure. Never attach a photo of a real person, including yourself.
- People are shown in **clothed, everyday social situations** only, bar scenes included.
- Everything generated is credited in the app as **AI-generated** (the manifest
  carries the credit line; the catalogue and the cast page show it).
- No real brand names, logos, shop names or legible text other than the Thai
  sign words given below. No real banknote designs (Thai notes carry a real
  person's portrait), so the banknote is an invented design.
- Keep the files in `phi-project/generated/` (not in the app) and only the packed
  output in `app/public/packs/`.

## The shared look (paste into every portrait prompt)

> Photorealistic head-and-shoulders portrait of an original, fictional adult
> Thai person (not based on any real person). Facing the camera, centred, the top
> of the head about 8% below the top edge, shoulders reaching the bottom edge.
> Plain near-black background (#0a0a0a), no gradient, nothing behind them.
> One soft key light from the front, slightly left and above, gentle fill, no
> coloured light, no rim glow. Neutral colour grade, sharp focus on the eyes,
> natural skin texture. Square 1:1, 1024 x 1024. No text, no watermark, no hands
> in frame, no hat brim or hair covering the eyes (unless the person's look says so).

Same framing and lighting in all six portraits of a person matters more than
anything else: the dots morph between them, so the head must stay in place.

## Expression lines (one portrait each, six per person)

| File | Add to the prompt |
| --- | --- |
| `neutral.png` | Relaxed neutral expression, mouth closed, eyes open looking straight into the lens. |
| `smile.png` | Warm natural smile, lips parted slightly, eyes narrowed a little by the smile, looking into the lens. |
| `puzzled.png` | Puzzled: one eyebrow raised, the other lowered, mouth pulled slightly to one side, head tilted a few degrees. |
| `sad.png` | Quietly sad: inner ends of the eyebrows raised, mouth corners turned down, gaze lowered slightly. |
| `closed.png` | Eyes gently closed, face relaxed, mouth closed, as if mid-blink. (Also used for blinking.) |
| `turn.png` | Three-quarter view: head and shoulders turned about 40 degrees to the person's left (toward the right of the picture), eyes to the camera. |

## The eight people

Each block gives the description (used in every prompt for that person), the
reference-sheet prompt (run once, first), and the six portrait prompts (shared
look + description + expression line + "Match the attached reference sheet
exactly: same face, hair, clothing").

### Nok - food vendor, 50s (amber, food stall)

**Description:** Thai woman in her mid fifties, round warm face with laugh lines,
short practical layered black hair with a little grey at the temples, small gold
stud earrings, a faded navy t-shirt under a striped cotton apron, quick and warm.

**Reference sheet:** Character reference sheet of an original fictional adult:
[description]. Three views side by side - front, three-quarter, profile - head and
shoulders, plain dark grey background, even studio lighting, same outfit in all
views, photorealistic, no text or labels.

**Portraits (6):**
1. [shared look] [description] Relaxed neutral expression, mouth closed, eyes open looking straight into the lens. Match the attached reference sheet exactly.
2. ... Warm natural smile (her usual face at the stall), eyes crinkling. Match the attached reference sheet exactly.
3. ... Puzzled: one eyebrow raised, mouth pulled to one side, head tilted. Match the reference.
4. ... Quietly sad: inner eyebrows raised, mouth corners down, gaze lowered. Match the reference.
5. ... Eyes gently closed, relaxed. Match the reference.
6. ... Three-quarter view, turned about 40 degrees to her left, eyes to camera. Match the reference.

### Ton - taxi driver, 40s (blue, taxi rank)

**Description:** Thai man in his mid forties, broad calm face, short neat black
hair, dark sunglasses pushed up onto the top of his head, light blue polo shirt
with the collar open, a patient half-smile at rest, slight stubble.

**Reference sheet** and **portraits:** as for Nok, with this description. For the
smile: "a patient, amused smile". For puzzled: "squinting slightly, as if he
did not catch the address".

### Ploy - hotel receptionist, 20s (blue, hotel desk)

**Description:** Thai woman in her mid twenties, oval face, black hair pulled
neatly back into a low bun, small pearl earrings, a fitted dark navy reception
uniform jacket with a mandarin (stand) collar, composed and precise.

**Notes:** For the smile, "a polite professional smile". Her wai clip (below)
uses the same uniform.

### Lek - market trader, 30s (amber, market)

**Description:** Thai man in his early thirties, lean face, quick teasing eyes,
a plain dark baseball cap worn forward (no logo), short hair at the sides, a
faded grey t-shirt, a cheeky grin at rest.

**Notes:** The cap brim must not hide the eyes. For puzzled: "mock surprise,
eyebrows up, about to haggle".

### Mai - pharmacist, 30s (cyan, pharmacy)

**Description:** Thai woman in her mid thirties, calm oval face, long straight
dark hair falling behind her shoulders, a white pharmacist's coat over a pale
blue blouse, a small plain name badge with no readable text, calm and kind.

### Bank - bar regular, late 20s (pink, bar)

**Description:** Thai man in his late twenties, open friendly face, textured
short hair with volume on top, a dark short-sleeved shirt open at the collar
over a plain tee, an easy laugh. Adult, clearly over 25.

### Fah - bar regular, late 20s (pink, bar)

**Description:** Thai woman in her late twenties, short black bob with a
straight fringe, direct steady gaze, a plain black t-shirt, small silver hoop
earrings, dry humour in the eyes. Adult, clearly over 25.

**Notes:** Fah is the person in "palm on the glass" and the default walk-away,
so make her reference sheet first among the bar cast.

### Pim - guide and narrator, 30s (white, everywhere)

**Description:** Thai woman in her mid thirties, relaxed face, shoulder-length
dark hair tucked behind one ear, an off-white linen shirt with a soft collar,
unhurried and friendly.

## Gesture clips (Veo, about 8 clips)

Common to every clip prompt:

> 6 to 8 seconds, one continuous shot, locked-off camera, no cuts, no camera
> movement. Medium close-up (head and upper body), plain near-black background,
> one soft key light from the front-left. Slow, deliberate movement. The person
> matches the attached reference sheet exactly. Original fictional adult, not a
> real person. No text, no music needed.

| Clip | Pack name | Person | Prompt (after the common text) |
| --- | --- | --- | --- |
| Palm on the glass | `palm` | Fah | She looks straight into the lens, her face slowly falls, she raises her right palm and presses it flat against the camera lens as if against glass, holds, then lowers her eyes. Ends with her palm still filling part of the frame. |
| Wai | `wai` | Ploy | She brings her palms together at her chest, fingertips near her chin, and bows her head in a polite wai, then rises with a small smile. |
| Wai (guide) | `wai-pim` | Pim | Same wai, warmer and less formal, a friendly smile after. |
| Hand-over (food) | `handover` | Nok | She holds out a plastic takeaway bag with a food box toward the lens, arm extending until the bag fills the lower half of the frame, smiling. |
| Hand-over (market) | `handover-lek` | Lek | He hands a folded shirt in a paper bag toward the lens with a grin. |
| Driver's glance | `glance` | Ton | Filmed from the back seat of a car at night: we see the back of his head and the headrest; he turns his head over his left shoulder to look back at the lens, says a short line, turns back to the road. Blurred street lights through the windscreen. |
| Walk-away | `walkaway` | Fah | Full figure. She looks at the lens, turns away and walks slowly into darkness until she is small and gone. |
| Walk-away (bar) | `walkaway-bank` | Bank | Same, he turns with a shrug and walks off into the dark. |

Packing: 10 stills a second (8 to 12 is fine), so an 8 s clip is about 80 stills.

## Street scenes (Gemini images, 6)

> Night street scene in a Bangkok side street, eye level, wide 16:10 frame, wet tarmac
> reflecting lights, tangled overhead power lines, warm practical lights only, no
> people (or only distant blurred shapes with no faces), no brand names, no
> readable text except the Thai sign word given. Photorealistic, high contrast,
> deep black shadows, 1600 x 1000.

| Pack id | Add |
| --- | --- |
| `food` | A street-food cart with a glass case lit from inside, a striped awning, a string of bare bulbs, steam rising from a wok, red plastic stools. Sign reads ร้านอาหาร. |
| `taxi` | A taxi rank at the kerb, one taxi with a roof light, a pole sign, a street lamp cone of light. Sign reads แท็กซี่. |
| `hotel` | A small hotel entrance with glass doors glowing, a canopy, potted plants either side, a lit sign reading โรงแรม. |
| `market` | Night market stalls under parasols with hanging bulbs, racks of folded shirts, a lit sign reading ตลาด. |
| `bar` | A small open-front bar, neon outline strip, a counter with stools, shelves of unlabeled bottles, a sign reading บาร์. Clothed, relaxed, no people in focus. |
| `pharmacy` | A pharmacy shopfront with lit shelves behind glass and a glowing cross sign, a sign reading ร้านขายยา. |

## Objects (Gemini images, start with these 7, about 30 later)

> Single object centred on a plain near-black background, seen from slightly
> above, soft key light, no hands, no text, no logos, photorealistic, 1024 x 1024.

| Pack id | Object |
| --- | --- |
| `dish` | A plate of Thai fried rice with cucumber slices and a lime wedge. |
| `tuktuk` | A Thai tuk-tuk (auto rickshaw), three-quarter view, no logos or plates. |
| `temple` | The tiered roof of a Thai temple with curved gable finials (chofa), against the black. |
| `banknote` | An invented paper banknote with abstract guilloche patterns, a lotus emblem and the numeral 100, **no portrait and not a real currency design**. |
| `bottle` | A plain plastic water bottle with a blank label. |
| `ice` | A glass of tube ice (cylinders with a hole through the middle). |
| `stall` | A small market stall table under a parasol with hanging bulbs. |

Fact screens pass free text ("A plate of fried rice"); the app maps it to these
ids by keyword (see `objectKind` in `app/src/anim/packs.ts`).

## Step by step on the PC

1. **Tools (free):** Python 3.10+, then `pip install pillow numpy onnxruntime`.
   Download the MiDaS v2.1 small depth model (MIT licence) to
   `phi-project/models/model-small.onnx` from
   https://github.com/isl-org/MiDaS/releases/tag/v2_1 . Install ffmpeg and put it on PATH.
2. **Reference sheets:** for each person, run the reference-sheet prompt. Save as
   `generated/refs/<who>.png`. Pick the one you like; this is now the identity.
3. **Portraits:** run the six portrait prompts with the reference sheet attached.
   Save as `generated/portraits/<who>/<expression>.png`
   (`neutral smile puzzled sad closed turn`). `generated/portraits/<who>_<expression>.png` also works.
4. **Check faces against the reference (plan step 3):** use a free face-matching
   library, e.g. `pip install face_recognition` (needs dlib) and compare each
   portrait's face encoding with the reference: distance above about 0.6 means
   "not the same person", regenerate it. (Check the licence of whichever model
   you use; this is a personal tool.) Also eyeball that the head sits in the same
   place in all six; regenerate any that drift.
5. **Pack the portraits:**
   `python pipeline/pack_portraits.py portraits --src generated/portraits`
   Writes `app/public/packs/<who>/<expression>.webp` and `.depth.webp` and
   updates `manifest.json`. Missing expressions fall back to neutral in the app.
6. **Clips:** generate each clip with the person's reference sheet attached, save
   as `generated/clips/<name>.mp4`, then e.g.
   `python pipeline/pack_portraits.py sequence --name palm --who fah --video generated/clips/palm.mp4 --linger near`
   `python pipeline/pack_portraits.py sequence --name handover-lek --who lek --video generated/clips/handover-lek.mp4`
   Use `--fps 8` to `--fps 12`, `--key-frame N` to choose the still shown with
   reduced motion, `--end-fade 0` if the clip already ends empty.
7. **Scenes and objects:**
   `python pipeline/pack_portraits.py still --kind scenes --id food --src generated/scenes/food.png --size 384x240`
   `python pipeline/pack_portraits.py still --kind objects --id dish --src generated/objects/dish.png`
8. **Check:** `python pipeline/pack_portraits.py check` lists what is packed and
   what is still a code-drawn stand-in, with the total size. Then open the app
   at `/#/anim`, press **Reload packs**, and go through every row on phone and
   desktop (including **Still fallback**).
9. If you delete files by hand, run `python pipeline/pack_portraits.py manifest`
   to rebuild the manifest from what is on disk.

`--midas none` runs the whole pipeline with a rough stand-in depth, for testing only.

**Accurate depth (default for portraits, objects and scenes, `--depth dav2`).** In the
pipeline venv: `pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision`
and `pip install transformers timm kornia einops opencv-contrib-python scipy mediapipe`.
The free models download once into `pipeline/work/models/` (git-ignored): Depth Anything V2
Small (Apache-2.0), BiRefNet and BiRefNet-portrait (MIT), MediaPipe Face Landmarker and the
canonical face model (Apache-2.0); MiDaS small (MIT) is only the fallback. See `phi_depth.py`
for the method: 518 + 1022 px passes with flip averaging, a BiRefNet cut-out, guided-filter
edges, metric calibration (faces against a posed anatomical face template, objects by a
shape prior with `--extent`, scenes linear in disparity), an inverse-perspective pre-warp so
the cloud at rest matches the photo, and sanity checks that reject inverted, flat or noisy
maps (logged to `pipeline/work/depth_log.json`). `python pipeline/phi_depth.py selftest IMG`
proves the checks reject corrupted depth. `--depth midas` keeps the old path. Clips still use
MiDaS. Filler cast portraits are AI-generated locally by `pipeline/gen_cast.py` (free open
weights: SSD-1B, Apache-2.0, with the LCM-SSD-1B UNet, OpenRAIL++-M; CPU, about a minute
each; fictional people only, prompts from the descriptions above). Filler scenes and objects
found online are listed in `pipeline/filler_spec.json`. `pipeline/filler_packs.py` packs both; they set `"filler": true` in the manifest and are listed in
`packs/credits.json` (Settings > About > Image credits), and must be replaced before
anything is published.

## Pack format (what the app reads)

Everything lives under `app/public/packs/` and is cached for offline use by the
service worker (`.webp` and `.json` are in its precache patterns).

```
manifest.json
<who>/<expression>.webp          256 x 256, grey brightness in RGB, alpha = matte
<who>/<expression>.depth.webp    256 x 256, grey depth, white = near
seq/<name>.webp                  frame atlas, cols x rows tiles (192 x 192), row-major from top-left, alpha = matte
seq/<name>.depth.webp            matching depth atlas
objects/<id>.webp + .depth.webp
scenes/<place>.webp + .depth.webp  (e.g. 384 x 240, no matte)
```

`manifest.json`:

```json
{
  "version": 1,
  "credit": "AI-generated (image model), depth by MiDaS. Not real people.",
  "people": {
    "nok": {
      "credit": "AI-generated ...",
      "depth": { "offset": 0.6, "scale": 0.9 },
      "expressions": { "neutral": { "image": "nok/neutral.webp", "depth": "nok/neutral.depth.webp" } }
    }
  },
  "sequences": {
    "palm": { "image": "seq/palm.webp", "depth": "seq/palm.depth.webp", "who": "fah", "fps": 10,
              "frames": 80, "cols": 10, "rows": 8, "tile": [192, 192],
              "depth_map": { "offset": 0.6, "scale": 0.9 }, "key_frame": 48,
              "linger": "near", "end_fade": 0.6, "credit": "..." }
  },
  "objects": { "dish": { "image": "objects/dish.webp", "depth": "objects/dish.depth.webp", "size": [256, 256] } },
  "scenes":  { "food": { "image": "scenes/food.webp", "depth": "scenes/food.depth.webp", "size": [384, 240] } }
}
```

- With `--depth dav2` the depth grey is linear in metric depth (scenes: linear in
  disparity) and `offset`/`scale` are computed, not tuned: z = 0 is the turn pivot
  (about 80 mm behind the eyes for a face) and one unit is the frame's half-height.
- Depth becomes dot depth as `z = (depth - offset) * scale`; raise `scale` for a
  stronger 3D turn, lower it if faces look stretched when they turn.
- `linger: "near"` makes the nearest dots (a hand on the glass) outlast the rest
  when the clip dissolves. `end_fade` (0..1) dissolves the end of the clip.
- A clip named `<name>-<who>` (e.g. `handover-lek`) is used when that person
  plays the sequence; otherwise `<name>`.
- Paths are relative to `packs/`; anything with `..` or a URL scheme is ignored.

Sizes: a portrait pair is roughly 10 to 25 KB; an 80-still clip roughly 0.5 to
1.5 MB; all 48 portraits plus 8 clips plus scenes and objects come to roughly
10 to 15 MB.
