#!/usr/bin/env bash
# Nemotron-3-Nano-30B-A3B NVFP4 on NVIDIA vLLM 26.05.post1 (Anchor's GB10-proven flags, STACK_GUIDE §4).
# gpu-memory-utilization 0.35 leaves room for RAPIDS + ASR (128 GB unified memory).
set -euo pipefail
MODEL_DIR="${MODEL_DIR:-$HOME/tw/models/nemotron-3-nano-30b-a3b-nvfp4}"
docker rm -f vllm >/dev/null 2>&1 || true
docker run -d --name vllm --gpus all --ipc=host --shm-size 16g --restart unless-stopped \
  -p 8000:8000 -v "$MODEL_DIR":/models/nemotron:ro \
  -e FLASHINFER_DISABLE_VERSION_CHECK=1 --entrypoint /bin/bash nvcr.io/nvidia/vllm:26.05.post1-py3 -c \
  "vllm serve /models/nemotron --served-model-name nemotron-3-nano --host 0.0.0.0 --port 8000 \
   --max-model-len ${MAX_LEN:-65536} --gpu-memory-utilization ${GPU_UTIL:-0.35} --max-num-seqs 8 --trust-remote-code \
   --enable-auto-tool-choice --tool-call-parser qwen3_coder --reasoning-parser nemotron_v3 \
   --moe-backend flashinfer_cutlass --async-scheduling --kv-cache-dtype fp8"
echo "vLLM starting (several minutes for NVFP4 shards + CUDA graphs). Watch: docker logs -f vllm"
echo "Ready when: curl -s localhost:8000/v1/models"
