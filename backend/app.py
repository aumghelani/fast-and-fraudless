"""Tripwire backend: FastAPI on :8790 (see ARCHITECTURE.md §3 and the README contract).

Run on the box:  .venv/bin/uvicorn backend.app:app --host 0.0.0.0 --port 8790
"""
from __future__ import annotations

import asyncio
import os
import importlib
import threading
import time
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import counters, egress, telemetry, worker_feed
from .bus import bus
from .config import settings

STARTED = time.time()
_restored = {"value": False}


def _optional(module: str):
    """Modules built by other team members; the app must start even if one is missing or broken."""
    try:
        return importlib.import_module(f"backend.{module}")
    except Exception as e:  # report, don't crash (CLAUDE.md: honest, never silent)
        print(f"[app] optional module backend.{module} unavailable: {e}", flush=True)
        return None


agent_api = _optional("agent_api")
agent_bridge = _optional("agent_bridge")
calls = _optional("calls")


def _health_loop() -> None:
    while True:
        up = time.time() - STARTED
        bus.publish("health", {"uptime_s": round(up), "restored": _restored["value"] and up < 30})
        time.sleep(5)


@asynccontextmanager
async def lifespan(app: FastAPI):
    bus.bind(asyncio.get_running_loop())
    try:
        _restored["value"] = await run_in_threadpool(worker_feed.hydrate)
        bus.publish("counters", await run_in_threadpool(counters.get))
    except Exception as e:
        print(f"[app] Mongo not reachable at startup: {e}", flush=True)
    worker_feed.start()
    egress.start()
    telemetry.start()
    if agent_bridge and hasattr(agent_bridge, "start") and os.environ.get("TW_AGENT_BRIDGE", "on") != "off":
        agent_bridge.start()
    elif agent_bridge:
        print("[app] agent bridge disabled (TW_AGENT_BRIDGE=off)", flush=True)
    threading.Thread(target=_health_loop, name="health", daemon=True).start()
    print(f"[app] Tripwire backend up on :{settings.port} (restored={_restored['value']})", flush=True)
    yield


app = FastAPI(title="Tripwire", lifespan=lifespan)
for mod in (agent_api, calls):
    if mod and hasattr(mod, "router"):
        app.include_router(mod.router)


@app.get("/api/health")
def health():
    return {"ok": True, "uptime_s": round(time.time() - STARTED), "restored": _restored["value"],
            "modules": {"agent_api": bool(agent_api), "agent_bridge": bool(agent_bridge), "calls": bool(calls)}}


@app.get("/api/state")
def state():
    return JSONResponse(bus.snapshot())


@app.get("/api/events")
async def events():
    async def gen():
        yield "retry: 2000\n\n"
        async for line in bus.stream():
            yield f"data: {line}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.post("/api/demo/exfil")
async def demo_exfil():
    return await run_in_threadpool(egress.attempt_exfil)


if settings.ui_dist.exists():
    app.mount("/", StaticFiles(directory=str(settings.ui_dist), html=True), name="ui")
else:
    @app.get("/", response_class=HTMLResponse)
    def placeholder():
        return ("<html><body style='background:#0b1220;color:#cbd5e1;font-family:sans-serif;padding:40px'>"
                "<h1>Tripwire backend is running</h1><p>UI not built yet (ui/dist missing). "
                "Live events: <a style='color:#76b900' href='/api/events'>/api/events</a> · "
                "<a style='color:#76b900' href='/api/state'>/api/state</a></p></body></html>")
