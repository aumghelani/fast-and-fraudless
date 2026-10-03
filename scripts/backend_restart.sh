#!/usr/bin/env bash
# (Re)start the backend in the background; log at ~/tw/backend.log
pkill -f "uvicorn backend.app:app" 2>/dev/null || true; sleep 1
nohup "$HOME/tripwire/scripts/backend_run.sh" > "$HOME/tw/backend.log" 2>&1 &
sleep 4; tail -5 "$HOME/tw/backend.log"; curl -s localhost:8790/api/health; echo
