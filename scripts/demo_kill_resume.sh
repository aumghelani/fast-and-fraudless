#!/usr/bin/env bash
# On-camera proof of self-healing (run on the box): kill -9 the agent run in flight, the backend and the GPU
# ring finder, then watch all three come back with nobody touching anything. Prints the recovery times.
#   bash scripts/demo_kill_resume.sh      (waits up to WAIT_S=90 s for an agent run, else wakes the agent)
set -uo pipefail
REPO="${REPO:-$HOME/tripwire}"; PY="$REPO/.venv/bin/python"
API="http://127.0.0.1:8790"; C="${RAPIDS_CONTAINER:-rapids}"
WAIT_S="${WAIT_S:-90}"; TIMEOUT_S="${TIMEOUT_S:-480}"
AGENT_PAT="[n]emoclaw tripwire agent --agent main --session-id ring-"

say() { printf '\033[1m[%s]\033[0m %s\n' "$(date +%T)" "$*"; }
now() { date +%s.%N; }
since() { awk -v a="$(now)" -v b="$1" 'BEGIN{printf "%.1f", a-b}'; }
mq() {  # small Mongo reads/writes: state | case <ring> <since_ms> | wake
  "$PY" - "$@" <<'PYEOF'
import json, sys
from pymongo import MongoClient
d = MongoClient("mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true", tz_aware=True)["tripwire"]
cmd = sys.argv[1]
if cmd == "state":   # one line: heartbeat resumed_at status pid resumes resumed_from replay_time
    w = d.meta.find_one({"_id": "worker"}) or {}
    t = d.meta.find_one({"_id": "tick"}) or {}
    ts = lambda k: "%.1f" % w[k].timestamp() if w.get(k) else "0"
    print(ts("heartbeat"), ts("resumed_at"), w.get("status") or "-", w.get("pid") or 0, w.get("resumes") or 0,
          (w.get("resumed_from") or "-")[:16], (t.get("replay_time") or "-")[:16])
elif cmd == "case":   # line 1: summary json; then timeline entries newer than the kill not printed yet
    import time
    c = d.cases.find_one({"_id": sys.argv[2]}) or {}
    new = [e for e in c.get("timeline", []) if e.get("ts", 0) >= int(sys.argv[3])]
    msgs = " | ".join(e["msg"] for e in new)
    print(json.dumps({"status": c.get("status"), "n": len(new), "resumed": "resumed after interruption" in msgs}))
    for e in new[int(sys.argv[4]):]:
        print("[%s] case %s: %s" % (time.strftime("%H:%M:%S", time.localtime(e["ts"] / 1000)), sys.argv[2], e["msg"][:110]))
elif cmd == "wake":   # largest escalated ring without a case: flip its tier so the change stream wakes the agent
    have = {x["_id"] for x in d.cases.find({}, {"_id": 1})}
    for r in d.rings.find({"tier": "escalate"}, {"_id": 1}).sort("total_usd", -1).limit(500):
        if r["_id"] not in have:
            d.rings.update_one({"_id": r["_id"]}, {"$set": {"tier": "watch"}})
            d.rings.update_one({"_id": r["_id"]}, {"$set": {"tier": "escalate"}})
            print(r["_id"]); break
PYEOF
}
jget() { "$PY" -c "import json,sys; v=json.loads(sys.argv[1]).get(sys.argv[2]); print('' if v is None else v)" "$1" "$2"; }
agent_ring() { pgrep -af "$AGENT_PAT" | grep -o 'ring-R-[0-9]*' | head -1 | sed 's/^ring-//'; }
gt() { awk -v a="$1" -v b="$2" 'BEGIN{exit !(a > b)}'; }

say "Fast and Fraudless self-healing demo: three kill -9s, then hands off."
h="$(curl -s -m 3 $API/api/health)"; say "backend: $h"
read -r _ _ s_st OLD_PID s_res _ s_replay <<<"$(mq state)"
say "ring finder: $s_st, replay clock $s_replay, resumed $s_res time(s) so far"

RID="$(agent_ring)"
if [ -z "$RID" ]; then
  say "waiting up to ${WAIT_S}s for the agent to start an investigation..."
  for _ in $(seq "$WAIT_S"); do RID="$(agent_ring)"; [ -n "$RID" ] && break; sleep 1; done
fi
if [ -z "$RID" ]; then
  W="$(mq wake)"; say "agent idle: waking it on ring $W (largest escalated ring without a case)"
  for _ in $(seq 120); do RID="$(agent_ring)"; [ -n "$RID" ] && break; sleep 1; done
fi
[ -z "$RID" ] && { say "no agent run started; is the backend up and the bridge on?"; exit 1; }
say "agent is investigating ring $RID (nemoclaw pid $(pgrep -f "$AGENT_PAT" | head -1))"
sleep 3

T_K="$(now)"; K_MS="$(awk -v t="$T_K" 'BEGIN{printf "%d", t*1000}')"
say "1/3  kill -9 the agent run on $RID";  pkill -9 -f "$AGENT_PAT"
sleep 1
say "2/3  kill -9 the backend (uvicorn pid $(pgrep -f '[u]vicorn backend.app' | tr '\n' ' '))"
pkill -9 -f "[u]vicorn backend.app"
sleep 1
if docker exec -u 0 "$C" pkill -9 -f "[r]ingfinder.py .*--loop"; then
  say "3/3  kill -9 the GPU ring finder (container $C, was pid $OLD_PID)"; W_ON=1
else
  say "3/3  ring finder not running under supervision: skipped"; W_ON=0
fi
say "hands off. Waiting for everything to come back by itself..."

B_T=""; WU_T=""; W_T=""; AQ_T=""; A_T=""; SEEN=0
while :; do
  el="$(since "$T_K")"
  if [ -z "$B_T" ]; then
    h="$(curl -s -m 2 $API/api/health)"
    up="$(sed -n 's/.*"uptime_s":\([0-9]*\).*/\1/p' <<<"$h")"
    if grep -q '"ok":true' <<<"$h" && [ -n "$up" ] && gt "$el" "$up"; then
      B_T="$el"; say "backend is back after ${B_T}s: $h"
    fi
  fi
  if [ "$W_ON" = 1 ] && [ -z "$W_T" ]; then
    read -r s_hb s_ra s_st s_pid s_res s_from _ <<<"$(mq state)"
    if [ -z "$WU_T" ] && gt "$s_hb" "$T_K" && [ "$s_pid" != "$OLD_PID" ]; then
      WU_T="$el"; say "ring finder process restarted after ${WU_T}s (pid $s_pid, reloading the transactions on the GPU)"
    fi
    if gt "$s_ra" "$T_K" && [ "$s_st" != loading ]; then
      W_T="$el"; say "ring finder resumed after ${W_T}s at replay time $s_from (resume #$s_res, $s_st)"
    fi
  fi
  if [ -z "$A_T" ]; then
    out="$(mq case "$RID" "$K_MS" "$SEEN")"; c="$(head -1 <<<"$out")"
    tail -n +2 <<<"$out"
    SEEN="$(jget "$c" n)"
    [ -z "$AQ_T" ] && [ "$(jget "$c" resumed)" = True ] && AQ_T="$el"
    [ "$(jget "$c" status)" = sar_drafted ] && [ "${SEEN:-0}" -gt 0 ] && { A_T="$el"; say "agent finished $RID after ${A_T}s"; }
  fi
  if [ -n "$B_T" ] && { [ "$W_ON" = 0 ] || [ -n "$W_T" ]; } && [ -n "$A_T" ]; then break; fi
  if awk -v e="$el" -v t="$TIMEOUT_S" 'BEGIN{exit !(e > t)}'; then say "timeout after ${TIMEOUT_S}s"; break; fi
  sleep 1
done

echo
say "== recovered by itself (seconds after the kills) =="
printf '   backend           %6s s   health ok, state restored from Mongo\n' "${B_T:--}"
[ "$W_ON" = 1 ] && printf '   ring finder       %6s s   process back %s s, replay resumed where it stopped\n' "${W_T:--}" "${WU_T:--}"
printf '   agent run %-7s %6s s   re-queued at %s s ("resumed after interruption"), SAR drafted\n' "$RID" "${A_T:--}" "${AQ_T:--}"
say "watchdog: $(curl -s -m 2 $API/api/health >/dev/null && "$PY" -c "
from pymongo import MongoClient
w = MongoClient('mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true')['tripwire'].meta.find_one({'_id': 'watchdog'}) or {}
print('self-healed', w.get('recoveries', 0), 'times; last:', (w.get('last_recovery') or {}).get('action'))")"
