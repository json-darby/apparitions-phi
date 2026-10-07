"""Run the course's automatic Thai checks over School of the Night content.

Every line, reply and slot sentence, in both speaker forms, goes through the
rule-based checks (tones against the romanisation, spelling shape, word list).
The second-model pass (spelling, meaning, natural, register, endings) then sees
each sentence once, with both speakers' forms in `said_by`, the same as course
items. No model is asked about tones. Frame templates with a ___ slot are
skipped by the rule checks (the slot is not Thai).

Model verdicts are cached in work/school-check-cache.json by the exact entry
sent, so a rerun only pays for sentences that changed. Sentences marked
source "course" are whole sentences the course already has, checked when the
course was built; they are not sent again unless --all is given.

    python check_school.py [--dry] [--all] [--only PREFIX ...]
Writes work/school-check.json.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from phi_pipeline.text import checks as C
from phi_pipeline.text.verify import CHECK_SYSTEM, ask_check

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "app" / "public" / "content" / "school.json"
OUT = Path(__file__).resolve().parent / "work" / "school-check.json"
CACHE = Path(__file__).resolve().parent / "work" / "school-check-cache.json"

CONTEXT = {
    "line": "said by the learner, a visitor, to a Thai person",
    "reply": "said back to the visitor by the Thai person they are talking to (staff, a bar worker, a new friend)",
    "slot": "said by the learner, a visitor: a sentence frame filled with one slot word",
}


def entries(d: dict):
    """(id, kind, english, obj) for every Thai sentence in the file."""
    for sec in d.get("sections", []):
        for ln in sec.get("lines", []):
            yield ln["id"], "line", ln.get("en", ""), ln
            for r in ln.get("replies", []) or []:
                yield r["id"], "reply", r.get("en", ""), r
        for fr in sec.get("frames", []) or []:
            tmpl = next((f.get("en", "___") for f in d.get("frames", []) if f.get("id") == fr.get("frame")), "___")
            for w in fr.get("words", []) or []:
                if isinstance(w, dict):
                    # a slot sentence: the frame's English with the word in the slot
                    yield f"{sec['id']}.{fr.get('frame')}.{w.get('id')}", "slot", tmpl.replace("___", w.get("en", "")), w


def key(payload: dict) -> str:
    return hashlib.sha256(json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()[:20]


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry", action="store_true", help="rule checks only, no model")
    ap.add_argument("--all", action="store_true", help="also send sentences the course already has")
    ap.add_argument("--only", nargs="*", default=None, help="id prefixes to send to the model (e.g. nu. nm.)")
    a = ap.parse_args()
    d = json.loads(SRC.read_text(encoding="utf-8"))
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    # school-only words are declared in the file (loanwords such as บาร์ไฟน์ are not in the
    # word list); the word list accepts their pieces, and the model still judges their spelling
    loan = {t for w in d.get("words", []) for t in C._content_tokens(w["thai"])}
    seen_rule, seen_model, rows = set(), set(), []
    for sid, kind, en, obj in entries(d):
        rule = []
        for sp in ("m", "f"):
            form = obj.get(sp)
            if not isinstance(form, dict) or not form.get("thai"):
                rule.append(f"{sp}: missing form")
                continue
            k = (form["thai"], form["roman"])
            if k in seen_rule or "___" in form["thai"]:
                continue
            seen_rule.add(k)
            iss = C.tone_check(form["thai"], form["roman"], form.get("tones")) + C.script_check(form["thai"]) + C.word_check(form["thai"], loan)
            rule += [f"{sp}: {i.check}: {i.detail}" for i in iss if i.severity == "fail"]
        m, f = obj.get("m") or {}, obj.get("f") or {}
        payload = {"id": sid, "thai": m.get("thai", ""), "romanisation": m.get("roman", ""), "english": en,
                   "context": CONTEXT[kind],
                   "said_by": {"male": m.get("thai", ""), "female": f.get("thai", "")}}
        dup = (payload["thai"], payload["said_by"]["female"], en) in seen_model
        seen_model.add((payload["thai"], payload["said_by"]["female"], en))
        rows.append({"id": sid, "kind": kind, "thai": m.get("thai", ""), "thai_f": f.get("thai", ""), "roman": m.get("roman", ""),
                     "english": en, "source": obj.get("source"), "unverified": bool(obj.get("unverified")),
                     "rule": rule, "payload": payload, "dup": dup})
    print(f"{len(rows)} sentences, {sum(1 for r in rows if r['rule'])} with rule failures")

    def wanted(r):
        if r["dup"]:
            return False
        if r["source"] == "course" and not a.all:
            return False
        if a.only is not None and not any(r["id"].startswith(p) for p in a.only):
            return False
        return True

    def ckey(r):
        p = dict(r["payload"])
        p.pop("id")
        return key(p)

    todo = [r for r in rows if wanted(r) and ckey(r) not in cache]
    print(f"{sum(1 for r in rows if wanted(r))} to judge, {len(todo)} not cached")
    if not a.dry and todo:
        from run import providers_for

        p = providers_for(False)
        for i in range(0, len(todo), 40):
            chunk = todo[i : i + 40]
            got = ask_check(p, "school.check", CHECK_SYSTEM, [r["payload"] for r in chunk])
            for r in chunk:
                v = got.get(r["id"])
                if v:
                    cache[ckey(r)] = v
            CACHE.write_text(json.dumps(cache, ensure_ascii=False, indent=1), encoding="utf-8")
        print(p.ledger.summary())
    for r in rows:
        r["model"] = cache.get(ckey(r)) if wanted(r) or ckey(r) in cache else None
    OUT.write_text(json.dumps([{k: v for k, v in r.items() if k != "payload"} for r in rows], ensure_ascii=False, indent=1), encoding="utf-8")
    bad = [r for r in rows if r["rule"] or (r.get("model") and r["model"]["verdict"] != "pass")]
    print(f"{len(bad)} need attention")
    for r in bad:
        print(r["id"], r["thai"], "|", r["roman"], "|", r["english"], "|", r["rule"][:3], (r.get("model") or {}).get("problems", [])[:3])


if __name__ == "__main__":
    main()
