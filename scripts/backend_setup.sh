#!/usr/bin/env bash
# Host venv for the backend, installed offline from the prepared aarch64 wheels.
set -euo pipefail
REPO="${REPO:-$HOME/tripwire}"
python3 -m venv "$REPO/.venv"
"$REPO/.venv/bin/pip" install -q --no-index --find-links "$HOME/tw/wheels/py312-aarch64" -r "$REPO/requirements.txt"
"$REPO/.venv/bin/python" -c "import fastapi,pymongo,httpx;print('backend venv ok')"
