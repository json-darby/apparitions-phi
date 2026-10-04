"""Check the generated text, regenerate failures, drop double failures.

For every item, pattern, note and task:

  shape   this module's own structure checks (tones agree with the roman's
          diacritics, no endings baked into items, taught-only task lines ...)
  tone, words, taught
          the rule checks in phi_pipeline/text/checks.py (check_item), built on
          PyThaiNLP. If that module is not importable, dry runs record "skip"
          and carry on; a real run refuses to verify.
  model   a second, different Gemini model (config MODELS.check) judges
          spelling, meaning, naturalness, register and the polite endings for
          each speaker. It is told never to judge tones.

Failures are regenerated with the problems fed back, at most twice; anything
still failing is dropped (status "dropped": never packed). Results live in
work/text/verify.json, keyed by ref ("item:hello", "pattern:p-khaw", ...).
Model verdicts are cached by content hash, so a rerun pays only for changed
content. The free checks rerun every time, because a dropped earlier item can
make later content fail the taught-words check.
"""

from __future__ import annotations

import os
import threading
from concurrent.futures import ThreadPoolExecutor

import json
import re

from ..config import MODELS, course_days
from . import curriculum as cur
from . import generate as gen
from .common import (ENDING_IDS, ENDINGS, NPC_SEX, Store, compose, content_hash, is_thai_text, say_form,
                     syllables, tones_from_roman)

try:  # written in parallel by another builder; guarded so dry runs work without it
    from .checks import Issue, check_item  # type: ignore
    HAVE_RULES = True
except Exception:  # noqa: BLE001
    check_item = None  # type: ignore
    Issue = None  # type: ignore
    HAVE_RULES = False

MAX_REGENS = 2
TASK_WORKERS = 6  # parallel task checks and rewrites (each task is independent)
TEXT_CHECKS = ("shape", "tone", "words", "taught", "endings", "model")

# ---------------------------------------------------------------- the second model

CHECK_SYSTEM = """You are a meticulous checker of Thai teaching content written for an adult English speaker. You are a different model from the writer and you are strict.
For each entry in `check`, judge:
- spelling: the Thai is spelled in standard modern Thai.
- meaning: the Thai means what the English says, and the romanisation spells the same consonants and vowels as the Thai (Paiboon-style: aa ii uu doubled for long vowels, ae for แ, aw for ออ, ʉ for ึ/ื, bp dt ph th kh).
- natural: this is what a Thai speaker would actually say in everyday spoken Bangkok Thai.
- register: polite and warm, suitable for a visitor talking to staff and new acquaintances; not stiff or textbook-formal (ดิฉัน is wrong anywhere except an entry that explicitly teaches the formal form), not crude.
- endings: male speakers use ผม and ครับ; female speakers use ฉัน and ค่ะ after statements, คะ after questions (นะคะ, never นะค่ะ). `said_by` shows what each speaker would say; both must be correct. Polite endings must not be baked into a bare item.
- speaker: when `speaker` is "m" or "f", only that sex says this entry (e.g. ครับ and ผม are said by men, ค่ะ and ฉัน by women). Judge it only as said by that sex; never fail it because the other sex would not say it. `said_by` then shows only that speaker.
- example: when an example sentence is given, it is correct, natural, something a person would really say in a real situation (fail tautologies or nonsense such as ผมเป็นผม "I am me" or "I am you"), written without spaces between words (a space only between phrases or sentences), and its English is a faithful translation that adds nothing (ครับ/ค่ะ are never "sir"/"madam").
IMPORTANT: Do NOT judge, mention or correct tones, tone marks or the tone diacritics of the romanisation. A separate rule-based checker handles tones. Ignore tone diacritics entirely.
This course has its own romanisation; never fail an entry for following it: ออ is written aw or aaw (ขอ khǎw, รอ raaw, ก็ gâaw), ออย aawy or oi (น้อย náawy, ซอย soi), final ย as i (เหนื่อย nʉ̀ai), แล้ว láaeo, เอีย ia, เอือ ʉa, แอ ae or aae, เ-า ao. How a vowel's length is spelled (a/aa, aw/aaw) is not an error. Fail the romanisation only when it spells a different consonant or vowel sound from the Thai.
Spacing: Thai is written without spaces between words; a space may separate two phrases or sentences, and its absence there is not an error. Before reporting a spacing or spelling problem, compare it with the exact characters given; never report a problem that the given text does not have.
Give each entry verdict "pass" only if every applicable field passes ("na" when a field does not apply). List each problem in one short sentence in `problems`, with the corrected Thai where you can. Answer only with JSON."""

FIELD = {"type": "string", "enum": ["pass", "fail", "na"]}
VERDICT_SCHEMA = gen._obj({"verdicts": {"type": "array", "items": gen._obj({
    "id": gen.S,
    "verdict": {"type": "string", "enum": ["pass", "fail"]},
    "problems": {"type": "array", "items": gen.S},
    "fields": gen._obj({k: FIELD for k in ("spelling", "meaning", "natural", "register", "endings", "example")}, []),
}, ["id", "verdict", "problems"])}})

CULTURE_CHECK = """Check each culture note in `check` for an adult visitor's Thai course. Fail a note if it: states specific legal details, penalties, opening hours or figures that may not be current or cannot be supported; gives advice on obtaining or using drugs; contains links or URLs; names real private people; is not in plain, dry, second-person English; contains Thai that is misspelled. Do not judge tones. Answer only with JSON."""

TASK_CHECK = """Check each node of a scripted conversation in `check`. The learner plays a visitor with a task, given in `goal`, which they see on screen. `line` is what the character says (their sex is given); `replies` are the learner's choices, given in the male and the female form, each marked right or wrong; a wrong one carries `why_wrong`, the feedback the learner sees.
Fail a node if any Thai line is misspelled, unnatural as spoken Thai, does not match its English, uses the wrong polite ending or pronoun for its speaker, or is in the wrong register (stiff, crude, or ดิฉัน in casual talk); if a reply marked right is not a sensible answer that moves the learner towards the goal; or if a reply marked wrong is in fact a good way to reach the goal. A reply may be marked wrong because it works against the goal or does not answer the line, even if a real person might say it, as long as `why_wrong` explains that. Content must stay non-explicit and consent-forward. Do NOT judge tones or tone marks. Answer only with JSON."""


def ask_check(providers, stage: str, system: str, check: list[dict]) -> dict[str, dict]:
    if not check:
        return {}
    prompt = "Check these entries.\n\n" + gen.request_block({"check": check})
    data = providers.text.generate_json(stage=stage, model=MODELS.check, system=system, prompt=prompt,
                                        schema=VERDICT_SCHEMA, temperature=0.0).data
    out = {}
    for v in data.get("verdicts", []):
        if isinstance(v, dict) and v.get("id"):
            out[v["id"]] = {"verdict": v.get("verdict", "fail"), "problems": list(v.get("problems", []))[:6]}
    return out


# ---------------------------------------------------------------- rule checks

RULE_KEYS = {"tone": "tone", "syllables": "tone", "words": "words", "taught": "taught", "endings": "endings",
             "script": "shape"}


def _rule_key(check_name: str) -> str:
    """checks.py names -> course.json check keys."""
    c = (check_name or "").lower()
    if c in RULE_KEYS:
        return RULE_KEYS[c]
    if "tone" in c or "syllable" in c:
        return "tone"
    if "taught" in c or "known" in c:
        return "taught"
    if "word" in c or "dict" in c:
        return "words"
    if "ending" in c:
        return "endings"
    return "shape"


def rule_checks(obj: dict, known: set[str], dry: bool) -> tuple[dict[str, str], list[str]]:
    """Run checks.py on one item-shaped dict. -> ({tone, words, taught}, problems)."""
    res = {"tone": "pass", "words": "pass", "taught": "pass", "endings": "pass"}
    if not HAVE_RULES:
        if not dry:
            raise SystemExit("verify: phi_pipeline/text/checks.py is missing; a real run cannot skip the rule checks.")
        return {k: "skip" for k in res}, []
    problems = []
    try:
        issues = check_item(obj, known)  # type: ignore[misc]
    except Exception as ex:  # noqa: BLE001
        return {"tone": "fail", "words": "fail", "taught": "fail", "endings": "fail"}, [f"rule checker crashed: {str(ex)[:160]}"]
    for iss in issues or []:
        sev = str(getattr(iss, "severity", "error")).lower()
        if sev in ("warn", "warning", "info", "note"):
            continue
        res[_rule_key(getattr(iss, "check", ""))] = "fail"
        problems.append(f"{getattr(iss, 'check', 'rule')}: {getattr(iss, 'detail', '')}")
    return res, problems


# ---------------------------------------------------------------- shape checks

ENDING_RE = re.compile(r"(ครับ|ค่ะ|คะ)$")


def item_shape(it: dict) -> list[str]:
    p = []
    if not is_thai_text(it.get("thai", "")):
        p.append("thai is empty or has non-Thai characters")
    syl = syllables(it.get("roman", ""))
    if not syl:
        p.append("roman is empty")
    if len(it.get("tones", [])) != len(syl):
        p.append(f"tones has {len(it.get('tones', []))} entries but roman has {len(syl)} syllables")
    elif it["tones"] != tones_from_roman(it["roman"]):
        p.append(f"tones {it['tones']} disagree with the roman's diacritics {tones_from_roman(it['roman'])}")
    if it["id"] in ENDING_IDS:
        want = {"khrap": "ครับ", "kha-statement": "ค่ะ", "kha-question": "คะ"}[it["id"]]
        if it.get("thai") != want:
            p.append(f"the ending item must be exactly {want}")
    elif ENDING_RE.search(it.get("thai", "")):
        p.append("a polite ending is baked into the item; use the polite field instead")
    formal = "formal" in it.get("en", "")
    texts = [it.get("thai", ""), (it.get("example") or {}).get("thai", "")] + [f["thai"] for f in (it.get("forms") or {}).values()]
    if not formal and any("ดิฉัน" in t for t in texts):
        p.append("ดิฉัน is too formal here; use ฉัน")
    if "example" not in it:
        p.append("no example sentence")
    elif not is_thai_text(it["example"]["thai"]) or not it["example"].get("en"):
        p.append("example is incomplete")
    if "hook" not in it:
        p.append("no memory hook")
    return p


def known_thai(items: list[dict]) -> set[str]:
    s = {e["thai"] for e in ENDINGS.values()}
    for it in items:
        s.add(it["thai"])
        for f in (it.get("forms") or {}).values():
            s.add(f["thai"])
    return s


# ---------------------------------------------------------------- the settle loop

class Verifier:
    def __init__(self, providers, log=print):
        self.p = providers
        self.dry = providers.dry
        self.ctx = gen.Ctx(providers, log=log)
        self.st: Store = self.ctx.store
        self.state = self.st.verify()
        self.log = log
        self.days = course_days()

    def save(self):
        self.st.save_verify(self.state)

    def rec(self, ref: str) -> dict:
        return self.state.setdefault(ref, {"status": "missing", "checks": {}, "problems": [], "regens": 0})

    def _model(self, ref: str, payload: dict, cache: dict[str, dict]) -> tuple[str, list[str]] | None:
        r = self.rec(ref)
        h = content_hash(payload)
        if r.get("model_hash") == h and r.get("model_verdict"):
            return r["model_verdict"]["verdict"], r["model_verdict"]["problems"]
        cache[ref] = {"payload": payload, "hash": h}
        return None

    def _settle(self, refs: list[str], free_fn, model_fn, regen_fn) -> None:
        """free_fn(ref) -> (checks, problems); model_fn(refs) -> {ref: (verdict, problems)}; regen_fn({ref: feedback})."""
        pending = list(refs)
        while pending:
            failing: dict[str, list[str]] = {}
            to_model = []
            for ref in pending:
                checks, problems = free_fn(ref)
                r = self.rec(ref)
                r["checks"] = checks
                r["problems"] = problems
                if any(v == "fail" for v in checks.values()):
                    failing[ref] = problems
                    r["checks"]["model"] = "skip"
                else:
                    to_model.append(ref)
            verdicts = model_fn(to_model) if to_model else {}
            for ref in to_model:
                r = self.rec(ref)
                v, probs = verdicts.get(ref, ("fail", ["no verdict returned by the check model"]))
                r["checks"]["model"] = v
                if v != "pass":
                    r["problems"] = probs
                    failing[ref] = probs
            for ref in pending:
                r = self.rec(ref)
                r["status"] = "fail" if ref in failing else "pass"
            # regenerate what failed and still has tries left
            # PHI_NO_REGEN=1: check only, never rewrite; failures stay "fail" (left out, rewritable later)
            no_regen = os.environ.get("PHI_NO_REGEN") == "1"
            retry = {} if no_regen else {ref: probs for ref, probs in failing.items() if self.rec(ref)["regens"] < MAX_REGENS}
            for ref in failing:
                if ref not in retry and not no_regen:
                    self.rec(ref)["status"] = "dropped"
            self.save()
            if not retry:
                break
            for ref in retry:
                self.rec(ref)["regens"] += 1
            regen_fn(retry)
            pending = list(retry)

    # ---------------- items

    def items_for_day(self, day: int) -> None:
        st = self.st
        today = st.load_day("items", day)["items"]
        for e in cur.entries_for(day):
            if e.id not in today:
                r = self.rec(f"item:{e.id}")
                r["status"], r["problems"] = "missing", ["not generated yet (run text again)"]
        if not today:
            return
        earlier = [it for it in st.all_items(day - 1) if self.state.get(f"item:{it['id']}", {}).get("status") == "pass"]

        def current(ref):
            return st.load_day("items", day)["items"][ref.split(":", 1)[1]]

        def free(ref):
            it = current(ref)
            todays = list(st.load_day("items", day)["items"].values())
            known = known_thai(earlier + todays)
            shape = item_shape(it)
            checks, problems = rule_checks(it, known, self.dry)
            checks["shape"] = "fail" if shape or checks.get("shape") == "fail" else "pass"
            return checks, shape + problems

        def model(refs):
            out, cache = {}, {}
            for ref in refs:
                it = current(ref)
                payload = {"id": it["id"], "en": it["en"], "thai": it["thai"], "roman": it["roman"],
                           "polite": it.get("polite", "none"), "speaker": it.get("speaker", "none"),
                           "forms": it.get("forms"), "example": it.get("example"),
                           "said_by": ({"male": say_form(it, "m")["thai"]} if it.get("speaker") == "m" else
                                       {"female": say_form(it, "f")["thai"]} if it.get("speaker") == "f" else
                                       {"male": say_form(it, "m")["thai"], "female": say_form(it, "f")["thai"]})}
                hit = self._model(ref, payload, cache)
                if hit:
                    out[ref] = hit
            if cache:
                got = ask_check(self.p, f"verify.items:day{day}", CHECK_SYSTEM, [c["payload"] for c in cache.values()])
                for ref, c in cache.items():
                    v = got.get(c["payload"]["id"], {"verdict": "fail", "problems": ["no verdict returned"]})
                    self.rec(ref)["model_hash"] = c["hash"]
                    self.rec(ref)["model_verdict"] = v
                    out[ref] = (v["verdict"], v["problems"])
            return out

        def regen(fb):
            prev = {ref.split(":", 1)[1]: {"previous": {k: current(ref).get(k) for k in ("thai", "roman", "tones", "example", "forms")},
                                           "problems": probs} for ref, probs in fb.items()}
            gen.generate_items(self.ctx, day, ids=list(prev), feedback=prev)

        self._settle([f"item:{i}" for i in today], free, model, regen)

    # ---------------- patterns

    def build_tiles(self, pat: dict) -> tuple[list[list[dict]], list[str]]:
        items = {it["id"]: it for it in self.st.all_items(pat["day"])
                 if self.state.get(f"item:{it['id']}", {}).get("status") == "pass"}
        problems, examples = [], []
        for ex in pat.get("raw_examples", []):
            tiles = []
            for t in ex:
                iid = (t.get("item") or "").strip()
                if iid:
                    it = items.get(iid)
                    if not it:
                        problems.append(f"tile uses '{iid}', which is not a taught item by day {pat['day']}")
                        continue
                    tiles.append({"thai": it["thai"], "roman": it["roman"], "en": it["en"], "slot": bool(t.get("slot"))})
                else:
                    tiles.append({"thai": t.get("thai", ""), "roman": t.get("roman", ""), "en": t.get("en", ""), "slot": bool(t.get("slot"))})
            if tiles:
                examples.append(tiles)
        if len(examples) < 2:
            problems.append("needs at least two worked examples")
        if any(len(e) < 2 for e in examples):
            problems.append("each example needs at least two tiles")
        if not any(t["slot"] for e in examples for t in e):
            problems.append("no tile is marked as the slot")
        if not re.search(r"[฀-๿]", pat.get("frame", "")):
            problems.append("frame has no Thai")
        return examples, problems

    def patterns_for_day(self, day: int) -> None:
        st = self.st
        pats = st.load_day("patterns", day)["patterns"]
        if not pats:
            return
        known = known_thai([it for it in st.all_items(day) if self.state.get(f"item:{it['id']}", {}).get("status") == "pass"])

        def current(ref):
            return st.load_day("patterns", day)["patterns"][ref.split(":", 1)[1]]

        def free(ref):
            pat = current(ref)
            examples, problems = self.build_tiles(pat)
            checks: dict[str, str] = {}
            for tiles in examples:
                joined = {"id": pat["id"], "kind": "phrase", "thai": "".join(t["thai"] for t in tiles),
                          "roman": " ".join(t["roman"] for t in tiles), "tones": tones_from_roman(" ".join(t["roman"] for t in tiles)),
                          "en": pat["en"], "theme": "linking", "day": day}
                c, p = rule_checks(joined, known, self.dry)
                for k, v in c.items():
                    if v == "fail" or k not in checks:
                        checks[k] = v
                problems += p
            for k in ("tone", "words", "taught", "endings"):
                checks.setdefault(k, "pass")
            own = any("tile" in x or "example" in x or "frame" in x for x in problems)
            checks["shape"] = "fail" if own or checks.get("shape") == "fail" else "pass"
            return checks, problems

        def model(refs):
            out, cache = {}, {}
            for ref in refs:
                pat = current(ref)
                examples, _ = self.build_tiles(pat)
                payload = {"id": pat["id"], "en": pat["en"], "thai": pat["frame"], "note": pat["note"],
                           "examples": [{"thai": "".join(t["thai"] for t in e), "roman": " ".join(t["roman"] for t in e)} for e in examples]}
                hit = self._model(ref, payload, cache)
                if hit:
                    out[ref] = hit
            if cache:
                got = ask_check(self.p, f"verify.patterns:day{day}", CHECK_SYSTEM, [c["payload"] for c in cache.values()])
                for ref, c in cache.items():
                    v = got.get(c["payload"]["id"], {"verdict": "fail", "problems": ["no verdict returned"]})
                    self.rec(ref).update(model_hash=c["hash"], model_verdict=v)
                    out[ref] = (v["verdict"], v["problems"])
            return out

        def regen(fb):
            gen.generate_patterns(self.ctx, day, ids=[r.split(":", 1)[1] for r in fb],
                                  feedback={r.split(":", 1)[1]: {"problems": p} for r, p in fb.items()})

        self._settle([f"pattern:{i}" for i in pats], free, model, regen)

    # ---------------- culture

    def culture(self) -> None:
        notes = self.st.culture()["notes"]
        if not notes:
            return
        passed = {it["id"] for it in self.st.all_items() if self.state.get(f"item:{it['id']}", {}).get("status") == "pass"}

        def current(ref):
            return self.st.culture()["notes"][ref.split(":", 1)[1]]

        def free(ref):
            n = current(ref)
            p = []
            words = len(n["body"].split())
            if not 30 <= words <= 160:
                p.append(f"body is {words} words; write 50 to 110")
            if re.search(r"https?://|www\.", n["body"]):
                p.append("no links or URLs")
            if "!" in n["body"]:
                p.append("no exclamation marks")
            n["items"] = [i for i in n["items"] if i in passed]
            return {"shape": "fail" if p else "pass", "tone": "skip", "words": "skip", "taught": "skip"}, p

        def model(refs):
            out, cache = {}, {}
            for ref in refs:
                n = current(ref)
                hit = self._model(ref, {"id": n["id"], "title": n["title"], "body": n["body"]}, cache)
                if hit:
                    out[ref] = hit
            for i in range(0, len(cache), 10):
                chunk = dict(list(cache.items())[i:i + 10])
                got = ask_check(self.p, "verify.culture", CULTURE_CHECK, [c["payload"] for c in chunk.values()])
                for ref, c in chunk.items():
                    v = got.get(c["payload"]["id"], {"verdict": "fail", "problems": ["no verdict returned"]})
                    self.rec(ref).update(model_hash=c["hash"], model_verdict=v)
                    out[ref] = (v["verdict"], v["problems"])
            return out

        def regen(fb):
            gen.generate_culture(self.ctx, ids=[r.split(":", 1)[1] for r in fb],
                                 feedback={r.split(":", 1)[1]: {"problems": p} for r, p in fb.items()})

        self._settle([f"culture:{i}" for i in notes], free, model, regen)

    # ---------------- tasks

    def task_items(self, day: int) -> dict[str, dict]:
        return {it["id"]: it for it in self.st.all_items(day)
                if self.state.get(f"item:{it['id']}", {}).get("status") == "pass" or it["id"] in ENDING_IDS}

    def build_task(self, tid: str) -> tuple[dict | None, list[str]]:
        """The task in the app's built shape (male build, female forms alongside), or problems."""
        data = self.st.task(tid)
        spec, raw_nodes = data.get("spec"), data.get("nodes") or []
        if not spec or not raw_nodes:
            return None, ["not generated"]
        items = self.task_items(spec["day"])
        p: list[str] = []
        ids = [n.get("id") for n in raw_nodes]
        if len(set(ids)) != len(ids):
            p.append("node ids repeat")
        npc = NPC_SEX.get(spec["person"], "f")
        nodes = {}
        steps_seen = set()
        for n in raw_nodes:
            nid = n.get("id")
            step = n.get("step", 0)
            if not isinstance(step, int) or not 0 <= step < len(spec["steps"]):
                p.append(f"{nid}: step {step} is outside the steps")
                step = 0
            steps_seen.add(step)
            end = None if n.get("end") == "none" else (n.get("end") or "s")
            try:
                line = compose([x for x in n.get("say", []) if x not in ENDING_IDS], npc, end, items)
            except KeyError as k:
                p.append(f"{nid}: the line uses {k}, which is not taught by day {spec['day']}")
                continue
            if len(n.get("say", [])) > 10:
                p.append(f"{nid}: line too long")
            opts = n.get("opts", [])
            if not 3 <= len(opts) <= 5:
                p.append(f"{nid}: has {len(opts)} replies; needs 3 to 5")
            if not any(o.get("ok", True) for o in opts):
                p.append(f"{nid}: no right reply")
            options = []
            for i, o in enumerate(opts):
                oend = None if o.get("end") == "none" else (o.get("end") or "s")
                say = [x for x in o.get("say", []) if x not in ENDING_IDS]
                try:
                    lm = compose(say, "m", oend, items)
                    lf = compose(say, "f", oend, items)
                except KeyError as k:
                    p.append(f"{nid}.{i}: the reply uses {k}, which is not taught by day {spec['day']}")
                    continue
                correct = bool(o.get("ok", True))
                nxt = o.get("next", "")
                nxt = None if nxt == "end" else (nxt or (None if correct else nid))
                opt = {"items": lm["items"], "thai": lm["thai"], "roman": lm["roman"], "en": o.get("en", ""), "next": nxt,
                       "correct": correct, "tones": lm["tones"], "say": o.get("say", []), "end": oend or "none",
                       "forms": {"m": {k: lm[k] for k in ("thai", "roman", "tones")}, "f": {k: lf[k] for k in ("thai", "roman", "tones")}}}
                for k in ("rep", "baht", "comfort"):
                    if o.get(k):
                        opt[k] = int(o[k])
                if o.get("fb"):
                    opt["feedback"] = o["fb"]
                options.append(opt)
            heard = [h for h in n.get("heard", []) if h in line["items"] and h not in ENDING_IDS]
            node = {"id": nid, "speaker": spec["person"], "thai": line["thai"], "roman": line["roman"], "en": n.get("en", ""),
                    "step": step, "items": line["items"], "tones": line["tones"], "options": options,
                    "say": n.get("say", []), "end": end or "none"}
            if n.get("stage"):
                node["stage"] = n["stage"]
            if n.get("expression") in ("neutral", "smile", "puzzled", "sad"):
                node["expression"] = n["expression"]
            if heard:
                node["heard"] = heard
            nodes[nid] = node
        for nid, node in nodes.items():
            for o in node["options"]:
                if o["next"] is not None and o["next"] not in nodes:
                    p.append(f"{nid}: a reply leads to unknown node {o['next']}")
        if nodes:
            start = raw_nodes[0]["id"]
            seen, stack = set(), [start]
            while stack:
                x = stack.pop()
                if x in seen or x not in nodes:
                    continue
                seen.add(x)
                stack += [o["next"] for o in nodes[x]["options"] if o["next"]]
            if seen != set(nodes):
                p.append(f"unreachable nodes: {sorted(set(nodes) - seen)}")
            if not any(o["next"] is None and o["correct"] for nd in nodes.values() for o in nd["options"]):
                p.append("no right reply ever finishes the task")
        missing_steps = set(range(len(spec["steps"]))) - steps_seen
        if missing_steps:
            p.append(f"steps without a node: {sorted(missing_steps)}")
        if not nodes:
            return None, p or ["no usable nodes"]
        task = {"id": spec["id"], "title": spec["title"], "place": spec["place"], "person": spec["person"], "day": spec["day"],
                "reward": spec["reward"], "steps": spec["steps"], "start": raw_nodes[0]["id"], "nodes": nodes}
        if spec.get("adult"):
            task["adult"] = True
        if spec.get("chapter"):
            task["chapter"] = spec["chapter"]
        return task, p

    def tasks(self) -> None:
        tids = [t.id for t in cur.tasks() if t.day <= self.days and self.st.task(t.id).get("nodes")]

        def free(ref):
            _, p = self.build_task(ref.split(":", 1)[1])
            return {"shape": "fail" if p else "pass", "tone": "skip", "words": "skip", "taught": "pass" if not any("not taught" in x for x in p) else "fail"}, p

        # tasks are independent of each other, so they are checked and rewritten in parallel
        lock = threading.Lock()

        def model_one(ref):
            task, _ = self.build_task(ref.split(":", 1)[1])
            spec = self.st.task(task["id"])["spec"]
            goal = f"{spec['title']}. {spec['goal']}"
            payload = [{"id": nid, "goal": goal, "speaker_sex": NPC_SEX.get(task["person"], "f"), "line": n["thai"], "en": n["en"],
                        "replies": [{"male": o["forms"]["m"]["thai"], "female": o["forms"]["f"]["thai"], "en": o["en"],
                                     "right": o["correct"], **({} if o["correct"] else {"why_wrong": o.get("feedback", "")})}
                                    for o in n["options"]]} for nid, n in task["nodes"].items()]
            cache: dict = {}
            with lock:
                hit = self._model(ref, payload, cache)
            if hit:
                return hit
            got = ask_check(self.p, f"verify.tasks:{task['id']}", TASK_CHECK, payload)
            bad = [f"{k}: {'; '.join(v['problems']) or 'failed'}" for k, v in got.items() if v["verdict"] != "pass"]
            missing = [x["id"] for x in payload if x["id"] not in got]
            if missing:
                bad.append(f"no verdict for nodes {missing}")
            v = {"verdict": "fail" if bad else "pass", "problems": bad}
            with lock:
                self.rec(ref).update(model_hash=cache[ref]["hash"], model_verdict=v)
            return v["verdict"], v["problems"]

        def model(refs):
            with ThreadPoolExecutor(max_workers=TASK_WORKERS) as ex:
                return dict(zip(refs, ex.map(model_one, refs)))

        def regen(fb):
            with ThreadPoolExecutor(max_workers=TASK_WORKERS) as ex:
                list(ex.map(lambda kv: gen.generate_task(self.ctx, kv[0].split(":", 1)[1], feedback=kv[1]), fb.items()))

        self._settle([f"task:{t}" for t in tids], free, model, regen)


# ---------------------------------------------------------------- the stage

def run_verify(providers, args=None, log=print) -> dict:
    v = Verifier(providers, log=log)
    if not HAVE_RULES:
        log("verify: checks.py not found; rule checks (tone, words, taught) recorded as 'skip' (dry run only)")
    # PHI_VERIFY_ONLY=items,patterns: check only those kinds (e.g. while tasks are being rewritten by hand)
    only = {k.strip() for k in os.environ.get("PHI_VERIFY_ONLY", "").split(",") if k.strip()}
    for day in range(1, v.days + 1):
        if not only or "items" in only:
            v.items_for_day(day)
        if not only or "patterns" in only:
            v.patterns_for_day(day)
    if not only or "culture" in only:
        v.culture()
    if not only or "tasks" in only:
        v.tasks()
    v.save()
    summary: dict[str, dict[str, int]] = {}
    for ref, r in v.state.items():
        kind = ref.split(":", 1)[0]
        summary.setdefault(kind, {}).setdefault(r["status"], 0)
        summary[kind][r["status"]] += 1
    log("verify: " + json.dumps(summary))
    return summary
