# Tripwire Architecture

> **One sentence:** Tripwire stops a scam wire while the customer is still on the phone, on a box that never leaves the bank.
>
> **Principle:** *Models perceive, code decides, humans approve.* Tripwire can **recommend a hold** and **draft a report**. It can never send money, release a wire, or file a SAR.

---

## 1. Why it must be local (the 30% criterion)

- **SAR secrecy is federal law** (31 CFR 1020.320(e)): a bank may not reveal that a Suspicious Activity Report exists.
- **A live call is customer voice data.**
- **The account graph** (who pays whom) is the bank's most sensitive dataset.

So every model runs on the Dell Pro Max GB10, and the agent runs in an OpenShell sandbox that denies all egress except one content-free alert channel.

## 2. System diagram

```
                    ┌───────────────────────── Dell Pro Max GB10 (DGX OS 7, aarch64, 128 GB unified) ─────────────────────────┐
                    │                                                                                                          │
 IBM AML HI-Medium  │  ┌──────────────── docker: rapids (cuDF / cuGraph, GPU) ────────────────┐                                │
 31.9M txns (CSV) ──┼─▶│ worker/ringfinder.py  (pandas API, run as `python -m cudf.pandas`)   │                                │
                    │  │  • replays the bank's transactions in time order (sim clock)         │                                │
                    │  │  • every cycle: fan-in / fan-out detection on the GPU                │──writes──┐                     │
                    │  │  • writes rings + their transactions + tick/bench/eval to Mongo      │          │                     │
                    │  └──────────────────────────────────────────────────────────────────────┘          ▼                     │
                    │                                                                    ┌──────────────────────────┐          │
                    │                                                                    │ docker: mongo 8.2 (rs0)   │          │
                    │                                                                    │ rings, transactions,      │          │
                    │                                                                    │ cases, sar_drafts, calls, │          │
                    │                                                                    │ decisions, egress_events, │          │
                    │                                                                    │ meta, watch_state         │          │
                    │                                                                    └────────────┬─────────────┘          │
                    │                                              change streams (resume tokens)     │                        │
                    │  ┌──────────────────────── host: backend (FastAPI :8790) ───────────────────────▼──────────────────┐     │
 Browser on the     │  │ bus (SSE /api/events) · rules engine · SAR validator · call pipeline · agent bridge ·           │     │
 box's own monitor ◀┼──┤ egress tail (openshell logs) · telemetry (nvidia-smi + /proc/meminfo) · notifier                │     │
 (ui/dist)          │  └───┬───────────────┬──────────────────────────┬───────────────────────────┬─────────────────────┘     │
                    │      │ audio chunks  │ chat/completions (JSON)  │ `nemoclaw tripwire agent` │ curl /api/agent/** │
 Mic / REPLAY wav ──┼──────┘               ▼                          ▼                           │                    │
                    │  ┌──────── docker: asr ───────┐  ┌──── docker: vllm :8000 ─────┐  ┌──────── NemoClaw sandbox "tripwire" (OpenShell) ───────┐
                    │  │ asr/server.py :8791         │  │ Nemotron-3-Nano-30B-A3B      │◀─│ OpenClaw agent "main"                                   │
                    │  │ Parakeet TDT 0.6B v3        │  │ NVFP4, gpu-mem 0.35          │  │  • AGENTS.md standing orders                             │
                    │  │ (transformers 5.15)         │  │ (inference.local route)      │  │  • skill tripwire-investigator (curl → host :8790)       │
                    │  └─────────────────────────────┘  └──────────────────────────────┘  │  • channels: Telegram (+ Slack) ── only allowed egress   │
                    │                                                                      └───────────────────────────────────────────────────────┘
                    └──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

## 3. Components

| # | Component | Runs where | Owns | Talks to |
|---|---|---|---|---|
| 1 | **Ring finder** `worker/ringfinder.py` | `rapids` container, GPU via `cudf.pandas` | replay clock, fan-in/fan-out detection, eval vs labels, CPU-vs-GPU bench | Mongo (write) |
| 2 | **Backend** `backend/` | host venv, `:8790` | API, SSE bus, call pipeline, rules, SAR validator, agent bridge, egress tail, telemetry, notifier | Mongo, vLLM, ASR, nemoclaw/openshell CLIs |
| 3 | **ASR** `asr/server.py` | `asr` container (vLLM v0.27.1 image), `:8791` | Parakeet speech-to-text | — |
| 4 | **LLM** | `vllm` container, `:8000` | Nemotron-3-Nano NVFP4 (OpenAI API) | — |
| 5 | **Investigator agent** `agent/` | NemoClaw sandbox `tripwire` | investigates rings, drafts SARs, sends alerts | backend `/api/agent/**` (curl), Telegram/Slack |
| 6 | **UI** `ui/` | browser on the box monitor, served from `ui/dist` | Control Room | backend REST + SSE |
| 7 | **MongoDB 8.2** | `mongo` container, `:27017`, replica set `rs0` | system of record | — |

## 4. The three loops

### A. Always-on ring loop (nobody presses anything)
1. `ringfinder` advances the sim clock and every cycle runs fan-in/fan-out detection on the GPU over the trailing window.
2. A new ring is inserted into `rings`, with its transactions in `transactions`.
3. A backend **change stream** on `rings` (resume token persisted in `watch_state`) sees the insert.
4. The agent bridge runs `nemoclaw tripwire agent --agent main --session-id ring-<id> --json -m "<wake prompt>"`.
5. The agent's skill curls `GET /api/agent/case/<ring_id>` (evidence), writes the narrative, then `POST /api/agent/sar`.
6. **The SAR validator** checks every transaction ID and amount in the draft against Mongo and marks each one ✓/✗.
7. The UI shows the case and the SAR. An analyst approves or rejects (`decisions`). The notifier sends "Ring R-xxx flagged, SAR draft ready" (no names, no amounts).

### B. Call loop (live)
1. The browser mic (or a REPLAY WAV) sends 16 kHz float32 chunks to `POST /api/calls/{id}/audio`.
2. Audio is cut into **≤10 s windows** (Parakeet drops sentences on long clips, see ERRORS.md E-006). Each window is transcribed by ASR.
3. **LLM perceives:** Nemotron (thinking off, JSON) extracts cues `{cue, quote}` from the transcript.
4. **Code decides:** `rules.py` combines the cues, the customer profile (first wire, amount vs typical outflow) and the **payee check** (is the payee in a ring found by the GPU worker?) into HOLD / VERIFY / NO_HOLD, plus reasons and questions.
5. **Human approves:** the banker clicks HOLD or RELEASE. The notifier sends "Call 0412: HOLD advised".

### C. Proof loop
- The `openshell logs tripwire --source sandbox --tail` reader parses ALLOWED/DENIED lines into `egress_events`, the SSE log panel and counters.
- `POST /api/demo/exfil` makes the sandbox try `curl -X POST https://example.com/exfil`, and a DENIED line appears.
- Counters: `customer_data_out` = ALLOWED destinations other than inference.local, host.openshell.internal and the alert channels. `alerts_sent` counts notifier successes.
- `net` = can the box reach the internet (TCP 1.1.1.1:443 every 3 s). It shows OFFLINE when Wi-Fi is off.

## 5. Decision rules (code, not model)

| Signal | Source |
|---|---|
| `payee_in_ring` / hops | GPU ring map (Mongo `rings.accounts`) |
| `first_wire`, `amount_ratio` | customer profile (scenario) |
| cues: URGENCY, SECRECY, AUTHORITY, STORY_CHANGE, COACHING, REMOTE_CONTROL, VERIFIED_INDEPENDENTLY, ROUTINE_PAYEE | LLM extraction (perception only) |

- **HOLD** if `payee_in_ring` **or** ≥2 high-risk cues **or** (`first_wire` and `amount_ratio ≥ 5` and ≥1 high-risk cue).
- **VERIFY** if large amount (≥ $50k) with VERIFIED_INDEPENDENTLY and no high-risk cues.
- **NO_HOLD** otherwise.

High-risk cues: URGENCY, SECRECY, AUTHORITY, STORY_CHANGE, COACHING, REMOTE_CONTROL.

## 6. Ring detection (GPU, deterministic)

Over the trailing window `W` (default 4 sim-days) of processed transactions, excluding self-transfers and `Reinvestment`:
- **Fan-in:** an account receiving from ≥ `K_IN` distinct senders.
- **Fan-out:** an account sending to ≥ `K_OUT` distinct receivers.
- A **hub filter** drops accounts whose all-time distinct counterparties exceed `HUB_MAX` (real merchants and banks).
- A ring is the hub account plus its window counterparties and the transactions between them. The ring id is stable per hub and window.
- **Eval:** a labelled attempt (Patterns.txt) counts as recovered if ≥50% of its transactions are edges of flagged rings. Precision = the share of flagged-ring transactions labelled `is_laundering=1`. Cycles and bipartite patterns are **out of scope** and reported as such.

## 7. Data model (Mongo)

| Collection | Key fields |
|---|---|
| `rings` | `_id` (ring id), type, hub, accounts[], edges[{src,dst,amount,currency,ts,txn_id}], total_usd, found_at, sim_time, status |
| `transactions` | `_id` (txn id `T<row>`), src, dst, amount, currency, ts, format, ring_id (only ring transactions are stored) |
| `cases` | `_id` ring id, status, timeline[{ts,msg}], agent_raw |
| `sar_drafts` | `_id`, ring_id, narrative, citations[{txn_id, amount, valid}], valid_all, decision |
| `calls` | `_id`, label, customer, payee_account, amount, source, transcript, windows[], cues[], payee_check, recommendation, reasons[], questions[], banker_decision, ended |
| `decisions` | who, what, when (audit trail) |
| `egress_events` | ts, verdict, process, dest, policy, reason |
| `meta` | `tick`, `bench`, `eval`, `worker` docs |
| `watch_state` | change-stream resume tokens |

## 8. Ports

| Port | Service | Notes |
|---|---|---|
| 8000 | vLLM | must be reachable from the Docker bridge (the sandbox uses `host.openshell.internal:8000`) |
| 8790 | backend + UI | the sandbox reaches `/api/agent/**` only (OpenShell preset `agent/policy/tripwire-api.yaml`) |
| 8791 | ASR | localhost only |
| 27017 | Mongo | localhost only |
| **Reserved, do not use:** 8080 (OpenShell gateway), 8081, 11434–11438, 18789 (OpenClaw dashboard), 3128 (sandbox proxy) | | |

## 9. Failure modes and fallbacks

| Failure | Fallback |
|---|---|
| vLLM not serving by 11:15 | Ollama `nemotron-3-nano:30b` (`NEMOCLAW_PROVIDER=ollama`) |
| Nemotron tool calling misbehaves in OpenClaw | Qwen3.6-35B-A3B NVFP4 (NemoClaw default; Groundwork used it with tools) |
| ASR fails | REPLAY transcript fed line by line, labelled REPLAY |
| HI-Medium too slow | HI-Small (5.08M rows) |
| Telegram/Slack proactive send fails through OpenClaw | backend sends directly via Bot API, **labelled "direct (fallback)"** in the counters |
| Agent wake via CLI fails | gateway WebSocket `chat.send` (Groundwork pattern) |
| Out of time | cut the risk score (XGBoost) first; the ring loop and call loop carry the demo |

## 10. What is synthetic (always say it)

IBM AML data is synthetic and labelled. Margaret, David and the 10 calls are fictional and planted. The ring R-102 transactions are verbatim from IBM's labelled data, and only Margaret's wire to its feeder `802225A40` is planted.
