"""Mongo glue for watchdog.sh.

  wd_state.py hb                      -> "<heartbeat age s> <status> <pid>" of the ring finder (age -1: none)
  wd_state.py put '<checks json>'     -> meta.watchdog.checks
  wd_state.py event <target> <action> <reason> <ok 0|1>  -> recoveries += 1, last_recovery, history
"""
import json
import os
import sys
from datetime import datetime, timezone

from pymongo import MongoClient

URI = os.environ.get("TW_MONGO", "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true")
meta = MongoClient(URI, serverSelectionTimeoutMS=3000, tz_aware=True)[os.environ.get("TW_DB", "tripwire")].meta
now = datetime.now(timezone.utc)
cmd = sys.argv[1] if len(sys.argv) > 1 else ""

if cmd == "hb":
    w = meta.find_one({"_id": "worker"}) or {}
    hb = w.get("heartbeat")
    age = int((now - hb).total_seconds()) if hb else -1
    print(age, w.get("status", "none"), w.get("pid", 0))
elif cmd == "put":
    meta.update_one({"_id": "watchdog"}, {"$set": {"checks": json.loads(sys.argv[2]), "ts": now}}, upsert=True)
elif cmd == "event":
    target, action, reason, ok = sys.argv[2:6]
    ev = {"ts": now, "target": target, "action": action, "reason": reason, "ok": ok == "1"}
    meta.update_one({"_id": "watchdog"}, {"$inc": {"recoveries": 1}, "$set": {"last_recovery": ev},
                                          "$push": {"history": {"$each": [ev], "$slice": -30}}}, upsert=True)
else:
    sys.exit(__doc__)
