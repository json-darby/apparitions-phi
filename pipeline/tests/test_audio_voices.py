"""Voice audition on mock voices: every Chirp voice from list_voices plus
Gemini voices, scored automatically, ranked per gender, a bad voice shown as
not eligible, the audition page written, picks saved (auto and --pick)."""

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
from phi_pipeline.audio import voices as V
from phi_pipeline.audio.run import run_voices
from phi_pipeline.providers.base import Providers
from phi_pipeline.providers.speech import GEMINI_AUDITION, MockSpeech

BAD = "th-TH-Chirp3-HD-Charon"


def _env(tmp: Path, mp, dry=True):
    work = tmp / "work"
    mp.setattr(config, "WORK", work)
    mp.setattr(ledger, "WORK", work)
    mp.setattr(ledger, "LEDGER", work / "ledger.jsonl")
    led = ledger.Ledger(dry=dry)
    sp = MockSpeech(led)
    return work, sp, Providers(None, sp, None, led, dry)


@pytest.fixture(scope="module")
def audition():
    mp = pytest.MonkeyPatch()
    tmp = _fresh("voices")
    work, sp, prov = _env(tmp, mp)
    sp.inject("tone", "*", BAD)  # this voice gets every tone wrong
    args = Namespace(gemini=["Kore", "Puck"], words=15, sentences=2, numbers=2, workers=4,
                     state=work / "dry" / "audio-state")
    out = run_voices(prov, args)
    data = json.loads((work / "dry" / "voices" / "audition.json").read_text(encoding="utf8"))
    yield {"work": work, "out": out, "data": data, "sp": sp, "prov": prov, "args": args}
    mp.undo()


def test_audio_voices_audition_covers_every_voice(audition):
    data, sp = audition["data"], audition["sp"]
    names = {r["name"] for rows in data["ranked"].values() for r in rows}
    assert names == set(sp.chirp_voices) | {"Kore", "Puck"}
    for sex, rows in data["ranked"].items():
        assert all(r["gender"] == sex for r in rows)
        assert [r["rank"] for r in rows] == list(range(1, len(rows) + 1))
        for r in rows:
            for k in ("tone", "toneSlow", "cer", "mos", "slowAgree", "loudnessSd", "consistency", "eligible"):
                assert k in r
            endings = [s["thai"] for s in r["samples"] if s["group"] == "ending"]
            assert ("ครับ" in endings) == (sex == "m") and ("ค่ะ" in endings) == (sex == "f")


def test_audio_voices_bad_voice_not_eligible(audition):
    rows = {r["name"]: r for rs in audition["data"]["ranked"].values() for r in rs}
    assert not rows[BAD]["eligible"] and rows[BAD]["tone"] < 0.95
    good = [r for n, r in rows.items() if n != BAD]
    assert all(r["eligible"] for r in good), [(r["name"], r["why"]) for r in good if not r["eligible"]]
    assert all(r["tone"] >= 0.95 for r in good)
    male = audition["data"]["ranked"]["m"]
    assert male[-1]["name"] == BAD  # ineligible voices rank last


def test_audio_voices_page(audition):
    page = (audition["work"] / "dry" / "voices" / "audition.html").read_text(encoding="utf8")
    n_samples = sum(len(r["samples"]) for rs in audition["data"]["ranked"].values() for r in rs)
    assert page.count("<audio ") == n_samples
    assert "not eligible" in page and "Female voices" in page and "Male voices" in page
    assert "<script" not in page and "http" not in page  # self-contained, writes nothing
    rel = re.search(r"src='([^']+\.ogg)'", page).group(1)
    assert (audition["work"] / "dry" / "voices" / rel).exists()


def test_audio_voices_auto_and_owner_picks(audition):
    work = audition["work"]
    vj = json.loads((work / "dry" / "voices.json").read_text(encoding="utf8"))
    female = [r["name"] for r in audition["data"]["ranked"]["f"] if r["eligible"] and r["engine"] == "chirp"]
    male = [r["name"] for r in audition["data"]["ranked"]["m"] if r["eligible"] and r["engine"] == "chirp"]
    assert [vj["f1"], vj["f2"]] == female[:2] and [vj["m1"], vj["m2"]] == male[:2]
    assert BAD not in (vj["m1"], vj["m2"])
    assert vj["x1"] == "Kore" and vj["x2"] == "Puck"
    assert set(vj["cast"]) == {"nok", "ton", "ploy", "lek", "mai", "bank", "fah", "pim"}
    assert len(set(vj["cast"].values())) == 8
    assert vj["source"]["f1"] == "auto"
    # owner pick by ear, then an auto re-run must not overwrite it
    run_voices(audition["prov"], Namespace(pick=["f1=th-TH-Chirp3-HD-Aoede", "nok=Leda"]))
    V.write_picks(work / "dry" / "voices.json", {"f1": female[0]}, "auto")
    vj = json.loads((work / "dry" / "voices.json").read_text(encoding="utf8"))
    assert vj["f1"] == "th-TH-Chirp3-HD-Aoede" and vj["source"]["f1"] == "owner" and vj["cast"]["nok"] == "Leda"
    with pytest.raises(SystemExit):
        V.parse_picks(["f1"])


def test_audio_voices_profiles_and_model(audition):
    st = audition["args"].state
    prof = json.loads((st / "profiles.json").read_text(encoding="utf8"))
    assert all(p["source"].endswith("qualification") for p in prof.values())
    model = json.loads((st / "tone_model.json").read_text(encoding="utf8"))
    assert set(model["proto"]) == {"mid", "low", "falling", "high", "rising"}


def test_audio_voices_full_audition_estimate_under_2_dollars():
    from phi_pipeline.providers.speech import VOICE_SEX

    chirp = [{"name": f"th-TH-Chirp3-HD-{n}", "gender": g} for n, g in VOICE_SEX.items()]  # all 30
    gem = [{"name": n, "gender": VOICE_SEX[n]} for n in GEMINI_AUDITION]
    est = V.estimate(chirp + gem)
    assert len(chirp) == 30 and est < 2.0, est


def test_audio_voices_refuses_over_budget_when_real(monkeypatch):
    work, sp, prov = _env(_fresh("voices-budget"), monkeypatch, dry=False)
    with pytest.raises(SystemExit):
        run_voices(prov, Namespace(audition_budget=0.01, state=work / "audio"))
    assert sp.calls["tts"] == 0
