"""Forward ring-finder output (rings, tick, eval, bench) from Mongo to the SSE bus."""
from __future__ import annotations

import threading
import time

from .bus import bus
from .db import db

RING_FIELDS = ("type", "hub", "accounts", "edges", "total_usd", "n_txns", "tier", "span_h",
               "amt_med_usd", "found_at", "sim_time", "status")


def ring_payload(doc: dict) -> dict:
    return {"ring_id": doc["_id"], **{k: doc.get(k) for k in RING_FIELDS}}


def publish_meta(doc: dict) -> None:
    _id = doc.get("_id")
    body = {k: v for k, v in doc.items() if k != "_id"}
    if _id == "tick":
        bus.publish("tick", body)
    elif _id == "bench":
        bus.publish("bench", body)
    elif _id in ("eval_rings", "eval_calls", "eval_redteam"):
        merged = {}
        for d in db().meta.find({"_id": {"$in": ["eval_rings", "eval_calls", "eval_redteam"]}}):
            prefix = "redteam_" if d["_id"] == "eval_redteam" else ""   # avoid key clashes
            merged.update({prefix + k: v for k, v in d.items() if k != "_id"})
        bus.publish("eval", merged)
    elif _id == "counters":
        bus.publish("counters", {k: body.get(k, 0) for k in ("customer_data_out", "alerts_sent", "denied_total")})
    elif _id == "watchdog":
        bus.publish("watchdog", body)


def hydrate() -> bool:
    """Load existing state into the bus at startup. Returns True if there was prior state (restored)."""
    d = db()
    n = 0
    for r in d.rings.find({"tier": "escalate"}).sort("found_at", -1).limit(300):
        bus.publish("ring", ring_payload(r)); n += 1
    for m in d.meta.find({}):
        publish_meta(m)
    return n > 0 or d.calls.count_documents({}) > 0


def _watch() -> None:
    pipeline = [{"$match": {"ns.coll": {"$in": ["rings", "meta"]},
                            "operationType": {"$in": ["insert", "update", "replace"]}}}]
    while True:
        try:
            with db().watch(pipeline, full_document="updateLookup", max_await_time_ms=1000) as stream:
                for ch in stream:
                    doc = ch.get("fullDocument")
                    if not doc:
                        continue
                    if ch["ns"]["coll"] == "rings":
                        if doc.get("tier") == "escalate":
                            bus.publish("ring", ring_payload(doc))
                    else:
                        publish_meta(doc)
        except Exception as e:
            print(f"[worker_feed] stream error, reconnecting: {e}", flush=True)
            time.sleep(2)


def start() -> None:
    threading.Thread(target=_watch, name="worker-feed", daemon=True).start()
