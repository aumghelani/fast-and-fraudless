#!/usr/bin/env bash
# Install the self-healing layer (idempotent): systemd user units tw-backend, tw-worker, tw-watchdog
# (Restart=always), linger, and Docker restart policies. RESTART=1 restarts units even if unchanged.
set -euo pipefail
REPO="${REPO:-$HOME/tripwire}"; SRC="$REPO/scripts/supervise"; DST="$HOME/.config/systemd/user"
UNITS="tw-backend tw-worker tw-watchdog"
mkdir -p "$DST" "$HOME/tw"

for c in mongo vllm asr rapids; do
  if docker inspect "$c" >/dev/null 2>&1; then
    docker update --restart unless-stopped "$c" >/dev/null && echo "docker $c: restart unless-stopped"
  fi
done
sudo -n loginctl enable-linger "$USER" && echo "linger: on (units run without a login session)" \
  || echo "WARN: loginctl enable-linger failed: units stop when $USER logs out"

changed=""
for u in $UNITS; do
  sed "s|@HOME@|$HOME|g" "$SRC/$u.service" > "$DST/$u.service.new"
  if cmp -s "$DST/$u.service.new" "$DST/$u.service"; then
    rm -f "$DST/$u.service.new"
  else
    mv "$DST/$u.service.new" "$DST/$u.service"; changed="$changed $u"
  fi
done
systemctl --user daemon-reload
echo "units changed:${changed:- none}"

# hand over processes started by hand (nohup backend, detached worker): never two writers
backend_pids() {  # real uvicorn processes only: a shell whose command line mentions the app is not one
  local p; for p in $(pgrep -f "[u]vicorn backend.app:app"); do
    case "$(ps -o comm= -p "$p" 2>/dev/null)" in uvicorn|python*) echo "$p";; esac
  done
}
if ! systemctl --user is-active -q tw-backend; then
  pids="$(backend_pids)"; [ -n "$pids" ] && kill $pids 2>/dev/null || true
  for _ in 1 2 3 4 5; do [ -z "$(backend_pids)" ] && break; sleep 1; done
  pids="$(backend_pids)"; [ -n "$pids" ] && kill -9 $pids 2>/dev/null || true
fi
if ! systemctl --user is-active -q tw-worker; then
  docker exec -u 0 rapids sh -c 'for p in $(pgrep -f "[r]ingfinder.py --data"); do
    grep -q -- --bench /proc/$p/cmdline || kill $p; done' 2>/dev/null || true
fi

systemctl --user enable $UNITS >/dev/null 2>&1
for u in $UNITS; do
  if [ "${RESTART:-0}" = 1 ] || [[ " $changed " == *" $u "* ]] && systemctl --user is-active -q "$u"; then
    systemctl --user restart "$u"
  else
    systemctl --user start "$u"
  fi
done
sleep 3
for u in $UNITS; do printf '%-12s %s\n' "$u" "$(systemctl --user is-active "$u")"; done
echo "logs: ~/tw/backend.log ~/tw/ringfinder.log ~/tw/watchdog.log   status: systemctl --user status 'tw-*'"
