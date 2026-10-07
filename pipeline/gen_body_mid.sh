#!/bin/bash
# Halfway keys for each greeting (edits of the greeting photo, so the head stays put),
# so RIFE only bridges half the move: no smeared arms. Lek's greeting is redone first so
# the calculator stays in the hand that holds it in idle and notice.
cd "/c/Users/I_NEE/Desktop/LEARN THAI/phi-project"
PY=pipeline/.venv/Scripts/python
G="pipeline/gen_candidates.py"
KEEP=" Everything else stays exactly the same: the same person, face, head angle and gaze, expression, clothes, the other arm, legs, feet exactly where they are, lighting, black background, camera and framing. Sharp and natural: no motion blur, no extra hands or fingers. Photorealistic."
$PY $G generated/bodies/lek/notice.png generated/bodies/lek/greet2 1 "Edit this photograph. He raises the calculator in his right hand (the hand on the LEFT side of the picture, which already holds it) up to chest height and holds it out in front of his body toward the right side of the picture, screen facing outward, showing a price, grinning. His other hand stays in his trouser pocket. Keep the same person, cap, face, clothes, legs, feet exactly where they are, lighting, black background, camera and framing. Photorealistic." --model ref --aspect 9:16 2>&1 | grep -v AFC
cp generated/bodies/lek/greet.png generated/bodies/lek/greet-old.png
cp generated/bodies/lek/greet2-a.png generated/bodies/lek/greet.png
mid() { # who suffix prompt
  rm -f generated/bodies/$1/mid$2-a.png
  $PY $G generated/bodies/$1/greet$2.png generated/bodies/$1/mid$2 1 "Edit this photograph to show the same gesture a split second earlier, halfway through the movement: $3$KEEP" --model ref --aspect 9:16 2>&1 | grep -v AFC
}
mid nok "" "the hand that is held out toward the right side of the picture is lower and closer to her body, at waist height just in front of the apron, elbow bent, palm turning upward."
mid ton "" "his arms are partway through unfolding from across his chest: the arm on the right side of the picture is halfway out, forearm in front of his stomach, hand starting to open toward the right; the arm on the left side of the picture is halfway down, its hand near his belt."
mid ploy "" "her palms are pressed together but lower, in front of her lower ribs, rising toward her chest, partway into the wai; her head is upright, only just starting to bow."
mid lek "" "the calculator in his right hand (on the left side of the picture) is halfway up, at stomach height, his elbow bent, moving forward."
mid mai "" "the open hand on the right side of the picture is halfway out: closer to her body, at waist height beside the box, palm turning upward."
mid bank "" "the beer bottle is halfway up: held at shoulder height in the same hand, elbow bent, partway through raising it."
mid theo "" "the hand on the left side of the picture is halfway up: out of his pocket at chest height, fingers starting to straighten, partway to the salute; the other thumb is still hooked in his pocket."
mid fah "" "her free hand (on the right side of the picture) is halfway between her collarbone and the beckoning position, fingers relaxed; the glass in her other hand is halfway between chest height and its raised position."
mid fah "-jacket" "her free hand (on the right side of the picture) is halfway between her collarbone and the beckoning position, fingers relaxed; the glass in her other hand is halfway between chest height and its raised position."
echo MID_DONE
