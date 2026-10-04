# Pipeline → app contract

The pipeline writes; the app reads. Nothing else crosses.

## Files the app loads

```
app/public/content/course.json          the whole course (one file)
app/public/audio/<kind>/<id>/<voice>.<speed>.ogg
app/public/audio/lines/<lineId>/<voice>.<speed>.ogg     dialogue lines
app/public/packs/...                    portraits, scenes, objects, clips (see CAST_SHEET.md)
```

`<kind>` is `item`, `letter`, `pattern`, `example`. `<voice>` is `f1 f2 m1 m2` (Chirp 3 HD) or a cast id / `x1 x2` (Gemini TTS extra voices). `<speed>` is `normal` or `slow`. Audio is OGG Opus, mono.

## course.json

```jsonc
{
  "version": "course-2026-10-xx-<hash>",   // the app reseeds content when this changes
  "generatedAt": "ISO date",
  "courseDays": 60,
  "voices": { "f1": "th-TH-Chirp3-HD-…", "f2": "…", "m1": "…", "m2": "…", "x1": "gemini voice name", "x2": "…" },
  "items":    [Item],       // app/src/content/types.ts Item, status "checked" or "draft"
  "letters":  [Letter],
  "patterns": [Pattern],
  "culture":  [CultureNote],
  "tasks":    [StreetTask], // street tasks and chapters, same shape as src/content/street-seed.ts builds
  "lines":    { "<lineId>": { "thai": "…", "roman": "…", "speaker": "<cast id>|you", "audio": { "nok.normal": "audio/lines/…" } } },
  "checks":   { "<ref>": { "tone": "pass|fail|override", "model": "pass|fail", "words": "pass|fail", "taught": "pass|fail", "stt": "pass|fail", "pitch": 0.0, "agree": 0.0 } }
}
```

Item fields are exactly `src/content/types.ts`:

- `media.audio` keys are `"<voice>.<speed>"` and values are paths relative to `app/public/`, or null.
- `media.pitch` holds one array per syllable: 16 normalised F0 points (0 is the speaker's floor, 1 their ceiling), the median over the four Chirp voices. Unvoiced points are null.
- `status` is `"checked"` when every automatic check passed. `"draft"` items never reach the learner. Status `"checked"` means checked by machine, never by a native speaker.

Romanisation follows the seed set: Paiboon-style, with tone diacritics on each syllable. Mid tone has no mark, low is a grave (à), falling a circumflex (â), high an acute (á), and rising a caron (ǎ). Syllables within a word are joined with `-` and words are separated by spaces; `ʉ` is used for ึ/ื; `bp`, `dt`, `ph`, `th`, `kh` are written as such. `tones[]` has one entry per syllable, in the same order as the romanisation.

## Ids

Item ids are kebab-case English, stable across runs (e.g. `how-much-this`). Line ids are `<taskId>.<nodeId>` or `<taskId>.<nodeId>.<optionIndex>`.
