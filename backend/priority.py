"""Real-time first: a live call outranks background investigations.

The call guard needs Nemotron answers in ~1 s. A ring investigation sends ~10k prompt tokens and holds the
GPU for ~55 s, which pushed call-cue requests past their timeout (calls fell back to keywords). While a call
is active (audio in the last QUIET_S seconds), the agent bridge waits before starting its next run.
"""
from __future__ import annotations

import threading
import time

QUIET_S = 15.0
_last_call_activity = 0.0
_lock = threading.Lock()


def mark_call_activity() -> None:
    global _last_call_activity
    with _lock:
        _last_call_activity = time.time()


def call_active() -> bool:
    return time.time() - _last_call_activity < QUIET_S


def wait_until_quiet(poll_s: float = 1.0, max_wait_s: float = 600.0) -> float:
    """Block while a call is active. Returns seconds waited."""
    t0 = time.time()
    while call_active() and time.time() - t0 < max_wait_s:
        time.sleep(poll_s)
    return time.time() - t0
