"""Give every example sentence and pattern tile that only a man would say a
woman's form beside it, so a learner who speaks as a woman reads, builds and
hears her own Thai.

    ผม (phǒm, I)       -> ฉัน (chǎn)
    ครับ (khráp)        -> ค่ะ (khâ), or คะ (khá) after นะ and in a question

The male text stays as it is; each gets `forms: {m, f}` (the same shape as
items and learner lines). Items said by one sex only (`speaker`) keep their
single-sex example: ผม and ครับ are the point of them. Safe to re-run after
`pack` rebuilds the course; it changes nothing that already has its forms.

    pipeline/.venv/Scripts/python.exe pipeline/female_examples.py [--course app/public/content/course.json] [--check]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT))

from phi_pipeline.audio.texts import text_sex  # noqa: E402

COURSE = ROOT.parent / "app" / "public" / "content" / "course.json"
QUESTION_END = ("ไหม", "มั้ย", "หรือ", "เหรอ", "อะไร", "ที่ไหน", "เท่าไร", "เท่าไหร่", "ยังไง", "ไหน", "กี่โมง", "ใคร", "ทำไม")


def female(thai: str, roman: str, en: str) -> tuple[str, str]:
    """The woman's form of a man's sentence (Thai and romanisation)."""
    t, r = thai, roman
    t = t.replace("ผม", "ฉัน")
    r = re.sub(r"\bphǒm\b", "chǎn", r)
    # each ครับ in turn: คะ after นะ or closing a question, ค่ะ otherwise
    out_t, out_r = "", r
    parts = t.split("ครับ")
    for i, part in enumerate(parts[:-1]):
        before = part.rstrip()
        question = i == len(parts) - 2 and not parts[-1].strip() and (en.rstrip().endswith("?") and before.endswith(QUESTION_END))
        soft = before.endswith("นะ") or question
        out_t += part + ("คะ" if soft else "ค่ะ")
        out_r = re.sub(r"\bkhráp\b", "khá" if soft else "khâ", out_r, count=1)
    out_t += parts[-1]
    return out_t, out_r


def tile_female(tile: dict) -> dict | None:
    if tile.get("thai") == "ผม":
        return {"thai": "ฉัน", "roman": "chǎn"}
    return None


def apply(course: dict) -> dict:
    n_ex = n_tiles = 0
    for it in course.get("items", []):
        ex = it.get("example")
        if not ex or it.get("speaker") or text_sex(ex["thai"]) != "m":
            continue
        ft, fr = female(ex["thai"], ex.get("roman", ""), ex.get("en", ""))
        forms = {"m": {"thai": ex["thai"], "roman": ex.get("roman", "")}, "f": {"thai": ft, "roman": fr}}
        if ex.get("forms") != forms:
            ex["forms"] = forms
            n_ex += 1
    for p in course.get("patterns", []):
        for tiles in p.get("examples") or []:
            for tile in tiles:
                f = tile_female(tile)
                if not f:
                    continue
                forms = {"m": {"thai": tile["thai"], "roman": tile.get("roman", "")}, "f": f}
                if tile.get("forms") != forms:
                    tile["forms"] = forms
                    n_tiles += 1
    return {"examples": n_ex, "tiles": n_tiles}


def check(course: dict) -> list[str]:
    """Every female form is a woman's sentence, and nothing of a man's is left in it."""
    bad = []
    for it in course.get("items", []):
        f = ((it.get("example") or {}).get("forms") or {}).get("f")
        if not f:
            continue
        if "ผม" in f["thai"] or "ครับ" in f["thai"] or "phǒm" in f["roman"] or "khráp" in f["roman"]:
            bad.append(f"{it['id']}: man's word left: {f['thai']} / {f['roman']}")
        if text_sex(f["thai"]) == "m":
            bad.append(f"{it['id']}: still reads as a man's sentence: {f['thai']}")
    return bad


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--course", type=Path, default=COURSE)
    ap.add_argument("--check", action="store_true", help="report only; write nothing")
    a = ap.parse_args()
    course = json.loads(a.course.read_text(encoding="utf8"))
    counts = apply(course)
    bad = check(course)
    print(f"female forms: {counts['examples']} examples and {counts['tiles']} tiles {'would change' if a.check else 'written'}; {len(bad)} problems")
    for b in bad:
        print("  ", b)
    if bad:
        raise SystemExit(1)
    if not a.check:
        tmp = a.course.with_suffix(".tmp")
        tmp.write_text(json.dumps(course, ensure_ascii=False, indent=1), encoding="utf8")
        tmp.replace(a.course)


if __name__ == "__main__":
    main()
