"""Text providers: Gemini on Vertex (structured JSON) and an offline mock.

Both implement providers.base.TextProvider:

    generate_json(*, stage, model, system, prompt, schema, temperature) -> TextResult

Prompts built by phi_pipeline.text carry their data in a machine-readable block
at the end, between <<<REQUEST and REQUEST>>>. The real model reads it as
part of the prompt; MockText parses it to return deterministic, schema-valid
answers so the whole pipeline runs offline with no cost.
"""

from __future__ import annotations

import hashlib
import json
import os
import random
import re
import time
from functools import lru_cache

from ..config import APP, PRICES, load_env
from ..ledger import Ledger
from .base import TextResult

REQUEST_RE = re.compile(r"<<<REQUEST\s*(\{.*\})\s*REQUEST>>>", re.S)


def request_block(data: dict) -> str:
    """The data block appended to every prompt."""
    return "<<<REQUEST\n" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + "\nREQUEST>>>"


def parse_request(prompt: str) -> dict:
    m = REQUEST_RE.search(prompt)
    return json.loads(m.group(1)) if m else {}


# ---------------------------------------------------------------- cost helpers

def est_tokens(text: str) -> int:
    """Conservative token estimate: Thai runs near 1 token per 1-2 characters, English about 4."""
    thai = sum(1 for ch in text if "฀" <= ch <= "๿")
    return int(thai / 1.2 + (len(text) - thai) / 3.0) + 16


def text_cost(model: str, tokens_in: int, tokens_out: int) -> float:
    pin = PRICES.text_in.get(model, max(PRICES.text_in.values()))
    pout = PRICES.text_out.get(model, max(PRICES.text_out.values()))
    return tokens_in * pin + tokens_out * pout


# ---------------------------------------------------------------- Vertex

class VertexText:
    """Gemini through google-genai on Vertex AI. Credentials come from the
    environment only (PHI_GCP_PROJECT with Application Default Credentials, or
    PHI_API_KEY for express mode) and are never logged."""

    MAX_TRIES = 5

    def __init__(self, ledger: Ledger, max_output_tokens: int = 16384):
        load_env()
        from google import genai  # imported here so dry runs never need it

        self.ledger = ledger
        self.max_out = max_output_tokens
        project = os.environ.get("PHI_GCP_PROJECT")
        key = os.environ.get("PHI_API_KEY")
        if project:
            self.client = genai.Client(vertexai=True, project=project,
                                       location=os.environ.get("PHI_GCP_LOCATION") or "global")
        elif key:
            self.client = genai.Client(vertexai=True, api_key=key)
        else:
            raise SystemExit("VertexText: no PHI_GCP_PROJECT or PHI_API_KEY set.")

    def _config(self, system: str, schema: dict, temperature: float, low_thinking: bool = False, model: str = "",
                deep: bool = False):
        from google.genai import types

        kw = dict(system_instruction=system, temperature=temperature, response_mime_type="application/json",
                  max_output_tokens=self.max_out * 2 if deep else self.max_out)
        if deep:
            # branching scripts that may use only taught words: think properly, but bounded so the answer
            # always has room (light thinking failed 44 of 48 tasks on 4 Oct 2026)
            kw["thinking_config"] = types.ThinkingConfig(thinking_budget=12000)
        if low_thinking:
            # Gemini 3 takes a thinking level; Gemini 2.5 only a token budget
            kw["thinking_config"] = (types.ThinkingConfig(thinking_level="low") if model.startswith("gemini-3")
                                     else types.ThinkingConfig(thinking_budget=2048))
        if "response_json_schema" in types.GenerateContentConfig.model_fields:
            kw["response_json_schema"] = schema
        else:
            kw["response_schema"] = schema
        return types.GenerateContentConfig(**kw)

    def generate_json(self, *, stage: str, model: str, system: str, prompt: str, schema: dict,
                      temperature: float = 0.7) -> TextResult:
        est_in = est_tokens(system) + est_tokens(prompt)
        # Conservative: the whole output budget is assumed used, thinking included.
        self.ledger.reserve(stage, "text", model, text_cost(model, est_in, self.max_out))
        # Gemini 3 models think at length by default and ran into the output cap on every day (2 min and
        # $0.06 wasted per call, measured 3 Oct 2026); low thinking answers the same JSON in ~12 s. The
        # checker model (Gemini 2.5) keeps its default.
        deep = stage.startswith("text.tasks")
        config = self._config(system, schema, temperature, low_thinking=model.startswith("gemini-3") and not deep,
                              model=model, deep=deep)
        last: Exception | None = None
        cut_off = 0
        for attempt in range(self.MAX_TRIES):
            try:
                resp = self.client.models.generate_content(model=model, contents=prompt, config=config)
            except Exception as e:  # noqa: BLE001 - decide below whether it is retryable
                last = e
                code = getattr(e, "code", None) or getattr(e, "status_code", None)
                if code in (400, 401, 403, 404):
                    raise RuntimeError(f"{stage}: {model} refused the request ({code}): {_safe(e)}") from None
                time.sleep(min(60, 2 ** attempt + random.random()))
                continue
            um = getattr(resp, "usage_metadata", None)
            t_in = int(getattr(um, "prompt_token_count", 0) or 0) or est_in
            t_out = int(getattr(um, "candidates_token_count", 0) or 0) + int(getattr(um, "thoughts_token_count", 0) or 0)
            self.ledger.record(stage, "text", model, {"in": t_in, "out": t_out}, text_cost(model, t_in, t_out),
                               note=f"try {attempt + 1}")
            fin = str(getattr((resp.candidates or [None])[0], "finish_reason", "") or "")
            if "MAX_TOKENS" in fin:
                # the answer ran out of room (usually long thinking): retry once with less thinking, never
                # the same request again, so a runaway cannot loop on paid calls
                cut_off += 1
                last = RuntimeError(f"answer cut off at {self.max_out} output tokens")
                if cut_off >= 2:
                    break
                config = self._config(system, schema, temperature, low_thinking=True, model=model)
                self.ledger.reserve(stage, "text", model, text_cost(model, est_in, self.max_out))
                continue
            try:
                data = getattr(resp, "parsed", None)
                if data is None:
                    data = json.loads(resp.text or "")
                return TextResult(data, model, t_in, t_out)
            except (json.JSONDecodeError, ValueError) as e:
                last = e  # truncated or malformed JSON: paid for, try again
                if attempt + 1 < self.MAX_TRIES:
                    self.ledger.reserve(stage, "text", model, text_cost(model, est_in, self.max_out))
                time.sleep(min(30, 2 ** attempt))
        raise RuntimeError(f"{stage}: {model} failed after {self.MAX_TRIES} tries: {_safe(last)}")


def _safe(e: Exception | None) -> str:
    """An error message with anything that looks like a key or token removed."""
    s = str(e or "")[:400]
    s = re.sub(r"AIza[0-9A-Za-z_\-]{20,}", "[key]", s)
    s = re.sub(r"ya29\.[0-9A-Za-z_\-.]+", "[token]", s)
    k = os.environ.get("PHI_API_KEY")
    return s.replace(k, "[key]") if k else s


# ---------------------------------------------------------------- Mock

# Real one-syllable Thai words, all mid tone, used to build clearly fake
# multi-syllable "words" for entries the seed set does not cover.
FAKE_SYLLABLES = [
    ("กา", "gaa"), ("ตา", "dtaa"), ("ดี", "dii"), ("มา", "maa"), ("นา", "naa"), ("ปู", "bpuu"), ("งู", "nguu"),
    ("ยา", "yaa"), ("ลม", "lom"), ("บิน", "bin"), ("ดู", "duu"), ("มือ", "mʉʉ"), ("ทาง", "thaang"), ("นอน", "nawn"),
]
_TONE = {"M": "mid", "L": "low", "F": "falling", "H": "high", "R": "rising"}


@lru_cache(maxsize=1)
def seed_lexicon() -> dict[str, dict]:
    """The Phase 1-3 seed items (id -> thai, roman, tones) for realistic dry runs."""
    f = APP / "src" / "content" / "seed.ts"
    if not f.exists():
        return {}
    out = {}
    for m in re.finditer(r"^\s*\['([a-z0-9-]+)', '([^']+)', '([^']+)', '([MLFHR]+)'", f.read_text(encoding="utf8"), re.M):
        out[m.group(1)] = {"thai": m.group(2), "roman": m.group(3), "tones": [_TONE[c] for c in m.group(4)]}
    return out


def _h(*parts) -> int:
    return int(hashlib.sha1("|".join(map(str, parts)).encode("utf8")).hexdigest()[:8], 16)


def fake_word(key: str) -> dict:
    h = _h(key)
    n = 1 + h % 3
    syl = [FAKE_SYLLABLES[(h >> (4 * i)) % len(FAKE_SYLLABLES)] for i in range(n)]
    return {"thai": "".join(s[0] for s in syl), "roman": "-".join(s[1] for s in syl), "tones": ["mid"] * n}


class MockText:
    """Deterministic, offline, free. Answers each stage with schema-valid JSON."""

    def __init__(self, ledger: Ledger):
        self.ledger = ledger

    def generate_json(self, *, stage: str, model: str, system: str, prompt: str, schema: dict,
                      temperature: float = 0.7) -> TextResult:
        req = parse_request(prompt)
        kind = stage.split(":")[0]
        fn = {
            "text.items": self._items, "text.patterns": self._patterns, "text.culture": self._culture,
            "text.tasks": self._task, "verify.items": self._verdicts, "verify.patterns": self._verdicts,
            "verify.culture": self._verdicts, "verify.tasks": self._verdicts, "probe": lambda r: {"ok": True},
        }.get(kind)
        data = fn(req) if fn else {}
        t_in, t_out = est_tokens(system) + est_tokens(prompt), est_tokens(json.dumps(data, ensure_ascii=False))
        self.ledger.record(stage, "text", model, {"in": t_in, "out": t_out}, text_cost(model, t_in, t_out), note="mock")
        return TextResult(data, model, t_in, t_out)

    # -- generation

    def _items(self, req: dict) -> dict:
        seed = seed_lexicon()
        known = req.get("known", [])
        out = []
        for e in req.get("entries", []):
            w = seed.get(e["id"]) or fake_word(e["id"])
            it = {"id": e["id"], "thai": w["thai"], "roman": w["roman"], "tones": list(w["tones"]),
                  "en": e["en"], "polite": "none", "speaker": "none",
                  "hook": f"Mock hook for {e['en']} (try {req.get('attempt', 0)}).",
                  "classifier": "", "contrasts": []}
            if e["id"] in ("khrap", "i-male"):
                it["speaker"] = "m"
            if e["id"] in ("kha-statement", "kha-question", "i-female"):
                it["speaker"] = "f"
            other = known[_h(e["id"]) % len(known)] if known else None
            if other:
                it["example"] = {"thai": it["thai"] + " " + other[1], "roman": it["roman"] + " " + other[2],
                                 "en": f"(mock) {e['en']} + {other[3]}"}
            else:
                it["example"] = {"thai": it["thai"], "roman": it["roman"], "en": f"(mock) {e['en']}"}
            out.append(it)
        return {"items": out}

    def _patterns(self, req: dict) -> dict:
        known = [k for k in req.get("known", []) if k[0] not in ("khrap", "kha-statement", "kha-question")]
        out = []
        for p in req.get("patterns", []):
            exs = []
            for j in range(2):
                pick = [known[(_h(p["id"], j, i)) % len(known)] for i in range(2)] if known else []
                exs.append([{"item": k[0], "thai": k[1], "roman": k[2], "en": k[3], "slot": i == 0} for i, k in enumerate(pick)])
            frame = "X " + (known[0][1] if known else "")
            out.append({"id": p["id"], "frame": frame.strip(), "en": p["en"],
                        "note": f"Mock note for the pattern {p['en']}.", "examples": exs})
        return {"patterns": out}

    def _culture(self, req: dict) -> dict:
        known = req.get("known", [])
        return {"notes": [{"id": n["id"], "title": n["title"],
                           "body": (f"Mock note for day {n['day']}: {n['title']} (try {req.get('attempt', 0)}). You are reading a dry-run "
                                    "stand-in. The real note is written by the generation model and checked by a second model "
                                    "before it reaches the app. It will be short, dry and in the second person, and where it "
                                    "touches the law it will point you to official sources rather than make claims."),
                           "items": [k[0] for k in known[:2]]} for n in req.get("notes", [])]}

    def _task(self, req: dict) -> dict:
        t = req.get("task", {})
        known = [k[0] for k in req.get("known", []) if k[0] not in ("khrap", "kha-statement", "kha-question", "i-male", "i-female")]
        if len(known) < 4:
            return {"nodes": []}
        steps = t.get("steps") or ["Talk"]
        nodes = []
        for i, _label in enumerate(steps):
            pick = [known[_h(t.get("id"), i, j) % len(known)] for j in range(4)]
            pick = list(dict.fromkeys(pick)) + [k for k in known if k not in pick]
            nid = f"s{i}"
            nxt = f"s{i + 1}" if i + 1 < len(steps) else "end"
            nodes.append({
                "id": nid, "step": i, "say": [pick[0]], "end": "s", "en": f"(mock line, try {req.get('attempt', 0)})", "stage": "", "expression": "neutral",
                "heard": [],
                "opts": [
                    {"say": [pick[1]], "end": "s", "en": "(mock right reply)", "ok": True, "next": nxt, "rep": 1, "baht": 0, "comfort": 0, "fb": ""},
                    {"say": [pick[2]], "end": "s", "en": "(mock wrong reply)", "ok": False, "next": "", "rep": 0, "baht": 0, "comfort": 0, "fb": "Not that."},
                    {"say": [pick[3]], "end": "s", "en": "(mock wrong reply)", "ok": False, "next": "", "rep": 0, "baht": 0, "comfort": 0, "fb": "Not that either."},
                ],
            })
        return {"nodes": nodes}

    # -- the second-model check

    def _verdicts(self, req: dict) -> dict:
        out = []
        for x in req.get("check", []):
            # Fail a small, fixed share so dry runs exercise the regenerate path.
            bad = _h(json.dumps(x, ensure_ascii=False, sort_keys=True)) % 23 == 0
            out.append({"id": x["id"], "verdict": "fail" if bad else "pass",
                        "problems": ["mock: naturalness"] if bad else [], "fields": {}})
        return {"verdicts": out}
