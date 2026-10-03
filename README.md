# Fast and Fraudless

**Fast and Fraudless stops a scam wire while the customer is still on the phone, on a box that never leaves the bank.**

Built on 3 Oct 2026 at the Dell × NVIDIA AI Factory hackathon (Boston). It runs entirely on a Dell Pro Max GB10.

- **Ring finder:** RAPIDS cuDF and cuGraph on the GPU look for money-laundering rings in 32M IBM AML transactions.
- **Investigator agent:** OpenClaw runs inside an OpenShell sandbox (set up by NemoClaw) on Nemotron-3-Nano-30B NVFP4 served by local vLLM. When a ring appears it wakes on its own, cites every transaction and drafts the SAR. An analyst approves.
- **Call guard:** Parakeet turns the live call into text. Nemotron extracts scam cues, **code decides**, and the banker sees a HOLD card.
- **Proof:** the OpenShell egress log is shown on screen. The only outside destination is a content-free Telegram alert.

Data: IBM "Transactions for Anti-Money Laundering" (synthetic, labelled) plus a planted demo scenario. Everything shown is labelled SYNTHETIC.

## Layout

```
backend/   FastAPI on the host (:8790). Mongo, SSE, rules, agent bridge, egress tail, telemetry. Serves ui/dist
worker/    ringfinder.py: pandas code; on the box it runs on GPU via `python -m cudf.pandas`
asr/       Parakeet speech-to-text service (:8791), runs in the vLLM container
agent/     OpenClaw AGENTS.md, skill, OpenShell policy preset
ui/        React + Vite Control Room
scripts/   box start-up scripts
```

## Contract between backend and UI

### SSE: `GET /api/events`
Each message is `data: {"type": "<type>", "ts": <epoch ms>, "data": {...}}`.

| type | data |
|---|---|
| `tick` | `{tx_total, tx_per_sec, replay_time}` |
| `ring` | `{ring_id, type, accounts:[str], edges:[{src,dst,amount,ts,txn_id}], total_usd, found_at, status}` |
| `case` | `{ring_id, status: "woke"\|"investigating"\|"sar_drafted"\|"approved"\|"rejected"\|"error", timeline:[{ts,msg}]}` |
| `sar` | `{sar_id, ring_id, narrative, citations:[{txn_id, amount, valid:bool}], valid_all:bool, decision:null\|"approved"\|"rejected"}` |
| `call` | `{call_id, label, customer:{name,age,tenure_years}, payee_account, amount, source:"mic"\|"replay", transcript, cues:[{cue, quote}], payee_check:{in_ring:bool, ring_id, hops, path:[str]}, recommendation:"HOLD"\|"VERIFY"\|"NO_HOLD"\|null, reasons:[str], questions:[str], banker_decision:null\|"hold"\|"release", ended:bool}` |
| `egress` | `{ts, verdict:"ALLOWED"\|"DENIED", process, dest, policy, reason}` |
| `counters` | `{customer_data_out, alerts_sent, denied_total}` |
| `telemetry` | `{gpu_util, temp_c, power_w, mem_used_gb, mem_total_gb}` |
| `bench` | `{rows, cpu_s, gpu_s}` |
| `eval` | `{rings_recovered, rings_total, flagged_precision, scam_caught, scam_total, false_holds, normal_total}` |
| `net` | `{online:bool}` |
| `health` | `{uptime_s, restored:bool}` |

### REST
| Method | Path | Body / notes |
|---|---|---|
| GET | `/api/state` | Snapshot of the latest of every type above (initial load) |
| POST | `/api/calls/start` | `{scenario?: "CALL-01".."CALL-10"}` → `{call_id}` |
| POST | `/api/calls/{id}/audio` | raw little-endian float32 PCM, 16 kHz mono (≈2 s per POST) |
| POST | `/api/calls/{id}/replay` | `{clip:"CALL-01"}`: server feeds the stored WAV through the same pipeline; the UI plays `/api/audio/{clip}` |
| POST | `/api/calls/{id}/end` | |
| POST | `/api/calls/{id}/decision` | `{decision:"hold"\|"release"}` |
| POST | `/api/sar/{sar_id}/decision` | `{decision:"approve"\|"reject"}` |
| POST | `/api/demo/exfil` | the sandbox tries an outbound POST and the DENIED line shows up |
| GET | `/api/audio/{clip}` | WAV file |
| GET/POST | `/api/agent/**` | **only** paths the sandboxed agent may call (see agent/policy) |
