#!/usr/bin/env bash
# NemoClaw onboarding for Tripwire (STACK_GUIDE §6-7). Requires vLLM already serving on :8000.
# Channels are baked in at onboarding (Telegram preset is requiredAtCreate):
#   ~/tw/secrets/telegram.env  -> TELEGRAM_BOT_TOKEN, TELEGRAM_ALLOWED_IDS
#   ~/tw/secrets/slack.env     -> SLACK_BOT_TOKEN, SLACK_APP_TOKEN, SLACK_ALLOWED_USERS, SLACK_ALLOWED_CHANNELS (optional)
set -uo pipefail
curl -sf localhost:8000/v1/models >/dev/null || { echo "vLLM is not serving on :8000 yet"; exit 1; }

# never leak cloud keys into onboarding; never enable web search
for v in $(env | grep -o "^[A-Z0-9_]*_API_KEY"); do unset "$v"; done   # no cloud keys may leak into onboarding
set -a
for f in "$HOME"/tw/secrets/telegram.env "$HOME"/tw/secrets/slack.env; do [ -f "$f" ] && . "$f"; done
set +a
export NEMOCLAW_PROVIDER=vllm NEMOCLAW_AGENT=openclaw NEMOCLAW_SANDBOX_NAME=tripwire
export NEMOCLAW_NON_INTERACTIVE=1 NEMOCLAW_YES=1 NEMOCLAW_ACCEPT_THIRD_PARTY_SOFTWARE=1
export NEMOCLAW_WEB_SEARCH_PROVIDER=none
export NEMOCLAW_POLICY_TIER="${NEMOCLAW_POLICY_TIER:-restricted}"   # suppresses auto-added openclaw-pricing
export NEMOCLAW_SANDBOX_READY_TIMEOUT=600
echo "channels: telegram=${TELEGRAM_BOT_TOKEN:+yes} slack=${SLACK_BOT_TOKEN:+yes}"

if ! command -v nemoclaw >/dev/null && [ ! -x "$HOME/.local/bin/nemoclaw" ]; then
  curl -fsSL https://www.nvidia.com/nemoclaw.sh | bash
else
  nemoclaw onboard --non-interactive --yes-i-accept-third-party-software || nemoclaw onboard --resume
fi
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"

# close the cloud paths (choosing a local provider does NOT close them)
nemoclaw tripwire policy exclude nvidia --force || true
nemoclaw tripwire policy remove openclaw-pricing --yes || true
nemoclaw tripwire policy list || true
nemoclaw tripwire doctor || true
nemoclaw tripwire channels status || true
