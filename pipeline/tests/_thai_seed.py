"""Seed items parsed from app/src/content/seed.ts (the hand-written Phase 1-3 placeholders)."""

from __future__ import annotations

import re
import sys
from pathlib import Path

PIPELINE = Path(__file__).resolve().parents[1]
if str(PIPELINE) not in sys.path:
    sys.path.insert(0, str(PIPELINE))

SEED_TS = PIPELINE.parent / "app" / "src" / "content" / "seed.ts"
TONE_LETTERS = {"M": "mid", "L": "low", "F": "falling", "H": "high", "R": "rising"}

_ITEM = re.compile(r"\[\s*'([^']+)',\s*'([^']+)',\s*'([^']+)',\s*'([MLFHR]+)',\s*(?:'[^']*'|\"[^\"]*\"),\s*'(\w+)',\s*\d+(?:,\s*(.*))?\],?\s*$")
_TILE = re.compile(r"tile\('([^']+)',\s*'([^']+)'")
_PLACE = re.compile(r"thaiSign:\s*'([^']+)',\s*signRoman:\s*'([^']+)'")


def seed_items() -> list[dict]:
    items = []
    for line in SEED_TS.read_text(encoding="utf-8").splitlines():
        m = _ITEM.search(line.strip())
        if not m:
            continue
        iid, thai, roman, tones, theme, extra = m.groups()
        item = {"id": iid, "thai": thai, "roman": roman, "tones": [TONE_LETTERS[c] for c in tones], "theme": theme}
        extra = extra or ""
        sp = re.search(r"speaker:\s*'([mf])'", extra)
        if sp:
            item["speaker"] = sp.group(1)
        po = re.search(r"polite:\s*'(\w+)'", extra)
        if po:
            item["polite"] = po.group(1)
        items.append(item)
    return items


def seed_tiles() -> list[tuple[str, str]]:
    text = SEED_TS.read_text(encoding="utf-8")
    return sorted(set(_TILE.findall(text)))


def seed_places() -> list[tuple[str, str]]:
    return _PLACE.findall(SEED_TS.read_text(encoding="utf-8"))
