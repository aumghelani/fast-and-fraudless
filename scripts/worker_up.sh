#!/usr/bin/env bash
# GPU ring finder in the RAPIDS container: same pandas code, accelerated by cudf.pandas.
# With the self-healing units installed (scripts/supervise/install.sh), systemd runs it (tw-worker); then
# RF_ARGS=--reset (default) asks for a fresh replay and RF_ARGS=--resume just restarts where it left off.
set -euo pipefail
REPO="${REPO:-$HOME/tripwire}"; TW="${TW:-$HOME/tw}"
DATA="${DATA:-/tw/data/ibm-aml-hi-medium}"
if systemctl --user cat tw-worker >/dev/null 2>&1; then
  case "${RF_ARGS:---reset}" in *--reset*) touch "$TW/worker.reset"; echo "fresh replay requested";; esac
  systemctl --user restart tw-worker
  echo "tw-worker restarted under systemd. Log: tail -f ~/tw/ringfinder.log"
  exit 0
fi
docker rm -f rapids >/dev/null 2>&1 || true
docker run -d --name rapids --gpus all --ipc=host --network host --ulimit memlock=-1 --ulimit stack=67108864 \
  --restart unless-stopped -v "$REPO":/app -v "$TW":/tw rapidsai/base:26.08-cuda13-py3.12 sleep infinity
docker exec rapids pip install -q --no-index --find-links /tw/wheels/py312-aarch64 pymongo
docker exec rapids python -c "import cudf,cugraph,xgboost,pymongo;print('cudf',cudf.__version__,'cugraph',cugraph.__version__)"
docker exec -d -u 0 -e TW_SPEED="${TW_SPEED:-1440}" rapids bash -c "cd /app && exec python -m cudf.pandas /app/worker/ringfinder.py --data $DATA ${RF_ARGS:---reset} >> /tw/ringfinder.log 2>&1"
echo "ring finder started on GPU. Log: tail -f ~/tw/ringfinder.log"
