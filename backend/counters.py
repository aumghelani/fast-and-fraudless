"""Proof counters shown in the top bar: customer_data_out, alerts_sent, denied_total. Persisted in Mongo meta."""
from __future__ import annotations

import threading

from .bus import bus
from .db import db

_lock = threading.Lock()
_FIELDS = ("customer_data_out", "alerts_sent", "denied_total")


def get() -> dict:
    doc = db().meta.find_one({"_id": "counters"}) or {}
    return {k: int(doc.get(k, 0)) for k in _FIELDS}


def inc(name: str, n: int = 1) -> dict:
    assert name in _FIELDS, name
    with _lock:
        db().meta.update_one({"_id": "counters"}, {"$inc": {name: n}}, upsert=True)
        cur = get()
    bus.publish("counters", cur)
    return cur
