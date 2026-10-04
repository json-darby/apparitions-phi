"""Dry run end to end: text -> verify -> pack produces a course.json that
matches CONTRACT.md and the app's TypeScript types, without touching the app
or the network. Runs in a temporary work directory."""

from __future__ import annotations

import json
import re
import sys
from argparse import Namespace
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from phi_pipeline import config, ledger, pack
from phi_pipeline.config import APP
from phi_pipeline.text import common
from phi_pipeline.text.course_schema import CULTURE, ITEM, LETTER, PATTERN, TASK, validate, validate_course

TYPES_TS = APP / "src" / "content" / "types.ts"


@pytest.fixture(scope="module")
def dry_course(tmp_path_factory):
    work = tmp_path_factory.mktemp("work")
    mp = pytest.MonkeyPatch()
    for mod in (common, pack, config):
        mp.setattr(mod, "WORK", work)
    mp.setattr(ledger, "WORK", work)
    mp.setattr(ledger, "LEDGER", work / "ledger.jsonl")
    mp.setenv("PHI_COURSE_DAYS", "30")
    app_file = config.OUT_CONTENT / "course.json"
    app_before = app_file.stat().st_mtime if app_file.exists() else None
    import run as cli

    args = Namespace(dry_run=True, days=None, force=False)
    assert cli.cmd_text(args) == 0
    assert cli.cmd_verify(args) == 0
    assert cli.cmd_pack(args) == 0
    path = work / "dry" / "course.json"
    course = json.loads(path.read_text(encoding="utf8"))
    app_after = app_file.stat().st_mtime if app_file.exists() else None
    yield {"course": course, "work": work, "cli": cli, "args": args, "app_untouched": app_before == app_after}
    mp.undo()


def test_dry_writes_only_to_work(dry_course):
    assert pack.course_path(True).is_relative_to(dry_course["work"])
    assert dry_course["app_untouched"]  # a dry run never writes the app's course.json
    assert pack.course_path(False) == config.OUT_CONTENT / "course.json"


def test_course_matches_contract(dry_course):
    c = dry_course["course"]
    assert validate_course(c) == []
    assert re.fullmatch(r"course-\d{4}-\d{2}-\d{2}-[0-9a-f]{10}", c["version"])
    assert c["courseDays"] == 30
    assert len(c["items"]) > 300
    assert len(c["letters"]) >= 48
    assert len(c["culture"]) == 30
    assert len(c["tasks"]) >= 30
    assert all(i["status"] == "checked" for i in c["items"])
    for i in c["items"]:
        assert set(i["media"]["audio"]) == {f"{v}.{s}" for v in "f1 f2 m1 m2".split() for s in ("normal", "slow")}
        assert all(x is None for x in i["media"]["audio"].values())
        assert len(i["tones"]) == len(common.syllables(i["roman"]))


def test_drafts_and_drops_are_excluded(dry_course):
    c = dry_course["course"]
    packed = {f"item:{i['id']}" for i in c["items"]}
    for ref, chk in c["checks"].items():
        if ref.startswith("item:") and chk["status"] != "pass":
            assert ref not in packed


def test_task_lines_use_only_packed_items_and_both_forms(dry_course):
    c = dry_course["course"]
    ids = {i["id"] for i in c["items"]}
    days = {i["id"]: i["day"] for i in c["items"]}
    for t in c["tasks"]:
        for nid, n in t["nodes"].items():
            assert 3 <= len(n["options"]) <= 5
            assert f"{t['id']}.{nid}" in c["lines"]
            for i, o in enumerate(n["options"]):
                assert set(o["items"]) <= ids
                assert all(days[x] <= t["day"] for x in o["items"]), (t["id"], o["items"])
                assert o["forms"]["m"]["thai"].endswith("ครับ") or o["end"] == "none"
                assert not o["forms"]["f"]["thai"].endswith("ครับ")
                assert c["lines"][f"{t['id']}.{nid}.{i}"]["speaker"] == "you"


def test_lines_cover_every_played_phrase(dry_course):
    c = dry_course["course"]
    for i in c["items"]:
        if i.get("example"):
            assert c["lines"][f"example.{i['id']}"]["thai"] == i["example"]["thai"]
        if i.get("polite"):
            assert not i["thai"].endswith(("ครับ", "ค่ะ", "คะ"))
    for p in c["patterns"]:
        for n, tiles in enumerate(p["examples"]):
            assert c["lines"][f"pattern.{p['id']}.{n}"]["thai"] == "".join(t["thai"] for t in tiles)
    assert all(l.get("speaker") and l.get("roman") is not None for l in c["lines"].values())
    assert all(l.get("nameThai") for l in c["letters"])


def test_resume_makes_no_new_calls(dry_course):
    cli, args, work = dry_course["cli"], dry_course["args"], dry_course["work"]
    before = (work / "ledger.jsonl").read_text(encoding="utf8").count("\n")
    cli.cmd_text(args)
    cli.cmd_verify(args)
    after = (work / "ledger.jsonl").read_text(encoding="utf8").count("\n")
    assert after == before


def test_repack_keeps_media(dry_course):
    work = dry_course["work"]
    c = pack.load_course(True)
    c["items"][0]["media"]["audio"]["f1.normal"] = "audio/item/x/f1.normal.ogg"
    c["voices"] = {"f1": "th-TH-Chirp3-HD-Kore"}
    pack.save_course(c, dry=True)
    dry_course["cli"].cmd_pack(dry_course["args"])
    c2 = pack.load_course(True)
    assert c2["items"][0]["media"]["audio"]["f1.normal"] == "audio/item/x/f1.normal.ogg"
    assert c2["voices"]["f1"] == "th-TH-Chirp3-HD-Kore"
    assert (work / "dry" / "course.json").exists()


def test_save_course_rejects_bad_shapes(dry_course):
    c = pack.load_course(True)
    c["items"][0]["surprise"] = 1
    with pytest.raises(ValueError):
        pack.save_course(c, dry=True)


# ---- the course schema against the app's TypeScript types

def ts_fields(interface: str) -> set[str]:
    src = TYPES_TS.read_text(encoding="utf8")
    body = src[src.index(f"export interface {interface} {{"):]
    body = body[: body.index("\n}")]
    return set(re.findall(r"^  (\w+)\??:", body, re.M))


@pytest.mark.parametrize("iface,schema", [("Item", ITEM), ("Letter", LETTER), ("Pattern", PATTERN),
                                          ("CultureNote", CULTURE)])
def test_schema_fields_match_types_ts(iface, schema):
    extras = {"nameThai"} if iface == "Letter" else set()  # pipeline extra for the audio stage
    assert set(schema["properties"]) - extras == ts_fields(iface)


def test_task_schema_covers_street_task():
    assert ts_fields("StreetTask") <= set(TASK["properties"])


def test_validator_catches_errors():
    assert validate({"a": 1}, {"type": "object", "required": ["b"]})
    assert validate("x", {"enum": ["y"]})
    assert validate([1, "a"], {"type": "array", "items": {"type": "integer"}})


def test_compose_matches_app_rules():
    items = {"hello": {"id": "hello", "thai": "สวัสดี", "roman": "sà-wàt-dii"},
             "i-male": {"id": "i-male", "thai": "ผม", "roman": "phǒm"},
             "i-female": {"id": "i-female", "thai": "ฉัน", "roman": "chǎn"}}
    m = common.compose(["hello"], "m", "s", items)
    f = common.compose(["hello"], "f", "q", items)
    assert m["thai"] == "สวัสดีครับ" and m["items"] == ["hello", "khrap"] and m["tones"][-1] == "high"
    assert f["thai"] == "สวัสดีคะ" and f["roman"].endswith("khá")
    assert common.compose(["I"], "f", None, items)["thai"] == "ฉัน"
    assert common.compose([], "f", "s", items)["thai"] == "ค่ะ"


def test_probe_refuses_without_credentials(monkeypatch, capsys):
    import run as cli

    monkeypatch.setattr(cli, "credentials_present", lambda: False)
    assert cli.cmd_probe(Namespace(dry_run=False)) == 2
    assert "no credentials" in capsys.readouterr().out


def test_estimate_prints_table(capsys):
    import run as cli

    assert cli.cmd_estimate(Namespace(dry_run=False)) == 0
    out = capsys.readouterr().out
    assert "Total" in out and "Video: not in this run" in out
    total60 = float(re.search(r"Total.*\|\s*([\d.]+)\s*\|\s*([\d.]+)", out).group(2))
    assert 20 < total60 < 150
