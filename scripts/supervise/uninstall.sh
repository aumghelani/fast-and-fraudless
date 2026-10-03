#!/usr/bin/env bash
# Remove the self-healing units and go back to manual start-up (backend via nohup; worker via worker_up.sh).
set -uo pipefail
DST="$HOME/.config/systemd/user"
systemctl --user disable --now tw-watchdog tw-worker tw-backend 2>/dev/null || true
rm -f "$DST/tw-backend.service" "$DST/tw-worker.service" "$DST/tw-watchdog.service"
systemctl --user daemon-reload
systemctl --user reset-failed 2>/dev/null || true
echo "units removed; starting the backend by hand"
bash "$HOME/tripwire/scripts/backend_restart.sh"
echo "ring finder stopped: RF_ARGS=--resume bash ~/tripwire/scripts/worker_up.sh to run it detached again"
