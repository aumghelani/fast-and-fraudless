"""In-app phone line between two browsers on the bank's network (WebRTC).

The box only relays the two connection descriptions (offer and answer, with their network candidates);
the voices go laptop to laptop. One desk line at a time: a customer page calls, the banker's dashboard answers.

  POST /api/rtc/call     {sdp, name}  -> {id}       the customer rings the desk
  GET  /api/rtc/state                  -> the line  both sides poll it
  POST /api/rtc/answer   {id, sdp}                  the banker picks up
  POST /api/rtc/hangup   {id}                       either side hangs up
"""
from __future__ import annotations

import threading
import time
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

router = APIRouter()
_lock = threading.Lock()
_line: dict = {"state": "idle"}  # idle | ringing | connected
RING_TIMEOUT_S = 90
MAX_SDP = 200_000


class CallBody(BaseModel):
    sdp: str
    name: Optional[str] = None


class AnswerBody(BaseModel):
    id: str
    sdp: str


class HangupBody(BaseModel):
    id: Optional[str] = None


def _idle() -> None:
    _line.clear()
    _line["state"] = "idle"


@router.post("/api/rtc/call")
def call(body: CallBody):
    if not body.sdp.strip():
        raise HTTPException(400, "missing offer")
    with _lock:
        _idle()
        _line.update({"state": "ringing", "id": uuid.uuid4().hex[:8], "offer": body.sdp[:MAX_SDP],
                      "name": (body.name or "Customer").strip()[:40] or "Customer", "since": time.time()})
        return {"id": _line["id"]}


@router.get("/api/rtc/state")
def state():
    with _lock:
        if _line.get("state") == "ringing" and time.time() - _line.get("since", 0) > RING_TIMEOUT_S:
            _idle()  # nobody answered
        return dict(_line)


@router.post("/api/rtc/answer")
def answer(body: AnswerBody):
    with _lock:
        if _line.get("id") != body.id or _line.get("state") != "ringing":
            raise HTTPException(409, "that call is no longer ringing")
        _line.update({"state": "connected", "answer": body.sdp[:MAX_SDP], "since": time.time()})
    return {"ok": True}


@router.post("/api/rtc/hangup")
def hangup(body: HangupBody):
    with _lock:
        if body.id and _line.get("id") not in (None, body.id):
            return {"ok": True}  # an older call; the line has already moved on
        _idle()
    return {"ok": True}
