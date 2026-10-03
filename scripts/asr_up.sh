#!/usr/bin/env bash
# Parakeet ASR service on :8791 (localhost only) inside the vLLM v0.27.1 image (torch cu130 + transformers 5.15).
# STACK_GUIDE §5. librosa is installed offline from wheels (ERRORS.md E-005). Check: curl -s localhost:8791/health
set -euo pipefail
REPO="${REPO:-$HOME/tripwire}"
MODELS_DIR="${MODELS_DIR:-$HOME/tw/models}"
TW_DIR="${TW_DIR:-$HOME/tw}"
IMAGE="${ASR_IMAGE:-vllm/vllm-openai:v0.27.1}"
docker rm -f asr >/dev/null 2>&1 || true
docker run -d --name asr --gpus all --ipc=host --network host --restart unless-stopped \
  -v "$MODELS_DIR":/models:ro -v "$REPO":/repo:ro -v "$TW_DIR":/tw:ro \
  -e TW_PARAKEET=/models/parakeet-tdt-0.6b-v3 \
  -e TW_ASR_WARMUP_WAV=/tw/data/demo-audio/normal_test.wav \
  -e HF_HUB_OFFLINE=1 -e TRANSFORMERS_OFFLINE=1 -e PYTHONDONTWRITEBYTECODE=1 \
  --entrypoint /bin/bash "$IMAGE" -c '
    set -e
    python3 -c "import librosa" 2>/dev/null || \
      pip install --no-index --find-links /tw/wheels/py312-aarch64-asr librosa || \
      pip install --no-index --find-links /tw/wheels/py313-aarch64-asr librosa
    cd /repo
    exec python3 -m uvicorn asr.server:app --host 127.0.0.1 --port 8791 --log-level info'
echo "ASR starting (model load + warm-up ~30 s). Watch: docker logs -f asr"
echo "Ready when: curl -s localhost:8791/health   -> {\"ok\": true, ...}"
