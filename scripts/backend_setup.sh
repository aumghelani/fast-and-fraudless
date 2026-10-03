#!/usr/bin/env bash
# Host venv for the backend. Offline from the prepared aarch64 wheels when present, otherwise PyPI.
set -euo pipefail
REPO="${REPO:-$HOME/tripwire}"; WHEELS="$HOME/tw/wheels/py312-aarch64"
python3 -m venv "$REPO/.venv"
if [ -d "$WHEELS" ]; then
  "$REPO/.venv/bin/pip" install -q --no-index --find-links "$WHEELS" -r "$REPO/requirements.txt"
else
  echo "offline wheels not found at $WHEELS -> installing from PyPI"
  "$REPO/.venv/bin/pip" install -q -r "$REPO/requirements.txt"
fi
"$REPO/.venv/bin/python" -c "import fastapi,pymongo,httpx;print('backend venv ok')"
