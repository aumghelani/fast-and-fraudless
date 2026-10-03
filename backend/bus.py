"""In-process event bus feeding the SSE stream (`GET /api/events`).

Every module publishes with `bus.publish(type, data)`; it is safe to call from worker threads.
Event types and payloads are defined in README.md (the contract). The bus also keeps the
latest state per type so `GET /api/state` can hydrate a freshly opened UI.
"""
from __future__ import annotations

import asyncio
import json
import threading
import time
from collections import deque
from typing import Any, AsyncIterator

# types kept as a dict keyed by id (latest version of each object)
KEYED = {"ring": "ring_id", "case": "ring_id", "sar": "sar_id", "call": "call_id"}
# types kept as a bounded list (newest last)
LISTS = {"egress": 200}


def _jsonable(o: Any) -> Any:
    if hasattr(o, "isoformat"):
        return o.isoformat()
    return str(o)


class Bus:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._subs: set[asyncio.Queue] = set()
        self._lock = threading.Lock()
        self._latest: dict[str, Any] = {}
        self._keyed: dict[str, dict[str, Any]] = {t: {} for t in KEYED}
        self._lists: dict[str, deque] = {t: deque(maxlen=n) for t, n in LISTS.items()}

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def publish(self, type_: str, data: dict) -> None:
        msg = {"type": type_, "ts": int(time.time() * 1000), "data": data}
        with self._lock:
            if type_ in KEYED:
                key = str(data.get(KEYED[type_]))
                self._keyed[type_][key] = data
            elif type_ in LISTS:
                self._lists[type_].append(data)
            else:
                self._latest[type_] = data
        line = json.dumps(msg, default=_jsonable)
        if self._loop is None:
            return
        for q in list(self._subs):
            self._loop.call_soon_threadsafe(self._offer, q, line)

    @staticmethod
    def _offer(q: asyncio.Queue, line: str) -> None:
        if q.qsize() > 500:   # slow client: drop oldest rather than block producers
            try:
                q.get_nowait()
            except asyncio.QueueEmpty:
                pass
        q.put_nowait(line)

    def snapshot(self) -> dict:
        with self._lock:
            snap: dict[str, Any] = dict(self._latest)
            for t in KEYED:
                snap[t + "s"] = list(self._keyed[t].values())
            for t in LISTS:
                snap[t] = list(self._lists[t])
        return json.loads(json.dumps(snap, default=_jsonable))

    async def stream(self) -> AsyncIterator[str]:
        q: asyncio.Queue = asyncio.Queue()
        self._subs.add(q)
        try:
            while True:
                try:
                    line = await asyncio.wait_for(q.get(), timeout=15)
                    yield line
                except asyncio.TimeoutError:
                    yield json.dumps({"type": "ping", "ts": int(time.time() * 1000), "data": {}})
        finally:
            self._subs.discard(q)


bus = Bus()
