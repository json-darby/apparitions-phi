#!/bin/bash
# Noticing-you and greeting edits of each approved body base. Same framing, feet fixed.
cd "/c/Users/I_NEE/Desktop/LEARN THAI/phi-project"
PY=pipeline/.venv/Scripts/python
G="pipeline/gen_candidates.py"
KEEP=" Keep the same person, face, hair, clothes, shoes, lighting, black background and camera; the feet stay exactly where they are, at the same size and position in the frame. Photorealistic, natural."
ed() { # who name prompt
  $PY $G generated/bodies/$1/idle.png generated/bodies/$1/$2 1 "Edit this photograph. $3$KEEP" --model ref --aspect 9:16 2>&1 | grep -v AFC
}
TURN="head turned about 45 degrees and shoulders about 20 degrees toward the right side of the picture, eyes looking at someone who has just arrived there,"
ed ton notice "His $TURN chin lifting slightly as if to ask 'where to?'. Arms stay folded."
ed ton greet "His $TURN he unfolds one arm and gestures with an open hand toward the right side of the picture, as if saying 'get in'. The other arm relaxes at his side."
ed ploy notice "Her $TURN a polite welcoming smile, head bowed very slightly. Hands stay clasped at her waist."
ed ploy greet "Her $TURN she makes a Thai wai: both palms pressed together at chest height, fingertips under her chin, with a small respectful bow of the head and a gentle smile."
ed lek notice "His $TURN a cheeky teasing grin. Hands as before."
ed lek greet "His $TURN grinning, he holds the pocket calculator out toward the right side of the picture at chest height, screen facing outward, as if showing a price. Other hand still in his pocket."
ed mai notice "Her $TURN attentive, head tilted slightly, calm small smile. Hands as before holding the box."
ed mai greet "Her $TURN a small polite nod, and her free hand opens gently toward the right side of the picture, palm up, as if asking 'how can I help?'. The other hand still holds the small box."
ed bank notice "His $TURN an easy warm grin. Bottle held as before."
ed bank greet "His $TURN grinning, he raises the beer bottle toward the right side of the picture at head height as if saying 'cheers'."
ed theo notice "His $TURN a slow, cool chin-up nod, eyes half-lidded, easy smile. Relaxed stance and hands as before."
ed theo greet "His $TURN relaxed, he gives a lazy two-finger salute from his brow toward the right side of the picture, easy smile. Other thumb still hooked in his pocket."
ed fah notice "Her head turned to look over her shoulder toward the right side of the picture with a slow, knowing half-smile, shoulders turned slightly that way. Same dress, glass and pose."
ed fah greet "Her $TURN head tilted, a slow half-smile, she raises her glass slightly and curls one finger of her free hand toward herself, beckoning 'come here'. Same dress, tasteful, not explicit."
# 18+ off: Fah with a jacket over the dress, all three poses
for p in idle notice greet; do
  $PY $G generated/bodies/fah/$p.png generated/bodies/fah/$p-jacket 1 "Edit this photograph. She now wears a black cropped leather jacket, worn closed over the dress, covering her shoulders and arms. Everything else unchanged: same pose, face, hands, glass, legs, shoes, lighting, black background and camera, feet in exactly the same place." --model ref --aspect 9:16 2>&1 | grep -v AFC
done
echo EDITS_DONE
