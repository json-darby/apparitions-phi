"""
Filler packs: private placeholder images found online, packed with accurate depth
(phi_depth.py via pack_portraits.py) until the owner's own generated images exist.

    python pipeline/filler_packs.py            # download what is missing, pack, write credits
    python pipeline/filler_packs.py --only scenes/food objects/dish

Reads   pipeline/filler_spec.json   (what to use, from where, licence, author)
Caches  pipeline/work/filler/src/   (downloaded originals, git-ignored)
Writes  app/public/packs/<who|objects|scenes>/...   + manifest.json ("filler": true)
        app/public/packs/credits.json               (shown in Settings > About)
        pipeline/work/depth_log.json                (every depth sanity check)

Everything packed here is filler for private testing and must be replaced before
anything is published or deployed (the manifest carries "filler": true).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import requests

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import pack_portraits as pp  # noqa: E402

SPEC = HERE / "filler_spec.json"
SRC = HERE / "work" / "filler" / "src"
UA = {"User-Agent": "phi-filler/0.1 (private learning app; owner's machine)"}
FILLER_LINE = "Filler images for private testing, sourced online, to be replaced."


def fetch(entry: dict) -> Path:
    p = SRC / entry["file"]
    if p.exists() and p.stat().st_size > 0:
        return p
    p.parent.mkdir(parents=True, exist_ok=True)
    r = requests.get(entry["file_url"], headers=UA, timeout=120)
    r.raise_for_status()
    p.write_bytes(r.content)
    print(f"  downloaded {p.name} ({len(r.content) / 1e3:.0f} KB)")
    return p


def credit_line(e: dict) -> str:
    who = e.get("creator") or "unknown author"
    ai = "AI-generated, " if e.get("ai_generated") else ""
    return f"Filler: {ai}{who}, {e.get('license') or 'licence unknown'}. To be replaced."


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", default=str(pp.DEFAULT_OUT))
    ap.add_argument("--only", nargs="*", default=None, help="pack keys to (re)build, e.g. scenes/food people/ton")
    a = ap.parse_args(argv)
    out = Path(a.out)
    spec = json.loads(SPEC.read_text(encoding="utf8"))
    m = pp.load_manifest(out)
    m["filler"] = True
    m["credit"] = FILLER_LINE
    eng = pp.engine(argparse.Namespace(midas=str(HERE / "work" / "models" / "midas-small.onnx")))
    want = lambda key: a.only is None or key in a.only

    credits = []
    # generated cast (gen_cast.py): AI-generated locally, every expression found on disk
    gen = SRC / "people"
    glog = json.loads((gen / "gen_log.json").read_text(encoding="utf8")) if (gen / "gen_log.json").exists() else {}
    for who in sorted(p.name for p in gen.iterdir() if p.is_dir()) if gen.exists() else []:
        exprs = {}
        for e in pp.EXPRESSIONS:
            if (gen / who / f"{e}.png").exists():
                g = glog.get(f"{who}/{e}", {})
                exprs[e] = {
                    "what": f"{who.capitalize()} ({e}): AI-generated filler portrait of a fictional person",
                    "file": f"people/{who}/{e}.png", "file_url": None,
                    "source_url": "https://huggingface.co/segmind/SSD-1B + https://huggingface.co/latent-consistency/lcm-ssd-1b",
                    "creator": "Generated locally (pipeline/gen_cast.py), seed %s" % g.get("seed", "?"),
                    "license": "Model output: SSD-1B (Apache-2.0) + LCM-SSD-1B (CreativeML OpenRAIL++-M)",
                    "license_url": "https://huggingface.co/latent-consistency/lcm-ssd-1b",
                    "licensed": True, "ai_generated": True,
                    "changes": "generated, then aligned on the eyes, cut out, graded to low-key monochrome, depth added",
                }
        if exprs:
            spec.setdefault("people", {})[who] = {"expressions": exprs}
    # people: one entry per person, one source per expression
    for who, person in spec.get("people", {}).items():
        exprs = {}
        for expr, e in person["expressions"].items():
            credits.append({"pack": f"{who}/{expr}", **{k: e.get(k) for k in ("what", "creator", "license", "license_url", "licensed", "source_url", "ai_generated")}, "changes": e.get("changes", "aligned on the eyes, cut out, graded to low-key monochrome, depth added")})
            if want(f"people/{who}"):
                exprs[expr] = fetch(e)
        if exprs:
            first = next(iter(person["expressions"].values()))
            pp.pack_person(eng, who, exprs, out, m, credit=credit_line(first), sources={k: v["source_url"] for k, v in person["expressions"].items()})
    # objects and scenes
    for kind in ("objects", "scenes"):
        for id_, e in spec.get(kind, {}).items():
            credits.append({"pack": f"{kind}/{id_}", **{k: e.get(k) for k in ("what", "creator", "license", "license_url", "licensed", "source_url", "ai_generated")}, "changes": e.get("changes", "cut out and centred, graded to low-key monochrome, depth added" if kind == "objects" else "cropped to 16:10, graded to low-key monochrome, depth added")})
            if not want(f"{kind}/{id_}"):
                continue
            if e.get("alias_of"):
                continue
            src = fetch(e)
            size = tuple(e.get("size", (384, 240))) if kind == "scenes" else e.get("size", 256)
            pp.pack_still(eng, kind, id_, src, out, m, size, credit=credit_line(e), extent=e.get("extent", 0.6), crop_x=e.get("crop_x", 0.5), crop_y=e.get("crop_y", 0.5), source=e["source_url"])
        # aliases: an id that shows another pack (e.g. 'banknote' shows the coins)
        for id_, e in spec.get(kind, {}).items():
            if e.get("alias_of") and e["alias_of"] in m[kind]:
                m[kind][id_] = dict(m[kind][e["alias_of"]])
    pp.save_manifest(out, m)
    # credits: the manifest's packs only (an image whose depth was rejected is not listed)
    packed = set()
    for who, p in m["people"].items():
        packed |= {f"{who}/{e}" for e in p.get("expressions", {})}
    for kind in ("objects", "scenes"):
        packed |= {f"{kind}/{i}" for i in m[kind]}
    images = [c for c in credits if c["pack"] in packed]
    doc = {"filler": True, "note": FILLER_LINE, "people_note": "People shown are AI-generated filler portraits of fictional people, made locally with a free open image model; not real people.", "images": images}
    (out / "credits.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf8")
    print(f"wrote {out / 'credits.json'} ({len(images)} images)")
    total = sum(p.stat().st_size for p in out.rglob("*") if p.is_file())
    print(f"pack folder total {total / 1e6:.2f} MB")


if __name__ == "__main__":
    main()
