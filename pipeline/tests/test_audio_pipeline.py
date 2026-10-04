"""Audio stages end to end on mock speech: generate -> STT check -> pitch
check -> quality checks -> course.json updated. Also resumability, the retry
policy, injected faults and the budget cap. Everything runs in a temporary
work folder with MockSpeech: no network, no cost, nothing written to the app."""

from __future__ import annotations

import json
import re
import sys
from argparse import Namespace
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


# Temporary folders live under pipeline/work/test-audio (the project's own work
# area), not the system temp folder.
_TEST_ROOT = Path(__file__).resolve().parents[1] / "work" / "test-audio"


def _fresh(name: str) -> Path:
    import shutil

    d = _TEST_ROOT / re.sub(r"[^A-Za-z0-9_.-]", "_", name)
    shutil.rmtree(d, ignore_errors=True)
    d.mkdir(parents=True)
    return d

from phi_pipeline import config, ledger
from phi_pipeline.audio import run as arun
from phi_pipeline.audio import texts as tx
from phi_pipeline.providers.base import Providers
from phi_pipeline.providers.speech import MockSpeech


def _media():
    return {"audio": {}, "pitch": None, "image": None, "animation": None}


def _item(id, thai, roman, tones, en, **kw):
    it = {"id": id, "kind": "phrase" if " " in roman else "word", "thai": thai, "roman": roman, "tones": tones, "en": en,
          "theme": "greetings", "day": 1, "survival": True, "skills": ["hear", "say"], "tags": [], "status": "checked",
          "media": _media()}
    it.update(kw)
    return it


COURSE = {
    "version": "", "generatedAt": "", "courseDays": 30, "voices": {},
    "items": [
        _item("hello", "สวัสดี", "sà-wàt-dii", ["low", "low", "mid"], "hello", polite="statement"),
        _item("horse", "ม้า", "máa", ["high"], "horse", contrasts=["dog"]),
        _item("dog", "หมา", "mǎa", ["rising"], "dog", contrasts=["horse"],
              example={"thai": "หมาตัวนี้น่ารัก", "roman": "mǎa dtua níi nâa-rák", "en": "this dog is cute"}),
        _item("rice", "ข้าว", "khâao", ["falling"], "rice", contrasts=["horse"]),
        _item("i", "ผม", "phǒm", ["rising"], "I", forms={"m": {"thai": "ผม", "roman": "phǒm"}, "f": {"thai": "ฉัน", "roman": "chǎn"}}),
        _item("khrap", "ครับ", "khráp", ["high"], "polite ending (male)", speaker="m"),
    ],
    "letters": [{"id": "l-gor", "char": "ก", "name": "gor gài", "keyword": "chicken", "initial": "g", "final": "k",
                 "cls": "mid", "day": 1, "strokes": None, "lookalikes": [], "skills": ["read"], "status": "checked",
                 "media": _media()}],
    "patterns": [{"id": "p-mai-not", "frame": "ไม่ + verb", "en": "not", "note": "", "day": 2, "skills": ["read"],
                  "status": "checked", "media": _media(),
                  "examples": [[{"thai": "ไม่", "roman": "mâi", "en": "not"},
                                {"thai": "เผ็ด", "roman": "phèt", "en": "spicy", "slot": True}]]}],
    "culture": [], "tasks": [],
    "lines": {
        "t1.a": {"thai": "สวัสดีค่ะ", "roman": "sà-wàt-dii khâ", "speaker": "nok", "audio": {}},
        "t1.a.0": {"thai": "สวัสดีครับ", "roman": "sà-wàt-dii khráp", "speaker": "you", "audio": {},
                   "forms": {"m": {"thai": "สวัสดีครับ", "roman": "sà-wàt-dii khráp", "tones": ["low", "low", "mid", "high"]},
                             "f": {"thai": "สวัสดีค่ะ", "roman": "sà-wàt-dii khâ", "tones": ["low", "low", "mid", "falling"]}}},
    },
    "checks": {},
}

F1, F2 = "th-TH-Chirp3-HD-Achernar", "th-TH-Chirp3-HD-Callirrhoe"
M1, M2 = "th-TH-Chirp3-HD-Alnilam", "th-TH-Chirp3-HD-Iapetus"


class Env:
    def __init__(self, tmp: Path, mp: pytest.MonkeyPatch, dry: bool = True):
        self.work = tmp / "work"
        mp.setattr(config, "WORK", self.work)
        mp.setattr(ledger, "WORK", self.work)
        mp.setattr(ledger, "LEDGER", self.work / "ledger.jsonl")
        self.led = ledger.Ledger(dry=dry)
        self.speech = MockSpeech(self.led)
        self.providers = Providers(None, self.speech, None, self.led, dry)
        self.course = tmp / "course.json"
        self.course.write_text(json.dumps(COURSE, ensure_ascii=False), encoding="utf8")
        self.out = self.work / "dry"
        self.state = self.work / "dry" / "audio-state"

    def args(self, **kw):
        base = dict(course=self.course, out=self.out, state=self.state, workers=4)
        base.update(kw)
        return Namespace(**base)

    def load(self) -> dict:
        return json.loads(self.course.read_text(encoding="utf8"))


@pytest.fixture(scope="module")
def run_once():
    """One full mock run shared by the end-to-end assertions, with faults."""
    tmp = _fresh("pipeline")
    mp = pytest.MonkeyPatch()
    env = Env(tmp, mp)
    sp = env.speech
    # every take of "rice" in f1 comes out with the wrong tone: recorded, but the tone verdict is advisory
    sp.inject("tone", "ข้าว", F1)
    # and every take of "rice" in every voice is transcribed as another word: no clean clip -> item dropped
    sp.inject("stt", "ข้าว")
    # one bad take each, fixed by the single retry
    sp.inject("stt", "ม้า", M1, times=1)
    sp.inject("clip", "หมา", M2, times=1)
    sp.inject("trunc", "ผม", M1, times=1)
    sp.inject("silence", "สวัสดีค่ะ", F2, times=1)
    gen = arun.run_audio(env.providers, env.args())
    calls_after_gen = sp.calls["tts"]
    again = arun.run_audio(env.providers, env.args())
    calls_after_again = sp.calls["tts"]
    chk = arun.run_audio_check(env.providers, env.args())
    report = json.loads((env.state / "check-report.json").read_text(encoding="utf8"))
    yield {"env": env, "gen": gen, "again": again, "chk": chk, "report": report,
           "calls": (calls_after_gen, calls_after_again), "course": env.load()}
    mp.undo()


def test_audio_generates_every_clip_in_dry_folder(run_once):
    env, gen = run_once["env"], run_once["gen"]
    assert gen["status"].get("made") == gen["clips"]
    files = list(env.out.rglob("*.ogg"))
    assert len(files) == gen["clips"]
    assert all(env.work.resolve() in f.resolve().parents for f in files)
    assert files[0].read_bytes()[:4] == b"OggS"


def test_audio_is_resumable(run_once):
    gen_calls, again_calls = run_once["calls"]
    assert again_calls == gen_calls, "a second run must not call TTS again"
    assert run_once["again"]["status"].get("skipped") == run_once["gen"]["clips"]


def test_audio_texts_and_keys(run_once):
    course = run_once["course"]
    items = {i["id"]: i for i in course["items"]}
    hello = items["hello"]["media"]["audio"]
    assert set(hello) == {f"{v}.{s}" for v in tx.CHIRP_SLOTS + tx.EXTRA_SLOTS for s in tx.SPEEDS}
    assert hello["f1.normal"] == "audio/item/hello/f1.normal.ogg"
    rep = run_once["report"]["texts"]
    assert "audio/item/hello/f1.normal.ogg" in rep["audio/item/hello#f"]["clips"]  # female voices say สวัสดีค่ะ
    assert "audio/item/hello/m2.slow.ogg" in rep["audio/item/hello#m"]["clips"]  # male voices say สวัสดีครับ
    assert "audio/item/i/f1.normal.ogg" in rep["audio/item/i#f"]["clips"]  # ฉัน
    assert set(items["khrap"]["media"]["audio"]) == {"m1.normal", "m1.slow", "m2.normal", "m2.slow", "x2.normal", "x2.slow"}
    lines = course["lines"]
    assert lines["example.dog"]["thai"] == "หมาตัวนี้น่ารัก"
    # sentences get 2 voices (one woman, one man) at normal speed only; the app slows them itself
    assert set(lines["example.dog"]["audio"]) == {"f1.normal", "m1.normal"}
    assert lines["example.dog"]["audio"]["f1.normal"] == "audio/example/dog/f1.normal.ogg"
    assert lines["pattern.p-mai-not.0"]["thai"] == "ไม่เผ็ด"
    assert lines["pattern.p-mai-not.0"]["audio"]["m1.normal"] == "audio/pattern/p-mai-not.0/m1.normal.ogg"
    assert course["letters"][0]["media"]["audio"]["f1.normal"] == "audio/letter/l-gor/f1.normal.ogg"
    # an NPC line is voiced by the cast member alone; the other voices of that sex are added only when
    # that take fails its checks (test_audio_other_voices_when_none_is_clean)
    assert course["lines"]["t1.a"]["audio"] == {"nok.normal": "audio/lines/t1.a/nok.normal.ogg"}
    assert set(course["lines"]["t1.a.0"]["audio"]) == {"f1.normal", "m1.normal"}
    assert course["voices"]["f1"].startswith("th-TH-Chirp3-HD-") and course["voices"]["nok"]


def test_audio_check_updates_course(run_once):
    course, chk = run_once["course"], run_once["chk"]
    items = {i["id"]: i for i in course["items"]}
    pc = items["hello"]["media"]["pitch"]  # one 16-point array per syllable of สวัสดี (no ending), 0..1
    assert len(pc) == 3 and all(len(s) == 16 for s in pc)
    assert all(v is None or 0 <= v <= 1 for s in pc for v in s)
    c = course["checks"]["item:horse"]
    assert c["stt"] == "pass" and c["audio"] == "pass" and c["pitch"] >= 0.9 and c["agree"] >= 0.75
    for k in ("clipping", "truncation", "silence", "duration", "glitch", "loudness", "mos", "sttConf"):
        assert k in c
    assert abs(c["loudness"] - (-16)) < 1.0
    for ref in ("letter:l-gor", "line:pattern.p-mai-not.0", "line:t1.a", "line:t1.a.0", "line:example.dog", "item:i",
                "item:khrap", "item:hello"):
        assert course["checks"][ref]["audio"] == "pass", (ref, course["checks"][ref])
    assert chk["refs_fail"] == 1


def test_audio_retry_fixes_one_bad_take(run_once):
    rep = run_once["report"]["texts"]
    for key, rel, check in (
        ("audio/item/horse", "audio/item/horse/m1.normal.ogg", "stt"),
        ("audio/item/dog", "audio/item/dog/m2.normal.ogg", "clipping"),
        ("audio/item/i#m", "audio/item/i/m1.normal.ogg", "truncation"),
        ("audio/item/hello#f", "audio/item/hello/f2.normal.ogg", "silence"),
    ):
        r = rep[key]["clips"][rel]
        assert r["ok"] and r[check] == "pass", (key, r)
    assert run_once["chk"]["retried"] >= 5
    assert run_once["course"]["checks"]["item:dog"]["audio"] == "pass"


def test_audio_no_clean_clip_twice_drops_item(run_once):
    course = run_once["course"]
    assert "rice" not in {i["id"] for i in course["items"]}
    c = course["checks"]["item:rice"]
    assert c["audio"] == "fail" and c["stt"] == "fail"
    clip = run_once["report"]["texts"]["audio/item/rice"]["clips"]["audio/item/rice/f1.normal.ogg"]
    # the wrong tone is still measured and recorded, but it is not what rejected the clip
    assert clip["pitch"] == "fail" and clip["tonesHeard"] != ["falling"]
    assert "pitch" not in clip["why"] and "stt" in clip["why"]
    assert "rice" in run_once["chk"]["dropped_items"]


def test_audio_one_bad_voice_does_not_drop_item(run_once):
    # a clip that fails twice is removed; the word stays while each form keeps a clean normal-speed clip
    course = run_once["course"]
    assert course["checks"]["item:horse"]["audio"] == "pass"
    assert "horse" in {i["id"] for i in course["items"]}


def test_audio_dry_run_never_targets_app(monkeypatch):
    env = Env(_fresh("paths"), monkeypatch)
    with pytest.raises(SystemExit):
        arun.resolve_paths(True, env.args(out=config.APP / "public"))
    p = arun.resolve_paths(True, Namespace(course=config.APP / "public" / "content" / "course.json"))
    assert config.APP.resolve() not in p.course_out.resolve().parents
    assert (env.work / "dry").resolve() in (p.public.resolve() / "x").parents


def test_audio_ledger_refuses_past_cap(monkeypatch):
    """Non-dry ledger with a tiny cap: the run stops itself before passing it,
    and a later run with a higher cap resumes without redoing anything."""
    monkeypatch.setenv("PHI_BUDGET_USD", "0.0005")
    env = Env(_fresh("cap"), monkeypatch, dry=False)  # MockSpeech still: nothing leaves the machine
    a = env.args(only=["item"], ids=["hello", "horse"], workers=1)
    out = arun.run_audio(env.providers, a)
    made = out["status"].get("made", 0)
    assert out["status"].get("budget", 0) > 0 and 0 < made < out["clips"]
    assert env.led.spent <= 0.0005 + 1e-9
    with pytest.raises(ledger.BudgetExceeded):
        env.led.reserve("t", "tts", "x", 0.01)
    monkeypatch.setenv("PHI_BUDGET_USD", "10")
    out2 = arun.run_audio(env.providers, a)
    assert out2["status"].get("skipped", 0) == made
    assert out2["status"].get("made", 0) == out["clips"] - made
