# Tasks (tick only when verified on the box)

## 0. Box infrastructure
- [x] SSH laptop → box (key), sudo, docker group, swap off, GPU in containers (CDI)
- [x] MongoDB 8.2 replica set `rs0` running
- [x] Box timezone America/New_York
- [ ] Nemotron NVFP4 on box (cable transfer)
- [ ] vLLM container pulled → serving `nemotron-3-nano` on :8000 (gpu-mem 0.35)
- [ ] RAPIDS container pulled → imports cudf/cugraph
- [ ] Parakeet + ASR container → `/transcribe` works on GPU
- [ ] Host venv for backend (wheels)
- [ ] NemoClaw onboard `tripwire` (vLLM provider, Telegram + Slack channels) → `doctor` healthy
- [ ] Close cloud paths (`policy exclude nvidia`, remove `openclaw-pricing`), policy preset `tripwire-api` added

## 1. Ring loop (target 13:00)
- [ ] `worker/ringfinder.py` detects R-102 (and others) on HI-Medium, writes rings/tick/eval
- [ ] backend change stream → agent wake via `nemoclaw tripwire agent`
- [ ] agent skill: GET case, POST SAR
- [ ] SAR validator marks citations
- [ ] Notifier: Telegram (+ Slack) "ring flagged" alert

## 2. Call loop (target 14:30)
- [ ] ASR windows (≤10 s) from mic and REPLAY
- [ ] LLM cue extraction (JSON, thinking off)
- [ ] rules → HOLD/VERIFY/NO_HOLD + reasons + questions
- [ ] payee check against ring map (Margaret → 802225A40 → R-102)
- [ ] banker decision + alert

## 3. Proof + numbers (target 15:30)
- [ ] egress tail + exfil demo DENIED line
- [ ] counters + net online/offline
- [ ] telemetry SSE
- [ ] CPU vs GPU bench numbers
- [ ] eval: rings recovered x/total, precision; calls x/5 scams, false holds y/5
- [ ] kill-and-resume (STATE RESTORED)

## 4. UI (instructions from Aum)
- [ ] Control Room per instructions

## 5. Submission (16:30 → 18:00)
- [ ] Record video (≤3 min, includes Wi-Fi-off moment)
- [ ] Writeup naming every criterion
- [ ] Repo pushed
- [ ] Slides (19:00)
