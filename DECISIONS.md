# Decisions (why we did it this way)

| # | Decision | Why |
|---|---|---|
| D-1 | Tripwire (bank scam-call guard + GPU ring finder) over Alert Desk / Second Ear / Wire Room | Matches both 1st-place winners' shape (several engines, live real-world input, regulated local reason); finance untouched by past winners; real labelled data |
| D-2 | Nemotron-3-Nano NVFP4 on NVIDIA vLLM 26.05.post1, gpu-mem 0.35 | Exact config that ran on GB10 for Anchor (1st NYC); leaves memory for RAPIDS + ASR |
| D-3 | Wake the agent with `nemoclaw <sb> agent` CLI from a Mongo change stream | Proven on GB10 by past teams; `/hooks/wake` never proven inside a NemoClaw sandbox |
| D-4 | Ring finder written in plain pandas, run on GPU with `python -m cudf.pandas` | Same code gives the CPU-vs-GPU benchmark and can be tested on a laptop |
| D-5 | Only ring transactions stored in Mongo; the full 32M stay in GPU memory | Mongo stays light; validator still checks every cited ID |
| D-6 | ASR in ≤10 s windows | E-006 |
| D-7 | Telegram + Slack alerts are content-free | Nothing sensitive leaves the box |
| D-8 | No live demo (event rule): the video carries the Wi-Fi-off + HOLD moment | Event rules announced on the day |
| D-9 | Detector looks only at cross-bank ACH edges | HI-Small labels: 86.6% of laundering is ACH (0.75% laundering rate vs ~0.02% other formats), 98% cross-bank. Precision 0.27% → 4.5% at similar recall |
| D-10 | Escalation tier: span ≥ 2 h and median ≥ $4,000 → agent; else "watch" | Benign flagged bursts: median span 0.4 h, $2.5k; true rings: 45 h, $9.5k. Keeps 146/158 true rings, precision 49% (ring-level) / 45% (txn-level). 304 of 4,369 rings escalated on HI-Small |
| D-11 | Call-cue perception = union of two readers (Nemotron + deterministic keywords), each cue with a verbatim quote; rules still decide | First on-box eval with Nemotron alone: 4/5 scams, 0/5 false holds; CALL-03 miss was perception ("today", "Microsoft support" present but not extracted). Disclosed: change made after seeing that eval run; rerun reported in full |
