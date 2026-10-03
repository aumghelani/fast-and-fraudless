#!/usr/bin/env bash
# Run the backend (foreground). Secrets (Telegram/Slack tokens) come from ~/tw/secrets/*.env.
set -euo pipefail
REPO="${REPO:-$HOME/tripwire}"; cd "$REPO"
set -a; for f in "$HOME"/tw/secrets/*.env; do [ -f "$f" ] && . "$f"; done; set +a
export TW_AGENT_CONCURRENCY="${TW_AGENT_CONCURRENCY:-1}"   # nemoclaw CLI holds a host-wide lock (E-014)
export TW_AGENT_CATCHUP_MAX="${TW_AGENT_CATCHUP_MAX:-5}"
export TW_TELEGRAM_CHAT_IDS="${TW_TELEGRAM_CHAT_IDS:-${TELEGRAM_ALLOWED_IDS:-}}"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
exec "$REPO/.venv/bin/uvicorn" backend.app:app --host 0.0.0.0 --port 8790
