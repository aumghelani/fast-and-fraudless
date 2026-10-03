"""Single source of configuration. Everything is overridable by environment variable (prefix TW_)."""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path


def _env(name: str, default: str) -> str:
    return os.environ.get(f"TW_{name}", default)


@dataclass(frozen=True)
class Settings:
    # storage
    mongo_uri: str = _env("MONGO", "mongodb://127.0.0.1:27017/?replicaSet=rs0&directConnection=true")
    db_name: str = _env("DB", "tripwire")
    # local model endpoints (never cloud)
    vllm_url: str = _env("VLLM_URL", "http://127.0.0.1:8000/v1")
    llm_model: str = _env("LLM_MODEL", "nemotron-3-nano")
    asr_url: str = _env("ASR_URL", "http://127.0.0.1:8791")
    # NVIDIA agent stack
    sandbox: str = _env("SANDBOX", "tripwire")
    nemoclaw_bin: str = _env("NEMOCLAW_BIN", str(Path.home() / ".local/bin/nemoclaw"))
    openshell_bin: str = _env("OPENSHELL_BIN", "openshell")
    agent_concurrency: int = int(_env("AGENT_CONCURRENCY", "2"))
    agent_timeout_s: int = int(_env("AGENT_TIMEOUT_S", "240"))
    # alert channels (content-free messages only)
    telegram_chat_ids: tuple[str, ...] = tuple(x for x in _env("TELEGRAM_CHAT_IDS", "").split(",") if x)
    slack_channel: str = _env("SLACK_CHANNEL", "")
    # data
    data_dir: Path = Path(_env("DATA_DIR", str(Path.home() / "tw/data")))
    scenario_file: Path = Path(_env("SCENARIO", str(Path.home() / "tw/data/scenario/scenario.json")))
    audio_dir: Path = Path(_env("AUDIO_DIR", str(Path.home() / "tw/data/demo-audio")))
    ui_dist: Path = Path(_env("UI_DIST", str(Path(__file__).resolve().parent.parent / "ui" / "dist")))
    # call pipeline
    asr_window_s: float = float(_env("ASR_WINDOW_S", "10"))
    sample_rate: int = 16000
    # server
    host: str = _env("HOST", "0.0.0.0")
    port: int = int(_env("PORT", "8790"))
    # alert destinations that do NOT count as "customer data out"
    local_dests: tuple[str, ...] = field(default=("inference.local", "host.openshell.internal",
                                                  "api.telegram.org", "slack.com", "api.slack.com",
                                                  "wss-primary.slack.com", "wss-backup.slack.com"))


settings = Settings()
