"""Run nemoclaw CLI calls one at a time; alerts go ahead of queued investigations (E-014)."""
from __future__ import annotations

import subprocess
import threading

_run_lock = threading.Lock()
_cv = threading.Condition()
_urgent_waiting = 0


def run(cmd: list[str], timeout: float, urgent: bool = False) -> subprocess.CompletedProcess:
    global _urgent_waiting
    with _cv:
        if urgent:
            _urgent_waiting += 1
        else:
            while _urgent_waiting > 0:
                _cv.wait()
    try:
        with _run_lock:
            return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    finally:
        if urgent:
            with _cv:
                _urgent_waiting -= 1
                _cv.notify_all()
