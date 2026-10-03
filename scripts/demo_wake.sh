#!/usr/bin/env bash
# On camera: re-fire the escalation of the largest escalated ring that has no case yet.
# The change stream wakes the agent exactly as a new ring finder escalation would.
REPO="${REPO:-$HOME/tripwire}"
"$REPO/.venv/bin/python" - <<'PYEOF'
from pymongo import MongoClient
d = MongoClient("mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true")["tripwire"]
have = {x["_id"] for x in d.cases.find({}, {"_id": 1})}
for r in d.rings.find({"tier": "escalate"}, {"_id": 1, "type": 1, "total_usd": 1}).sort("total_usd", -1).limit(500):
    if r["_id"] not in have:
        d.rings.update_one({"_id": r["_id"]}, {"$set": {"tier": "watch"}})
        d.rings.update_one({"_id": r["_id"]}, {"$set": {"tier": "escalate"}})
        print(f"escalated {r['_id']} ({r.get('type')}, {r.get('total_usd', 0):,.0f} USD): the agent wakes on it now")
        break
PYEOF
