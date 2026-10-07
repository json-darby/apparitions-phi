# Gemini and Veo prompts: the cast, done properly

These replace the filler faces (made locally with SSD-1B, which is why they look rough).
Run them in Gemini (images) and Veo (clips), save each result under the exact filename
given, then pack with `pipeline/pack_portraits.py` as in `CAST_SHEET.md` steps 5 to 8.

## Why the prompts look like this

The noir look (dark street, haze, coloured edge light) is **added by the app**, by the
dots, the place colour and the tearing. The photo itself must be a clean, sharp, evenly
framed studio portrait, because two models read it before the app does:

- **The depth model** needs the whole head sharp, from the nose to the ears. Shallow
  focus or haze makes faces flat or bumpy when they turn. So: 85 mm, f/8, no haze or smoke.
- **The cut-out model** needs a clean edge against black. So: a faint *white* rim light
  from behind and a plain near-black background. Never coloured light; the app adds colour.
- **The morph between expressions** needs the head in exactly the same place in all six.
  So: make `neutral` first, then **edit** it into the other five rather than generating fresh.

If you only remember one rule: **neutral first, then edit it. Never regenerate a person from scratch.**

## Order of work, per person

1. Run the **reference sheet** prompt. Save it as `generated/refs/<who>.png`. Regenerate until you love the face, because this face is now the person.
2. Start a new Gemini chat. Attach the reference sheet and run the **neutral** prompt. Save as `generated/portraits/<who>/neutral.png`.
3. In the same chat, attach **that neutral image** and run each of the five **edit** prompts. Save each under its filename.
4. Check all six side by side: the eyes should sit at the same height and the shoulders at the same width. Redo any that drifted, again from the neutral image.

Folder layout when finished (48 portraits, 8 sheets):

```
generated/refs/nok.png  ton.png  ploy.png  lek.png  mai.png  bank.png  fah.png  pim.png
generated/portraits/<who>/neutral.png
generated/portraits/<who>/smile.png
generated/portraits/<who>/puzzled.png
generated/portraits/<who>/sad.png
generated/portraits/<who>/closed.png
generated/portraits/<who>/turn.png
```

`<who>` is always lower case: `nok ton ploy lek mai bank fah pim`.

---

## A. The shared portrait look

This text is already included in every neutral prompt below. It is here in case you need it on its own.

> Photorealistic studio portrait photograph, head and shoulders, of an original fictional adult (not based on any real person). Shot on a full-frame camera with an 85 mm lens at f/8, so the whole head is sharp from the tip of the nose to the ears and hair. The person faces the camera straight on, head level, centred. The top of the head sits about 8% below the top edge of the frame; the eyes sit 38% down from the top; the shoulders reach the bottom edge. Plain matte near-black background (#0a0a0a), completely even, with no gradient, vignette, haze or smoke. Lighting: one large soft key light from the front-left, slightly above eye level, giving gentle modelling and a soft shadow on the right cheek. A faint white rim light from behind separates the hair and shoulders from the background. No coloured light, neutral white balance. Real skin texture with visible pores and fine lines, no retouching, no beauty filter, natural matte skin, minimal or no makeup. One small catchlight in each eye. Square 1:1, 2048 × 2048. No text, no watermark, no logos, no jewellery that hangs or moves, no hands in frame, nothing covering the eyes.

---

## B. Reference sheets (one per person, run first)

Use this prompt, swapping in the person's description from section D:

> Character reference sheet photograph of an original fictional adult: **[DESCRIPTION]**. Three photographs side by side on one wide image: front view, three-quarter view turned 40 degrees to their left, and full profile facing left. Head and shoulders in each, identical outfit, hair and expression (relaxed, mouth closed) in all three, all at the same scale and eye height. Plain dark grey studio background, soft even studio lighting, neutral white balance, real skin texture, sharp focus throughout, 85 mm lens, f/8. Photorealistic. No text, labels, borders or watermark. Wide 3:1 frame.

Save as `generated/refs/<who>.png`.

---

## C. The neutral portrait (one per person, attach the reference sheet)

> Match the attached reference sheet exactly: the same face, bone structure, skin, hair and clothing. **[DESCRIPTION]** Relaxed neutral expression, mouth gently closed, jaw relaxed, eyes open and looking straight into the lens. Photorealistic studio portrait photograph, head and shoulders, of an original fictional adult (not based on any real person). Shot on a full-frame camera with an 85 mm lens at f/8, so the whole head is sharp from the tip of the nose to the ears and hair. The person faces the camera straight on, head level, centred. The top of the head sits about 8% below the top edge of the frame; the eyes sit 38% down from the top; the shoulders reach the bottom edge. Plain matte near-black background (#0a0a0a), completely even, with no gradient, vignette, haze or smoke. Lighting: one large soft key light from the front-left, slightly above eye level, giving gentle modelling and a soft shadow on the right cheek. A faint white rim light from behind separates the hair and shoulders from the background. No coloured light, neutral white balance. Real skin texture with visible pores and fine lines, no retouching, no beauty filter, natural matte skin. One small catchlight in each eye. Square 1:1, 2048 × 2048. No text, no watermark, no logos, no hands in frame, nothing covering the eyes.

Save as `generated/portraits/<who>/neutral.png`.

---

## D. The eight people (paste as [DESCRIPTION])

**nok** (food stall, amber)
> A Thai woman in her mid fifties. Round, warm face with deep laugh lines at the eyes and mouth, sun-touched skin, faint freckles on the cheeks. Short, practical, layered black hair with a little grey at the temples, tucked behind her ears. Small gold stud earrings. A faded navy cotton t-shirt under a striped blue-and-white cotton apron tied at the neck. Quick, warm, a little tired.

**ton** (taxi rank, blue)
> A Thai man in his mid forties. Broad, calm face, heavy-lidded patient eyes, light stubble on the jaw, a small scar through the left eyebrow. Short neat black hair with a little grey. Dark sunglasses pushed up on top of his head, resting in the hair. A light blue short-sleeved polo shirt, collar open, slightly creased. Patient, quietly amused.

**ploy** (hotel desk, blue)
> A Thai woman in her mid twenties. Oval face, smooth skin, neat defined eyebrows, composed and precise. Black hair pulled back tightly into a low bun at the nape, no loose strands. Small pearl stud earrings. A fitted dark navy reception uniform jacket with a stand-up mandarin collar and a plain blank brass pin on the lapel.

**lek** (market, amber)
> A Thai man in his early thirties. Lean face, sharp cheekbones, quick teasing eyes, a slight crooked grin at rest, faint stubble. A plain dark grey baseball cap worn forward with no logo, the brim high enough that both eyes and eyebrows are fully visible. Short hair at the sides. A faded grey crew-neck t-shirt.

**mai** (pharmacy, cyan)
> A Thai woman in her mid thirties. Calm oval face, steady kind eyes, a few fine lines at the eyes. Long straight dark hair falling behind her shoulders, a centre parting. A crisp white pharmacist's coat over a pale blue collared blouse, a small plain white name badge with no readable text.

**bank** (bar, pink)
> A Thai man in his late twenties, clearly over 25. Open, friendly face, easy laugh lines, light stubble. Textured short black hair with volume on top, slightly tousled. A dark charcoal short-sleeved shirt open at the collar over a plain black t-shirt.

**fah** (bar, pink)
> A Thai woman in her late twenties, clearly over 25. Short black bob cut level with the jaw, a straight fringe just above the eyebrows. A direct, steady gaze with dry humour in it. Small silver hoop earrings that sit close to the earlobe. A plain black crew-neck t-shirt.

**theo** (cannabis shop, 18+ only; name is a working title)
> A Black man in his late twenties, clearly over 25, a Londoner who has lived in Thailand for a few years. Shoulder-length locs tied back loosely, a couple falling at the temples but never over the eyes. A short neat beard, warm relaxed eyes, an easy half-smile, a small silver stud in his left ear. A plain dark green t-shirt under an open, short-sleeved, light linen shirt. Easy-going, knowledgeable, unhurried.

**pim** (your guide, white)
> A Thai woman in her mid thirties. Relaxed, open face, thoughtful eyes, a few faint freckles. Shoulder-length dark hair tucked behind her right ear, loose on the left. An off-white linen shirt with a soft collar, top button open. Unhurried and friendly.

---

## E. The five edits (attach the neutral image, same chat)

Use these word for word for everyone. Gemini keeps the face and framing when you edit.

**smile.png**
> Edit this photograph. Change only the expression to a warm, natural smile: lips parted slightly showing a little of the top teeth, cheeks lifted, eyes narrowed a little by the smile with soft crinkles at the corners, still looking into the lens. Keep everything else identical: the same person, head position and size in the frame, hair, clothing, lighting, background and camera.

**puzzled.png**
> Edit this photograph. Change only the expression to quizzical and puzzled, not angry and not frowning: the left eyebrow clearly raised high, the right eyebrow level and relaxed, the eyes slightly narrowed, lips closed and pulled a little to one side, as if hearing something odd. Head tilted about 5 degrees. Keep everything else identical: the same person, head position and size in the frame, hair, clothing, lighting, background and camera.

**sad.png**
> Edit this photograph. Change only the expression to quietly sad: the inner ends of the eyebrows raised, the corners of the mouth turned slightly down, the gaze lowered a little below the lens. Keep everything else identical: the same person, head position and size in the frame, hair, clothing, lighting, background and camera.

**closed.png**
> Edit this photograph. Change only the eyes: gently closed, eyelids relaxed as if mid-blink, the face otherwise exactly as it is. Keep everything else identical: the same person, head position and size in the frame, hair, clothing, lighting, background and camera.

**turn.png**
> Edit this photograph. Turn the person's head and shoulders about 30 degrees to their left (toward the right side of the picture), a gentle three-quarter view with both eyes and both cheeks still clearly visible, with the eyes still looking at the lens. The head stays the same size, at the same height in the frame, centred on the same point. Keep the same person, hair, clothing, lighting direction, background and camera.

Person-specific touches (add as an extra sentence when you run that edit):

- nok `smile`: "This is her everyday face at the stall, quick and genuine."
- ton `smile`: "A patient, amused half-smile, mouth closed." `puzzled`: "Squinting slightly, as if he did not catch the address."
- ploy `smile`: "A polite, professional smile, mouth closed."
- lek `puzzled`: "Mock surprise, both eyebrows up, about to haggle."

---

## F. Walking clips for you (Veo)

At the moment the figure you walk on The Street is one still shape that slides. To get a walk that looks real, the dots should follow real movement, the same way the gesture clips do. Make these four clips, with no reference sheet (you are deliberately anonymous):

Common text for all four:

> 8 seconds, one continuous shot, no cuts. Full body, head to feet always in frame, the person about 70% of the frame height. Plain matte near-black background and a near-black floor with a faint reflection, no other objects. One soft key light from the front-left, a faint white rim light from behind. Original fictional adult, not a real person, plain dark clothes: dark trousers, dark long-sleeved top, dark trainers, no logos. Natural, relaxed, realistic human movement, real weight shift, arms swinging naturally. Photorealistic. No text, no music.

| Save as | Add to the common text |
| --- | --- |
| `generated/clips/walk-you-m.mp4` | A Thai man in his thirties walks steadily from left to right at a relaxed pace, seen exactly side-on. The camera tracks sideways alongside him at the same speed, so he stays in the centre of the frame for the whole clip. Locked height, no zoom. |
| `generated/clips/walk-you-f.mp4` | The same shot with a Thai woman in her thirties, shoulder-length hair tied back. |
| `generated/clips/arrive-you-m.mp4` | The same man walks in from the left, seen side-on, slows over his last two steps, stops at the centre of the frame with his weight settling, then turns his head and shoulders toward the camera as if about to speak. The camera does not move. |
| `generated/clips/arrive-you-f.mp4` | The same arrival with the woman. |

For now, just save these. They can't be packed yet: `pack_portraits.py sequence` only accepts the gesture names (palm, wai, handover, glance, walkaway), crops to a square, and The Street doesn't play sequences. Once the clips exist, the pipeline needs to accept `walk` and `arrive` with a tall crop, and The Street needs to play them in place of the sliding figure, looping exactly two steps (near heel down to the same heel down) so the loop never jumps.

---

## Checklist before packing

- [ ] All six of a person line up: eyes at the same height, same head size.
- [ ] Background is flat near-black in every image, no glow behind the head.
- [ ] No coloured light anywhere (the app adds colour).
- [ ] Ears, hair edge and nose all sharp. Blurry ears mean redo it, because the depth will fail there.
- [ ] Nobody looks under 25, and nobody looks like a real person you recognise.
