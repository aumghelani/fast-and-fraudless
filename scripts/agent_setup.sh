#!/usr/bin/env bash
# Install the Tripwire investigator into the NemoClaw sandbox. Idempotent: safe to re-run.
#   1. OpenShell policy preset tripwire-api (dry-run, then --yes)      agent/policy/tripwire-api.yaml
#   2. OpenClaw skill tripwire-investigator                              agent/skills/tripwire-investigator/
#   3. Standing orders -> /sandbox/.openclaw/workspace/AGENTS.md         agent/AGENTS.md
#   4. Reachability: sandbox curl -> host.openshell.internal:8790/api/agent/ (backend must be running)
#   5. Smoke test: one agent turn ("Reply OK")
#   6. Last 20 sandbox egress log lines
# Env: REPO (default ~/tripwire), TW_SANDBOX (tripwire), FORCE_POLICY=1 to re-add the preset.
set -uo pipefail
REPO="${REPO:-$HOME/tripwire}"
SB="${TW_SANDBOX:-tripwire}"
export PATH="$HOME/.local/bin:$HOME/.npm-global/bin:$PATH"
NC="${TW_NEMOCLAW_BIN:-$(command -v nemoclaw || echo "$HOME/.local/bin/nemoclaw")}"
OS="${TW_OPENSHELL_BIN:-$(command -v openshell || echo openshell)}"
AGENT_DIR="$REPO/agent"
fail=0
step() { printf '\n== %s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*"; fail=1; }

[ -x "$NC" ] || { echo "nemoclaw not found ($NC)"; exit 1; }
[ -f "$AGENT_DIR/AGENTS.md" ] || { echo "missing $AGENT_DIR/AGENTS.md (REPO=$REPO)"; exit 1; }
cd "$AGENT_DIR"

step "1. policy preset tripwire-api"
if [ "${FORCE_POLICY:-0}" != "1" ] && "$NC" "$SB" policy list 2>/dev/null | grep -q "tripwire-api"; then
  echo "already applied (FORCE_POLICY=1 to re-add)"
else
  if "$NC" "$SB" policy add --from-file policy/tripwire-api.yaml --dry-run; then
    "$NC" "$SB" policy add --from-file policy/tripwire-api.yaml --yes || warn "policy add failed"
  else
    warn "policy dry-run rejected the preset; not applied"
  fi
fi
"$NC" "$SB" policy list 2>/dev/null | grep -i "tripwire" || warn "tripwire-api not listed by 'policy list'"
GW="$(docker network inspect -f '{{range .IPAM.Config}}{{.Gateway}}{{end}}' openshell-docker 2>/dev/null || true)"
echo "openshell-docker bridge gateway: ${GW:-unknown} (preset allows 172.16.0.0/12)"
case "$GW" in 172.1[6-9].*|172.2[0-9].*|172.3[01].*|"") ;; *) warn "bridge $GW is outside 172.16.0.0/12: edit allowed_ips";; esac

step "2. skill tripwire-investigator"
"$NC" "$SB" skill install ./skills/tripwire-investigator/ || warn "skill install failed"

step "3. standing orders (AGENTS.md)"
"$NC" "$SB" upload ./AGENTS.md /sandbox/.openclaw/workspace/AGENTS.md || warn "AGENTS.md upload failed"

step "4. sandbox -> backend reachability (expects 'error: unknown ring __probe__')"
if curl -sS -m 3 -o /dev/null http://127.0.0.1:8790/api/health; then
  out="$("$OS" sandbox exec -n "$SB" -- /usr/bin/curl -sS -m 8 http://host.openshell.internal:8790/api/agent/case/__probe__ 2>&1)"
  echo "$out"
  echo "$out" | grep -q "unknown ring" || warn "sandbox could not reach /api/agent/ (policy? ufw on docker bridge? backend on 0.0.0.0?)"
else
  warn "backend not answering on :8790; skipped reachability (start it: bash scripts/backend_restart.sh)"
fi

step "5. smoke test: one agent turn"
timeout 240 "$NC" "$SB" agent --agent main -m "Reply OK" --json || warn "agent smoke test failed"

step "6. last sandbox egress log lines"
"$OS" logs "$SB" --source sandbox -n 20 || warn "openshell logs failed"

echo
[ "$fail" = 0 ] && echo "agent_setup: OK" || echo "agent_setup: finished with warnings (see above; log new ones in ERRORS.md)"
exit "$fail"
