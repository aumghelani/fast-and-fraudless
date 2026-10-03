# Video script (≤ 3:00, one continuous take, clock visible)

Record on the laptop (OBS or the Windows Game Bar). The browser shows `http://172.20.65.119:8790` reached over Wi-Fi.
- For the Wi-Fi-off moment, either open the page on the box itself (`http://localhost:8790` in its browser) and record its screen with OBS there,
- or record the laptop while the box stays reachable over the direct cable at `http://169.254.236.88:8790`.
Keep a phone with Telegram in the shot for the alert.

| Time | On screen | Voice-over (one line each) |
|---|---|---|
| 0:00 | Title card: *Fast and Fraudless* | "Margaret is 78. She's about to wire $40,000 to a scammer, and her bank is about to stop it." |
| 0:08 | Control Room. 3D bank map turning, rings lighting up, GB10 gauges moving | "One Dell Pro Max GB10. 32 million bank transactions in GPU memory, scanned for laundering rings continuously." |
| 0:20 | Box Wi-Fi switched off; the pill turns **OFFLINE** | "Banks can't send this data to the cloud. So: no internet. Everything still runs on the box." |
| 0:30 | Press 1: Margaret's call. Voice orb moves, transcript streams, cue chips light up | "Parakeet transcribes the call live. Nemotron reads the scam cues: urgency, secrecy, authority." |
| 1:00 | Payee graph: payee → ring hub (red). **HOLD THIS WIRE** card with three questions | "The payee is a mule account in a ring our GPU found this morning. Code decides: hold. The banker asks three questions." |
| 1:20 | Banker clicks HOLD | "The model perceives. Code decides. A human approves." |
| 1:30 | Press 2: David's rent call → **NO HOLD** (green) | "And it doesn't cry wolf: routine rent goes straight through." |
| 1:45 | Agent panel: the case woke by itself, SAR with ✓ citations, "Every number checked against the database" | "Nobody asked the OpenClaw agent. It woke on its own inside an OpenShell sandbox and drafted the SAR. Every number is verified." |
| 2:05 | Press E: exfiltration attempt → red **DENIED** in the OpenShell log; "data sent out: 0" | "If anything tries to leave the box, OpenShell denies it, and logs it." |
| 2:15 | Run `scripts/demo_kill_resume.sh` in a terminal beside the UI; the RESTORED banner appears | "Kill the agent. Kill the backend. It heals itself and resumes from MongoDB." |
| 2:35 | Wi-Fi back on; the Telegram alert arrives on the phone | "The only thing that ever leaves: a content-free alert. No names, no amounts." |
| 2:45 | Eval strip: 5/5 scams, 0/5 false holds, rings recovered, data out 0 | "Five of five scams caught, zero false holds. On a box that never leaves the bank." |

Before recording:
- Start a fresh replay so rings appear live (`RF_ARGS=--reset TW_SPEED=240`).
- Warm up the model (one call replay).
- Close other tabs.
- Do a dry run once.
