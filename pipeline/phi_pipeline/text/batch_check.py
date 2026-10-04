"""Batched second-model check (4 Oct 2026). verify asks the checker once per day and record kind,
which costs a full thinking budget per call even for one record. This runs verify three times:

  1. plan: verify with the checker stubbed, collecting every payload it would send (no cost, nothing saved)
  2. ask:  those payloads in batches of BATCH to the real checker (one paid call per batch)
  3. fill: verify again with the checker answered from step 2, so verify stores the verdicts and
           content hashes itself, exactly as a normal run would. A payload not asked in step 2 stops
           the run instead of costing money.

Use: PHI_VERIFY_ONLY=items,patterns python -m phi_pipeline.text.batch_check [--force ref,ref] [--plan]
"""

from __future__ import annotations

import argparse
import json
import os
from types import SimpleNamespace

from . import verify as V

BATCH = 10  # items and patterns per call
TASK_BATCH = 16  # conversation nodes per call (whole conversations are never split)


def _run(providers, answer) -> None:
    saved = V.ask_check
    V.ask_check = answer
    try:
        V.run_verify(providers, None, log=lambda *a: None)
    finally:
        V.ask_check = saved


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--force", default="", help="refs whose cached verdict is cleared and asked again")
    ap.add_argument("--plan", action="store_true", help="only list what would be asked")
    a = ap.parse_args(argv)
    os.environ["PHI_NO_REGEN"] = "1"
    force = {r for r in a.force.split(",") if r}
    if force:
        orig = V.Verifier.__init__

        def init(self, providers, log=print):
            orig(self, providers, log)
            for ref in force:
                r = self.state.get(ref)
                if r:
                    r.pop("model_hash", None)
                    r.pop("model_verdict", None)

        V.Verifier.__init__ = init

    # 1. plan. Item and pattern ids are unique course-wide; a conversation's node ids are only unique
    # within it, so those are keyed by the conversation ("tasks:hotel-hello::greet").
    asked: dict[str, tuple[str, dict]] = {}

    def key(stage: str, cid: str) -> str:
        return f"{stage.split('.', 1)[1]}::{cid}" if stage.startswith("verify.tasks") else cid

    def collect(providers, stage, system, check):
        for c in check:
            asked[key(stage, c["id"])] = (system, {**c, "id": key(stage, c["id"])})
        # assume a pass, so records that depend on it (a pattern built on a word) are planned too
        return {c["id"]: {"verdict": "pass", "problems": []} for c in check}

    save = V.Verifier.save
    V.Verifier.save = lambda self: None
    _run(SimpleNamespace(dry=False, text=None), collect)
    V.Verifier.save = save
    print(f"batch_check: {len(asked)} records to ask: {sorted(asked)}")
    if a.plan or not asked:
        return 0

    # 2. ask in batches, grouped by checker instructions
    from ..providers.base import get_providers

    providers = get_providers(False)
    verdicts: dict[str, dict] = {}
    by_system: dict[str, list[dict]] = {}
    for system, c in asked.values():
        by_system.setdefault(system, []).append(c)
    n = 0
    for system, payloads in by_system.items():
        chunks: list[list[dict]] = []
        if system == V.TASK_CHECK:
            by_task: dict[str, list[dict]] = {}
            for c in payloads:
                by_task.setdefault(c["id"].split("::", 1)[0], []).append(c)
            cur: list[dict] = []
            for nodes in by_task.values():
                if cur and len(cur) + len(nodes) > TASK_BATCH:
                    chunks.append(cur)
                    cur = []
                cur += nodes
            if cur:
                chunks.append(cur)
        else:
            chunks = [payloads[i:i + BATCH] for i in range(0, len(payloads), BATCH)]
        for chunk in chunks:
            n += 1
            got = V.ask_check(providers, f"verify.batch{n}", system, chunk)
            for c in chunk:
                verdicts[c["id"]] = got.get(c["id"], {"verdict": "fail", "problems": ["no verdict returned"]})
    print(f"batch_check: spent so far ${providers.ledger.summary()['spent_usd']:.2f}")

    # 3. fill: verify stores the verdicts with their hashes
    def answer(providers_, stage, system, check):
        missing = [c["id"] for c in check if key(stage, c["id"]) not in verdicts]
        if missing:
            raise SystemExit(f"batch_check: verify asked about {missing} ({stage}), which step 2 did not ask; stopped")
        return {c["id"]: verdicts[key(stage, c["id"])] for c in check}

    _run(SimpleNamespace(dry=False, text=None), answer)
    for rid, v in sorted(verdicts.items()):
        print(f"  {v['verdict']:4s} {rid}" + "".join(f"\n        - {p}" for p in v["problems"]))
    print(f"batch_check: {sum(v['verdict'] == 'pass' for v in verdicts.values())}/{len(verdicts)} pass")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
