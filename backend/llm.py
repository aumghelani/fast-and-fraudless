"""Local LLM client (vLLM OpenAI API on the box). JSON-only, thinking off. Never a cloud endpoint."""
from __future__ import annotations

import json
import re

import httpx

from .config import settings


class LLMError(RuntimeError):
    pass


_THINK = re.compile(r"<think>.*?</think>", re.S | re.I)


def extract_json(text: str) -> dict:
    """Return the first balanced {...} object in `text` that parses as JSON."""
    if not text:
        raise LLMError("empty LLM reply")
    text = _THINK.sub("", text)
    start = text.find("{")
    while start != -1:
        depth, in_str, esc = 0, False, False
        for i in range(start, len(text)):
            ch = text[i]
            if in_str:
                if esc:
                    esc = False
                elif ch == "\\":
                    esc = True
                elif ch == '"':
                    in_str = False
            elif ch == '"':
                in_str = True
            elif ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    try:
                        obj = json.loads(text[start:i + 1])
                    except json.JSONDecodeError:
                        break
                    if isinstance(obj, dict):
                        return obj
                    break
        start = text.find("{", start + 1)
    raise LLMError(f"no JSON object in LLM reply: {text[:200]!r}")


def chat_json(system: str, user: str, max_tokens: int = 400, timeout: float = 20) -> dict:
    body = {
        "model": settings.llm_model,
        "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}],
        "temperature": 0,
        "max_tokens": max_tokens,
        "chat_template_kwargs": {"enable_thinking": False},
    }
    url = settings.vllm_url.rstrip("/") + "/chat/completions"
    try:
        r = httpx.post(url, json=body, timeout=timeout)
        r.raise_for_status()
        msg = r.json()["choices"][0]["message"]
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as e:
        raise LLMError(f"LLM call failed: {type(e).__name__}: {e}") from e
    # with a reasoning parser, stray output can land in reasoning_content; try content first
    for field in ("content", "reasoning_content", "reasoning"):
        try:
            return extract_json(msg.get(field) or "")
        except LLMError:
            continue
    raise LLMError(f"no JSON object in LLM reply: {str(msg.get('content'))[:200]!r}")
