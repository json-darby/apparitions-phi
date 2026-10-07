#!/bin/bash
# Full-body street poses: a base per person (from the approved portrait), then put on black.
cd "/c/Users/I_NEE/Desktop/LEARN THAI/phi-project"
PY=pipeline/.venv/Scripts/python
G="pipeline/gen_candidates.py"
FRAME="seen from head to toe with shoes visible and a little floor below the feet, space above the head, camera at chest height, 50mm lens. Plain even near-black studio background (#0a0a0a) and dark floor, nothing else in the picture. Soft night light from the front with a coloured rim light from one side. Photorealistic, natural skin, real proportions, no text."
gen() { # who rim pose
  $PY $G generated/portraits/$1/neutral.png generated/bodies/$1/idle 1 "Full-length photograph of this exact same person (same face, hair and clothes as in this portrait unless told otherwise), standing, $3 $FRAME The rim light is $2." --model ref --aspect 9:16 2>&1 | grep -v AFC
}
# Nok greet retake
$PY $G generated/bodies/nok/base-a.png generated/bodies/nok/greet2 1 "Edit this photograph. She welcomes a customer on her left (right side of the picture): head and shoulders turned toward the right of the picture, warm smile. Her right hand is raised in front of her at shoulder height, arm extended toward the customer, with the BACK of her hand facing up and the palm facing DOWN toward the floor, fingers together flapping downward toward herself - the Thai and Asian beckoning gesture (not the Western palm-up wave). Her other hand stays at her apron holding the towel. Keep the same woman, face, clothes, towel on the shoulder, shoes, lighting, black background and camera; her feet stay exactly where they are." --model ref --aspect 9:16 2>&1 | grep -v AFC
gen ton "cool blue (#2E9BFF)" "arms folded across his chest, weight on one leg, sunglasses pushed up on his head, patient, facing the camera at a slight three-quarter angle."
gen ploy "cool blue (#2E9BFF)" "upright and poised in her hotel uniform, hands clasped neatly in front of her at the waist, polite calm expression, facing the camera at a slight three-quarter angle."
gen lek "warm amber (#FFB03A)" "loose easy stance, a small pocket calculator held in his right hand at his side, his left hand in his trouser pocket, cheeky half-smile, facing the camera at a slight three-quarter angle."
gen mai "cyan (#2EE6E6)" "calm and composed in her white pharmacist coat, both hands together in front of her holding a small medicine box, facing the camera at a slight three-quarter angle."
gen bank "magenta pink (#FF3C96)" "relaxed, shirt open at the collar, a beer bottle held at chest height in one hand, leaning his weight on one hip, easy grin, facing the camera at a slight three-quarter angle."
gen theo "lime green (#9BE564)" "cool and relaxed, leaning back slightly with his ankles crossed, thumbs hooked in his front pockets, locs tied back, eyes half-lidded, an easy unbothered smile, facing the camera at a slight three-quarter angle."
gen fah "magenta pink (#FF3C96)" "an adult woman in her late twenties dressed for a night out in a short black satin slip dress with thin straps and bare shoulders, heels; weight on one hip, a cocktail glass in one hand, the other hand resting at her collarbone; a confident, alluring, self-possessed look at the camera; tasteful fashion photograph, not explicit; facing the camera at a slight three-quarter angle."
echo BODIES_DONE
