"""Assemble course.json (pipeline/CONTRACT.md) from the text stage's state.

Real runs write app/public/content/course.json. Dry runs write
pipeline/work/dry/course.json and can never touch the app, so the app never
loads fake content.

Only content whose every check passed is packed, with status "checked"
(checked by machine, never by a native speaker). Failed and dropped content is
left out of items/patterns/culture/tasks; its check results stay in `checks`.

Media slots start empty. When course.json already exists, media (audio paths,
pitch curves, images) and the audio checks are carried over for every record
whose text did not change, so re-packing after the audio stage loses nothing.

Other stages (audio, voices) use load_course()/save_course() to rewrite the
file; save_course() validates it and recomputes the version, so the app
reseeds whenever anything changes.
"""

from __future__ import annotations

import datetime as _dt
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

from .config import OUT_CONTENT, WORK, course_days
from .text import curriculum as cur
from .text.common import Store, content_hash, empty_media, write_json
from .text.course_schema import validate_course

TEXT_CHECKS = ("shape", "tone", "words", "taught", "endings", "model")


# ---------------------------------------------------------------- files

def course_path(dry: bool = False) -> Path:
    return WORK / "dry" / "course.json" if dry else OUT_CONTENT / "course.json"


def load_course(dry: bool = False) -> dict | None:
    p = course_path(dry)
    if not p.exists():
        return None
    return json.loads(p.read_text(encoding="utf8"))


def compute_version(course: dict) -> str:
    body = {k: v for k, v in course.items() if k not in ("version", "generatedAt")}
    h = hashlib.sha1(json.dumps(body, ensure_ascii=False, sort_keys=True).encode("utf8")).hexdigest()[:10]
    return f"course-{_dt.date.today().isoformat()}-{h}"


def save_course(course: dict, dry: bool = False, validate: bool = True) -> Path:
    """Validate, stamp version and time, and write atomically."""
    if validate:
        errs = validate_course(course)
        if errs:
            raise ValueError("course.json does not match the contract:\n  " + "\n  ".join(errs[:20]))
    course["generatedAt"] = _dt.datetime.now(_dt.timezone.utc).isoformat(timespec="seconds")
    course["version"] = compute_version(course)
    p = course_path(dry)
    write_json(p, course)
    return p


# ---------------------------------------------------------------- assembly

# Checks that apply to each record type (the rest are "skip" by design): culture notes are English prose,
# and a task's tones and words are checked on the items its replies are built from.
APPLIES = {"culture": ("shape", "model"), "task": ("shape", "taught", "model")}


def _passed(rec: dict | None, dry: bool, kind: str = "item") -> bool:
    if not rec or rec.get("status") != "pass":
        return False
    ok = {"pass", "skip"} if dry else {"pass"}
    checks = rec.get("checks", {})
    return all(checks.get(k, "pass" if k != "model" else "fail") in ok for k in APPLIES.get(kind, TEXT_CHECKS))


def _text_key(obj: dict, fields: tuple[str, ...]) -> str:
    return content_hash({k: obj.get(k) for k in fields})


def build_course(dry: bool, days: int | None = None, log=print) -> dict:
    from .text.verify import Verifier  # local: verify imports generate

    days = days or course_days()
    st = Store(dry)
    ver = st.verify()
    v = Verifier(SimpleNamespace(dry=dry, text=None), log=lambda *_: None)

    # items
    items = []
    for it in st.all_items(days):
        if _passed(ver.get(f"item:{it['id']}"), dry):
            items.append({**it, "status": "checked"})
    ids = {i["id"] for i in items}
    for i in items:
        if i.get("classifier") and i["classifier"] not in ids:
            del i["classifier"]
        if i.get("contrasts"):
            i["contrasts"] = [c for c in i["contrasts"] if c in ids]
            if not i["contrasts"]:
                del i["contrasts"]
    items.sort(key=lambda i: (i["day"], i["id"]))

    # letters: hand table, no generated text
    letters = []
    for l in cur.letters():
        if l.day > days:
            continue
        skills = ["read", "write"] if l.cls == "tonemark" else ["read", "write", "hear"]
        letters.append({"id": l.id, "char": l.char, "name": l.name, "keyword": l.keyword, "initial": l.initial,
                        "final": l.final, "cls": l.cls, "day": l.day, "strokes": None, "lookalikes": list(l.lookalikes),
                        "skills": skills, "status": "checked", "media": empty_media(), "nameThai": l.nameThai})

    # patterns
    patterns = []
    for day in range(1, days + 1):
        for pid, pat in st.load_day("patterns", day)["patterns"].items():
            if not _passed(ver.get(f"pattern:{pid}"), dry):
                continue
            examples, _ = v.build_tiles(pat)
            patterns.append({"id": pid, "frame": pat["frame"], "en": pat["en"], "note": pat["note"], "day": day,
                             "examples": examples, "skills": ["read", "say"], "status": "checked", "media": empty_media()})

    # culture
    culture = []
    for cid, n in st.culture()["notes"].items():
        if n["day"] <= days and _passed(ver.get(f"culture:{cid}"), dry, "culture"):
            culture.append({"id": cid, "day": n["day"], "title": n["title"], "body": n["body"],
                            "items": [x for x in n.get("items", []) if x in ids], "status": "checked"})
    culture.sort(key=lambda c: c["day"])

    # tasks and their lines
    tasks, lines = [], {}
    for t in cur.tasks():
        if t.day > days or not _passed(ver.get(f"task:{t.id}"), dry, "task"):
            continue
        task, problems = v.build_task(t.id)
        if not task or problems:
            continue
        used = {x for n in task["nodes"].values() for x in n["items"] + [i for o in n["options"] for i in o["items"]]}
        if not used <= ids:
            log(f"pack: task {t.id} uses unpacked items {sorted(used - ids)}; left out")
            continue
        tasks.append(task)
        for nid, n in task["nodes"].items():
            lines[f"{t.id}.{nid}"] = {"thai": n["thai"], "roman": n["roman"], "en": n["en"], "speaker": n["speaker"],
                                      "audio": {}}
            for i, o in enumerate(n["options"]):
                # learner replies: thai is the male build; forms carry both so each sex is voiced in its own form
                lines[f"{t.id}.{nid}.{i}"] = {"thai": o["thai"], "roman": o["roman"], "en": o["en"], "speaker": "you",
                                              "audio": {}, "forms": o["forms"]}

    # every other phrase a screen plays: item examples, and pattern examples with the tiles joined
    # with no space (as the app's patternThai() does)
    for it in items:
        ex = it.get("example")
        if ex and ex.get("thai"):
            lines[f"example.{it['id']}"] = {"thai": ex["thai"], "roman": ex.get("roman", ""), "en": ex.get("en", ""),
                                            "speaker": "you", "audio": {}}
    for pat in patterns:
        for n, tiles in enumerate(pat["examples"]):
            lines[f"pattern.{pat['id']}.{n}"] = {"thai": "".join(x["thai"] for x in tiles),
                                                 "roman": " ".join(x["roman"] for x in tiles),
                                                 "en": " ".join(x["en"] for x in tiles), "speaker": "you", "audio": {}}

    checks = {}
    for ref, rec in sorted(ver.items()):
        checks[ref] = {**{k: rec.get("checks", {}).get(k) for k in TEXT_CHECKS}, "status": rec.get("status")}

    return {"version": "", "generatedAt": "", "courseDays": 60 if days > 30 else 30, "voices": {},
            "items": items, "letters": letters, "patterns": patterns, "culture": culture, "tasks": tasks,
            "lines": lines, "checks": checks}


def carry_media(new: dict, old: dict | None) -> int:
    """Keep media and audio results for records whose text is unchanged. Returns records carried."""
    if not old:
        return 0
    n = 0
    new["voices"] = old.get("voices", {}) or {}
    for key, fields in (("items", ("thai", "roman", "forms", "example", "polite")), ("letters", ("char", "name", "nameThai")),
                        ("patterns", ("frame", "examples"))):
        before = {r["id"]: r for r in old.get(key, [])}
        for r in new[key]:
            o = before.get(r["id"])
            if o and _text_key(o, fields) == _text_key(r, fields) and o.get("media"):
                r["media"] = o["media"]
                n += 1
                ref = {"items": "item", "letters": "letter", "patterns": "pattern"}[key] + ":" + r["id"]
                for k, val in (old.get("checks", {}).get(ref) or {}).items():
                    if k not in TEXT_CHECKS and k != "status":
                        new["checks"].setdefault(ref, {})[k] = val
    for lid, line in new["lines"].items():
        o = old.get("lines", {}).get(lid)
        if o and o.get("thai") == line["thai"] and o.get("forms") == line.get("forms"):
            line["audio"] = o.get("audio", {})
            if o.get("pitch") is not None:
                line["pitch"] = o["pitch"]
            for k, val in (old.get("checks", {}).get(f"line:{lid}") or {}).items():
                new["checks"].setdefault(f"line:{lid}", {})[k] = val
    # sections other stages add (e.g. the audio stage's toneSets) and their checks are kept as they are
    for k, val in old.items():
        if k not in new:
            new[k] = val
    for ref, val in (old.get("checks") or {}).items():
        if ref.split(":", 1)[0] not in ("item", "pattern", "culture", "task", "letter", "line"):
            new["checks"].setdefault(ref, val)
    return n


def run_pack(providers, args=None, log=print) -> Path:
    dry = providers.dry
    days = course_days()
    course = build_course(dry, days, log=log)
    if not dry:
        # checks that apply to each record type: culture notes are English prose (their Thai words are not
        # tone- or word-checked), and a task's tones and words are checked on the items its replies are
        # built from, so verify marks those "skip" by design. Every other skip is refused.
        bad = [r for r, c in course["checks"].items() if c.get("status") == "pass"
               and any(c.get(k) == "skip" for k in APPLIES.get(r.split(":", 1)[0], TEXT_CHECKS))]
        if bad:
            raise SystemExit(f"pack: {len(bad)} records passed with skipped checks; a real course needs every check run.")
    old = load_course(dry)
    carried = carry_media(course, old)
    # items the audio stage dropped (audio failed twice) stay dropped on every re-pack, unless
    # PHI_REJUDGE_AUDIO=1 (the audio check itself changed): then audio-check judges them again from
    # their existing clips and drops them again if they still fail
    import os

    rejudge = os.environ.get("PHI_REJUDGE_AUDIO") == "1"
    failed = set() if rejudge else {ref.split(":", 1)[1] for ref, c in ((old or {}).get("checks") or {}).items()
                                     if ref.startswith("item:") and isinstance(c, dict) and c.get("audio") == "fail"}
    if failed:
        from .audio.run import drop_items
        dropped, _ = drop_items(course, failed)
        log(f"pack: kept {len(dropped)} item(s) out whose audio failed twice")
    p = save_course(course, dry=dry)
    log(f"pack: {len(course['items'])} items, {len(course['letters'])} letters, {len(course['patterns'])} patterns, "
        f"{len(course['culture'])} notes, {len(course['tasks'])} tasks, {len(course['lines'])} lines "
        f"({carried} with media carried over) -> {p}  [{course['version']}]")
    return p
