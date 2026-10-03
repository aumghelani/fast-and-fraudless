# Working rules for everyone touching this repo

1. **Read `ARCHITECTURE.md` first.** Do not add components, services or features that are not in it. If something must change, update `ARCHITECTURE.md` in the same commit and say why in `DECISIONS.md`.
2. **The README contract is law.** SSE event types and REST paths in `README.md` are shared by backend and UI. Change them only together, in one commit.
3. **Models perceive, code decides, humans approve.** The LLM never makes the HOLD/NO_HOLD decision and never sends money or files anything. Decisions live in `backend/rules.py`.
4. **Nothing leaves the box** except content-free alerts (no names, no amounts) through the notifier. No cloud APIs, no telemetry, no CDN at runtime.
5. **Every error goes in `ERRORS.md`** (symptom → cause → fix → status) before moving on. Check it before debugging something that "feels familiar".
6. **Tick `TASKS.md`** when a task is done and verified on the box (not just written).
7. **Honest labels.** Anything replayed shows REPLAY, synthetic data shows SYNTHETIC, a fallback path is labelled fallback. No hard-coded numbers in the UI.
8. **Small commits, real timestamps.** Commit after each working step with a clear message. Everything in this repo was written on 3 Oct 2026.
9. **Box facts:** GB10 is aarch64 + CUDA 13. Use the container images listed in `ARCHITECTURE.md`. Mongo must be **8.2** (8.0 crashes on this kernel). Ports 8080/8081/11434–11438/18789/3128 are reserved.
10. **Deadline:** 18:00 code freeze. After 16:30, only fixes, plus recording the video.
