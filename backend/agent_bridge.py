"""Agent bridge: wakes the sandboxed OpenClaw investigator when the GPU ring finder escalates a ring.

    start()  -> launches daemon threads (call once from the app lifespan)

* A Mongo change stream on `rings` (inserts/replaces with tier=escalate, and updates that set tier to
  escalate). Its resume token is persisted under "rings_agent" and saved only AFTER the ring is queued,
  so a crash can repeat a wake but never lose one.
* On start, escalated rings that have no case yet are queued too (catch-up after a restart).
* A priority queue (largest total_usd first) feeds settings.agent_concurrency workers. Each runs
      nemoclaw <sandbox> agent --agent main --session-id ring-<id> --json -m <WAKE_PROMPT>
  The agent's skill fetches GET /api/agent/case/<id> and POSTs /api/agent/sar (see agent_api.py).
* Case status / timeline go to Mongo `cases` and the SSE bus (`case` events). If the agent run ends
  without a SAR arriving, the case is marked error ("no SAR submitted"): we never pretend.
* Self-healing: a sweeper re-queues interrupted runs (orphaned woke/investigating cases, killed CLI runs)
  and retries failed ones after 30/120/300 s, at most 3 times per case.
Nothing here may crash the backend: every loop logs and retries.
"""
from __future__ import annotations

import itertools
import json
import os
import queue
import re
import socket
import subprocess
import threading
import time

from .bus import bus
from . import nemoclaw_cli, priority
from .config import settings
from .db import db, load_token, now_ms, save_token

TOKEN_KEY = "rings_agent"
# Prompts live in prompts.py. Inline mode (default, E-017): the case file travels in the wake message;
# TW_AGENT_MODE=skill restores the curl-skill flow.
from .prompts import INLINE_PROMPT, WAKE_PROMPT  # noqa: E402
AGENT_MODE = os.environ.get("TW_AGENT_MODE", "inline")
TIMELINE_MAX = 50
_TERMINAL = {"sar_drafted", "approved", "rejected"}
RESUME_MAX = int(os.environ.get("TW_AGENT_RESUME_MAX", "3"))    # retries after real errors
BACKOFF_S = (30, 120, 300)                                       # error -> retry delays
INTERRUPT_MAX = 10                      # resumes after kills/restarts (not the case's fault, but bounded)
SWEEP_S = float(os.environ.get("TW_AGENT_SWEEP_S", "15"))
LEASE_KEY = "agent_bridge_lease"
RESUME_PRIO = -1e300                    # interrupted runs go first (a forced demo run is -inf)
_ANSI = re.compile(r"\x1b\[[0-9;]*m")

_q: queue.PriorityQueue = queue.PriorityQueue()
_seq = itertools.count()
_queued: set[str] = set()
_inflight: dict[str, float] = {}       # ring id -> dequeue time (this process)
_qlock = threading.Lock()
_kick = threading.Event()              # run the sweeper now (set after every run)
_swept = threading.Event()             # first sweep done: workers may start
_leader = threading.Event()            # this process holds the bridge lease
_started = False
_start_lock = threading.Lock()


def log(*a) -> None:
    print("[agent_bridge]", *a, flush=True)


# ------------------------------------------------------------------ case helpers (shared with agent_api)
def update_case(ring_id: str, msg: str | None = None, status: str | None = None,
                keep_if: set[str] | None = None, **extra) -> dict | None:
    """Append a timeline entry and/or set status, then publish the `case` event.

    keep_if: statuses that must NOT be overwritten (e.g. don't fall back to "investigating" after a SAR).
    Returns the case payload that was published, or None if Mongo failed.
    """
    try:
        cases = db().cases
        cur = cases.find_one({"_id": ring_id}, {"status": 1}) or {}
        upd: dict = {}
        if status and not (keep_if and cur.get("status") in keep_if):
            upd["$set"] = {"status": status, **extra}
        elif extra:
            upd["$set"] = dict(extra)
        if msg:
            upd["$push"] = {"timeline": {"$each": [{"ts": now_ms(), "msg": msg}], "$slice": -TIMELINE_MAX}}
        if not cur:
            upd.setdefault("$set", {}).setdefault("status", status or "woke")
        if upd:
            cases.update_one({"_id": ring_id}, upd, upsert=True)
        doc = cases.find_one({"_id": ring_id}) or {}
        payload = {"ring_id": ring_id, "status": doc.get("status"), "timeline": doc.get("timeline", [])}
        bus.publish("case", payload)
        return payload
    except Exception as e:
        log(f"case update failed for {ring_id}: {e}")
        return None


# ------------------------------------------------------------------ queue
def enqueue(ring_id: str, total_usd: float = 0.0, reason: str = "change stream", force: bool = False,
            prio: float | None = None) -> bool:
    """Queue a ring for investigation (largest total first). force=True re-runs / jumps the queue (demo)."""
    with _qlock:
        if (ring_id in _queued or ring_id in _inflight) and not force:
            return False
        _queued.add(ring_id)
    p = float("-inf") if force else (prio if prio is not None else -float(total_usd or 0.0))
    _q.put((p, next(_seq), ring_id, reason, time.time()))
    return True


def _busy(ring_id: str) -> bool:
    with _qlock:
        return ring_id in _queued or ring_id in _inflight


def _has_case(ring_id: str) -> bool:
    return db().cases.find_one({"_id": ring_id}, {"_id": 1}) is not None


def _consider(doc: dict, reason: str) -> bool:
    if not doc or doc.get("tier") != "escalate":
        return False
    rid = doc.get("_id")
    if not rid or _busy(rid) or _has_case(rid):
        return False
    return enqueue(rid, doc.get("total_usd") or 0.0, reason)


def _catch_up() -> int:
    """Queue escalated rings that never got a case (largest first, capped by TW_AGENT_CATCHUP_MAX so an old
    backlog cannot starve rings that arrive live)."""
    cap = int(os.environ.get("TW_AGENT_CATCHUP_MAX", "25"))
    n = 0
    have = {c["_id"] for c in db().cases.find({}, {"_id": 1})}
    pending = [r for r in db().rings.find({"tier": "escalate"}, {"_id": 1, "total_usd": 1})
               if r["_id"] not in have]
    pending.sort(key=lambda r: -(r.get("total_usd") or 0.0))
    for r in pending[:cap]:
        if enqueue(r["_id"], r.get("total_usd") or 0.0, "catch-up after restart"):
            n += 1
    if len(pending) > cap:
        log(f"catch-up: {len(pending)} escalated rings without a case; queued the largest {cap}")
    return n


# ------------------------------------------------------------------ change stream
PIPELINE = [{"$match": {"$or": [
    {"operationType": {"$in": ["insert", "replace"]}, "fullDocument.tier": "escalate"},
    {"operationType": "update", "updateDescription.updatedFields.tier": "escalate"},
]}}]


def _watch() -> None:
    caught_up = False
    while True:
        try:
            token = load_token(TOKEN_KEY)
            kw = {"resume_after": token} if token else {}
            with db().rings.watch(PIPELINE, full_document="updateLookup", max_await_time_ms=1000, **kw) as stream:
                if not caught_up:   # open the stream first, then catch up, so nothing falls in between
                    n = _catch_up()
                    caught_up = True
                    log(f"watching rings (resume={'yes' if token else 'no'}); catch-up queued {n} ring(s)")
                last_save = time.time()
                while stream.alive:
                    ch = stream.try_next()
                    if ch is None:
                        # idle: persist the post-batch token now and then so a restart resumes close to now
                        if time.time() - last_save > 10 and stream.resume_token:
                            save_token(TOKEN_KEY, stream.resume_token)
                            last_save = time.time()
                        continue
                    doc = ch.get("fullDocument") or {}
                    _consider(doc, "change stream")
                    save_token(TOKEN_KEY, ch["_id"])      # after enqueueing (at-least-once)
                    last_save = time.time()
        except Exception as e:
            msg = str(e)
            # resume point fell off the oplog / invalid token: start fresh (catch-up covers the gap)
            if getattr(e, "code", None) in (260, 280, 286) or "ChangeStreamHistoryLost" in msg:
                log(f"resume token unusable ({msg[:120]}); restarting stream from now")
                try:
                    db().watch_state.delete_one({"_id": TOKEN_KEY})
                except Exception:
                    pass
                caught_up = False
            else:
                log(f"stream error, retrying in 3 s: {msg[:200]}")
            time.sleep(3)


# ------------------------------------------------------------------ workers
def _parse_agent_output(stdout: str) -> str:
    """Text of the agent's reply. stdout is JSON with payloads[].text or result.payloads[].text;
    tolerate log lines before the JSON and plain text."""
    s = (stdout or "").strip()
    if not s:
        return ""
    candidates = [s]
    i = s.find("{")
    if i > 0:
        candidates.append(s[i:])
    candidates += [ln for ln in reversed(s.splitlines()) if ln.strip().startswith("{")]
    for c in candidates:
        try:
            obj, _ = json.JSONDecoder().raw_decode(c)   # stdout can hold several JSON documents back to back
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        payloads = obj.get("payloads") or (obj.get("result") or {}).get("payloads") or []
        texts = [p.get("text", "") for p in payloads if isinstance(p, dict) and p.get("text")]
        if texts:
            return "\n".join(texts)
        for k in ("text", "reply", "message", "output"):
            if isinstance(obj.get(k), str):
                return obj[k]
        return ""
    return ""   # never treat unparsed CLI output as an agent reply


def _sar_since(ring_id: str, since_ms: int) -> dict | None:
    return db().sar_drafts.find_one({"_id": "SAR-" + ring_id, "received_at_ms": {"$gte": since_ms}})


def _killed(rc: int | None) -> bool:
    """CLI ended by a signal (kill -9, OOM, supervisor stop): not the agent's fault, retry at once."""
    return rc is not None and (rc < 0 or rc in (137, 143))


def run_agent(ring_id: str, reason: str = "change stream", queued_s: float = 0.0) -> None:
    update_case(ring_id, f"woke via {reason} (queued {queued_s:.0f} s)", status="woke", keep_if=_TERMINAL)
    if AGENT_MODE == "inline":
        from .agent_api import case_pack   # lazy: agent_api imports this module
        ring = db().rings.find_one({"_id": ring_id})
        if not ring:
            update_case(ring_id, "error: ring not found in Mongo", status="error", keep_if=_TERMINAL,
                        retryable=False)
            return
        prompt = INLINE_PROMPT.format(ring_id=ring_id, case=case_pack(ring))
        update_case(ring_id, "agent reading case file (inline)", status="investigating", keep_if=_TERMINAL)
    else:
        prompt = WAKE_PROMPT.format(ring_id=ring_id)
    cmd = [settings.nemoclaw_bin, settings.sandbox, "agent", "--agent", "main", "--session-id",
           f"ring-{ring_id}-{now_ms()}", "--json", "-m", prompt]
    t0 = time.time()
    t0_ms = now_ms()
    stdout, err, rc, permanent = "", None, None, False
    try:
        p = nemoclaw_cli.run(cmd, timeout=settings.agent_timeout_s)  # serialized (E-014)
        stdout, rc = p.stdout or "", p.returncode
        if p.returncode != 0:
            out = _ANSI.sub("", p.stderr or p.stdout or "").strip()
            err = f"agent exited {p.returncode}" + (f": {out[-300:]}" if out else "")
    except FileNotFoundError:
        err, permanent = f"nemoclaw not found at {settings.nemoclaw_bin}", True
    except subprocess.TimeoutExpired as e:
        stdout = e.stdout.decode(errors="replace") if isinstance(e.stdout, bytes) else (e.stdout or "")
        err = f"agent timed out after {settings.agent_timeout_s} s"
    except Exception as e:
        err = f"agent launch failed: {e}"
    dt = time.time() - t0
    reply = _parse_agent_output(stdout)
    try:
        db().cases.update_one({"_id": ring_id}, {"$set": {"agent_raw": reply[:4000], "agent_s": round(dt, 1)}})
    except Exception as e:
        log(f"could not store agent reply for {ring_id}: {e}")

    if AGENT_MODE == "inline" and reply.strip() and not err:
        try:
            from .agent_api import _store_sar
            code, receipt = _store_sar(ring_id, reply.strip())
            update_case(ring_id, f"SAR draft received from agent ({receipt.strip()[:140]})")
        except Exception as e:
            log(f"inline SAR store failed for {ring_id}: {e}")
    try:
        sar = _sar_since(ring_id, t0_ms)
    except Exception as e:
        sar = None
        log(f"sar lookup failed for {ring_id}: {e}")
    if sar:
        msg = f"agent run finished in {dt:.0f} s"
        if err:
            msg += f" (CLI reported: {err[:120]})"
        update_case(ring_id, msg)          # status already sar_drafted (set by agent_api)
        log(f"{ring_id}: {msg}")
    else:
        why = err or f"agent finished in {dt:.0f} s without posting one"
        _failed(ring_id, why, killed=_killed(rc), retryable=not permanent)
        log(f"{ring_id}: no SAR ({why}); reply: {reply[:200]!r}")


def _failed(ring_id: str, why: str, killed: bool = False, retryable: bool = True) -> None:
    """Mark a run without a SAR. Killed runs resume at once; real errors retry after 30/120/300 s, 3 times."""
    try:
        c = db().cases.find_one({"_id": ring_id}, {"attempts": 1, "fails": 1}) or {}
    except Exception:
        c = {}
    att, fails = int(c.get("attempts") or 0), int(c.get("fails") or 0) + (0 if killed else 1)
    msg = f"error: no SAR submitted ({why})"
    if not retryable:
        update_case(ring_id, msg, status="error", keep_if=_TERMINAL, retryable=False)
    elif killed and att < INTERRUPT_MAX:
        update_case(ring_id, msg + "; run was killed, resuming", status="error", keep_if=_TERMINAL,
                    retryable=True, interrupted=True, retry_at_ms=now_ms())
    elif not killed and fails <= RESUME_MAX:
        delay = BACKOFF_S[min(fails, len(BACKOFF_S)) - 1]
        update_case(ring_id, msg + f"; retry in {delay} s", status="error", keep_if=_TERMINAL, retryable=True,
                    interrupted=False, fails=fails, retry_at_ms=now_ms() + delay * 1000)
    else:
        update_case(ring_id, msg + f"; gave up after {att + 1} runs", status="error", keep_if=_TERMINAL,
                    retryable=False, fails=fails)


# ------------------------------------------------------------------ self-healing
def _alive_backend(pid) -> bool:
    try:
        with open(f"/proc/{int(pid)}/cmdline", "rb") as fh:
            return b"backend.app" in fh.read()
    except FileNotFoundError:
        return False
    except Exception:
        return True


def _hold_lease() -> bool:
    """One active bridge per box: a second (orphaned) backend must not run or steal cases."""
    ws, now = db().watch_state, now_ms()
    me = {"pid": os.getpid(), "host": socket.gethostname()}
    doc = ws.find_one({"_id": LEASE_KEY})
    if doc and (doc.get("pid"), doc.get("host")) != (me["pid"], me["host"]):
        fresh = now - int(doc.get("renewed_ms") or 0) < 4 * SWEEP_S * 1000
        if fresh and (doc.get("host") != me["host"] or _alive_backend(doc.get("pid"))):
            return False
    flt = {"_id": LEASE_KEY, "renewed_ms": doc.get("renewed_ms")} if doc else {"_id": LEASE_KEY}
    try:
        res = ws.update_one(flt, {"$set": {**me, "renewed_ms": now}}, upsert=doc is None)
        return bool(res.matched_count or res.upserted_id is not None)
    except Exception:   # lost the race to another backend
        return False


def _resume(ring_id: str, attempts: int, why: str, front: bool) -> bool:
    """Put a case back in the queue and record the attempt on its timeline."""
    ring = db().rings.find_one({"_id": ring_id}, {"total_usd": 1})
    if not ring:
        update_case(ring_id, "error: ring no longer in Mongo; not resuming", status="error",
                    keep_if=_TERMINAL, retryable=False)
        return False
    update_case(ring_id, f"resumed {why} (attempt {attempts + 1})", status="woke", keep_if=_TERMINAL,
                attempts=attempts, retry_at_ms=None, interrupted=False)
    return enqueue(ring_id, ring.get("total_usd") or 0.0, f"resume {why}", prio=RESUME_PRIO if front else None)


def _sweep(startup: bool) -> int:
    """Re-queue interrupted cases and due retries. At startup nothing runs here yet, so every
    woke/investigating case was left behind by a killed process."""
    now, n = now_ms(), 0
    stuck_ms = (settings.agent_timeout_s + 60) * 1000
    cur = db().cases.find({"status": {"$in": ["woke", "investigating", "error"]}},
                          {"status": 1, "attempts": 1, "fails": 1, "retry_at_ms": 1, "retryable": 1,
                           "interrupted": 1, "timeline": {"$slice": -1}})
    last_ts = lambda c: int(((c.get("timeline") or [{}])[-1] or {}).get("ts") or 0)   # noqa: E731
    for c in sorted(cur, key=last_ts, reverse=True):   # most recent work first (FIFO among equal priority)
        rid = c["_id"]
        if _busy(rid):
            continue
        att, fails = int(c.get("attempts") or 0), int(c.get("fails") or 0)
        last = last_ts(c)
        if c.get("status") == "error":
            if c.get("retryable") is False or fails > RESUME_MAX:
                continue
            due = c.get("retry_at_ms")
            if due is None:   # errors recorded before self-healing existed: first retry after 30 s
                due = last + BACKOFF_S[0] * 1000
            interrupted = bool(c.get("interrupted"))
            if now < due or (not interrupted and _q.qsize() >= 2):   # old failures trickle in behind live rings
                continue
            n += _resume(rid, att + 1, "after interruption" if interrupted else "after error", front=interrupted)
        elif startup or now - last > stuck_ms:
            if att >= INTERRUPT_MAX:
                update_case(rid, f"error: interrupted {att} times; not resuming", status="error",
                            keep_if=_TERMINAL, retryable=False)
                continue
            n += _resume(rid, att + 1, "after interruption", front=True)
    return n


def _sweeper() -> None:
    startup, standby = True, False
    while True:
        try:
            if _hold_lease():
                _leader.set()
                n = _sweep(startup)
                if n or startup:
                    log(f"sweep{' at startup' if startup else ''}: re-queued {n} case(s)")
                startup, standby = False, False
            else:
                _leader.clear()
                if not standby:
                    log("another live backend holds the bridge lease: standby")
                standby = True
        except Exception as e:
            log(f"sweep failed: {e}")
        finally:
            _swept.set()
        _kick.wait(SWEEP_S)
        _kick.clear()


def _worker(n: int) -> None:
    _swept.wait(30)   # let the startup sweep queue interrupted cases first
    while True:
        prio, _, ring_id, reason, t_q = _q.get()
        _leader.wait()   # standby while another live backend owns the bridge
        with _qlock:     # the case doc is the dedupe key from here on (ids restart after ringfinder --reset)
            _queued.discard(ring_id)
            if ring_id in _inflight:
                continue
            _inflight[ring_id] = time.time()
        try:
            waited = priority.wait_until_quiet()   # real-time first: never start an investigation mid-call
            if waited > 1:
                log(f"{ring_id}: waited {waited:.0f} s for a live call to finish")
            run_agent(ring_id, reason, time.time() - t_q)
        except Exception as e:
            log(f"worker {n} crashed on {ring_id}: {e}")
            _failed(ring_id, f"bridge failure ({e})")
        finally:
            with _qlock:
                _inflight.pop(ring_id, None)
            _kick.set()


def start() -> None:
    global _started
    with _start_lock:
        if _started:
            return
        _started = True
    threading.Thread(target=_sweeper, name="agent-sweeper", daemon=True).start()
    threading.Thread(target=_watch, name="agent-watch", daemon=True).start()
    for i in range(max(1, settings.agent_concurrency)):
        threading.Thread(target=_worker, args=(i,), name=f"agent-worker-{i}", daemon=True).start()
    log(f"started: {settings.agent_concurrency} worker(s), sandbox={settings.sandbox}, bin={settings.nemoclaw_bin}, "
        f"sweep every {SWEEP_S:.0f} s, up to {RESUME_MAX} resumes per case")


def queue_size() -> int:
    return _q.qsize()
