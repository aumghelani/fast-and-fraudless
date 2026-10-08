# Rebuild: everything we installed and downloaded

Fast and Fraudless ran on a Dell Pro Max GB10 (aarch64, DGX OS 7 / Ubuntu 24.04, kernel 7.0, CUDA 13.0,
driver 580). The box was wiped after the hackathon and the large downloads were deleted from the laptop.
This file is the shopping list to put it all back. Versions are the ones that worked on 3 Oct 2026.

## 1. Models (Hugging Face, download onto the box)

| Model | Hugging Face id | Size | Used for |
|---|---|---|---|
| Nemotron-3-Nano 30B-A3B, NVFP4 | `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4` | ~20 GB | agent, SAR drafts, call cues (served as `nemotron-3-nano`) |
| Parakeet TDT 0.6B v3 | `nvidia/parakeet-tdt-0.6b-v3` | ~2.5 GB | speech to text |
| Nemotron-3.5-Lightning 30B-A3B, NVFP4 (tried, not used) | `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4` | ~20 GB | alternative LLM |
| Nemotron-3.5-Lightning DSpark (tried, not used) | `nvidia/NVIDIA-Nemotron-3.5-Lightning-30B-A3B-NVFP4-DSpark` | small | speculative decoding draft |
| Qwen3.6 35B-A3B NVFP4 (tried, not used) | `nvidia/Qwen3.6-35B-A3B-NVFP4` | ~22 GB | alternative LLM |

```bash
pip install -U "huggingface_hub[cli]"
hf download nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B-NVFP4 --local-dir ~/tw/models/nemotron-3-nano-30b-a3b-nvfp4
hf download nvidia/parakeet-tdt-0.6b-v3 --local-dir ~/tw/models/parakeet-tdt-0.6b-v3
```

Ollama models we pulled on the laptop for prep (not needed by the project):
`gpt-oss:20b`, `llama3.1:8b`, `nemotron-3-nano:30b`, `qwen2.5-coder:14b`, `qwen3-coder:30b`, `qwen3-embedding:4b`.

## 2. Container images (arm64, on the box)

| Image | Role |
|---|---|
| `nvcr.io/nvidia/vllm:26.05.post1-py3` | serves Nemotron |
| `vllm/vllm-openai:v0.27.1` | runs Parakeet (transformers 5.15 + librosa inside) |
| `rapidsai/base:26.08-cuda13-py3.12` | GPU ring finder (cuDF, cuGraph) |
| `mongo:8.2` | database as replica set `rs0` (do not use 8.0: it crashes on kernel 7.0) |

```bash
docker pull nvcr.io/nvidia/vllm:26.05.post1-py3
docker pull vllm/vllm-openai:v0.27.1
docker pull rapidsai/base:26.08-cuda13-py3.12
docker pull mongo:8.2
```

vLLM flags that worked: `--max-model-len 65536 --gpu-memory-utilization 0.35 --tool-call-parser qwen3_coder
--reasoning-parser nemotron_v3 --moe-backend flashinfer_cutlass --kv-cache-dtype fp8`, served name
`nemotron-3-nano`. `scripts/vllm_up.sh`, `scripts/asr_up.sh` and `scripts/worker_up.sh` start them.

## 3. Agent stack (on the box)

| Piece | Version |
|---|---|
| NemoClaw | v0.0.124 (last known good) |
| OpenShell | 0.0.116 (`openshell_0.0.116-1_arm64.deb`) |
| OpenClaw | 2026.7.1 |
| Node.js | v22.23.3 linux-arm64 (via nvm) |

Setup: `scripts/nemoclaw_onboard.sh` (sandbox `tripwire`, provider `vllm`, restricted tier, Telegram channel from
`TELEGRAM_BOT_TOKEN` / `TELEGRAM_ALLOWED_IDS`), then `scripts/agent_setup.sh` (policy `tripwire-api`, skill, AGENTS.md).

## 4. Python (backend on the box, Python 3.12 venv at `~/tripwire/.venv`)

`requirements.txt` in this repo, plus what the box had: fastapi, uvicorn[standard], pymongo, httpx, websockets,
sse-starlette, python-multipart, pydantic, orjson, python-dotenv, numpy, pandas, networkx, soundfile, scipy, rich.

```bash
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
```

## 5. Frontend and tools (laptop)

- `ui/`: Node 22+, then `npm install` (React 19, Vite 7, Tailwind 4, three.js, motion; see `ui/package.json`).
- Screenshots and the pitch deck used `puppeteer-core` (with local Chrome) and `pptxgenjs`.
- Laptop apps used: Docker Desktop (disk on `E:\DockerData`), Ollama (models on `D:`), Telegram Desktop, VS Code, Chrome.

## 6. Data

- IBM synthetic AML dataset, HI-Medium (31.9M transactions) and HI-Small: Kaggle
  "IBM Transactions for Anti Money Laundering (AML)" (`ealtman2019/ibm-transactions-for-anti-money-laundering-aml`),
  paper arXiv 2306.16424. Files: `HI-Medium_Trans.csv`, `HI-Medium_Patterns.txt`, `HI-Medium_accounts.csv`.
- Demo calls (`CALL-01..16` WAVs) and the scenario (`scenario.json`, `call_scripts.md`, `redteam_calls.md`) are kept
  on the laptop in `D:\DellXNvidia\data\demo-audio` and `D:\DellXNvidia\data\scenario`.

## 7. Order to bring it back

1. Box: install Docker with the NVIDIA runtime (CDI works out of the box on DGX OS), Python 3.12, nvm + Node 22.
2. Download the two models above, pull the four images, copy the IBM CSVs to `~/tw/data/`.
3. `scripts/vllm_up.sh`, `scripts/asr_up.sh`, start Mongo 8.2 as `rs0`.
4. Backend venv, then `scripts/supervise/install.sh` (systemd user units + linger) and `scripts/worker_up.sh`.
5. NemoClaw onboarding and `scripts/agent_setup.sh`.
6. Laptop: `cd ui && npm install && npm run build`, deploy `ui/dist` to `~/tripwire/ui/dist`.

Known traps are in `ERRORS.md` (E-001 to E-032).
