"""Every paid call is recorded here before and after it runs. The ledger
refuses any call that would take total spend past the cap, so a bug can never
run up the bill. Dry runs are recorded too, marked dry, and cost nothing.
"""

from __future__ import annotations

import contextlib
import json
import os
import threading
import time
from dataclasses import dataclass

from .config import LEDGER, WORK, budget_usd


class BudgetExceeded(RuntimeError):
    pass


@contextlib.contextmanager
def _file_lock():
    """Cross-process lock around ledger appends: on Windows two processes appending to one file at once
    can overwrite each other's line (seen 4 Oct 2026 with verify and audio-check running together)."""
    lock = LEDGER.with_suffix(".lock")
    lock.parent.mkdir(parents=True, exist_ok=True)
    with open(lock, "a+b") as fh:
        if os.name == "nt":
            import msvcrt

            for _ in range(200):
                try:
                    fh.seek(0)
                    msvcrt.locking(fh.fileno(), msvcrt.LK_NBLCK, 1)
                    break
                except OSError:
                    time.sleep(0.05)
            try:
                yield
            finally:
                fh.seek(0)
                try:
                    msvcrt.locking(fh.fileno(), msvcrt.LK_UNLCK, 1)
                except OSError:
                    pass
        else:
            import fcntl

            fcntl.flock(fh.fileno(), fcntl.LOCK_EX)
            try:
                yield
            finally:
                fcntl.flock(fh.fileno(), fcntl.LOCK_UN)


@dataclass
class Entry:
    at: float
    stage: str
    kind: str  # text | tts | gemini_tts | stt | image | video | live
    model: str
    units: dict
    usd: float
    dry: bool
    note: str = ""


class Ledger:
    def __init__(self, dry: bool):
        self.dry = dry
        self._lock = threading.Lock()
        WORK.mkdir(parents=True, exist_ok=True)
        self._pos = 0
        self.spent = 0.0
        self._sync()

    def _sync(self) -> float:
        """Real spend so far, read from the ledger file (new lines only), so
        several jobs running at once share one cap."""
        if LEDGER.exists():
            with LEDGER.open("rb") as f:
                f.seek(self._pos)
                chunk = f.read()
            end = chunk.rfind(b"\n") + 1
            for line in chunk[:end].decode("utf8").splitlines():
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if not e.get("dry"):
                    self.spent += float(e.get("usd", 0))
            self._pos += end
        return self.spent

    def reserve(self, stage: str, kind: str, model: str, usd_estimate: float) -> None:
        """Call before a paid request. Raises if it would break the cap."""
        if self.dry:
            return
        with self._lock:
            spent = self._sync()
            if spent + usd_estimate > budget_usd():
                raise BudgetExceeded(
                    f"{stage}/{kind}: ${spent:.2f} spent + ${usd_estimate:.3f} would pass the ${budget_usd():.0f} cap"
                )

    def record(self, stage: str, kind: str, model: str, units: dict, usd: float, note: str = "") -> None:
        e = Entry(time.time(), stage, kind, model, units, 0.0 if self.dry else usd, self.dry, note)
        with self._lock, _file_lock():
            with LEDGER.open("a", encoding="utf8") as f:
                f.write(json.dumps(e.__dict__, ensure_ascii=False) + "\n")
            self._sync()

    def summary(self) -> dict:
        by: dict[str, float] = {}
        n = 0
        if LEDGER.exists():
            for line in LEDGER.read_text(encoding="utf8").splitlines():
                e = json.loads(line)
                if e.get("dry"):
                    continue
                n += 1
                by[e["kind"]] = by.get(e["kind"], 0) + float(e["usd"])
        with self._lock:
            self._sync()
        return {"spent_usd": round(self.spent, 4), "cap_usd": budget_usd(), "calls": n, "by_kind": {k: round(v, 4) for k, v in by.items()}}
