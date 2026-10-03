"""GB10 telemetry (1 Hz) and network state (online/offline) published on the bus.

nvidia-smi reports memory as N/A on the GB10's unified memory, so memory comes from /proc/meminfo
(pattern from SquidWard runtime.py / Anchor telemetry.py, see STACK_GUIDE §13).
"""
from __future__ import annotations

import socket
import subprocess
import threading
import time

from .bus import bus

FIELDS = "utilization.gpu,temperature.gpu,power.draw"


def _num(v: str):
    v = v.strip()
    if v in {"", "N/A", "[N/A]", "[Not Supported]", "Not Supported"}:
        return None
    try:
        return float(v)
    except ValueError:
        return None


def sample() -> dict:
    gpu = {"gpu_util": None, "temp_c": None, "power_w": None}
    try:
        out = subprocess.run(["nvidia-smi", f"--query-gpu={FIELDS}", "--format=csv,noheader,nounits"],
                             capture_output=True, text=True, timeout=2).stdout.strip().splitlines()
        if out:
            u, t, p = (out[0].split(",") + [""] * 3)[:3]
            gpu = {"gpu_util": _num(u), "temp_c": _num(t), "power_w": _num(p)}
    except Exception:
        pass
    mem_used = mem_total = None
    try:
        info = {}
        with open("/proc/meminfo") as fh:
            for line in fh:
                k, v = line.split(":", 1)
                info[k] = int(v.strip().split()[0]) * 1024
        mem_total = info["MemTotal"] / 1e9
        mem_used = (info["MemTotal"] - info["MemAvailable"]) / 1e9
    except Exception:
        pass
    return {**gpu, "mem_used_gb": None if mem_used is None else round(mem_used, 1),
            "mem_total_gb": None if mem_total is None else round(mem_total, 1)}


def online(timeout: float = 1.5) -> bool:
    try:
        with socket.create_connection(("1.1.1.1", 443), timeout=timeout):
            return True
    except OSError:
        return False


def _telemetry_loop() -> None:
    while True:
        bus.publish("telemetry", sample())
        time.sleep(1)


def _net_loop() -> None:
    last = None
    while True:
        state = online()
        if state != last:
            print(f"[net] {'ONLINE' if state else 'OFFLINE'}", flush=True)
        bus.publish("net", {"online": state})
        last = state
        time.sleep(3)


def start() -> None:
    threading.Thread(target=_telemetry_loop, name="telemetry", daemon=True).start()
    threading.Thread(target=_net_loop, name="net", daemon=True).start()
