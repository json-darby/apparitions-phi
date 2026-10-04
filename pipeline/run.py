"""Phi content pipeline: the command line.

    python run.py estimate                 cost table for the 30- and 60-day courses (no calls)
    python run.py probe                    one tiny call per model (needs credentials; < $0.50)
    python run.py text      [--dry-run]    generate the course text, day by day (resumes)
    python run.py verify    [--dry-run]    checks + second-model pass; regenerate failures (max 2), drop the rest
    python run.py pack      [--dry-run]    write course.json (dry: pipeline/work/dry/course.json)
    python run.py voices    [--dry-run]    qualify voices on tone-pair words      (audio stage)
    python run.py audio     [--dry-run]    every clip                               (audio stage)
    python run.py audio-check [--dry-run]  transcribe back, pitch, agreement        (audio stage)
    python run.py images    [--dry-run]    portraits, scenes, objects (style still being decided; not in `all`)
    python run.py all       [--dry-run]    text, verify, pack, voices, audio, audio-check
    python run.py ledger                   what has been spent

Every subcommand takes --dry-run: mock providers, no network, no cost. Video
generation is not part of this run.
"""

from __future__ import annotations

import argparse
import importlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:  # Windows consoles default to a legacy code page; Thai and box characters need UTF-8
    sys.stdout.reconfigure(encoding="utf-8")  # type: ignore[attr-defined]
except Exception:  # noqa: BLE001
    pass

from phi_pipeline.config import MODELS, PRICES, budget_usd, course_days  # noqa: E402
from phi_pipeline.ledger import Ledger  # noqa: E402
from phi_pipeline.providers.base import Providers, credentials_present, get_providers  # noqa: E402


# ---------------------------------------------------------------- providers

class _Missing:
    """Stands in for a provider whose module is not built yet; fails only if used."""

    def __init__(self, what: str):
        self.what = what

    def __getattr__(self, name):
        raise RuntimeError(f"{self.what} is not available yet (its module has not been built)")


def providers_for(dry: bool) -> Providers:
    try:
        return get_providers(dry)
    except ImportError as e:  # speech.py or media.py not built yet: text stages still work
        from phi_pipeline.providers import base

        base.load_env()
        if not dry and not credentials_present():
            raise SystemExit("No credentials. Put PHI_GCP_PROJECT or PHI_API_KEY in pipeline/.env.local, or use --dry-run.")
        ledger = Ledger(dry=dry)
        from phi_pipeline.providers.text import MockText, VertexText

        text = MockText(ledger) if dry else VertexText(ledger)

        def opt(mod, cls):
            try:
                return getattr(importlib.import_module(f"phi_pipeline.providers.{mod}"), cls)(ledger)
            except ImportError:
                return _Missing(f"providers.{mod}.{cls}")

        speech = opt("speech", "MockSpeech" if dry else "VertexSpeech")
        media = opt("media", "MockMedia" if dry else "VertexMedia")
        print(f"(note: {e.name or e}: using stand-ins for unbuilt providers)")
        return Providers(text, speech, media, ledger, dry)


def stage_fn(module: str, fn: str):
    """Stages owned by other builders, imported only when present."""
    try:
        return getattr(importlib.import_module(module), fn)
    except (ImportError, AttributeError):
        return None


def run_external(module: str, fn: str, providers, args) -> int:
    f = stage_fn(module, fn)
    if f is None:
        print(f"{module}.{fn} is not built yet; skipped.")
        return 0
    try:
        f(providers, args)
    except ImportError as e:  # the stage exists but a module it needs is still being built
        print(f"{module}.{fn} could not run: {e}; skipped.")
    return 0


# ---------------------------------------------------------------- estimate

def planned_volumes(days: int) -> dict:
    """Volumes the run will produce, from the curriculum (not guesses)."""
    from phi_pipeline.text import curriculum as cur

    es = [e for e in cur.entries() if e.day <= days]
    pats = [p for p in cur.patterns() if p.day <= days]
    tasks = [t for t in cur.tasks() if t.day <= days]
    notes = [c for c in cur.culture_topics() if c.day <= days]
    letters = [l for l in cur.letters() if l.day <= days]
    known_by_day = [sum(1 for e in es if e.day < d) for d in range(1, days + 1)]
    pat_days = sorted({p.day for p in pats})
    nodes = sum(len(t.steps) * 2 for t in tasks)  # about two character turns a step
    opts = nodes * 4
    return dict(days=days, items=len(es), patterns=len(pats), tasks=len(tasks), notes=len(notes), letters=len(letters),
                known_by_day=known_by_day, pat_days=pat_days, nodes=nodes, opts=opts,
                gendered=sum(1 for e in es if "I " in e.en or e.en.startswith("I'")))


def estimate_rows(days: int) -> list[tuple[str, str, str, float]]:
    v = planned_volumes(days)
    R = 1.35  # retries and regenerations (failed items regenerate up to twice)
    sys_tok, rules_tok = 1300, 700
    gi = go = ci = co = 0.0
    for d, known in enumerate(v["known_by_day"], start=1):
        from phi_pipeline.text import curriculum as cur

        n = len(cur.entries_for(d))
        if n:
            gi += sys_tok + rules_tok + known * 22 + n * 30
            go += n * 280 * 1.5  # answer plus thinking
            ci += 600 + n * 170
            co += n * 90 + 1500  # verdicts plus thinking
        if d in v["pat_days"]:
            k = sum(1 for p in cur.patterns() if p.day == d)
            gi += sys_tok + 400 + (known + n) * 22
            go += k * 450 * 1.5
            ci += 600 + k * 200
            co += k * 90 + 1500
    batches = -(-v["notes"] // 10)
    gi += batches * (sys_tok + 500 + sum(v["known_by_day"][-1:]) * 10)
    go += v["notes"] * 220 * 1.5
    ci += batches * 500 + v["notes"] * 200
    co += v["notes"] * 80 + batches * 1500
    avg_known = sum(v["known_by_day"]) / max(1, len(v["known_by_day"]))
    gi += v["tasks"] * (sys_tok + 900 + avg_known * 22)
    go += v["tasks"] * 2800 * 1.5
    ci += v["tasks"] * (400 + 900)
    co += v["tasks"] * (500 + 1500)
    gi, go, ci, co = gi * R, go * R, ci * R, co * R
    gen_m, chk_m = MODELS.generate, MODELS.check
    usd_gen = gi * PRICES.text_in[gen_m] + go * PRICES.text_out[gen_m]
    usd_chk = ci * PRICES.text_in[chk_m] + co * PRICES.text_out[chk_m]

    # audio: texts x 4 Chirp voices x 2 speeds
    chars = (v["items"] * (9 + 26) + v["gendered"] * 12 + v["patterns"] * 2.5 * 16 + v["letters"] * 10
             + v["nodes"] * 22 + v["opts"] * 2 * 20)
    texts = v["items"] * 2 + v["gendered"] + v["patterns"] * 2.5 + v["letters"] + v["nodes"] + v["opts"] * 2
    clips = texts * 8 * 1.15
    usd_chirp = chars * 8 * 1.15 * PRICES.chirp_char
    gem_clips = (v["items"] * 2 + v["nodes"] * 2) * 1.2  # two extra voices on items; cast voices x2 speeds on lines
    gem_secs = gem_clips * 1.8
    usd_gem = gem_secs * PRICES.gemini_tts_second
    stt_secs = (clips + gem_clips) * 2.0 * 1.1
    usd_stt = stt_secs * PRICES.stt_second
    usd_voices = 60 * 6 * 2 * 2.0 * PRICES.stt_second + 60 * 4 * 2 * 6 * PRICES.chirp_char + 60 * 2 * 2 * 1.8 * PRICES.gemini_tts_second
    usd_img = 8 * PRICES.image_ref * 1.5 + 48 * PRICES.image * 1.5 + 36 * PRICES.image * 1.3
    return [
        ("Text generation", gen_m, f"{v['items']} items, {v['patterns']} patterns, {v['notes']} notes, {v['tasks']} tasks; ~{gi / 1e6:.2f}M in, {go / 1e6:.2f}M out", usd_gen),
        ("Text checking (2nd model)", chk_m, f"~{ci / 1e6:.2f}M in, {co / 1e6:.2f}M out (thinking included)", usd_chk),
        ("Main audio", MODELS.tts_main_prefix + "*", f"~{texts:,.0f} texts, {chars * 8 * 1.15 / 1e3:,.0f}k chars over 4 voices x 2 speeds", usd_chirp),
        ("Cast and extra voices", MODELS.tts_gemini, f"~{gem_clips:,.0f} clips, {gem_secs / 60:,.0f} min", usd_gem),
        ("Audio checking", MODELS.stt, f"~{clips + gem_clips:,.0f} clips, {stt_secs / 3600:,.1f} h", usd_stt),
        ("Voice qualification", "Chirp 3 HD + Gemini TTS + STT", "60 words x 6 voices", usd_voices),
        ("Images (style pending)", f"{MODELS.image_ref} + {MODELS.image}", "8 sheets, 48 portraits, ~36 scenes/objects", usd_img),
    ]


def cmd_estimate(args) -> int:
    r30, r60 = estimate_rows(30), estimate_rows(60)
    w = [27, 34, 74, 9, 9]
    line = "+".join("-" * (x + 2) for x in w)
    print(f"Phi pipeline estimate (list prices from config.PRICES; 1M free Chirp characters a month NOT assumed)\n")
    print(f" {'Service':<{w[0]}} | {'Model':<{w[1]}} | {'Volume (60-day course)':<{w[2]}} | {'30 days':>{w[3]}} | {'60 days':>{w[4]}}")
    print(line)
    t30 = t60 = 0.0
    for (s, m, _, a), (_, _, vol, b) in zip(r30, r60):
        print(f" {s:<{w[0]}} | {m[:w[1]]:<{w[1]}} | {vol[:w[2]]:<{w[2]}} | {a:>{w[3]}.2f} | {b:>{w[4]}.2f}")
        t30 += a
        t60 += b
    print(line)
    print(f" {'Total':<{w[0]}} | {'':<{w[1]}} | {'':<{w[2]}} | {t30:>{w[3]}.2f} | {t60:>{w[4]}.2f}")
    print(f"\n Probe (one call per model): under $0.10.  Video: not in this run.")
    print(f" Spending cap (PHI_BUDGET_USD): ${budget_usd():.0f}. Course length (PHI_COURSE_DAYS): {course_days()}.")
    return 0


# ---------------------------------------------------------------- probe

def cmd_probe(args) -> int:
    if not args.dry_run and not credentials_present():
        print("probe: no credentials. Put PHI_GCP_PROJECT (with gcloud application-default login) or PHI_API_KEY in "
              "pipeline/.env.local. Nothing was called.")
        return 2
    p = providers_for(args.dry_run)
    led = p.ledger
    start = led.spent
    results = []

    def step(name, fn):
        try:
            results.append((name, "available", fn()))
        except Exception as e:  # noqa: BLE001
            results.append((name, "NOT AVAILABLE", str(e)[:160]))
        if led.spent - start > 0.50:
            raise SystemExit("probe: passed $0.50; stopped.")

    schema = {"type": "object", "properties": {"ok": {"type": "boolean"}}, "required": ["ok"]}

    def text_call(model, max_out):
        if args.dry_run:
            prov = p.text
        else:
            from phi_pipeline.providers.text import VertexText

            prov = VertexText(led, max_output_tokens=max_out)
        r = prov.generate_json(stage="probe", model=model, system="Answer with JSON only.",
                               prompt='Return {"ok": true}.', schema=schema, temperature=0.0)
        return f"{model}: {r.data} ({r.tokens_in} in, {r.tokens_out} out)"

    step("text (generate)", lambda: text_call(MODELS.generate, 1024))
    step("text (check)", lambda: text_call(MODELS.check, 1024))
    voices: list = []

    def list_voices():
        voices.extend(p.speech.list_voices("th-TH"))
        return f"{len(voices)} Thai Chirp 3 HD voices: {', '.join(v['name'].split('-')[-1] for v in voices[:8])}"

    step("tts: list voices", list_voices)
    audio: list = []

    def chirp():
        name = voices[0]["name"] if voices else MODELS.tts_main_prefix + "Kore"
        a = p.speech.tts(stage="probe", text="สวัสดี", voice=name)
        audio.append(a)
        return f"{name}: {a.seconds:.2f} s"

    step("tts: Chirp 3 HD", chirp)

    def gem():
        a = p.speech.tts(stage="probe", text="สวัสดี", voice="Kore", model=MODELS.tts_gemini)
        audio.append(a)
        return f"{MODELS.tts_gemini}/Kore: {a.seconds:.2f} s"

    step("tts: Gemini TTS", gem)

    def stt():
        if not audio:
            raise RuntimeError("no audio to transcribe (TTS failed)")
        t = p.speech.stt(stage="probe", audio=audio[0])
        return f"{MODELS.stt}: '{t.text}' ({t.confidence:.2f})"

    step("stt", stt)

    def image():
        im = p.media.image(stage="probe", prompt="A plain mid-grey square, nothing else.", aspect="1:1")
        return f"{MODELS.image}: {len(im.data)} bytes {im.mime}"

    step("image", image)
    print(f"{'Probe':<20} {'Result':<14} Detail")
    for name, status, detail in results:
        print(f"{name:<20} {status:<14} {detail}")
    print(f"\nSpent on probe: ${led.spent - start:.4f}{' (dry run: nothing)' if args.dry_run else ''}. Video: not probed in this run.")
    return 0


# ---------------------------------------------------------------- stages

def cmd_text(args) -> int:
    from phi_pipeline.text.generate import run_text

    run_text(providers_for(args.dry_run), args)
    return 0


def cmd_verify(args) -> int:
    from phi_pipeline.text.verify import run_verify

    run_verify(providers_for(args.dry_run), args)
    return 0


def cmd_pack(args) -> int:
    from phi_pipeline.pack import run_pack

    run_pack(providers_for(args.dry_run), args)
    return 0


def cmd_audio(args) -> int:
    return run_external("phi_pipeline.audio.run", "run_audio", providers_for(args.dry_run), args)


def cmd_audio_check(args) -> int:
    return run_external("phi_pipeline.audio.run", "run_audio_check", providers_for(args.dry_run), args)


def cmd_voices(args) -> int:
    return run_external("phi_pipeline.audio.run", "run_voices", providers_for(args.dry_run), args)


def cmd_images(args) -> int:
    return run_external("phi_pipeline.assets.run", "run_images", providers_for(args.dry_run), args)


def cmd_all(args) -> int:
    for fn in (cmd_text, cmd_verify, cmd_pack, cmd_voices, cmd_audio, cmd_audio_check):
        print(f"== {fn.__name__[4:].replace('_', '-')}")
        rc = fn(args)
        if rc:
            return rc
    print("(images are not part of `all` while the image style is being decided; run `images` on its own.)")
    return 0


def cmd_ledger(args) -> int:
    led = Ledger(dry=True)
    print(json.dumps(led.summary(), indent=1))
    return 0


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="run.py", description="Phi content pipeline")
    sub = ap.add_subparsers(dest="cmd", required=True)
    cmds = {
        "estimate": cmd_estimate, "probe": cmd_probe, "text": cmd_text, "verify": cmd_verify, "pack": cmd_pack,
        "audio": cmd_audio, "audio-check": cmd_audio_check, "voices": cmd_voices, "images": cmd_images,
        "all": cmd_all, "ledger": cmd_ledger,
    }
    for name in cmds:
        sp = sub.add_parser(name)
        sp.add_argument("--dry-run", action="store_true", help="mock providers: no network, no cost")
        if name in ("text", "all"):
            sp.add_argument("--days", help="only these days, e.g. 1-5 (culture and tasks run on full runs)")
            sp.add_argument("--force", action="store_true", help="regenerate even what exists")
        if name in ("audio", "audio-check", "voices"):
            # the audio stage's own flags (--pick f1=..., --workers, --limit, ...)
            try:
                from phi_pipeline.audio.run import add_arguments
                add_arguments(sp, "voices" if name == "voices" else "audio")
            except ImportError:
                pass
    args = ap.parse_args(argv)
    return cmds[args.cmd](args)


if __name__ == "__main__":
    raise SystemExit(main())
