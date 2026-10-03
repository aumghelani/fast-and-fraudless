#!/usr/bin/env bash
# Foreground GPU ring finder for tw-worker.service: resumes from Mongo and stays alive after the data ends.
#   worker_run.sh         start (systemd sees the process die and restarts it)
#   worker_run.sh stop    stop the ring finder inside the container (docker exec forwards no signals)
# Fresh replay: touch ~/tw/worker.reset, then `systemctl --user restart tw-worker` (or scripts/worker_up.sh).
# Optional overrides in ~/tw/worker.env: DATA, TW_SPEED, RF_EXTRA.
set -uo pipefail
REPO="${REPO:-$HOME/tripwire}"; TW="${TW:-$HOME/tw}"
[ -f "$TW/worker.env" ] && . "$TW/worker.env"
DATA="${DATA:-/tw/data/ibm-aml-hi-medium}"
C="${RAPIDS_CONTAINER:-rapids}"
IMAGE="${RAPIDS_IMAGE:-rapidsai/base:26.08-cuda13-py3.12}"
PAT="[r]ingfinder.py .*--loop"   # only the supervised run, never a --bench

stop_inside() { docker exec -u 0 "$C" pkill -f "$PAT" >/dev/null 2>&1; }

if [ "${1:-}" = "stop" ]; then
  stop_inside; exit 0
fi

if [ "$(docker inspect -f '{{.State.Running}}' "$C" 2>/dev/null)" != "true" ]; then
  if docker inspect "$C" >/dev/null 2>&1; then
    docker start "$C" >/dev/null || exit 1
  else
    docker run -d --name "$C" --gpus all --ipc=host --network host --ulimit memlock=-1 --ulimit stack=67108864 \
      --restart unless-stopped -v "$REPO":/app -v "$TW":/tw "$IMAGE" sleep infinity >/dev/null || exit 1
  fi
fi
docker exec "$C" python -c "import pymongo" 2>/dev/null || \
  docker exec "$C" pip install -q --no-index --find-links /tw/wheels/py312-aarch64 pymongo || exit 1
# never two writers: a run left over from a stopped unit keeps going inside the container
if stop_inside; then sleep 2; docker exec -u 0 "$C" pkill -9 -f "$PAT" >/dev/null 2>&1; fi

ARGS="--resume --loop"
if [ -f "$TW/worker.reset" ]; then
  rm -f "$TW/worker.reset"; ARGS="--reset --loop"
fi
echo "$(date '+%F %T') tw-worker: ring finder $ARGS ${RF_EXTRA:-} (data $DATA, speed ${TW_SPEED:-1440})"
exec docker exec -u 0 -e TW_SPEED="${TW_SPEED:-1440}" -e PYTHONUNBUFFERED=1 "$C" \
  python -m cudf.pandas /app/worker/ringfinder.py --data "$DATA" $ARGS ${RF_EXTRA:-}
