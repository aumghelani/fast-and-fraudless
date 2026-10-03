#!/usr/bin/env bash
# (Re)start the backend; log at ~/tw/backend.log.
# With the self-healing units installed (scripts/supervise/install.sh) systemd owns it; otherwise nohup.
PAT="[u]vicorn backend.app:app"
if systemctl --user cat tw-backend >/dev/null 2>&1; then
  systemctl --user restart tw-backend
  main="$(systemctl --user show -p MainPID --value tw-backend)"
else
  pkill -f "$PAT" 2>/dev/null || true
  main=""
fi
# nothing but the current backend may survive: SSE streams can stall a graceful stop (E-024)
for _ in 1 2 3 4 5; do
  left="$(pgrep -f "$PAT" | grep -vx "${main:-0}" || true)"
  [ -z "$left" ] && break
  sleep 1
done
[ -n "$left" ] && { echo "SIGKILL leftover backend pid(s): $left"; kill -9 $left 2>/dev/null || true; }
if [ -z "$main" ]; then
  nohup bash "$HOME/tripwire/scripts/backend_run.sh" > "$HOME/tw/backend.log" 2>&1 &
fi
sleep 4; tail -5 "$HOME/tw/backend.log"; curl -s localhost:8790/api/health; echo
