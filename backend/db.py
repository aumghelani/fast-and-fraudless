"""MongoDB access (system of record). Synchronous pymongo; call from threads, not the event loop."""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone

from pymongo import MongoClient
from pymongo.database import Database

from .config import settings

_client: MongoClient | None = None
_lock = threading.Lock()


def db() -> Database:
    global _client
    with _lock:
        if _client is None:
            _client = MongoClient(settings.mongo_uri, serverSelectionTimeoutMS=5000, tz_aware=True)
    return _client[settings.db_name]


def now() -> datetime:
    return datetime.now(timezone.utc)


def now_ms() -> int:
    return int(time.time() * 1000)


def load_token(stream: str):
    doc = db().watch_state.find_one({"_id": stream})
    return doc.get("token") if doc else None


def save_token(stream: str, token) -> None:
    db().watch_state.update_one({"_id": stream}, {"$set": {"token": token, "at": now()}}, upsert=True)


def audit(actor: str, action: str, **details) -> None:
    """Append-only trail of every human and agent decision."""
    db().decisions.insert_one({"at": now(), "actor": actor, "action": action, **details})
