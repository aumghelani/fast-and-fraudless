# Pitch deck (5 minutes, 8 slides): content

1. **Fast and Fraudless.** *Stops a scam wire while the customer is still on the phone, on a box that never leaves the bank.* (Dell Pro Max GB10 photo)
2. **Margaret, 78, $40,000.**
   - "My grandson is in jail." Americans over 60 lost **$7.75B** to fraud in 2025 (FBI).
   - Wires are final: the only moment to stop one is *during the call*.
3. **Why it must be local.**
   - SAR secrecy is federal law (31 CFR 1020.320(e)).
   - A live call is customer voice data.
   - The account graph is the bank's most sensitive asset.
   - Result: every model runs on the GB10, and the agent is sandboxed by OpenShell.
4. **How it works** (one picture):
   - **GPU ring finder** (RAPIDS, 31.9M transactions) → **OpenClaw agent** drafts the SAR on its own → validator → analyst.
   - **Live call** → Parakeet → Nemotron perceives → **code decides** → banker approves.
   - *Models perceive. Code decides. Humans approve.*
5. **Demo** (embedded video, 3:00).
6. **Results, measured on the GB10:**
   - Scam calls caught **5/5**, false holds **0/5**.
   - Laundering rings: **10x cleaner analyst queue** (escalated precision 41% vs 4%).
   - SAR citations machine-verified (13/13 on the demo ring).
   - 31.9M rows: GPU 16.5 s vs CPU 37.9 s.
7. **Built to be trusted:**
   - **Can't be talked into it:** 23 attacks, 0 decisions changed, 0 invented facts passed, 0 data out.
   - **Heals itself:** backend back in 4.5 s; the agent resumes its case.
   - **Nothing leaves:** customer data sent out = 0.
   - **Never** moves money or files anything.
8. **Drops into any bank:**
   - Fits existing systems: ISO 20022 payments, signed webhooks to case management, FinCEN-style SAR draft, white-label.
   - Buyer: the fraud and BSA team.
   - *"Margaret keeps her $40,000. The bank keeps Margaret. And the report the law requires is already written."*
