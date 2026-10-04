"""Day-by-day course-text generation with Gemini (through providers.text).

Order (the spine's order): for each day, that day's items, then its patterns
(which may use the day's items). Then the culture notes, in batches. Then the
Street task scripts, which are composed only from item ids already taught by the
task's day, so every line is built from taught words by construction.

Letters are not generated: they come from the hand table in curriculum.py.

Resume: everything is kept in work/text/ (work/dry/text/ for dry runs). A run
generates only what is missing; a failed call leaves its piece missing and the
next run retries it. `verify` asks for regenerations of single items, patterns,
notes or tasks with the problems found, through the same functions here.
"""

from __future__ import annotations

import json
from dataclasses import asdict

from ..config import MODELS, course_days
from ..providers.text import request_block
from . import curriculum as cur
from .common import CAST, ENDING_IDS, NPC_SEX, TONES, Store, shape_item

# ---------------------------------------------------------------- shared prompt text

ROMANISATION = """ROMANISATION (Paiboon-style, the convention used across this course):
- Mark the tone on the vowel of EVERY syllable: mid = no mark (gaa), low = grave (gàa), falling = circumflex (gâa), high = acute (gáa), rising = caron (gǎa).
- Join the syllables of one word with "-" and separate words with spaces: ขอบคุณ khàwp-khun; อันนี้เท่าไหร่ an-níi thâo-rài.
- Long vowels are doubled: aa ii uu ee oo ʉʉ; short vowels single. แ = ae, ออ/-อ- = aw, เ-อ = əə, ึ/ื = ʉ/ʉʉ, เ-ีย = ia, เ-ือ = ʉa, -ัว = ua, ไ/ใ = ai, เ-า = ao, -ำ = am.
- Initials: ก g, ข/ค/ฆ kh, จ j, ฉ/ช/ฌ ch, ด/ฎ d, ต/ฏ dt, ถ/ท/ธ/ฐ th, บ b, ป bp, ผ/พ/ภ ph, ฝ/ฟ f, ง ng, ซ/ส/ศ/ษ s, ห/ฮ h. Finals are k, t, p, ng, n, m, i (ย), w or o (ว).
- `tones` has exactly one entry per syllable of `roman`, in order, and must agree with the diacritics.
- Examples: สวัสดี sà-wàt-dii [low, low, mid]; ไม่เป็นไร mâi-bpen-rai [falling, mid, mid]; น้ำแข็ง nám-khǎeng [high, rising]; เท่าไหร่ thâo-rài [falling, low]."""

ENDINGS = """POLITE ENDINGS AND SPEAKERS:
- ครับ (khráp) is said by male speakers after statements and questions. ค่ะ (khâ, falling) is said by female speakers after statements and answers. คะ (khá, high) is said by female speakers after questions and after นะ (นะคะ, never นะค่ะ).
- Never put ครับ, ค่ะ or คะ inside an item's `thai` (except the three items that ARE the endings). Instead set `polite` to "statement" or "question" when a learner would add the ending when saying the item to someone; the app adds the right ending for the learner's own identity. Use "none" for bare words.
- I: male speakers say ผม (phǒm), female speakers say ฉัน (chǎn). Do not use ดิฉัน except where the entry asks for the formal form: it is far too stiff for a bar, a market, a taxi or friends. Never mix male and female forms for one speaker.
- If an item's words differ by speaker (it contains "I" or another gendered word), give `forms.m` and `forms.f` (thai and roman), and set `thai`/`roman` to the male form. Otherwise omit `forms`.
- `speaker` is "m" or "f" only for words said exclusively by one sex (ผม, ครับ, ฉัน, ค่ะ, คะ, ดิฉัน); otherwise "none"."""

REGISTER = """REGISTER AND CONTENT:
- Everyday spoken Bangkok Thai that a polite adult visitor uses with staff, drivers, vendors and new acquaintances: polite and warm, not stiff, not textbook-formal, no crude slang. Standard spelling only (no chat spellings such as ค่า for ค่ะ).
- The learner is an adult English speaker. Everyone in this course is an adult. Nightlife and dating language stays non-explicit and consent-forward: asking first, accepting a no gracefully. Cannabis-shop language is talk only: questions about rules, never advice on obtaining or using anything.
- Use no real people, brands or places that could date or mislead; generic places are fine (the hotel, the pier, the station).
- Everything you write must be your own original wording. Do not reproduce material from any course, app, book or website."""

HOOKS = """HOOKS: one short, original memory hook in English (at most 18 words) linking the sound of the romanisation to the meaning. Dry adult humour is fine; nothing crude. Do not reuse mnemonics from other courses."""

EXAMPLES = """EXAMPLE SENTENCE: one short natural sentence (2 to 9 words) that uses the item and otherwise ONLY words from the KNOWN list or from TODAY's entries. Do not add polite endings to examples. If the sentence needs "I", use ผม. Give thai, roman (same convention) and a plain English translation.
- Write the Thai the Thai way: no spaces between words. A space goes only between two phrases or sentences (e.g. สวัสดี ยินดีที่ได้รู้จัก).
- It must be something a person would really say in a real situation on a trip. Never a filler or tautology such as ผมเป็นผม ("I am me") or ผมเป็นคุณ ("I am you"); if the known words cannot make a real sentence, use the shortest real phrase instead (e.g. ขอบคุณครับ).
- The English is a faithful translation of the Thai: add nothing that is not there (ครับ and ค่ะ are politeness, never "sir" or "madam").
- For an entry only one sex says (speaker m or f), the example is said by that sex (ฉัน and ค่ะ/คะ for f, ผม and ครับ for m)."""


def system_prompt() -> str:
    return "\n\n".join([
        "You write the Thai content of Phi, a 30-to-60-day Thai course for one adult English speaker travelling to Thailand. "
        "Accuracy matters more than flair: every word is checked automatically for spelling, real-word status, taught-words-only and the agreement of spelling, tone diacritics and tones. "
        "Answer only with JSON matching the schema.",
        ROMANISATION, ENDINGS, REGISTER,
    ])


# ---------------------------------------------------------------- schemas

def _obj(props: dict, required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required if required is not None else list(props)}


S = {"type": "string"}
FORM = _obj({"thai": S, "roman": S})
TONE_LIST = {"type": "array", "items": {"type": "string", "enum": TONES}}

ITEMS_SCHEMA = _obj({"items": {"type": "array", "items": _obj({
    "id": S, "thai": S, "roman": S, "tones": TONE_LIST, "en": S,
    "polite": {"type": "string", "enum": ["statement", "question", "none"]},
    "speaker": {"type": "string", "enum": ["m", "f", "none"]},
    "forms": _obj({"m": FORM, "f": FORM}),
    "hook": S,
    "example": _obj({"thai": S, "roman": S, "en": S}),
    "classifier": S,
    "contrasts": {"type": "array", "items": S},
}, ["id", "thai", "roman", "tones", "en", "polite", "speaker", "hook", "example", "classifier", "contrasts"])}})

TILE = _obj({"item": S, "thai": S, "roman": S, "en": S, "slot": {"type": "boolean"}})
PATTERNS_SCHEMA = _obj({"patterns": {"type": "array", "items": _obj({
    "id": S, "frame": S, "en": S, "note": S,
    "examples": {"type": "array", "items": {"type": "array", "items": TILE}},
})}})

CULTURE_SCHEMA = _obj({"notes": {"type": "array", "items": _obj({
    "id": S, "title": S, "body": S, "items": {"type": "array", "items": S},
})}})

_INT = {"type": "integer"}
OPTION = _obj({
    "say": {"type": "array", "items": S}, "end": {"type": "string", "enum": ["s", "q", "none"]}, "en": S,
    "ok": {"type": "boolean"}, "next": S, "rep": _INT, "baht": _INT, "comfort": _INT, "fb": S,
}, ["say", "end", "en", "ok", "next"])
TASK_SCHEMA = _obj({"nodes": {"type": "array", "items": _obj({
    "id": S, "step": _INT, "say": {"type": "array", "items": S},
    "end": {"type": "string", "enum": ["s", "q", "none"]}, "en": S, "stage": S,
    "expression": {"type": "string", "enum": ["neutral", "smile", "puzzled", "sad"]},
    "heard": {"type": "array", "items": S},
    "opts": {"type": "array", "items": OPTION},
}, ["id", "step", "say", "end", "en", "opts"])}})


# ---------------------------------------------------------------- context

class Ctx:
    def __init__(self, providers, store: Store | None = None, log=print):
        self.p = providers
        self.store = store or Store(providers.dry)
        self.log = log
        self.days = course_days()

    def ask(self, stage: str, prompt: str, schema: dict, model: str | None = None, temperature: float = 0.7):
        return self.p.text.generate_json(stage=stage, model=model or MODELS.generate, system=system_prompt(),
                                         prompt=prompt, schema=schema, temperature=temperature).data


def entry_dict(e) -> dict:
    return asdict(e)


def known_rows(store: Store, upto: int, include_today: bool, exclude: set[str] | None = None) -> list[list[str]]:
    """[id, thai, roman, en] for every item usable so far (dropped items excluded)."""
    ver = store.verify()
    rows = []
    for it in store.all_items(upto):
        if it["day"] > upto or (not include_today and it["day"] == upto):
            continue
        if ver.get(f"item:{it['id']}", {}).get("status") == "dropped":
            continue
        if exclude and it["id"] in exclude:
            continue
        rows.append([it["id"], it["thai"], it["roman"], it["en"]])
    return rows


def _day_header(day: int) -> str:
    d = cur.day_info(day)
    return (f"DAY {day}. Script: {d.script}. Language focus: {d.focus}. Situation in The Street: {d.situation}. "
            f"Culture note: {d.culture or '(none)'}.")


# ---------------------------------------------------------------- items

def items_prompt(day: int, entries: list[dict], known: list[list[str]], feedback: dict | None, attempt: int) -> str:
    parts = [
        _day_header(day),
        "Write the Thai for each of TODAY's entries (in `entries` below; keep each id). The KNOWN list (`known`: id, thai, roman, English) "
        "is everything the learner has met before today; examples may use only those words, today's entries and the item itself.",
        HOOKS, EXAMPLES,
        "CLASSIFIER: for a countable noun, the id of its classifier if that classifier is in KNOWN or TODAY, else \"\".\n"
        "CONTRASTS: ids from KNOWN or TODAY that differ from this item only by tone or vowel length, or look alike in script; [] if none.\n"
        "Notes on an entry (`note`) are binding. `en` repeats the entry's English.",
    ]
    if feedback:
        parts.append("THESE ENTRIES WERE WRITTEN BEFORE AND FAILED THE CHECKS. Fix every problem listed in `feedback` (previous attempt and problems per id). "
                     "Do not repeat the same Thai if the problem was spelling, meaning or naturalness.")
    req = {"day": day, "attempt": attempt, "entries": entries, "known": known}
    if feedback:
        req["feedback"] = feedback
    parts.append(request_block(req))
    return "\n\n".join(parts)


def generate_items(ctx: Ctx, day: int, ids: list[str] | None = None, feedback: dict | None = None, force: bool = False) -> list[str]:
    """Generate the day's missing items (or the given ids). Returns ids written."""
    st = ctx.store
    state = st.load_day("items", day)
    entries = [entry_dict(e) for e in cur.entries_for(day)]
    if ids is not None:
        entries = [e for e in entries if e["id"] in ids]
    elif not force:
        entries = [e for e in entries if e["id"] not in state["items"]]
    if not entries:
        return []
    # a regeneration may also lean on the day's other items, which already exist
    known = known_rows(st, day, include_today=ids is not None, exclude={e["id"] for e in entries})
    allowed = {k[0] for k in known} | {e.id for e in cur.entries_for(day)}
    written = []
    for i in range(0, len(entries), 18):  # one call per day; split only very large days
        chunk = entries[i:i + 18]
        attempt = max((state["attempts"].get(e["id"], 0) for e in chunk), default=0) + (1 if feedback else 0)
        prompt = items_prompt(day, [{k: e[k] for k in ("id", "en", "theme", "note", "adult")} for e in chunk], known,
                              {k: v for k, v in (feedback or {}).items() if k in {e["id"] for e in chunk}} or None, attempt)
        try:
            data = ctx.ask(f"text.items:day{day}", prompt, ITEMS_SCHEMA)
        except Exception as ex:  # noqa: BLE001 - leave missing, the next run retries
            for e in chunk:
                state["errors"][e["id"]] = str(ex)[:300]
            ctx.log(f"  day {day}: items call failed ({str(ex)[:120]})")
            continue
        got = {r.get("id"): r for r in data.get("items", []) if isinstance(r, dict)}
        for e in chunk:
            raw = got.get(e["id"])
            if not raw:
                state["errors"][e["id"]] = "missing from the model's answer"
                continue
            state["items"][e["id"]] = shape_item(raw, e, allowed)
            state["errors"].pop(e["id"], None)
            if feedback and e["id"] in feedback:
                state["attempts"][e["id"]] = state["attempts"].get(e["id"], 0) + 1
            written.append(e["id"])
    st.save_day("items", day, state)
    return written


# ---------------------------------------------------------------- patterns

def patterns_prompt(day: int, specs: list[dict], known: list[list[str]], feedback: dict | None, attempt: int) -> str:
    parts = [
        _day_header(day),
        "Write each sentence pattern in `patterns` (keep each id):\n"
        "- `frame`: the Thai pattern with slots written as X, Y, Z (e.g. ขอ X หน่อย).\n"
        "- `en`: the English pattern. `note`: one or two dry sentences in the second person on how it works.\n"
        "- `examples`: 2 or 3 worked examples, each a correct tile order. Each tile is one word or fixed phrase: set `item` to its id "
        "from KNOWN when it is a KNOWN item (and copy its thai, roman and en), and `slot`: true for the tile that fills a slot. "
        "Use only KNOWN words. No polite endings in tiles. Every example must be a sensible sentence a person would really say "
        "(never a tautology or nonsense such as ผม เป็น ผม 'I am me' or ผม เป็น คุณ 'I am you'); if the known words cannot make one, "
        "use fewer, simpler examples.",
    ]
    if feedback:
        parts.append("These patterns failed the checks before. Fix every problem listed in `feedback`.")
    req = {"day": day, "attempt": attempt, "patterns": specs, "known": known}
    if feedback:
        req["feedback"] = feedback
    parts.append(request_block(req))
    return "\n\n".join(parts)


def generate_patterns(ctx: Ctx, day: int, ids: list[str] | None = None, feedback: dict | None = None, force: bool = False) -> list[str]:
    st = ctx.store
    state = st.load_day("patterns", day)
    specs = [asdict(p) for p in cur.patterns() if p.day == day]
    if ids is not None:
        specs = [p for p in specs if p["id"] in ids]
    elif not force:
        specs = [p for p in specs if p["id"] not in state["patterns"]]
    if not specs:
        return []
    known = known_rows(st, day, include_today=True)
    attempt = max((state["attempts"].get(p["id"], 0) for p in specs), default=0) + (1 if feedback else 0)
    try:
        data = ctx.ask(f"text.patterns:day{day}", patterns_prompt(day, specs, known, feedback, attempt), PATTERNS_SCHEMA)
    except Exception as ex:  # noqa: BLE001
        for p in specs:
            state["errors"][p["id"]] = str(ex)[:300]
        st.save_day("patterns", day, state)
        return []
    got = {r.get("id"): r for r in data.get("patterns", []) if isinstance(r, dict)}
    written = []
    for p in specs:
        raw = got.get(p["id"])
        if not raw:
            state["errors"][p["id"]] = "missing from the model's answer"
            continue
        state["patterns"][p["id"]] = {"id": p["id"], "frame": raw.get("frame", "").strip(), "en": raw.get("en") or p["en"],
                                      "note": raw.get("note", "").strip(), "day": day, "raw_examples": raw.get("examples", [])}
        state["errors"].pop(p["id"], None)
        if feedback and p["id"] in feedback:
            state["attempts"][p["id"]] = state["attempts"].get(p["id"], 0) + 1
        written.append(p["id"])
    st.save_day("patterns", day, state)
    return written


# ---------------------------------------------------------------- culture

CULTURE_RULES = """Write a short culture note for each entry in `notes` (keep id and title):
- 50 to 110 words, plain and dry, second person ("you"), useful to an adult visitor. No exclamation marks, no clichés, no lists.
- Where the topic touches law, the monarchy, alcohol sale hours, cannabis, police, scams or emergencies: state only stable, widely known facts; say that rules change; tell the reader to check official sources (name the kind of authority, e.g. Thai government announcements or the Tourism Authority of Thailand). Do not state specific penalties, fines, hours or legal details you cannot be sure are current. No links, no URLs.
- Emergency numbers may be given only if you are certain of them.
- `items`: up to 4 ids from `known` that the note leans on (words that appear in it or that it explains). [] if none fit."""


def generate_culture(ctx: Ctx, ids: list[str] | None = None, feedback: dict | None = None, force: bool = False) -> list[str]:
    st = ctx.store
    state = st.culture()
    specs = [asdict(c) for c in cur.culture_topics() if c.day <= ctx.days]
    if ids is not None:
        specs = [c for c in specs if c["id"] in ids]
    elif not force:
        specs = [c for c in specs if c["id"] not in state["notes"]]
    written = []
    for i in range(0, len(specs), 10):
        chunk = specs[i:i + 10]
        upto = max(c["day"] for c in chunk)
        known = [[k[0], k[3]] for k in known_rows(st, upto, include_today=True)]
        fb = {k: v for k, v in (feedback or {}).items() if k in {c["id"] for c in chunk}}
        req = {"notes": chunk, "known": known,
               "attempt": max((state["attempts"].get(c["id"], 0) for c in chunk), default=0) + (1 if fb else 0)}
        parts = [CULTURE_RULES]
        if fb:
            parts.append("These notes failed the checks before. Fix every problem listed in `feedback`.")
            req["feedback"] = fb
        parts.append(request_block(req))
        try:
            data = ctx.ask(f"text.culture:{chunk[0]['day']}-{upto}", "\n\n".join(parts), CULTURE_SCHEMA)
        except Exception as ex:  # noqa: BLE001
            for c in chunk:
                state["errors"][c["id"]] = str(ex)[:300]
            continue
        got = {r.get("id"): r for r in data.get("notes", []) if isinstance(r, dict)}
        known_ids = {k[0] for k in known}
        for c in chunk:
            raw = got.get(c["id"])
            if not raw:
                state["errors"][c["id"]] = "missing from the model's answer"
                continue
            state["notes"][c["id"]] = {"id": c["id"], "day": c["day"], "title": c["title"], "body": raw.get("body", "").strip(),
                                       "items": [x for x in raw.get("items", []) if x in known_ids][:4], "status": "draft"}
            state["errors"].pop(c["id"], None)
            if c["id"] in fb:
                state["attempts"][c["id"]] = state["attempts"].get(c["id"], 0) + 1
            written.append(c["id"])
    st.save_culture(state)
    return written


# ---------------------------------------------------------------- Street tasks

TASK_RULES = """Write the scripted branches for one task in The Street, a night street in Bangkok. Rules:
- Every line, the character's and the learner's, is a list of item ids from `known` (the ONLY words allowed). Each list element is exactly ONE id copied from `known`: never join two ids with a space, never invent an id (scene words like "plastic-stall" or "street-food" are not ids). If an idea cannot be said with the known ids, say something simpler that can. "_" inserts a space between phrases. "I" stands for the speaker's own pronoun (ผม or ฉัน, filled in by speaker). Lines are composed by joining the items' Thai, so pick items that read as natural Thai in that order.
- `end` is the speaker's polite ending: "s" after statements and answers, "q" after questions, "none" for none. The character's ending follows the character's own sex automatically; never put ending ids in `say`.
- One node per turn of the character. `step` is the index into `steps`. Cover every step in order. 2 to 5 nodes per step at most.
- Each node has 3 to 5 learner replies (`opts`). At least one is right (`ok`: true). Wrong replies (`ok`: false) must differ in MEANING from the right one, so that choosing right needs understanding the Thai. Each wrong reply gets `fb`: one dry sentence in the second person saying what went wrong.
- `next`: the id of the node the reply leads to, "end" to finish the task, or "" for the default (a wrong reply stays on this node, a right one ends the task).
- `heard`: ids in the character's line the learner must understand to choose right ([] when the choice does not depend on the line).
- `stage`: one short stage direction in the present tense. `en`: the plain English of the character's line. Each reply's `en` is its plain English.
- `rep` (reputation, -3 to 3), `baht` (money gained or lost, 0 if none), `comfort` (only in After Hours tasks, -4 to 2; otherwise 0).
- Lines are short: at most 8 items. Characters speak naturally for their role and sex. Everyone is an adult. Romantic or flirty scenes stay non-explicit and consent-forward: a no is accepted, pushing after a no is always a wrong reply with negative comfort. Cannabis scenes are talk about the rules only."""


def task_prompt(spec: dict, known: list[list[str]], feedback: list[str] | None, attempt: int) -> str:
    person = spec["person"]
    parts = [TASK_RULES,
             f"TASK: {spec['title']} (day {spec['day']}, place: {spec['place']}). Goal: {spec['goal']}. Steps: {spec['steps']}.\n"
             f"CHARACTER: {CAST.get(person, person)} ({'male' if NPC_SEX.get(person) == 'm' else 'female'} speech forms)."
             + (" This is an 18+ After Hours scene." if spec.get("adult") else "")]
    req = {"task": spec, "attempt": attempt, "known": known}
    if feedback:
        parts.append("This script failed the checks before. Fix every problem listed in `feedback`.")
        req["feedback"] = feedback
    parts.append(request_block(req))
    return "\n\n".join(parts)


def task_known(store: Store, day: int) -> list[list[str]]:
    rows = known_rows(store, day, include_today=True)
    return [r for r in rows if r[0] not in ENDING_IDS]


def generate_task(ctx: Ctx, tid: str, feedback: list[str] | None = None, force: bool = False) -> bool:
    st = ctx.store
    spec = next((asdict(t) for t in cur.tasks() if t.id == tid), None)
    if spec is None:
        return False
    old = st.task(tid)
    if old.get("nodes") and not force and feedback is None:
        return False
    attempt = old.get("attempt", 0) + (1 if feedback else 0)
    known = task_known(st, spec["day"])
    try:
        data = ctx.ask(f"text.tasks:{tid}", task_prompt(spec, known, feedback, attempt), TASK_SCHEMA)
    except Exception as ex:  # noqa: BLE001
        st.save_task(tid, {**old, "spec": spec, "error": str(ex)[:300], "attempt": attempt})
        return False
    st.save_task(tid, {"spec": spec, "nodes": _split_joined_ids(data.get("nodes", []), {k[0] for k in known}), "attempt": attempt})
    return True


def _split_joined_ids(nodes: list, known: set[str]) -> list:
    """The writer sometimes packs several ids into one element ("too-expensive mango"). Split such an
    element only when every part is a known id; anything else is left as written for the checks to fail."""
    def fix(xs):
        if not isinstance(xs, list):
            return xs
        out = []
        for x in xs:
            parts = x.split() if isinstance(x, str) else [x]
            out += parts if len(parts) > 1 and all(q in known or q in ("_", "I") for q in parts) else [x]
        return out

    for n in nodes:
        if isinstance(n, dict):
            for k, v in list(n.items()):
                if isinstance(v, list) and all(isinstance(q, str) for q in v):
                    n[k] = fix(v)
                elif isinstance(v, list):
                    for o in v:
                        if isinstance(o, dict):
                            for ok, ov in list(o.items()):
                                if isinstance(ov, list) and all(isinstance(q, str) for q in ov):
                                    o[ok] = fix(ov)
    return nodes


# ---------------------------------------------------------------- the stage

def run_text(providers, args) -> dict:
    """`run.py text`: generate whatever is missing, in spine order."""
    ctx = Ctx(providers)
    force = bool(getattr(args, "force", False))
    first, last = 1, ctx.days
    if getattr(args, "days", None):
        a, _, b = str(args.days).partition("-")
        first, last = int(a), int(b or a)
    from .common import write_json
    write_json(ctx.store.root / "curriculum.json", cur.snapshot())
    made = {"items": 0, "patterns": 0, "culture": 0, "tasks": 0}
    for day in range(first, last + 1):
        n = len(generate_items(ctx, day, force=force))
        m = len(generate_patterns(ctx, day, force=force))
        made["items"] += n
        made["patterns"] += m
        if n or m:
            ctx.log(f"day {day:2d}: {n} items, {m} patterns")
    if last >= ctx.days or getattr(args, "days", None) is None:
        made["culture"] = len(generate_culture(ctx, force=force))
        for t in cur.tasks():
            if t.day <= ctx.days and generate_task(ctx, t.id, force=force):
                made["tasks"] += 1
    ctx.log(f"text: wrote {json.dumps(made)} into {ctx.store.root}")
    return made
