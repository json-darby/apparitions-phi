"""The shape of course.json, mirroring app/src/content/types.ts and
pipeline/CONTRACT.md, with a tiny JSON-schema validator (no dependency).

Items, letters, patterns and culture notes are closed (no extra keys), so a
field the app does not know about cannot slip in. Tasks and lines are open:
the pipeline adds `say`/`end`/`forms` beside the built fields so the app can
rebuild learner lines for either speaking identity.
"""

from __future__ import annotations

TONES = ["mid", "low", "falling", "high", "rising"]
SKILLS = ["hear", "say", "read", "write", "tone"]
THEMES = ["greetings", "verbs", "questions", "numbers", "classifiers", "food", "ordering", "shopping", "directions",
          "hotel", "time", "people", "feelings", "health", "nightlife", "cannabis", "signs", "linking", "tonepairs"]
PLACES = ["food", "taxi", "hotel", "market", "bar", "pharmacy"]
STATUS = ["placeholder", "draft", "checked"]

STR = {"type": "string"}
INT = {"type": "integer"}
NUM = {"type": "number"}
BOOL = {"type": "boolean"}
NULLSTR = {"type": ["string", "null"]}
STRS = {"type": "array", "items": STR}
SKILL_LIST = {"type": "array", "items": {"enum": SKILLS}}
TONE_LIST = {"type": "array", "items": {"enum": TONES}}


def closed(props: dict, required: list[str]) -> dict:
    return {"type": "object", "properties": props, "required": required, "additionalProperties": False}


MEDIA = closed({
    "audio": {"type": "object", "additionalProperties": NULLSTR},
    "pitch": {"type": ["array", "null"], "items": {"type": "array", "items": {"type": ["number", "null"]}}},
    "image": NULLSTR,
    "animation": NULLSTR,
}, ["audio", "pitch", "image", "animation"])

FORM = closed({"thai": STR, "roman": STR}, ["thai", "roman"])

ITEM = closed({
    "id": STR, "kind": {"enum": ["word", "phrase"]}, "thai": STR, "roman": STR, "tones": TONE_LIST, "en": STR,
    "theme": {"enum": THEMES}, "day": INT, "polite": {"enum": ["statement", "question"]}, "speaker": {"enum": ["m", "f"]},
    "forms": closed({"m": FORM, "f": FORM}, ["m", "f"]), "hook": STR,
    "example": closed({"thai": STR, "roman": STR, "en": STR}, ["thai", "roman", "en"]),
    "classifier": STR, "contrasts": STRS, "survival": BOOL, "adult": BOOL, "skills": SKILL_LIST, "tags": STRS,
    "status": {"enum": STATUS}, "media": MEDIA,
}, ["id", "kind", "thai", "roman", "tones", "en", "theme", "day", "survival", "skills", "tags", "status", "media"])

LETTER = closed({
    "id": STR, "char": STR, "name": STR, "keyword": STR, "initial": STR, "final": NULLSTR,
    "cls": {"enum": ["mid", "high", "low", "vowel", "tonemark"]}, "day": INT,
    "strokes": {"type": ["array", "null"], "items": closed({"d": STR}, ["d"])},
    "lookalikes": STRS, "skills": SKILL_LIST, "status": {"enum": STATUS}, "media": MEDIA,
    "nameThai": STR,  # pipeline extra: the Thai-script name the audio stage voices (the app ignores it)
}, ["id", "char", "name", "keyword", "initial", "final", "cls", "day", "strokes", "lookalikes", "skills", "status", "media"])

TILE = closed({"thai": STR, "roman": STR, "en": STR, "slot": BOOL}, ["thai", "roman", "en"])
PATTERN = closed({
    "id": STR, "frame": STR, "en": STR, "note": STR, "day": INT,
    "examples": {"type": "array", "items": {"type": "array", "items": TILE}},
    "skills": SKILL_LIST, "status": {"enum": STATUS}, "media": MEDIA,
}, ["id", "frame", "en", "note", "day", "examples", "skills", "status", "media"])

CULTURE = closed({"id": STR, "day": INT, "title": STR, "body": STR, "items": STRS, "status": {"enum": STATUS}},
                 ["id", "day", "title", "body", "items", "status"])

OPTION = {"type": "object", "required": ["items", "thai", "roman", "en", "next"], "properties": {
    "items": STRS, "thai": STR, "roman": STR, "en": STR, "next": NULLSTR, "rep": NUM, "baht": NUM, "comfort": NUM,
    "correct": BOOL, "feedback": STR, "tones": TONE_LIST,
}}
NODE = {"type": "object", "required": ["id", "speaker", "thai", "roman", "en", "options"], "properties": {
    "id": STR, "speaker": STR, "thai": STR, "roman": STR, "en": STR, "stage": STR,
    "expression": {"enum": ["neutral", "smile", "puzzled", "sad"]}, "options": {"type": "array", "items": OPTION},
    "step": INT, "items": STRS, "tones": TONE_LIST, "heard": STRS,
}}
TASK = {"type": "object", "required": ["id", "title", "place", "person", "day", "reward", "steps", "start", "nodes"], "properties": {
    "id": STR, "title": STR, "place": {"enum": PLACES}, "person": STR, "day": INT,
    "reward": closed({"baht": NUM, "rep": NUM}, ["baht", "rep"]), "steps": STRS, "start": STR,
    "nodes": {"type": "object", "additionalProperties": NODE}, "adult": BOOL,
    "chapter": {"enum": ["meters-running", "after-hours", "door-to-door"]},
}}

CHECK = {"type": "object", "additionalProperties": {"type": ["string", "number", "null"]}}

COURSE = {"type": "object", "required": ["version", "generatedAt", "courseDays", "voices", "items", "letters", "patterns",
                                         "culture", "tasks", "lines", "checks"], "properties": {
    "version": STR, "generatedAt": STR, "courseDays": {"enum": [30, 60]},
    "voices": {"type": "object", "additionalProperties": NULLSTR},
    "items": {"type": "array", "items": ITEM}, "letters": {"type": "array", "items": LETTER},
    "patterns": {"type": "array", "items": PATTERN}, "culture": {"type": "array", "items": CULTURE},
    "tasks": {"type": "array", "items": TASK},
    "lines": {"type": "object", "additionalProperties": {"type": "object", "required": ["thai", "roman", "speaker", "audio"],
                                                         "properties": {"thai": STR, "roman": STR, "en": STR, "speaker": STR,
                                                                        "audio": {"type": "object", "additionalProperties": NULLSTR}}}},
    "checks": {"type": "object", "additionalProperties": CHECK},
}}

_PY = {"string": str, "integer": int, "number": (int, float), "boolean": bool, "array": list, "object": dict, "null": type(None)}


def _type_ok(v, t) -> bool:
    ts = t if isinstance(t, list) else [t]
    for x in ts:
        if x in ("integer", "number") and isinstance(v, bool):
            continue
        if isinstance(v, _PY[x]):
            return True
    return False


def validate(value, schema: dict, path: str = "$", errors: list[str] | None = None, limit: int = 50) -> list[str]:
    errors = [] if errors is None else errors
    if len(errors) >= limit:
        return errors
    if "enum" in schema and value not in schema["enum"]:
        errors.append(f"{path}: {value!r} not in {schema['enum']}")
        return errors
    if "type" in schema and not _type_ok(value, schema["type"]):
        errors.append(f"{path}: expected {schema['type']}, got {type(value).__name__}")
        return errors
    if isinstance(value, dict):
        props = schema.get("properties", {})
        for k in schema.get("required", []):
            if k not in value:
                errors.append(f"{path}: missing {k}")
        extra = schema.get("additionalProperties", True)
        for k, v in value.items():
            if k in props:
                validate(v, props[k], f"{path}.{k}", errors, limit)
            elif extra is False:
                errors.append(f"{path}: unexpected key {k}")
            elif isinstance(extra, dict):
                validate(v, extra, f"{path}.{k}", errors, limit)
    elif isinstance(value, list) and "items" in schema:
        for i, v in enumerate(value):
            validate(v, schema["items"], f"{path}[{i}]", errors, limit)
    return errors


def validate_course(course: dict) -> list[str]:
    errs = validate(course, COURSE)
    # cross-references the app relies on
    item_ids = {i["id"] for i in course.get("items", [])}
    if len(item_ids) != len(course.get("items", [])):
        errs.append("$.items: duplicate ids")
    for i in course.get("items", []):
        if i.get("status") != "checked":
            errs.append(f"item {i.get('id')}: status {i.get('status')} in the packed course")
        if len(i.get("tones", [])) != len([s for s in i.get("roman", "").replace("-", " ").split() if s]):
            errs.append(f"item {i.get('id')}: tones and syllables differ")
        for ref in (i.get("contrasts") or []) + ([i["classifier"]] if i.get("classifier") else []):
            if ref not in item_ids:
                errs.append(f"item {i['id']}: refers to missing item {ref}")
    for t in course.get("tasks", []):
        if t.get("start") not in t.get("nodes", {}):
            errs.append(f"task {t.get('id')}: start node missing")
        for n in t.get("nodes", {}).values():
            for o in n.get("options", []):
                for ref in o.get("items", []):
                    if ref not in item_ids:
                        errs.append(f"task {t['id']}.{n['id']}: uses missing item {ref}")
    return errs[:100]
