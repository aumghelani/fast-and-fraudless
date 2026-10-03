# Fast and Fraudless: submission

**Fast and Fraudless stops a scam wire while the customer is still on the phone, on a Dell Pro Max GB10 that never leaves the bank.**

Margaret, 78, calls her bank to wire $40,000 "for her grandson's bail". While she talks, the GB10 transcribes the call, spots the scam script, and sees that the payee account belongs to a money-mule ring that the GPU found earlier in the bank's transactions. The banker gets a **HOLD** card with three questions to ask. Separately, an agent that runs on its own has already drafted the Suspicious Activity Report (SAR) for the whole ring. Every number in it is checked against the database, and an analyst approves it. Nothing leaves the box except a content-free alert.

## 1. Local-first + always-on

- **All inference runs on the GB10:**
  - Nemotron-3-Nano-30B-A3B NVFP4 on vLLM (~60 tok/s)
  - Parakeet TDT 0.6B v3 speech-to-text (a 58 s call transcribes in 4.3 s)
  - RAPIDS cuDF/cuGraph on 31.9M transactions
  - No cloud LLM calls.
- **Why it must be local:**
  - SAR secrecy is federal law (31 CFR 1020.320(e)).
  - A live call is customer voice data.
  - The account graph is the bank's most sensitive dataset.
- **Always-on, with nobody pressing buttons:**
  - The ring finder replays the bank's transactions continuously on the GPU and flags rings.
  - A MongoDB change stream (with a persisted resume token) wakes the investigator agent.
  - The agent drafts the SAR and posts a Telegram alert, all by itself.
- **NVIDIA stack in the runtime path:**
  - NemoClaw onboarded the sandbox.
  - The investigator is an OpenClaw agent inside an OpenShell sandbox, using the local vLLM through `inference.local`.
  - Cloud paths are closed (`policy exclude nvidia`, restricted tier).
  - A custom preset allows exactly one host API path, plus the Telegram channel.
- **Proof on screen:**
  - The live OpenShell egress log shows every ALLOWED/DENIED line. Bot tokens are redacted as `[CREDENTIAL]`.
  - Customer data sent out: **0**.
  - Exfiltration attempts are DENIED.
  - An ONLINE/OFFLINE indicator shows the box keeps working with the Wi-Fi off.
- **Self-healing:** kill the agent, the backend or the GPU worker and each restarts and resumes from MongoDB on its own.

## 2. Business value

- **Buyer:** a bank's fraud and BSA/AML team.
- **Value:**
  - US banks must monitor for laundering and file SARs, and drafting them takes analyst hours.
  - Elder fraud cost Americans over 60 **$7.75B** in 2025 (FBI IC3).
  - Wires are effectively final, so the only moment to stop one is during the call.
- **Money line:** *"Margaret keeps her $40,000. The bank keeps Margaret. And the report the law requires is already written."*
- **Measured on the GB10:**
  - **Scam calls caught 5/5, false holds 0/5.** Ten synthetic calls run through Parakeet → Nemotron cue reading → deterministic rules. The legitimate $85k house closing gets VERIFY, not HOLD.
  - **Ring finder** over all 31.9M IBM AML transactions:
    - 801 of 2,755 labelled laundering attempts recovered (736 by escalated rings alone).
    - Fan-in 184/355, fan-out 171/345, gather-scatter 206/321, scatter-gather 176/331.
    - Escalation tier precision 40.9% versus 4.2% for all flagged rings, so analysts see a 10x cleaner queue.
    - Cycle, stack and bipartite patterns are out of scope, and we say so.
  - **SAR drafts:** citations are machine-verified. On the demo ring, 13/13 transaction ids and amounts were verified; on another ring the validator caught a wrong citation before an analyst saw it.
  - **Speed:** 31.9M rows load plus full detection takes 16.5 s on the GPU versus 37.9 s on the CPU, while the GPU also serves the LLM.
- **Integrates as if built in-house:**
  - ISO 20022 pacs.008/pain.001 screening endpoint
  - Signed webhooks to case management
  - FinCEN-style SAR XML draft and CSV case export
  - White-label branding
  - OpenAPI at `/docs`
  - See INTEGRATION.md.

## 3. Demo

The 3-minute video is one continuous take on the GB10:
1. Margaret's call → live transcript → scam cues → payee matched to the GPU-found ring → **HOLD**.
2. David's rent call → **NO HOLD**.
3. The agent's SAR with verified citations, and the analyst's approval.
4. An exfiltration attempt DENIED by OpenShell.
5. Wi-Fi switched off: everything keeps working.
6. The agent killed: it comes back by itself.
7. The Telegram alert lands, with no names and no amounts.

## 4. Technical execution

- **Models perceive, code decides, humans approve:**
  - Nemotron and a keyword reader only extract cues, each with a verbatim quote.
  - `rules.py` decides.
  - The banker or analyst clicks.
  - The agent cannot send money or file anything.
- **Can't be talked into anything:**
  - Injected instructions in a caller's speech or in case data do not change decisions.
  - Invented numbers are flagged by the validator.
  - Outbound attempts are denied (SECURITY.md).
- **Reliability:**
  - 60+ automated tests.
  - Every on-box problem we hit is logged with its fix in ERRORS.md.
  - Every design choice and its reason is in DECISIONS.md.
- **Stack:**
  - Dell Pro Max GB10 (Blackwell, 128 GB unified memory)
  - NVIDIA NemoClaw v0.0.124 + OpenShell 0.0.116 + OpenClaw
  - Nemotron-3-Nano NVFP4 on NVIDIA vLLM 26.05
  - Parakeet TDT 0.6B v3 (transformers)
  - RAPIDS 26.08 (cuDF, cuGraph)
  - MongoDB 8.2
  - FastAPI
  - React + three.js UI

## 5. What is synthetic

- The transactions are IBM's published synthetic AML dataset, which comes with labels.
- Margaret, David and the 10 calls are fictional; the call audio was generated with text-to-speech.
- Only Margaret's wire is planted. Its payee is a real labelled feeder account from the IBM data.

## What it will never do

- Send or release money.
- File a SAR.
- Contact a customer.
- Send customer data off the box.

It can recommend a hold and draft a report. A person decides.
