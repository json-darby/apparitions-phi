"""Build School of the Night sections 3-18 into app/public/content/school.json.

Sections 1 and 2 are kept exactly as they are. Every sentence is composed
from course items (and the file's school-only words, ids "sw."), the same
rule as content.ts composeForm.
"""
import json, re, sys
from pathlib import Path

ROOT = Path(r"C:\Users\I_NEE\Desktop\LEARN THAI\phi-project")
SCHOOL = ROOT / "app/public/content/school.json"
COURSE = ROOT / "app/public/content/course.json"
sys.path.insert(0, str(Path(__file__).parent))
from school_content import WORDS, FRAMES, SECTIONS  # noqa: E402

course = json.loads(COURSE.read_text(encoding="utf-8"))
school = json.loads(SCHOOL.read_text(encoding="utf-8"))
items = {i["id"]: i for i in course["items"]}
for w in WORDS:
    assert w["id"].startswith("sw."), w
    assert w["id"] not in items, w
    items[w["id"]] = w

strip = lambda s: re.sub(r"\s+", "", s)
known = set()
for t in course["tasks"]:
    for n in t["nodes"].values():
        known.add(strip(n["thai"]))
        for o in n["options"]:
            known.add(strip(o["thai"]))
for i in course["items"]:
    for e in ["", "ครับ", "ค่ะ", "คะ"]:
        known.add(strip(i["thai"]) + e)


def compose(say, end, sex):
    parts, ids, thai, space = [], [], "", False
    for t in say:
        if t == "_":
            space = True
            continue
        iid = ("i-male" if sex == "m" else "i-female") if t == "I" else t
        it = items[iid]
        f = it.get("forms")
        own = f[sex] if f and f["m"]["thai"] == it["thai"] else {"thai": it["thai"], "roman": it["roman"]}
        thai += (" " if space and thai else "") + own["thai"]
        parts.append({"thai": own["thai"], "roman": own["roman"], "tones": list(it["tones"])})
        ids.append(iid)
        space = False
    if end:
        eid = "khrap" if sex == "m" else ("kha-question" if end == "q" or thai.endswith("นะ") else "kha-statement")
        e = items[eid]
        thai += e["thai"]
        parts.append({"thai": e["thai"], "roman": e["roman"], "tones": list(e["tones"])})
        ids.append(eid)
    return {"thai": thai, "roman": " ".join(p["roman"] for p in parts),
            "tones": [t for p in parts for t in p["tones"]], "items": ids, "parts": parts}


def toks(s):
    return s.split()


def composed(say, end):
    m, f = compose(say, end, "m"), compose(say, end, "f")
    out = {"say": say, "end": end, "m": m, "f": f,
           "source": "course" if strip(m["thai"]) in known or strip(f["thai"]) in known else "composed"}
    if any(t.startswith("sw.") for t in say):
        out["unverified"] = True
    return out


def line(sec_prefix, spec):
    lid, en, say, end = spec[0], spec[1], toks(spec[2]), spec[3]
    replies = spec[4] if len(spec) > 4 else []
    full = lid if "." in lid else f"{sec_prefix}.{lid}"
    out = {"id": full, "en": en, **composed(say, end)}
    out["replies"] = []
    for k, (ren, rsay, rend, ans) in enumerate(replies, 1):
        r = {"id": f"{full}.r{k}", "en": ren, **composed(toks(rsay), rend), "answer": ans if "." in ans else f"{sec_prefix}.{ans}"}
        out["replies"].append(r)
    return out


def frame_template(fr, sex):
    say = fr["say"]
    i = say.index("X")
    before = [t for t in say[:i]]
    after = [t for t in say[i + 1:]]
    a = compose(before, None, sex) if before else {"thai": "", "roman": ""}
    # the ending depends on the whole sentence: compose after with a dummy that ends like the frame
    b = compose(after, fr["end"], sex) if after or fr["end"] else {"thai": "", "roman": ""}
    if fr["end"] and sex == "f" and not after and fr["end"] == "s":
        pass
    thai = " ".join(x for x in [a["thai"], "___", b["thai"]] if x)
    roman = " ".join(x for x in [a["roman"], "___", b["roman"]] if x)
    return {"thai": thai, "roman": roman}


frames = {f["id"]: f for f in school["frames"]}
for fid, (en, say, end) in FRAMES.items():
    fr = {"id": fid, "en": en, "say": toks(say), "end": end}
    fr["m"] = frame_template(fr, "m")
    fr["f"] = frame_template(fr, "f")
    if fid in frames:
        assert frames[fid]["say"] == fr["say"], fid
    else:
        school["frames"].append(fr)
        frames[fid] = fr


def frame_words(sec_id, fid, words):
    fr = frames[fid]
    out = []
    for wid, en, wsay in words:
        wt = toks(wsay)
        say = [x for t in fr["say"] for x in (wt if t == "X" else [t])]
        wparts = [items[t] for t in wt]
        word = {"thai": "".join(p["thai"] for p in wparts), "roman": " ".join(p["roman"] for p in wparts),
                "tones": [x for p in wparts for x in p["tones"]], "items": wt}
        out.append({"id": wid, "en": en, **composed(say, fr["end"]), "word": word})
    return out


by_n = {s["n"]: s for s in school["sections"]}
# Must-knows: after "Sorry", ไม่เป็นไร is "that's okay", and "thank you" answers it
for l in by_n[1]["lines"]:
    for r in l["replies"]:
        if r["id"] == "mk.sorry.r1":
            r["en"] = "That's okay, no problem."

for n, sec in SECTIONS.items():
    s = by_n[n]
    prefix = sec["prefix"]
    s["lines"] = [line(prefix, l) for l in sec["lines"]]
    s["frames"] = [{"frame": fid, "words": frame_words(s["id"], fid, ws)} for fid, ws in sec["frames"]]
    s["door"] = sec["door"] if "." in sec["door"] else f"{prefix}.{sec['door']}"
    if sec.get("note"):
        s["note"] = sec["note"]
    else:
        s.pop("note", None)

school["words"] = WORDS
school["version"] = "school-2026-10-07b"
school["note"] = ("Generated from course items: each recipe (say, end) composes again from the course and must match. "
                  "A few words the course does not teach are in `words` (ids sw.); lines that use them are marked unverified.")
# keep words after sections for readability: rebuild key order
ordered = {k: school[k] for k in ["version", "note", "groups", "frames", "words", "sections"]}
SCHOOL.write_text(json.dumps(ordered, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

# report
ids = {l["id"] for s in school["sections"] for l in s["lines"]}
bad = [(r["id"], r["answer"]) for s in school["sections"] for l in s["lines"] for r in l["replies"] if r["answer"] not in ids]
for s in school["sections"]:
    unv = sum(1 for l in s["lines"] if l.get("unverified")) + sum(1 for l in s["lines"] for r in l["replies"] if r.get("unverified"))
    print(s["n"], s["id"], len(s["lines"]), "lines", sum(len(l["replies"]) for l in s["lines"]), "replies",
          sum(len(f["words"]) for f in s["frames"]), "slot words", unv, "unverified")
print("bad answers:", bad)
used = {t for s in school["sections"] for l in s["lines"] for t in l["say"]} | {t for s in school["sections"] for l in s["lines"] for r in l["replies"] for t in r["say"]} | {t for s in school["sections"] for f in s["frames"] for w in f["words"] for t in w["say"]}
print("unused school words:", [w["id"] for w in WORDS if w["id"] not in used])
