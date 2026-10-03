# Runbook (on the box)

Everything below runs as `dell` on the GB10. The self-healing layer is described in ARCHITECTURE.md §12.

## Start / install (once, idempotent)
```bash
cd ~/tripwire && bash scripts/supervise/install.sh      # units tw-backend, tw-worker, tw-watchdog + restart policies
```
After this, nobody starts anything by hand. A killed process comes back in seconds; a reboot brings everything back
(linger is on, containers have `--restart unless-stopped`).

## Status
```bash
systemctl --user status 'tw-*'                 # three units, all "active (running)"
curl -s localhost:8790/api/health              # backend ok, modules agent_bridge + calls true
docker ps --format '{{.Names}} {{.Status}}'    # mongo vllm asr rapids + the sandbox
~/tripwire/.venv/bin/python ~/tripwire/scripts/supervise/wd_state.py hb   # ring finder heartbeat age, status
```
Mongo `meta.watchdog` holds the last checks and `recoveries` (self-heal count); `meta.worker` the ring finder heartbeat.

## Logs
| What | Where |
|---|---|
| backend (agent bridge, calls) | `~/tw/backend.log` |
| ring finder | `~/tw/ringfinder.log` |
| watchdog (every repair is a `HEAL` line) | `~/tw/watchdog.log` |
| unit events | `journalctl --user -u tw-backend -u tw-worker -u tw-watchdog -n 50` |

## Restart / stop
```bash
bash ~/tripwire/scripts/backend_restart.sh     # = systemctl --user restart tw-backend (+ kills leftovers)
systemctl --user restart tw-worker             # ring finder resumes where it stopped
bash ~/tripwire/scripts/worker_up.sh           # FRESH replay (wipes rings, cases, SARs) and restart
systemctl --user stop tw-worker                # stop the ring finder (e.g. before --bench); start to resume
systemctl --user stop tw-watchdog              # pause repairs while working on a service by hand
```
Deploy new code: copy the repo archive, then `bash scripts/backend_restart.sh` and/or `systemctl --user restart tw-worker`.

## Recover by hand (only if the watchdog could not)
| Symptom | Do |
|---|---|
| dashboard / agent cannot reach OpenClaw | `nemoclaw tripwire recover` (takes the host lock: not while an agent run is busy) |
| ASR `/health` fails | `docker restart asr` (~30 s model load) |
| vLLM `/v1/models` fails | `docker logs --tail 50 vllm`; restart only if it is really dead (`bash scripts/vllm_up.sh`, minutes) |
| a case stuck in error | it retries after 30/120/300 s; after 3 failures it stays error (see its timeline) |
| two backends (`pgrep -fa "uvicorn backend.app"`) | the watchdog kills the extra one within 30 s; `bash scripts/backend_restart.sh` also does |

## Self-healing demo (video)
```bash
bash ~/tripwire/scripts/demo_kill_resume.sh
```
It kills (-9) the agent run in flight, the backend and the ring finder, then prints when each one is back by itself.

## Remove the units
```bash
bash ~/tripwire/scripts/supervise/uninstall.sh   # back to nohup backend; worker via worker_up.sh
```
