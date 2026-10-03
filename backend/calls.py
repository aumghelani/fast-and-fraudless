"""Call loop (ARCHITECTURE.md §4B): audio -> <=10 s ASR windows -> LLM cues -> payee check -> rules -> banker.

REST (README contract): POST /api/calls/start, /api/calls/{id}/audio, /api/calls/{id}/replay, /api/calls/{id}/end,
/api/calls/{id}/decision, GET /api/audio/{clip}. Every change is published as SSE type "call".

Models perceive (Parakeet, Nemotron), code decides (rules.decide), the banker approves (decision endpoint).
Env knobs (read here, not in config.py): TW_CUES=llm|keywords (default llm, keyword fallback when unreachable).
"""
import logging
import os
import random
import re
import threading
import time
from functools import lru_cache
from pathlib import Path
from typing import Optional

import httpx
import numpy as np
from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import rules
from .bus import bus
from .config import settings
from .cues import parse_amount, perceive
from .db import audit, db, now

log = logging.getLogger("tripwire.calls")
router = APIRouter()

SR = settings.sample_rate
PARTIAL_MIN_S = 2.0      # transcribe the incomplete window for live subtitles once it has this much audio
FINAL_MIN_S = 0.3        # shortest tail worth transcribing on /end
REPLAY_CHUNK_S = 2.0
LLM_BACKOFF_S = 30.0     # after an LLM failure, use the keyword fallback for this long (no 20 s stalls per window)
REPO = Path(__file__).resolve().parent.parent
CLIP_RE = re.compile(r"^[A-Za-z0-9_\-]{1,64}$")
SCENARIO_RE = re.compile(r"^CALL-\d{2}$")


# ---------------------------------------------------------------- data files
def _resolve(p: Path, *fallback: str) -> Path:
    """Configured path if it exists, else the sibling `data/` folder next to the repo (laptop layout)."""
    return p if p.exists() else REPO.parent.joinpath("data", *fallback)


def audio_dir() -> Path:
    return _resolve(settings.audio_dir, "demo-audio")


@lru_cache(maxsize=1)
def _scenario() -> dict:
    import json
    path = _resolve(settings.scenario_file, "scenario", "scenario.json")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:  # noqa: BLE001
        log.error("scenario file unreadable (%s): %s", path, e)
        return {}


def find_clip(clip: str) -> Optional[Path]:
    if not CLIP_RE.match(clip or ""):
        return None
    d = audio_dir()
    exact = d / f"{clip}.wav"
    if exact.exists():
        return exact
    hits = sorted(d.glob(f"{clip}*.wav"))
    return hits[0] if hits else None


def build_context(scenario: Optional[str], call_id: str) -> dict:
    """Customer, accounts and amount for a call. CALL-01/02 come from scenario.json; others get a generic profile."""
    sc = _scenario()
    if scenario == "CALL-01" and sc.get("scam_case"):
        case = sc["scam_case"]
        cu, wire = case["customer"], case["wire_request"]
        return {"label": f"CALL-01 · {cu['name']} · SYNTHETIC",
                "customer": {k: cu.get(k) for k in ("name", "age", "tenure_years", "prior_wires",
                                                    "typical_monthly_outflow_usd")},
                "customer_account": cu.get("account", "TW-MARG-0001"),
                "payee_account": wire["to_account"], "amount": float(wire["amount_usd"]), "amount_fixed": True}
    if scenario == "CALL-02" and sc.get("normal_case"):
        case = sc["normal_case"]
        cu, wire, hist = case["customer"], case["wire_request"], case.get("history", [])
        typical = (sum(h["amount_usd"] for h in hist) / len(hist)) if hist else None  # derived from history
        return {"label": f"CALL-02 · {cu['name']} · SYNTHETIC",
                "customer": {"name": cu["name"], "age": cu.get("age"), "tenure_years": cu.get("tenure_years"),
                             "prior_wires": len(hist), "typical_monthly_outflow_usd": typical},
                "customer_account": cu.get("account", "TW-DAVI-0001"),
                "payee_account": wire["to_account"], "amount": float(wire["amount_usd"]), "amount_fixed": True}
    who = scenario or "live"
    return {"label": f"{scenario} · generic profile · SYNTHETIC" if scenario else "Live call · generic profile · SYNTHETIC",
            "customer": {"name": f"Customer {who} (fictional)", "age": None, "tenure_years": 10, "prior_wires": 3,
                         "typical_monthly_outflow_usd": 3000},
            "customer_account": f"TW-CUST-{call_id}",
            "payee_account": f"TW-NEWPAYEE-{call_id}",   # a new payee, unknown to the bank
            "amount": None, "amount_fixed": False}


# ---------------------------------------------------------------- ASR (swappable for tests / offline eval)
def asr_http(x: np.ndarray) -> str:
    r = httpx.post(settings.asr_url.rstrip("/") + "/transcribe", content=np.asarray(x, dtype="<f4").tobytes(),
                   timeout=60)
    r.raise_for_status()
    return (r.json().get("text") or "").strip()


_asr = {"fn": asr_http, "mode": "parakeet"}


def set_asr(fn, mode: str = "parakeet") -> None:
    _asr["fn"], _asr["mode"] = fn, mode


def asr_ok() -> bool:
    if _asr["fn"] is not asr_http:
        return True
    try:
        return bool(httpx.get(settings.asr_url.rstrip("/") + "/health", timeout=2).json().get("ok"))
    except Exception:  # noqa: BLE001
        return False


def quiet_cut(x: np.ndarray, sr: int, max_s: float, search_s: float = 4.0) -> int:
    """Cut index in [max_s - search_s, max_s] at the quietest 300 ms stretch, i.e. a real pause between words
    (a 100 ms minimum split "eighteen thousand five | hundred"). Same rule in asr/server.py and backend/calls.py."""
    hi = int(max_s * sr)
    if len(x) < hi:
        return len(x)
    lo = max(int((max_s - search_s) * sr), 1)
    frame = int(0.05 * sr)
    seg = x[lo:hi]
    n = len(seg) // frame
    if n < 8:
        return hi
    energy = (seg[: n * frame].reshape(n, frame) ** 2).mean(axis=1)
    k = 6                                              # 6 x 50 ms = 300 ms smoothing
    smooth = np.convolve(energy, np.ones(k) / k, mode="valid")
    return lo + (int(np.argmin(smooth)) + k // 2) * frame


def split_windows(x: np.ndarray, sr: int = SR, max_s: Optional[float] = None) -> list:
    """Offline equivalent of the streaming cutter (used by eval_calls so eval sees the same windows)."""
    max_s = max_s or settings.asr_window_s
    out = []
    while len(x) >= int(max_s * sr):
        cut = quiet_cut(x, sr, max_s)
        out.append(x[:cut])
        x = x[cut:]
    if len(x) >= int(FINAL_MIN_S * sr):
        out.append(x)
    return out


# ---------------------------------------------------------------- payee check (GPU ring map in Mongo)
def payee_check(payee_account: str, customer_account: str) -> dict:
    base = {"in_ring": False, "ring_id": None, "hops": None, "path": [], "payee_account": payee_account}
    try:
        docs = list(db().rings.find({"accounts": payee_account},
                                    {"_id": 1, "hub": 1, "type": 1, "tier": 1, "found_at": 1}).limit(50))
    except Exception as e:  # noqa: BLE001 - Mongo down: say so, never invent a ring
        return {**base, "error": f"ring map unavailable: {type(e).__name__}"}
    if not docs:
        return base

    def rank(d):
        return (d.get("hub") == payee_account, d.get("tier") == "escalate", str(d.get("found_at") or ""))

    ring = max(docs, key=rank)
    hub = ring.get("hub")
    is_hub = hub == payee_account
    return {**base, "in_ring": True, "ring_id": ring["_id"], "hops": 1 if is_hub else 2,
            "path": [customer_account, payee_account] if is_hub else [customer_account, payee_account, hub],
            "ring_type": ring.get("type"), "ring_tier": ring.get("tier")}


# ---------------------------------------------------------------- call state
class Call:
    def __init__(self, call_id: str, scenario: Optional[str]):
        self.call_id = call_id
        self.lock = threading.RLock()            # guards fields below
        self.audio_lock = threading.Lock()       # serialises audio processing so windows stay in order
        self.analysis_lock = threading.Lock()    # one cues->rules pass at a time
        self.analysis_running = False
        self.analysis_dirty = False
        self.hold_notified = False
        self.stop = threading.Event()
        self.buf = np.zeros(0, dtype=np.float32)
        self.audio_s = 0.0
        self.committed_s = 0.0
        self.windows: list = []
        self.partial = ""
        self.source = "mic"
        self.clip = None
        self.asr_mode = _asr["mode"]
        self.asr_error = None
        self.cue_source = None
        self.cues: list = []
        self.payee_check: dict = {"in_ring": False, "ring_id": None, "hops": None, "path": []}
        self.recommendation = None
        self.reasons: list = []
        self.questions: list = []
        self.features: dict = {}
        self.banker_decision = None
        self.ended = False
        self.started_at = now()
        self.set_scenario(scenario)

    def set_scenario(self, scenario: Optional[str]) -> None:
        ctx = build_context(scenario, self.call_id)
        self.scenario = scenario
        self.label = ctx["label"]
        self.customer = ctx["customer"]
        self.customer_account = ctx["customer_account"]
        self.payee_account = ctx["payee_account"]
        self.amount = ctx["amount"]
        self.amount_fixed = ctx["amount_fixed"]

    def transcript(self) -> str:
        return " ".join(w["text"] for w in self.windows if w["text"]).strip()

    def public(self) -> dict:
        with self.lock:
            final = self.transcript()
            live = (final + " " + self.partial).strip() if self.partial else final
            return {
                "call_id": self.call_id, "label": self.label, "scenario": self.scenario, "synthetic": True,
                "customer": dict(self.customer), "customer_account": self.customer_account,
                "payee_account": self.payee_account, "amount": self.amount,
                "source": self.source, "clip": self.clip, "asr": self.asr_mode, "asr_error": self.asr_error,
                "transcript": live, "transcript_final": final, "partial": self.partial,
                "windows": [dict(w) for w in self.windows], "audio_s": round(self.audio_s, 2),
                "cues": list(self.cues), "cue_source": self.cue_source,
                "payee_check": dict(self.payee_check),
                "recommendation": self.recommendation, "reasons": list(self.reasons),
                "questions": list(self.questions), "features": dict(self.features),
                "banker_decision": self.banker_decision, "ended": self.ended,
                "started_at": self.started_at.isoformat(),
            }


_calls: dict = {}
_calls_lock = threading.Lock()
_llm = {"down_until": 0.0}


def _publish(c: Call, persist: bool = False) -> dict:
    obj = c.public()
    bus.publish("call", obj)
    if persist:
        try:
            doc = {k: v for k, v in obj.items() if k not in ("call_id", "partial")}
            doc.update({"_id": c.call_id, "updated_at": now()})
            db().calls.replace_one({"_id": c.call_id}, doc, upsert=True)
        except Exception as e:  # noqa: BLE001 - Mongo hiccup must not stop a live call
            log.warning("persist call %s failed: %s", c.call_id, e)
    return obj


def _new_id() -> str:
    for _ in range(200):
        cid = f"{random.randint(100, 9999):04d}"
        if cid in _calls:
            continue
        try:
            if db().calls.find_one({"_id": cid}, {"_id": 1}):
                continue
        except Exception:  # noqa: BLE001
            pass
        return cid
    raise HTTPException(500, "could not allocate a call id")


def _get(call_id: str) -> Call:
    with _calls_lock:
        c = _calls.get(call_id)
    if c is not None:
        return c
    try:   # restore a call from Mongo after a backend restart (audio buffer is not restored)
        doc = db().calls.find_one({"_id": call_id})
    except Exception:  # noqa: BLE001
        doc = None
    if not doc:
        raise HTTPException(404, f"call {call_id} not found")
    c = Call(call_id, doc.get("scenario"))
    for k in ("label", "customer", "customer_account", "payee_account", "amount", "source", "clip", "cues",
              "cue_source", "payee_check", "recommendation", "reasons", "questions", "features",
              "banker_decision", "ended", "windows"):
        if k in doc and doc[k] is not None:
            setattr(c, k, doc[k])
    c.hold_notified = c.recommendation == "HOLD"
    with _calls_lock:
        return _calls.setdefault(call_id, c)


# ---------------------------------------------------------------- pipeline
def _transcribe(c: Call, x: np.ndarray) -> str:
    last = None
    for _ in range(2):
        try:
            text = _asr["fn"](x)
            with c.lock:
                c.asr_error = None
            return text
        except Exception as e:  # noqa: BLE001
            last = e
    with c.lock:
        c.asr_error = f"{type(last).__name__}: {last}"[:200]
    log.warning("ASR failed for call %s: %s", c.call_id, last)
    return ""


def _commit(c: Call, seg: np.ndarray) -> None:
    t = time.time()
    text = _transcribe(c, seg)
    with c.lock:
        t0 = c.committed_s
        c.committed_s += len(seg) / SR
        c.windows.append({"i": len(c.windows), "t0_s": round(t0, 2), "t1_s": round(c.committed_s, 2),
                          "text": text, "asr_latency_s": round(time.time() - t, 3)})


def feed(c: Call, samples: np.ndarray) -> dict:
    """Append audio; cut every full window (at a pause) -> ASR; refresh the partial transcript."""
    W = settings.asr_window_s
    committed = False
    with c.audio_lock:
        with c.lock:
            if c.ended:
                raise HTTPException(409, "call ended")
            c.buf = np.concatenate([c.buf, samples.astype(np.float32, copy=False)])
            c.audio_s += len(samples) / SR
        while True:
            with c.lock:
                if len(c.buf) < int(W * SR):
                    break
                cut = quiet_cut(c.buf, SR, W)
                seg, c.buf = c.buf[:cut], c.buf[cut:]
            _commit(c, seg)
            committed = True
        with c.lock:
            rest = c.buf.copy()
        partial = _transcribe(c, rest) if len(rest) >= int(PARTIAL_MIN_S * SR) else ""
        with c.lock:
            c.partial = partial
    obj = _publish(c, persist=committed)
    if committed:
        _schedule_analysis(c)
    return obj


def _analyze(c: Call) -> None:
    with c.analysis_lock:
        with c.lock:
            transcript = c.transcript()
        use_llm = os.environ.get("TW_CUES", "llm").lower() != "keywords" and time.time() >= _llm["down_until"]
        cues, source = perceive(transcript, use_llm=use_llm)
        if use_llm and source != "llm":
            _llm["down_until"] = time.time() + LLM_BACKOFF_S
        with c.lock:
            amount = c.amount if c.amount_fixed else parse_amount(transcript)
            customer, payee, cust_acct = dict(c.customer), c.payee_account, c.customer_account
        pc = payee_check(payee, cust_acct)
        d = rules.decide(cues, customer, amount, pc)
        with c.lock:
            c.cues, c.cue_source, c.payee_check, c.amount = cues, source, pc, amount
            c.recommendation, c.reasons, c.questions = d["recommendation"], d["reasons"], d["questions"]
            c.features = d.get("features", {})
            first_hold = c.recommendation == "HOLD" and not c.hold_notified
            if first_hold:
                c.hold_notified = True
        _publish(c, persist=True)
        if first_hold:
            _notify(c)


def _analysis_loop(c: Call) -> None:
    try:
        while True:
            _analyze(c)
            with c.lock:
                if not c.analysis_dirty:
                    c.analysis_running = False
                    return
                c.analysis_dirty = False
    except Exception:  # noqa: BLE001
        log.exception("analysis failed for call %s", c.call_id)
        with c.lock:
            c.analysis_running = False


def _schedule_analysis(c: Call) -> None:
    """Debounced: while one pass runs, further windows just mark it dirty and one more pass follows."""
    with c.lock:
        if c.analysis_running:
            c.analysis_dirty = True
            return
        c.analysis_running = True
    threading.Thread(target=_analysis_loop, args=(c,), name=f"call-{c.call_id}-analysis", daemon=True).start()


def _notify(c: Call) -> None:
    try:
        from .notifier import notify
    except ImportError:
        log.info("notifier not available; HOLD alert for call %s not sent", c.call_id)
        return
    try:
        notify(f"Call {c.call_id}: HOLD advised", kind="call")
    except Exception as e:  # noqa: BLE001
        log.warning("notify failed for call %s: %s", c.call_id, e)


def end_call(c: Call) -> dict:
    c.stop.set()
    with c.audio_lock:
        with c.lock:
            if c.ended:
                return c.public()
            rest, c.buf = c.buf, np.zeros(0, dtype=np.float32)
        if len(rest) >= int(FINAL_MIN_S * SR):
            _commit(c, rest)
        with c.lock:
            c.partial = ""
            c.ended = True
    _analyze(c)   # final decision on the complete transcript
    return c.public()


def _replay_worker(c: Call, path: Path, auto_end: bool) -> None:
    try:
        import soundfile as sf
        x, sr = sf.read(str(path), dtype="float32")
        if x.ndim > 1:
            x = x.mean(axis=1)
        if sr != SR:
            x = np.interp(np.arange(0, len(x) * SR / sr) * sr / SR, np.arange(len(x)), x).astype(np.float32)
        if not asr_ok():
            _replay_transcript_fallback(c, path, len(x) / SR)
        else:
            step = int(REPLAY_CHUNK_S * SR)
            t0 = time.time()
            for i in range(0, len(x), step):
                chunk = x[i:i + step]
                due = t0 + (i + len(chunk)) / SR       # a chunk exists once it has been "spoken"
                if c.stop.wait(max(0.0, due - time.time())):
                    return
                try:
                    feed(c, chunk)
                except HTTPException:
                    return
        if auto_end and not c.stop.is_set():
            end_call(c)
    except Exception:  # noqa: BLE001
        log.exception("replay failed for call %s", c.call_id)


def _replay_transcript_fallback(c: Call, path: Path, duration_s: float) -> None:
    """ARCHITECTURE §9: ASR down -> feed the stored reference transcript line by line, labelled as fallback."""
    ref = audio_dir() / "parakeet_cpu_transcripts.txt"
    text = ""
    if ref.exists():
        stem = path.stem[:30]   # the reference file truncates names to 30 characters
        for line in ref.read_text(encoding="utf-8").splitlines():
            if "|" in line and line.split()[0].startswith(stem):
                text = line.split("|", 1)[1].strip()
                break
    with c.lock:
        c.asr_mode = "transcript-fallback"
        c.asr_error = "ASR unreachable; reference transcript fed line by line (REPLAY)"
    sentences = [s.strip() for s in re.findall(r"[^.!?]+[.!?]?", text) if s.strip()]
    if not sentences:
        _publish(c, persist=True)
        return
    gap = max(duration_s / len(sentences), 0.5)
    for s in sentences:
        if c.stop.wait(gap):
            return
        with c.lock:
            t0 = c.committed_s
            c.committed_s += gap
            c.audio_s = c.committed_s
            c.windows.append({"i": len(c.windows), "t0_s": round(t0, 2), "t1_s": round(c.committed_s, 2),
                              "text": s, "asr_latency_s": None, "fallback": True})
        _publish(c, persist=True)
        _schedule_analysis(c)


# ---------------------------------------------------------------- routes
class StartBody(BaseModel):
    scenario: Optional[str] = None


class ReplayBody(BaseModel):
    clip: str
    auto_end: bool = True


class DecisionBody(BaseModel):
    decision: str


@router.post("/api/calls/start")
def start_call(body: Optional[StartBody] = Body(default=None)):
    scenario = (body.scenario if body else None) or None
    if scenario is not None:
        scenario = scenario.strip().upper()
        if not SCENARIO_RE.match(scenario):
            raise HTTPException(400, "scenario must look like CALL-01")
    cid = _new_id()
    c = Call(cid, scenario)
    with _calls_lock:
        _calls[cid] = c
    _publish(c, persist=True)
    return {"call_id": cid}


@router.get("/api/calls/{call_id}")
def get_call(call_id: str):
    return _get(call_id).public()


@router.post("/api/calls/{call_id}/audio")
async def post_audio(call_id: str, request: Request):
    c = await run_in_threadpool(_get, call_id)
    body = await request.body()
    body = body[: len(body) - len(body) % 4]
    x = np.frombuffer(body, dtype="<f4").astype(np.float32)
    if not np.all(np.isfinite(x)):
        x = np.nan_to_num(x)
    obj = await run_in_threadpool(feed, c, x)
    return {"ok": True, "audio_s": obj["audio_s"], "windows": len(obj["windows"]), "partial": obj["partial"]}


@router.post("/api/calls/{call_id}/replay")
def replay(call_id: str, body: ReplayBody):
    c = _get(call_id)
    path = find_clip(body.clip)
    if path is None:
        raise HTTPException(404, f"clip {body.clip} not found in {audio_dir()}")
    m = re.match(r"^(CALL-\d{2})", body.clip.upper())
    with c.lock:
        if c.ended:
            raise HTTPException(409, "call ended")
        if c.scenario is None and m and c.audio_s == 0:
            c.set_scenario(m.group(1))     # replaying CALL-01 on a blank call loads Margaret's profile
        c.source, c.clip = "replay", body.clip
    _publish(c, persist=True)
    threading.Thread(target=_replay_worker, args=(c, path, body.auto_end), name=f"call-{call_id}-replay",
                     daemon=True).start()
    return {"ok": True, "call_id": call_id, "clip": body.clip, "audio_url": f"/api/audio/{body.clip}"}


@router.post("/api/calls/{call_id}/end")
def end(call_id: str):
    return end_call(_get(call_id))


@router.post("/api/calls/{call_id}/decision")
def decision(call_id: str, body: DecisionBody):
    d = (body.decision or "").strip().lower()
    if d not in ("hold", "release"):
        raise HTTPException(400, "decision must be hold or release")
    c = _get(call_id)
    with c.lock:
        c.banker_decision = d
        rec = c.recommendation
    try:
        audit("banker", f"call_{d}", call_id=call_id, recommendation=rec, scenario=c.scenario)
    except Exception as e:  # noqa: BLE001
        log.warning("audit failed for call %s: %s", call_id, e)
    return _publish(c, persist=True)


@router.get("/api/audio/{clip}")
def get_audio(clip: str):
    path = find_clip(clip)
    if path is None:
        raise HTTPException(404, f"clip {clip} not found")
    return FileResponse(str(path), media_type="audio/wav", filename=path.name)
