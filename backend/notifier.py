"""Content-free alerts (Telegram, optional Slack). The only thing that leaves the box (AGENT_RULES.md rule 4).

    notify("Ring R-102 escalated — SAR draft ready for analyst review", kind="ring")

* Every text is sanitized first: money amounts, account numbers, long digit runs, transaction ids,
  e-mail addresses, phone numbers and person names are replaced by placeholders. A sanitizer hit is
  logged loudly (it means a caller tried to send content).
* Primary path ("openclaw"): the OpenClaw agent inside the OpenShell sandbox delivers the message, so
  the send appears in the sandbox egress log:
      nemoclaw <sandbox> agent --agent main --session-id alerts --json \
          -m "Reply with exactly this text and nothing else: <text>" \
          --deliver --reply-channel telegram --reply-to <chat_id>
  Flags are UNVERIFIED (STACK_GUIDE §11); override with env TW_NOTIFY_CMD_TEMPLATE using the
  placeholders {nemoclaw} {sandbox} {prompt} {text} {channel} {target}.
* Fallback ("direct-fallback"): direct HTTPS from the host (Telegram Bot API sendMessage with
  TELEGRAM_BOT_TOKEN, Slack chat.postMessage with SLACK_BOT_TOKEN). Always labelled as fallback.
* TW_NOTIFY_MODE: auto (default: openclaw, then direct on failure) | openclaw | direct | off.
* Sends run on one background thread, so callers never block. Identical texts within 30 s are dropped.
"""
from __future__ import annotations

import json
import os
import queue
import re
import shlex
import subprocess
import threading
import time
from collections import deque
from typing import Any

from . import nemoclaw_cli
from .config import settings

DEDUPE_S = 30.0
DEFAULT_TEMPLATE = ("{nemoclaw} {sandbox} agent --agent main --session-id alerts --json -m {prompt} "
                    "--deliver --reply-channel {channel} --reply-to {target}")
PROMPT = "Reply with exactly this text and nothing else: {text}"

# ------------------------------------------------------------------ sanitizer
_NUM = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"
_CUR = (r"USD|US\s?Dollars?|dollars?|bucks|EUR|Euros?|GBP|pounds?|Yen|Yuan|Rupees?|Rubles?|Francs?|Pesos?|"
        r"Reals?|Shekels?|Riyals?|Bitcoins?|BTC|k\b|K\b|grand|thousand|million|mil\b|M\b")
_RULES: list[tuple[re.Pattern, str]] = [
    (re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+"), "[email]"),
    (re.compile(rf"[$€£¥]\s?(?:{_NUM})(?:\s?(?:{_CUR}))?", re.I), "[amount]"),
    (re.compile(rf"\b(?:USD|EUR|GBP)\s?(?:{_NUM})", re.I), "[amount]"),
    (re.compile(rf"(?<![\w-])(?:{_NUM})\s?(?:{_CUR})(?![A-Za-z])", re.I), "[amount]"),
    (re.compile(r"(?<![\w-])\d{1,3}(?:,\d{3})+(?:\.\d+)?(?![\w])"), "[amount]"),
    (re.compile(r"(?<![\w-])\d+\.\d+(?![\w])"), "[amount]"),
    (re.compile(r"\+?\d[\d\s().-]{7,}\d"), "[number]"),
    # IBM AML account ids are 9 hex chars (e.g. 802225A40); also IBAN-like strings
    (re.compile(r"\b(?=[0-9A-Fa-f]*\d)(?=[0-9A-Fa-f]*[A-Fa-f])[0-9A-Fa-f]{8,}\b"), "[acct]"),
    (re.compile(r"\b[A-Z]{2}\d{2}[A-Z0-9]{10,30}\b"), "[acct]"),
    (re.compile(r"(?<!R-)\b\d{5,}\b"), "[number]"),   # ring ids (R-24434) are case refs, not PII
    (re.compile(r"\bT\d{2,}\b"), "[txn]"),
    (re.compile(r"\b(?:Mr|Mrs|Ms|Miss|Dr|Sir|Madam)\.?\s+[A-Z][a-z][a-z'’]*(?:-[A-Za-z][a-z'’]*)*"), "[name]"),
]
_TITLE_RUN = re.compile(r"\b[A-Z][a-z][a-z'’]*(?:-[A-Za-z][a-z'’]*)*(?:\s+[A-Z][a-z][a-z'’]*(?:-[A-Za-z][a-z'’]*)*)+\b")
# Capitalized words our own templates use; anything else capitalized next to another capitalized word
# is treated as a possible name.
ALLOW_WORDS = {"Ring", "Rings", "Call", "Calls", "Case", "Sar", "Tripwire", "Analyst", "Banker", "Hold",
               "Release", "Released", "Approved", "Rejected", "Draft", "Review", "Alert", "Escalated",
               "Verify", "Advised", "New", "Ready", "Flagged", "The", "A", "An", "By", "For", "Agent",
               "Error", "Test", "Synthetic", "Replay", "Demo", "Telegram", "Slack", "Ok"}
_known_names: set[str] | None = None


def _scenario_names() -> set[str]:
    """Customer names from the planted scenario file, if present (strip them even when alone)."""
    global _known_names
    if _known_names is not None:
        return _known_names
    names: set[str] = set()
    try:
        data = json.loads(settings.scenario_file.read_text(encoding="utf-8"))

        def walk(o: Any) -> None:
            if isinstance(o, dict):
                for k, v in o.items():
                    if isinstance(v, str) and k.lower() in ("name", "customer", "customer_name", "payee_name"):
                        names.update(w for w in re.findall(r"[A-Z][a-z][a-z'’]*(?:-[A-Za-z][a-z'’]*)*", v))
                    else:
                        walk(v)
            elif isinstance(o, list):
                for v in o:
                    walk(v)
        walk(data)
    except Exception:
        pass
    _known_names = names - ALLOW_WORDS
    return _known_names


def sanitize(text: str) -> str:
    """Strip anything that could be customer content. Idempotent."""
    s = " ".join(str(text).split())
    for rx, rep in _RULES:
        s = rx.sub(rep, s)

    def names(m: re.Match) -> str:
        return " ".join(w if w.capitalize() in ALLOW_WORDS else "[name]" for w in m.group(0).split())
    s = _TITLE_RUN.sub(names, s)
    for n in _scenario_names():
        s = re.sub(rf"\b{re.escape(n)}\b", "[name]", s)
    s = re.sub(r"\[name\](?:\s+\[name\])+", "[name]", s)
    return s[:300]


def is_clean(text: str) -> bool:
    return sanitize(text) == " ".join(str(text).split())[:300]


# ------------------------------------------------------------------ senders
def _channels() -> list[tuple[str, str]]:
    out = [("telegram", cid) for cid in settings.telegram_chat_ids]
    if settings.slack_channel:
        out.append(("slack", settings.slack_channel))
    return out


def _openclaw_cmd(channel: str, target: str, text: str) -> list[str]:
    template = os.environ.get("TW_NOTIFY_CMD_TEMPLATE") or DEFAULT_TEMPLATE
    vals = {"nemoclaw": settings.nemoclaw_bin, "sandbox": settings.sandbox, "channel": channel,
            "target": target, "text": text, "prompt": PROMPT.format(text=text)}
    cmd = []
    for tok in shlex.split(template):
        for k, v in vals.items():
            tok = tok.replace("{" + k + "}", v)
        cmd.append(tok)
    return cmd


def _send_openclaw(channel: str, target: str, text: str) -> tuple[bool, str]:
    cmd = _openclaw_cmd(channel, target, text)
    try:
        p = nemoclaw_cli.run(cmd, timeout=float(os.environ.get("TW_NOTIFY_TIMEOUT_S", "120")),
                             urgent=True)  # serialized, ahead of queued investigations (E-014)
    except FileNotFoundError:
        return False, f"{cmd[0]} not found"
    except subprocess.TimeoutExpired:
        return False, "timed out"
    if p.returncode != 0:
        return False, f"exit {p.returncode}: {(p.stderr or p.stdout).strip()[-300:]}"
    return True, "exit 0"   # NOTE: exit 0 means the turn ran; delivery itself is not confirmed by the CLI


def _send_direct(channel: str, target: str, text: str) -> tuple[bool, str]:
    import httpx
    try:
        if channel == "telegram":
            tok = os.environ.get("TELEGRAM_BOT_TOKEN", "")
            if not tok:
                return False, "TELEGRAM_BOT_TOKEN not set"
            r = httpx.post(f"https://api.telegram.org/bot{tok}/sendMessage",
                           json={"chat_id": target, "text": text}, timeout=10)
        elif channel == "slack":
            tok = os.environ.get("SLACK_BOT_TOKEN", "")
            if not tok:
                return False, "SLACK_BOT_TOKEN not set"
            r = httpx.post("https://slack.com/api/chat.postMessage", json={"channel": target, "text": text},
                           headers={"Authorization": f"Bearer {tok}"}, timeout=10)
        else:
            return False, f"unknown channel {channel}"
        body = r.json() if r.headers.get("content-type", "").startswith("application/json") else {}
        if r.status_code == 200 and body.get("ok"):
            return True, "HTTP 200 ok"
        return False, f"HTTP {r.status_code}: {str(body.get('description') or body.get('error') or '')[:200]}"
    except Exception as e:  # network down (Wi-Fi off) is expected during the demo
        return False, f"{type(e).__name__}: {e}"[:300]


def _count_success() -> None:
    try:
        from . import counters
        counters.inc("alerts_sent")
    except Exception as e:
        print(f"[notifier] could not count alert: {e}", flush=True)


def deliver(text: str, kind: str = "") -> list[dict]:
    """Send one (already sanitized) text to every channel, synchronously. Returns one result per channel."""
    mode = os.environ.get("TW_NOTIFY_MODE", "auto").lower()
    results = []
    if mode == "off":
        return results
    for channel, target in _channels():
        ok, path, detail = False, "", ""
        if mode in ("auto", "openclaw"):
            ok, detail = _send_openclaw(channel, target, text)
            path = "openclaw"
            if not ok:
                print(f"[notifier] openclaw {channel} failed: {detail}", flush=True)
        if not ok and mode in ("auto", "direct"):
            ok, detail = _send_direct(channel, target, text)
            path = "direct-fallback"
        res = {"ok": ok, "channel": channel, "path": path, "detail": detail, "kind": kind, "ts": time.time()}
        print(f"[notifier] {kind or 'alert'} -> {channel} via {path}: {'ok' if ok else 'FAILED'} ({detail})",
              flush=True)
        if ok:
            _count_success()
        _recent.append(res)
        results.append(res)
    return results


# ------------------------------------------------------------------ background queue + dedupe
_q: queue.Queue = queue.Queue()
_recent: deque = deque(maxlen=50)
_seen: dict[str, float] = {}
_lock = threading.Lock()
_thread: threading.Thread | None = None


def _loop() -> None:
    while True:
        text, kind = _q.get()
        try:
            deliver(text, kind)
        except Exception as e:
            print(f"[notifier] delivery crashed: {e}", flush=True)


def _ensure_thread() -> None:
    global _thread
    with _lock:
        if _thread is None or not _thread.is_alive():
            _thread = threading.Thread(target=_loop, name="notifier", daemon=True)
            _thread.start()


def notify(text: str, kind: str = "alert", wait: bool = False) -> dict:
    """Queue a content-free alert to every configured channel. Never blocks unless wait=True."""
    clean = sanitize(text)
    changed = clean != " ".join(str(text).split())[:300]
    if changed:
        print(f"[notifier] WARNING sanitizer removed content from a {kind} alert; sending: {clean!r}", flush=True)
    now = time.time()
    with _lock:
        for k in [k for k, t in _seen.items() if now - t > DEDUPE_S]:
            del _seen[k]
        if clean in _seen:
            return {"queued": False, "deduped": True, "text": clean, "kind": kind}
        _seen[clean] = now
    channels = [c for c, _ in _channels()]
    if wait:
        return {"queued": False, "deduped": False, "text": clean, "kind": kind, "sanitized": changed,
                "results": deliver(clean, kind)}
    _ensure_thread()
    _q.put((clean, kind))
    return {"queued": True, "deduped": False, "text": clean, "kind": kind, "sanitized": changed,
            "channels": channels}


def recent() -> list[dict]:
    """Last delivery results (per channel, with path openclaw | direct-fallback) for debugging/UI."""
    return list(_recent)
