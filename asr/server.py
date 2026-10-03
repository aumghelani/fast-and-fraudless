"""Parakeet TDT 0.6B v3 speech-to-text service (:8791). Runs inside the vllm/vllm-openai:v0.27.1 container.

POST /transcribe  body = raw little-endian float32, 16 kHz mono  ->  {"text", "seconds", "latency_s"}
GET  /health

Anything longer than 12 s is split into <=10 s chunks at the quietest point (ERRORS.md E-006: Parakeet
silently drops sentences on long clips). `ParakeetASR` is also used directly by backend/eval_calls.py --asr local.
"""

import logging
import os
import threading
import time
from pathlib import Path

import numpy as np

SR = 16000
MAX_ONE_PASS_S = 12.0
CHUNK_S = 10.0

log = logging.getLogger("tripwire.asr")


def quiet_cut(x: np.ndarray, sr: int, max_s: float, search_s: float = 2.0) -> int:
    """Sample index in [max_s - search_s, max_s] with the lowest 100 ms energy (a pause between words)."""
    hi = int(max_s * sr)
    if len(x) < hi:
        return len(x)
    lo = max(int((max_s - search_s) * sr), 1)
    frame = int(0.1 * sr)
    seg = x[lo:hi]
    n = len(seg) // frame
    if n < 2:
        return hi
    energy = (seg[: n * frame].reshape(n, frame) ** 2).mean(axis=1)
    return lo + int(np.argmin(energy)) * frame + frame // 2


def split_windows(x: np.ndarray, sr: int = SR, max_s: float = CHUNK_S) -> list[np.ndarray]:
    out = []
    while len(x) > int(max_s * sr):
        cut = quiet_cut(x, sr, max_s)
        out.append(x[:cut])
        x = x[cut:]
    if len(x):
        out.append(x)
    return out


class ParakeetASR:
    def __init__(self, model_path: str, device: str | None = None, dtype: str | None = None):
        import torch
        from transformers import pipeline

        self.model_path = model_path
        if device is None:
            device = "cuda:0" if torch.cuda.is_available() else "cpu"
        self.device = device
        wanted = (dtype or os.environ.get("TW_ASR_DTYPE", "")).strip()
        if wanted:
            candidates = [wanted]
        elif device.startswith("cuda"):
            candidates = ["float16", "bfloat16", "float32"]
        else:
            candidates = ["float32"]
        self._lock = threading.Lock()
        last_err: Exception | None = None
        for name in candidates:
            try:
                t = time.time()
                self.pipe = pipeline("automatic-speech-recognition", model=model_path, device=device,
                                     dtype=getattr(torch, name))
                self.dtype = name
                self._warmup()
                log.info("Parakeet loaded on %s (%s) in %.1fs", device, name, time.time() - t)
                last_err = None
                break
            except Exception as e:  # noqa: BLE001 - try the next precision
                log.warning("Parakeet %s on %s failed: %s", name, device, e)
                last_err = e
                self.pipe = None
        if last_err is not None or self.pipe is None:
            raise RuntimeError(f"could not load Parakeet from {model_path}: {last_err}")

    def _warmup(self) -> None:
        """Run once on a real clip if available (validates the precision), else on low noise."""
        wav = os.environ.get("TW_ASR_WARMUP_WAV", "")
        if wav and Path(wav).exists():
            import soundfile as sf
            a, sr = sf.read(wav, dtype="float32")
            if a.ndim > 1:
                a = a.mean(axis=1)
            text = self._one(a[: int(min(len(a), 8 * sr))])
            if not text.strip():
                raise RuntimeError(f"warm-up on {wav} returned empty text")
            log.info("warm-up: %s", text[:80])
        else:
            self._one((np.random.default_rng(0).standard_normal(SR) * 1e-3).astype(np.float32))

    def _one(self, x: np.ndarray) -> str:
        if len(x) < int(0.2 * SR):
            return ""
        with self._lock:
            out = self.pipe({"raw": np.ascontiguousarray(x, dtype=np.float32), "sampling_rate": SR})
        return (out.get("text") or "").strip()

    def transcribe(self, x: np.ndarray) -> str:
        x = np.asarray(x, dtype=np.float32)
        if len(x) <= int(MAX_ONE_PASS_S * SR):
            return self._one(x)
        return " ".join(t for t in (self._one(w) for w in split_windows(x, SR, CHUNK_S)) if t)


# ---------------------------------------------------------------- HTTP service
def create_app():
    from contextlib import asynccontextmanager

    from fastapi import FastAPI, Request
    from fastapi.concurrency import run_in_threadpool

    state: dict = {"asr": None, "error": None, "started": time.time()}

    def _load() -> None:
        path = os.environ.get("TW_PARAKEET", "/models/parakeet-tdt-0.6b-v3")
        try:
            state["asr"] = ParakeetASR(path)
        except Exception as e:  # noqa: BLE001 - keep serving /health with the error
            state["error"] = str(e)
            log.exception("ASR load failed")

    @asynccontextmanager
    async def lifespan(_app):
        await run_in_threadpool(_load)
        yield

    app = FastAPI(title="tripwire-asr", lifespan=lifespan)

    @app.get("/health")
    def health() -> dict:
        a = state["asr"]
        return {"ok": a is not None, "model": a.model_path if a else None, "device": a.device if a else None,
                "dtype": a.dtype if a else None, "error": state["error"],
                "uptime_s": round(time.time() - state["started"], 1)}

    @app.post("/transcribe")
    async def transcribe(request: Request):
        a = state["asr"]
        if a is None:
            from fastapi.responses import JSONResponse
            return JSONResponse({"error": state["error"] or "model not loaded"}, status_code=503)
        body = await request.body()
        body = body[: len(body) - len(body) % 4]
        x = np.frombuffer(body, dtype="<f4").astype(np.float32)
        t = time.time()
        text = await run_in_threadpool(a.transcribe, x)
        return {"text": text, "seconds": round(len(x) / SR, 3), "latency_s": round(time.time() - t, 3)}

    return app


logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("TW_ASR_HOST", "127.0.0.1"), port=int(os.environ.get("TW_ASR_PORT", "8791")))
