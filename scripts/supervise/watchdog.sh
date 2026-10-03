#!/usr/bin/env bash
# Self-healing watchdog (tw-watchdog.service). Every 15 s: check each service, repair what systemd and Docker
# cannot see (alive but hung), count every recovery. Log ~/tw/watchdog.log; state in Mongo meta.watchdog.
set -uo pipefail
REPO="${REPO:-$HOME/tripwire}"; TW="${TW:-$HOME/tw}"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
SB="${TW_SANDBOX:-tripwire}"
LOG="$TW/watchdog.log"
PY="$REPO/.venv/bin/python"; ST="$REPO/scripts/supervise/wd_state.py"
EVERY="${WD_EVERY_S:-15}"; N="${WD_FAILS:-3}"; HB_MAX="${WD_HB_STALE_S:-180}"
BACKEND_PAT="[u]vicorn backend.app:app"
declare -A fails=() quiet=() prev=() seen=()

log() { printf '%s %s\n' "$(date '+%F %T')" "$*" | tee -a "$LOG"; }
backend_pids() {  # real uvicorn processes only: a shell whose command line mentions the app is not one
  local p; for p in $(pgrep -f "$BACKEND_PAT"); do
    case "$(ps -o comm= -p "$p" 2>/dev/null)" in uvicorn|python*) echo "$p";; esac
  done
}
event() {  # target action reason exit_code
  local ok=0; [ "$4" = 0 ] && ok=1
  log "HEAL $1: $2 ($3) -> $([ $ok = 1 ] && echo ok || echo "FAILED (exit $4)")"
  "$PY" "$ST" event "$1" "$2" "$3" "$ok" >/dev/null 2>&1 || true
}
active() { systemctl --user is-active -q "$1"; }
# check name ok|fail|stopped: log transitions; succeed when a repair is due (N fails in a row, not in grace)
check() {
  local name=$1 s=$2
  [ "${prev[$name]:-ok}" != "$s" ] && log "$name: ${prev[$name]:-?} -> $s"
  prev[$name]=$s
  if [ "$s" = fail ]; then fails[$name]=$(( ${fails[$name]:-0} + 1 )); else fails[$name]=0; fi
  [ "${fails[$name]}" -ge "$N" ] && [ "$(date +%s)" -ge "${quiet[$name]:-0}" ]
}
grace() { fails[$1]=0; quiet[$1]=$(( $(date +%s) + $2 )); }
# restarts done by systemd or Docker since the last loop are recoveries too
count_restarts() {  # key current_count action
  local last=${seen[$1]:-}
  if [ -n "$last" ] && [ "$2" -gt "$last" ]; then event "$1" "$3" "process exited" 0; fi
  seen[$1]=$2
}

log "watchdog up (every ${EVERY}s, repair after ${N} failed checks)"
while true; do
  # backend: systemd restarts a dead one; a hung one gets restarted here
  if active tw-backend; then
    curl -fs -m 5 -o /dev/null http://127.0.0.1:8790/api/health && b=ok || b=fail
    if check backend "$b"; then
      systemctl --user restart tw-backend; event backend "systemctl restart tw-backend" "health failed ${N}x" $?
      grace backend 60
    fi
    main="$(systemctl --user show -p MainPID --value tw-backend)"
    for p in $(backend_pids); do   # a second backend runs a second agent bridge (E-024)
      [ "$p" = "$main" ] && continue
      [ "$(ps -o etimes= -p "$p" 2>/dev/null | tr -d ' ')" -gt 20 ] 2>/dev/null || continue
      log "ALERT: orphan backend pid $p besides unit pid $main"
      kill -9 "$p"; event backend "kill -9 orphan backend $p" "more than one backend process" $?
    done
  else
    b=stopped; check backend stopped || true
  fi
  nb="$(backend_pids | wc -l)"; [ "$nb" -gt 1 ] && log "ALERT: $nb backend processes"

  # vLLM: report only (a restart costs minutes; Docker restarts a crashed container)
  curl -fs -m 5 -o /dev/null http://127.0.0.1:8000/v1/models && v=ok || v=fail
  check vllm "$v" || true

  # ASR
  curl -fs -m 5 -o /dev/null http://127.0.0.1:8791/health && a=ok || a=fail
  if check asr "$a"; then
    docker restart asr >/dev/null; event asr "docker restart asr" "health failed ${N}x" $?
    grace asr 120
  fi

  # ring finder heartbeat
  read -r age wst _ < <("$PY" "$ST" hb 2>/dev/null || echo "-2 mongo-error 0")
  if active tw-worker; then
    [ "$age" -ge 0 ] && [ "$age" -le "$HB_MAX" ] && w=ok || w=fail
    if check worker "$w"; then
      systemctl --user restart tw-worker; event worker "systemctl restart tw-worker" "heartbeat ${age}s old" $?
      grace worker 240
    fi
  else
    w=stopped; check worker stopped || true
  fi

  # OpenClaw gateway (dashboard forward into the sandbox); recover takes the nemoclaw host lock, so rarely
  code="$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:18789/)"
  [ "$code" = 200 ] && g=ok || g=fail
  if check gateway "$g"; then
    timeout 240 nemoclaw "$SB" recover >>"$LOG" 2>&1; event gateway "nemoclaw $SB recover" "gateway http $code ${N}x" $?
    grace gateway 300
  fi

  [ "$(docker inspect -f '{{.State.Running}}' mongo 2>/dev/null)" = true ] && m=ok || m=fail
  check mongo "$m" || true

  for u in tw-backend tw-worker; do
    count_restarts "$u" "$(systemctl --user show -p NRestarts --value "$u" 2>/dev/null || echo 0)" "systemd restarted $u"
  done
  for c in mongo vllm asr rapids; do
    count_restarts "$c" "$(docker inspect -f '{{.RestartCount}}' "$c" 2>/dev/null || echo 0)" "docker restarted $c"
  done

  "$PY" "$ST" put "{\"backend\":\"$b\",\"backends\":$nb,\"vllm\":\"$v\",\"asr\":\"$a\",\"worker\":\"$w\",\"worker_age_s\":${age:--1},\"worker_status\":\"${wst:-?}\",\"gateway\":\"$g\",\"mongo\":\"$m\"}" >/dev/null 2>&1 \
    || log "could not write meta.watchdog"
  sleep "$EVERY"
done
