"""Bank integration: ISO 20022 intake, core-banking batch ingest, branding, health (see INTEGRATION.md).

Everything stays on the box. Screening reuses calls.payee_check (GPU ring map) and rules.decide (code decides).
"""
import csv
import hashlib
import heapq
import hmac
import io
import ipaddress
import itertools
import json
import math
import os
import re
import socket
import threading
import time
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Callable, Optional
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse, Response
from pymongo.errors import DuplicateKeyError, PyMongoError

from .bus import bus
from .db import audit, db, load_token, now, save_token

router = APIRouter(prefix="/api/integrations", tags=["integrations"])

REPO = Path(__file__).resolve().parent.parent
CONFIG_DIR = REPO / "config"
DATA_LABEL = os.environ.get("TW_DATA_LABEL", "SYNTHETIC (IBM AML replay)")
MAX_XML_BYTES = 1_000_000
MAX_MSG_TXNS = 100
MAX_BATCH_BYTES = 25_000_000
MAX_BATCH_ROWS = 50_000
ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")

_state = {"started": False, "hooks": None, "watching": False, "note": "not started"}
_start_lock = threading.Lock()


def _log(msg: str) -> None:
    print(f"[integrations] {msg}", flush=True)


def _read_json(path: Path) -> Optional[dict]:
    """JSON object from a file; None if missing or unreadable."""
    try:
        if not path.is_file():
            return None
        obj = json.loads(path.read_text(encoding="utf-8"))
        return obj if isinstance(obj, dict) else None
    except Exception as e:  # noqa: BLE001
        _log(f"could not read {path.name}: {e}")
        return None


def _iso(v) -> Optional[str]:
    """ISO string for datetimes, epoch-ms ints and strings."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return datetime.fromtimestamp(v / 1000, timezone.utc).isoformat()
    return v.isoformat() if hasattr(v, "isoformat") else str(v)


def require_token(request: Request) -> None:
    """Bearer token (or X-API-Key) when TW_INTEGRATIONS_TOKEN is set; open otherwise."""
    want = os.environ.get("TW_INTEGRATIONS_TOKEN", "")
    if not want:
        return
    got = request.headers.get("authorization", "")
    got = got[7:].strip() if got.lower().startswith("bearer ") else request.headers.get("x-api-key", "")
    if not hmac.compare_digest(got.encode(), want.encode()):
        raise HTTPException(401, "missing or invalid integration token", headers={"WWW-Authenticate": "Bearer"})


AUTH = [Depends(require_token)]


async def _body(request: Request, limit: int) -> bytes:
    n = request.headers.get("content-length", "")
    if n.isdigit() and int(n) > limit:
        raise HTTPException(413, f"body larger than {limit} bytes")
    raw = await request.body()
    if len(raw) > limit:
        raise HTTPException(413, f"body larger than {limit} bytes")
    if not raw.strip():
        raise HTTPException(400, "empty body")
    return raw


# ---------------------------------------------------------------- ISO 20022 parsing (namespace-agnostic)
MSG_TYPES = {"FIToFICstmrCdtTrf": "pacs.008", "CstmrCdtTrfInitn": "pain.001"}
IBAN_RE = re.compile(r"^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$")
CCY_RE = re.compile(r"^[A-Z]{3}$")


def _ln(el) -> str:
    """Tag name without its namespace."""
    return el.tag.rsplit("}", 1)[-1] if isinstance(el.tag, str) else ""


def _child(el, *path):
    for name in path:
        if el is None:
            return None
        el = next((c for c in el if _ln(c) == name), None)
    return el


def _children(el, name: str) -> list:
    return [] if el is None else [c for c in el if _ln(c) == name]


def _txt(el, *path) -> Optional[str]:
    e = _child(el, *path)
    t = (e.text or "").strip() if e is not None else ""
    return t or None


def iban_ok(iban: str) -> bool:
    """ISO 13616 mod-97 check digits."""
    if not IBAN_RE.match(iban):
        return False
    s = iban[4:] + iban[:4]
    return int("".join(str(int(ch, 36)) for ch in s)) % 97 == 1


def _account(acct) -> dict:
    iban = _txt(acct, "Id", "IBAN")
    if iban:
        iban = re.sub(r"\s+", "", iban).upper()
        return {"account": iban, "scheme": "IBAN", "iban_valid": iban_ok(iban)}
    other = _txt(acct, "Id", "Othr", "Id")
    if other:
        scheme = _txt(acct, "Id", "Othr", "SchmeNm", "Cd") or _txt(acct, "Id", "Othr", "SchmeNm", "Prtry")
        return {"account": other, "scheme": scheme or "Othr"}
    return {"account": None, "scheme": None}


def _agent(agt) -> Optional[str]:
    fi = _child(agt, "FinInstnId")
    return (_txt(fi, "BICFI") or _txt(fi, "BIC") or _txt(fi, "ClrSysMmbId", "MmbId") or _txt(fi, "LEI")
            or _txt(fi, "Othr", "Id") or _txt(fi, "Nm"))


def _party(el, role: str) -> dict:
    """Name, account and agent of Dbtr or Cdtr."""
    return {"name": _txt(el, role, "Nm"), **_account(_child(el, role + "Acct")), "agent": _agent(_child(el, role + "Agt"))}


def _amount(el, where: str) -> tuple:
    if el is None:
        raise ValueError(f"{where}: amount missing")
    raw = (el.text or "").strip()
    try:
        v = Decimal(raw)
    except InvalidOperation:
        raise ValueError(f"{where}: amount {raw!r} is not a number") from None
    if not v.is_finite() or v <= 0 or v.as_tuple().exponent < -5:
        raise ValueError(f"{where}: amount must be positive with at most 5 decimals")
    ccy = (el.get("Ccy") or "").strip().upper()
    if not CCY_RE.match(ccy):
        raise ValueError(f"{where}: Ccy must be a 3-letter ISO 4217 code")
    return v, ccy


def _remittance(tx) -> Optional[str]:
    rmt = _child(tx, "RmtInf")
    parts = [(u.text or "").strip() for u in _children(rmt, "Ustrd")]
    for s in _children(rmt, "Strd"):
        parts += [_txt(s, "CdtrRefInf", "Ref"), _txt(s, "RfrdDocInf", "Nb"), _txt(s, "AddtlRmtInf")]
    return " | ".join(p for p in parts if p)[:1000] or None


def _tx(tx, debtor: dict, where: str, kind: str) -> dict:
    if kind == "pacs.008":
        amt = _child(tx, "IntrBkSttlmAmt")
        amt = amt if amt is not None else _child(tx, "InstdAmt")
    else:
        amt = _child(tx, "Amt", "InstdAmt")
        amt = amt if amt is not None else _child(tx, "Amt", "EqvtAmt", "Amt")
    value, ccy = _amount(amt, where)
    creditor = _party(tx, "Cdtr")
    if not creditor["account"]:
        raise ValueError(f"{where}: creditor account (CdtrAcct/Id/IBAN or Othr/Id) missing, cannot screen")
    return {"end_to_end_id": _txt(tx, "PmtId", "EndToEndId"), "instr_id": _txt(tx, "PmtId", "InstrId"),
            "tx_id": _txt(tx, "PmtId", "TxId"), "uetr": _txt(tx, "PmtId", "UETR"),
            "amount": float(value), "amount_text": str(value), "currency": ccy,
            "debtor": debtor, "creditor": creditor, "remittance": _remittance(tx)}


def parse_iso20022(raw: bytes) -> dict:
    """pacs.008 or pain.001 bytes -> {kind, version, message_id, transactions[], warnings[]}; ValueError if bad."""
    if len(raw) > MAX_XML_BYTES:
        raise ValueError("message larger than 1 MB")
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ValueError("message must be UTF-8") from None
    if re.search(r"<!\s*(DOCTYPE|ENTITY)", text, re.I):
        raise ValueError("DTDs and entity declarations are not accepted")
    try:
        root = ET.fromstring(raw)
    except ET.ParseError as e:
        raise ValueError(f"malformed XML: {e}") from None
    msg = next((el for el in root.iter() if _ln(el) in MSG_TYPES), None)
    if msg is None:
        raise ValueError("no pacs.008 (FIToFICstmrCdtTrf) or pain.001 (CstmrCdtTrfInitn) element found")
    kind = MSG_TYPES[_ln(msg)]
    ver = re.search(r"(pacs\.008|pain\.001)\.\d{3}\.\d{2}", msg.tag)
    hdr = _child(msg, "GrpHdr")
    mid = _txt(hdr, "MsgId")
    if not mid:
        raise ValueError("GrpHdr/MsgId missing")
    if not re.fullmatch(r"[^\x00-\x1f\x7f]{1,35}", mid):
        raise ValueError("GrpHdr/MsgId must be 1-35 characters (ISO Max35Text)")
    txs = []
    if kind == "pacs.008":
        for i, tx in enumerate(_children(msg, "CdtTrfTxInf"), 1):
            t = _tx(tx, _party(tx, "Dbtr"), f"CdtTrfTxInf[{i}]", kind)
            t["settlement_date"] = _txt(tx, "IntrBkSttlmDt") or _txt(hdr, "IntrBkSttlmDt")
            txs.append(t)
    else:
        for j, pmt in enumerate(_children(msg, "PmtInf"), 1):
            debtor = _party(pmt, "Dbtr")
            when = (_txt(pmt, "ReqdExctnDt") or _txt(pmt, "ReqdExctnDt", "Dt")
                    or _txt(pmt, "ReqdExctnDt", "DtTm"))
            for i, tx in enumerate(_children(pmt, "CdtTrfTxInf"), 1):
                t = _tx(tx, debtor, f"PmtInf[{j}]/CdtTrfTxInf[{i}]", kind)
                t.update(payment_info_id=_txt(pmt, "PmtInfId"), requested_date=when)
                txs.append(t)
    if not txs:
        raise ValueError("message has no CdtTrfTxInf")
    if len(txs) > MAX_MSG_TXNS:
        raise ValueError(f"more than {MAX_MSG_TXNS} transactions in one message; split it or use /transactions")
    warnings = []
    declared = _txt(hdr, "NbOfTxs")
    if declared and declared != str(len(txs)):
        warnings.append(f"GrpHdr/NbOfTxs is {declared} but the message has {len(txs)} transactions")
    ctrl = _txt(hdr, "CtrlSum")
    if ctrl:
        try:
            if Decimal(ctrl) != sum(Decimal(t["amount_text"]) for t in txs):
                warnings.append(f"GrpHdr/CtrlSum {ctrl} does not equal the sum of the transaction amounts")
        except InvalidOperation:
            warnings.append(f"GrpHdr/CtrlSum {ctrl!r} is not a number")
    for t in txs:
        if t["creditor"].get("iban_valid") is False:
            warnings.append(f"{t['end_to_end_id'] or 'transaction'}: creditor IBAN fails the check-digit test")
    return {"kind": kind, "version": ver.group(0) if ver else None, "message_id": mid,
            "created_at": _txt(hdr, "CreDtTm"), "transactions": txs, "warnings": warnings}


# ---------------------------------------------------------------- screening (GPU ring map + rules engine)
_RANK = {"CLEAR": 0, "UNAVAILABLE": 1, "RING_MATCH": 2}


def screen_tx(tx: dict, check: Callable) -> dict:
    """Creditor account vs the ring map (calls.payee_check); HOLD/NO_HOLD comes from rules.decide."""
    from .rules import decide
    acct = tx["creditor"]["account"]
    pc = check(acct, tx["debtor"].get("account") or "")
    out = {"end_to_end_id": tx.get("end_to_end_id"), "creditor_account": acct, "amount": tx["amount"],
           "currency": tx["currency"], "ring_id": None, "hops": None, "path": []}
    if pc.get("error"):   # never call it CLEAR when the map could not be read
        return {**out, "screening": "UNAVAILABLE", "hold_recommended": None, "recommendation": None,
                "reasons": [f"Not screened: {pc['error']}"], "questions": []}
    d = decide([], {}, tx["amount"] if tx["currency"] == "USD" else None, pc)
    hold = d["recommendation"] == "HOLD"
    reasons = d["reasons"] if hold else [f"Creditor account {acct} is not in any ring found by the GPU ring finder"]
    return {**out, "screening": "RING_MATCH" if pc.get("in_ring") else "CLEAR", "ring_id": pc.get("ring_id"),
            "hops": pc.get("hops"), "path": pc.get("path") or [], "ring_type": pc.get("ring_type"),
            "hold_recommended": hold, "recommendation": d["recommendation"], "reasons": reasons,
            "questions": d["questions"] if hold else []}


def screen_message(msg: dict, check: Optional[Callable] = None) -> dict:
    """Screen every transaction; the message result is the worst one (RING_MATCH > UNAVAILABLE > CLEAR)."""
    if check is None:
        from .calls import payee_check as check
    seen: dict = {}

    def cached(a, b):
        if (a, b) not in seen:
            seen[(a, b)] = check(a, b)
        return seen[(a, b)]

    results = [screen_tx(t, cached) for t in msg["transactions"]]
    hits = [r for r in results if r["screening"] == "RING_MATCH"]
    worst = max(results, key=lambda r: _RANK[r["screening"]])["screening"]
    hold = True if hits else (None if worst == "UNAVAILABLE" else False)
    multi = len(results) > 1
    reasons = [f"{r['end_to_end_id'] or '?'}: {x}" if multi else x for r in results for x in r["reasons"]]
    return {"message_id": msg["message_id"], "kind": msg["kind"], "version": msg["version"], "screening": worst,
            "ring_id": hits[0]["ring_id"] if hits else None, "hops": hits[0]["hops"] if hits else None,
            "hold_recommended": hold, "recommendation": "HOLD" if hits else (None if hold is None else "NO_HOLD"),
            "reasons": list(dict.fromkeys(reasons)), "questions": hits[0]["questions"] if hits else [],
            "transactions": results, "warnings": msg["warnings"]}


def _summary(result: dict) -> dict:
    keys = ("screening", "ring_id", "hops", "hold_recommended")
    return {**{k: result.get(k) for k in keys}, "transactions": len(result.get("transactions") or [])}


def intake(raw: bytes, expect: str, check: Optional[Callable] = None) -> tuple:
    """Parse, screen, persist (inbound_payments), publish. Returns (http status, body). Idempotent on MsgId."""
    try:
        msg = parse_iso20022(raw)
    except ValueError as e:
        return 400, {"error": str(e)}
    if msg["kind"] != expect:
        return 422, {"error": f"expected {expect}, got {msg['kind']}; "
                              f"POST it to /api/integrations/iso20022/{msg['kind'].replace('.', '')}"}
    sha = hashlib.sha256(raw).hexdigest()
    doc_id = f"{msg['kind']}:{msg['message_id']}"
    coll = db().inbound_payments
    try:
        prev = coll.find_one({"_id": doc_id}, {"sha256": 1, "result": 1})
    except PyMongoError as e:
        prev = None
        _log(f"inbound_payments unavailable: {type(e).__name__}")
    if prev:
        if prev.get("sha256") != sha:
            return 409, {"error": f"MsgId {msg['message_id']} was already received with different content"}
        return 200, {**prev["result"], "duplicate": True}
    result = screen_message(msg, check)
    result.update(received_at=now().isoformat(), sha256=sha, duplicate=False)
    try:
        coll.insert_one({"_id": doc_id, "kind": msg["kind"], "message_id": msg["message_id"], "sha256": sha,
                         "received_at": now(), "message": msg, "result": dict(result),
                         "raw_xml": raw.decode("utf-8-sig")})
        result["persisted"] = True
    except DuplicateKeyError:   # same message posted twice at once
        return 200, {**result, "duplicate": True, "persisted": True}
    except PyMongoError as e:
        result["persisted"] = False
        _log(f"could not persist {doc_id}: {type(e).__name__}")
    bus.publish("integration", {"kind": msg["kind"], "ref": msg["message_id"], "result": _summary(result)})
    if result["hold_recommended"]:
        emit("hold_recommended", f"hold:{doc_id}",
             {"source": "iso20022", "kind": msg["kind"], "message_id": msg["message_id"],
              "end_to_end_ids": [t["end_to_end_id"] for t in result["transactions"] if t["hold_recommended"]],
              "recommendation": "HOLD", "ring_id": result["ring_id"], "hops": result["hops"]})
    return (503 if result["screening"] == "UNAVAILABLE" else 200), result


XML_BODY = {"requestBody": {"required": True, "content": {"application/xml": {"schema": {"type": "string"}}}}}


@router.post("/iso20022/pacs008", dependencies=AUTH, openapi_extra=XML_BODY,
             summary="Screen an ISO 20022 pacs.008 FI-to-FI customer credit transfer")
async def iso_pacs008(request: Request):
    raw = await _body(request, MAX_XML_BYTES)
    code, body = await run_in_threadpool(intake, raw, "pacs.008")
    return JSONResponse(body, status_code=code)


@router.post("/iso20022/pain001", dependencies=AUTH, openapi_extra=XML_BODY,
             summary="Screen an ISO 20022 pain.001 customer credit transfer initiation")
async def iso_pain001(request: Request):
    raw = await _body(request, MAX_XML_BYTES)
    code, body = await run_in_threadpool(intake, raw, "pain.001")
    return JSONResponse(body, status_code=code)


# ---------------------------------------------------------------- core-banking batch ingest
TXN_FIELDS = ("ts", "from_bank", "src", "to_bank", "dst", "amount_rec", "cur_rec", "amount", "currency", "format",
              "is_laundering")   # same column order as worker/ringfinder.py COLS (IBM AML layout)
ACCT_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,63}$")
BATCH_NOTE = ("Stored in inbound_transactions for the ring finder. In this demo the ring finder replays the IBM AML "
              "CSV; reading this collection is the next step (see INTEGRATION.md).")


def _parse_ts(v) -> str:
    s = str(v if v is not None else "").strip()
    for fmt in ("%Y/%m/%d %H:%M", "%Y/%m/%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).isoformat()
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).isoformat()
    except ValueError:
        raise ValueError(f"ts {s!r} is not 'YYYY/MM/DD HH:MM' or ISO 8601") from None


def _num(v, name: str) -> float:
    try:
        x = float(str(v).replace(",", "").strip())
    except (TypeError, ValueError):
        raise ValueError(f"{name} {v!r} is not a number") from None
    if not math.isfinite(x) or x < 0:
        raise ValueError(f"{name} must be a non-negative number")
    return x


def normalize_txn(r: dict) -> dict:
    """Validate one row (IBM AML fields); ValueError with a short reason if it is bad."""
    out = {"ts": _parse_ts(r.get("ts"))}
    for k in ("src", "dst"):
        v = str(r.get(k) or "").strip()
        if not ACCT_RE.match(v):
            raise ValueError(f"{k} {v!r} is not a valid account id")
        out[k] = v
    for k in ("from_bank", "to_bank", "format"):
        out[k] = str(r.get(k) or "").strip()[:32] or None
    out["amount"] = _num(r.get("amount"), "amount")
    out["currency"] = str(r.get("currency") or "").strip()[:32]
    if not out["currency"]:
        raise ValueError("currency missing")
    rec = r.get("amount_rec")
    out["amount_rec"] = out["amount"] if rec in (None, "") else _num(rec, "amount_rec")
    out["cur_rec"] = str(r.get("cur_rec") or out["currency"]).strip()[:32]
    lab = r.get("is_laundering")
    if lab not in (None, ""):
        if str(lab).strip() not in ("0", "1"):
            raise ValueError("is_laundering must be 0 or 1")
        out["is_laundering"] = int(str(lab).strip())
    if r.get("ref"):
        out["ref"] = re.sub(r"[^A-Za-z0-9._:-]", "_", str(r["ref"]).strip())[:64]
    return out


def parse_csv_rows(text: str) -> list:
    """IBM AML CSV (header optional) -> list of dicts, or an error string for a bad row."""
    rows = list(csv.reader(io.StringIO(text)))
    if rows and rows[0] and rows[0][0].strip().lower() == "timestamp":
        rows = rows[1:]
    out = []
    for cells in rows:
        if not any(c.strip() for c in cells):
            continue
        if len(cells) not in (10, 11):
            out.append(f"expected 10 or 11 columns (IBM AML layout), got {len(cells)}")
        else:
            out.append(dict(zip(TXN_FIELDS, cells)))
    return out


def ingest(rows: list, fmt: str, dry_run: bool = False, coll=None) -> dict:
    """Validate rows and upsert the good ones; re-posting the same batch is idempotent."""
    from pymongo import UpdateOne
    batch_id = f"B-{now():%Y%m%d%H%M%S}-{uuid.uuid4().hex[:6]}"
    good, errors, seen = [], [], {}
    for i, r in enumerate(rows, 1):
        try:
            if isinstance(r, str):
                raise ValueError(r)
            if not isinstance(r, dict):
                raise ValueError("row is not an object")
            t = normalize_txn(r)
        except ValueError as e:
            errors.append({"row": i, "error": str(e)})
            continue
        key = t.get("ref") or hashlib.sha256(json.dumps(
            [t[k] for k in ("ts", "from_bank", "src", "to_bank", "dst", "amount", "currency", "amount_rec",
                            "cur_rec", "format")]).encode()).hexdigest()[:24]
        n = seen.get(key, 0)
        seen[key] = n + 1   # identical rows in one batch stay separate transactions
        good.append({"_id": f"IN-{key}" + (f"-{n}" if n else ""), **t, "batch_id": batch_id, "row": i, "source": fmt})
    inserted = duplicates = 0
    if good and not dry_run:
        coll = coll if coll is not None else db().inbound_transactions
        at = now()
        for j in range(0, len(good), 1000):
            ops = [UpdateOne({"_id": t["_id"]}, {"$setOnInsert": {**{k: v for k, v in t.items() if k != "_id"},
                                                                  "received_at": at}}, upsert=True)
                   for t in good[j:j + 1000]]
            res = coll.bulk_write(ops, ordered=False)
            inserted += res.upserted_count
            duplicates += res.matched_count
    return {"batch_id": batch_id, "format": fmt, "dry_run": dry_run, "received": len(rows), "accepted": len(good),
            "inserted": inserted, "duplicates": duplicates, "rejected": len(errors), "errors": errors[:25],
            "collection": "inbound_transactions", "note": BATCH_NOTE}


BATCH_BODY = {"requestBody": {"required": True, "content": {
    "text/csv": {"schema": {"type": "string"}},
    "application/json": {"schema": {"type": "array", "items": {"type": "object"}}}}}}


@router.post("/transactions", dependencies=AUTH, openapi_extra=BATCH_BODY,
             summary="Core-banking batch: CSV in IBM AML column layout, or a JSON list")
async def post_transactions(request: Request, dry_run: bool = False):
    raw = await _body(request, MAX_BATCH_BYTES)
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(400, "body must be UTF-8") from None
    if "json" in request.headers.get("content-type", "").lower() or text.lstrip().startswith(("[", "{")):
        try:
            obj = json.loads(text)
        except ValueError as e:
            raise HTTPException(400, f"invalid JSON: {e}") from None
        rows, fmt = (obj.get("transactions") if isinstance(obj, dict) else obj), "json"
        if not isinstance(rows, list):
            raise HTTPException(400, 'expected a JSON list of transactions or {"transactions": [...]}')
    else:
        rows, fmt = parse_csv_rows(text), "csv"
    if len(rows) > MAX_BATCH_ROWS:
        raise HTTPException(413, f"more than {MAX_BATCH_ROWS} rows; split the batch")
    try:
        result = await run_in_threadpool(ingest, rows, fmt, dry_run)
    except PyMongoError as e:
        return JSONResponse({"error": f"database unavailable ({type(e).__name__})"}, status_code=503)
    if not dry_run:
        bus.publish("integration", {"kind": "transactions", "ref": result["batch_id"],
                                    "result": {k: result[k] for k in ("accepted", "inserted", "duplicates", "rejected")}})
    return result


# ---------------------------------------------------------------- outbound webhooks (signed, retried, logged)
EVENTS = ("hold_recommended", "sar_drafted", "sar_decided", "ring_escalated")
RETRY_CODES = {408, 425, 429}
MAX_QUEUE = 5000
WATCH_KEY = "integrations_webhooks"
SIG_HEADER = "X-FastFraudless-Signature"


def sign(body: bytes, secret: str) -> str:
    """Signature header value: sha256=<hex HMAC-SHA256 of the raw body>."""
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def verify(body: bytes, secret: str, header: str) -> bool:
    """Receiver-side check, constant time."""
    return hmac.compare_digest(sign(body, secret), header or "")


def backoff(attempts: int) -> float:
    """Seconds before the next try: 1, 2, 4 ... capped at 60."""
    return float(min(60, 2 ** max(0, attempts - 1)))


def _redact(url: str) -> str:
    """scheme://host[:port]/path, without credentials or query."""
    u = urlsplit(url)
    host = (u.hostname or "") + (f":{u.port}" if u.port else "")
    return f"{u.scheme}://{host}{u.path}"


def _url_id(url: str) -> str:
    return hashlib.sha256(url.encode()).hexdigest()[:12]


def is_internal(url: str, resolve=socket.getaddrinfo) -> bool:
    """True if every address of the URL's host is non-global (private, loopback, link-local)."""
    host = urlsplit(url).hostname or ""
    try:
        ips = [ipaddress.ip_address(host)]
    except ValueError:
        ips = [ipaddress.ip_address(str(ai[4][0]).split("%")[0]) for ai in resolve(host, None)]
    return bool(ips) and all(not (ip.is_global or ip.is_multicast or ip.is_unspecified) for ip in ips)


def webhook_config() -> dict:
    """URLs from TW_WEBHOOKS (all events) or config/integrations.json; secret only from TW_WEBHOOK_SECRET."""
    cfg = _read_json(Path(os.environ.get("TW_INTEGRATIONS_FILE") or CONFIG_DIR / "integrations.json")) or {}
    env = [u.strip() for u in os.environ.get("TW_WEBHOOKS", "").split(",") if u.strip()]
    if env:
        hooks = [{"url": u, "events": list(EVENTS)} for u in env]
    else:
        hooks = []
        for h in cfg.get("webhooks") or []:
            h = {"url": h} if isinstance(h, str) else (h if isinstance(h, dict) else {})
            if h.get("url"):
                hooks.append({"url": str(h["url"]).strip(),
                              "events": [e for e in (h.get("events") or EVENTS) if e in EVENTS]})
    good = []
    for h in hooks:
        u = urlsplit(h["url"])
        if u.scheme in ("http", "https") and u.hostname:
            good.append(h)
        else:
            _log(f"ignoring webhook URL (need http/https and a host): {_redact(h['url'])}")
    return {"hooks": good, "secret": os.environ.get("TW_WEBHOOK_SECRET", ""),
            "allow_public": os.environ.get("TW_WEBHOOKS_ALLOW_PUBLIC", "") == "1" or cfg.get("allow_public_ips") is True,
            "max_attempts": int(cfg.get("max_attempts") or 8), "timeout_s": float(cfg.get("timeout_s") or 5),
            "base_url": os.environ.get("TW_PUBLIC_BASE_URL") or str(cfg.get("public_base_url") or "")}


def _links(event: str, data: dict, base: str) -> dict:
    """Where the receiver pulls detail (over the bank network); bodies carry ids and status only."""
    p, out = "/api/integrations", {}
    if data.get("sar_id"):
        out.update(sar_json=f"{p}/sar/{data['sar_id']}.json", sar_xml=f"{p}/sar/{data['sar_id']}/fincen.xml")
    if data.get("call_id"):
        out["call"] = f"/api/calls/{data['call_id']}"
    if data.get("ring_id"):
        out["ring"] = f"/api/rings/{data['ring_id']}"
    return {k: base.rstrip("/") + v for k, v in out.items()}


def events_from_change(ch: dict) -> list:
    """(event, dedupe key, data) for one change-stream document from calls, sar_drafts or rings."""
    coll = (ch.get("ns") or {}).get("coll")
    doc = ch.get("fullDocument") or {}
    rid = doc.get("_id")
    if not rid:
        return []
    if coll == "calls" and doc.get("recommendation") == "HOLD":
        pc = doc.get("payee_check") or {}
        return [("hold_recommended", f"hold:call:{rid}:{doc.get('started_at')}",
                 {"source": "call", "call_id": rid, "recommendation": "HOLD", "payee_in_ring": bool(pc.get("in_ring")),
                  "ring_id": pc.get("ring_id"), "hops": pc.get("hops"),
                  "cues": sorted({c.get("cue") for c in doc.get("cues") or [] if c.get("cue")}),
                  "banker_decision": doc.get("banker_decision"), "synthetic": bool(doc.get("synthetic"))})]
    if coll == "sar_drafts":
        cits = doc.get("citations") or []
        base = {"sar_id": rid, "ring_id": doc.get("ring_id"), "revision": doc.get("revision"),
                "valid_all": bool(doc.get("valid_all")), "citations_total": len(cits),
                "citations_verified": sum(1 for c in cits if c.get("valid"))}
        gen = doc.get("received_at_ms")
        out = []
        if ch.get("operationType") in ("insert", "replace"):
            out.append(("sar_drafted", f"sar_drafted:{rid}:r{doc.get('revision')}:{gen}", base))
        if doc.get("decision") in ("approved", "rejected"):
            out.append(("sar_decided", f"sar_decided:{rid}:{doc['decision']}:{gen}",
                        {**base, "decision": doc["decision"], "decided_by": doc.get("decided_by"),
                         "decided_at": _iso(doc.get("decided_at"))}))
        return out
    if coll == "rings" and doc.get("tier") == "escalate":
        return [("ring_escalated", f"ring:{rid}:{_iso(doc.get('found_at'))}",
                 {"ring_id": rid, "type": doc.get("type"), "tier": "escalate",
                  "n_accounts": len(doc.get("accounts") or []), "n_txns": doc.get("n_txns") or len(doc.get("edges") or []),
                  "found_at": _iso(doc.get("found_at")), "sim_time": doc.get("sim_time")})]
    return []


def _http_post(url: str, body: bytes, headers: dict, timeout: float) -> int:
    import httpx
    # no proxies from the environment, no redirects: only the configured bank-internal URL is contacted
    with httpx.Client(trust_env=False, follow_redirects=False, timeout=timeout) as c:
        return c.post(url, content=body, headers=headers).status_code


class Webhooks:
    """Signed delivery with retry and backoff; every attempt is logged in Mongo `webhook_deliveries`."""

    def __init__(self, cfg: dict, post: Optional[Callable] = None, coll=None, resolve=socket.getaddrinfo):
        self.cfg, self.post, self._coll, self.resolve = cfg, post or _http_post, coll, resolve
        self.heap: list = []
        self.cv = threading.Condition()
        self.seq = itertools.count()
        self.last: Optional[dict] = None

    def coll(self):
        return self._coll if self._coll is not None else db().webhook_deliveries

    def payload(self, event: str, key: str, data: dict) -> bytes:
        body = {"event": event, "event_id": hashlib.sha256(key.encode()).hexdigest()[:24], "ts": now().isoformat(),
                "source": "fast-and-fraudless", "bank": branding()["bank_name"], "data": data,
                "links": _links(event, data, self.cfg.get("base_url") or "")}
        return json.dumps(body, separators=(",", ":"), sort_keys=True, default=str).encode()

    def emit(self, event: str, key: str, data: dict) -> int:
        """Queue one event for each subscribed URL. Returns deliveries created (0 if already sent)."""
        n, body = 0, None
        for h in self.cfg["hooks"]:
            if event not in h["events"]:
                continue
            body = body or self.payload(event, key, data)
            did = hashlib.sha256(f"{key}|{h['url']}".encode()).hexdigest()[:32]
            try:
                self.coll().insert_one({"_id": did, "event": event, "key": key, "url": _redact(h["url"]),
                                        "url_id": _url_id(h["url"]), "status": "pending", "attempts": 0,
                                        "created_at": now(), "body": body.decode()})
            except DuplicateKeyError:
                continue   # already queued or sent
            except PyMongoError as e:
                _log(f"delivery log unavailable, {event} not queued: {type(e).__name__}")
                continue
            self._push(0.0, did, h["url"], event, body, 0)
            n += 1
        return n

    def _push(self, delay: float, did: str, url: str, event: str, body: bytes, attempts: int) -> None:
        with self.cv:
            if len(self.heap) >= MAX_QUEUE:
                full = True
            else:
                full = False
                heapq.heappush(self.heap, (time.time() + delay, next(self.seq), did, url, event, body, attempts))
                self.cv.notify()
        if full:
            self._record(did, "dropped", attempts, "queue full", None)

    def queued(self) -> int:
        with self.cv:
            return len(self.heap)

    def attempt(self, url: str, event: str, did: str, body: bytes) -> tuple:
        """One POST. Returns (ok, retryable, detail)."""
        if not self.cfg.get("allow_public"):
            try:
                if not is_internal(url, self.resolve):
                    return False, False, "destination is not bank-internal (TW_WEBHOOKS_ALLOW_PUBLIC=1 allows it)"
            except OSError as e:
                return False, True, f"DNS: {e}"[:200]
        headers = {"Content-Type": "application/json", "User-Agent": "FastFraudless-Webhooks/1",
                   "X-FastFraudless-Event": event, "X-FastFraudless-Delivery": did,
                   SIG_HEADER: sign(body, self.cfg["secret"])}
        try:
            code = int(self.post(url, body, headers, self.cfg.get("timeout_s", 5)))
        except Exception as e:  # noqa: BLE001 - network errors are retried
            return False, True, f"{type(e).__name__}: {e}"[:200]
        if 200 <= code < 300:
            return True, False, f"HTTP {code}"
        return False, code >= 500 or code in RETRY_CODES, f"HTTP {code}"

    def deliver(self, did: str, url: str, event: str, body: bytes, attempts: int) -> str:
        """Try once; reschedule with backoff or finish. Returns the new status."""
        t0 = time.time()
        ok, retry, detail = self.attempt(url, event, did, body)
        attempts += 1
        status = ("delivered" if ok else
                  "pending" if retry and attempts < self.cfg.get("max_attempts", 8) else "failed")
        self._record(did, status, attempts, detail, round((time.time() - t0) * 1000))
        self.last = {"event": event, "url": _redact(url), "status": status, "detail": detail,
                     "attempts": attempts, "at": now().isoformat()}
        if status == "pending":
            self._push(backoff(attempts), did, url, event, body, attempts)
        elif status == "failed":
            _log(f"{event} to {_redact(url)} failed after {attempts} attempt(s): {detail}")
        return status

    def _record(self, did: str, status: str, attempts: int, detail: str, ms) -> None:
        upd = {"$set": {"status": status, "attempts": attempts, "last_detail": detail, "updated_at": now()},
               "$push": {"log": {"$each": [{"at": now(), "status": status, "detail": detail, "ms": ms}],
                                 "$slice": -20}}}
        if status == "delivered":
            upd["$set"]["delivered_at"] = now()
        try:
            self.coll().update_one({"_id": did}, upd)
        except PyMongoError as e:
            _log(f"could not log delivery {did[:8]}: {type(e).__name__}")

    def requeue(self) -> int:
        """After a restart, resume deliveries still pending for URLs that are still configured."""
        urls = {_url_id(h["url"]): h["url"] for h in self.cfg["hooks"]}
        n = 0
        try:
            for d in self.coll().find({"status": "pending"}).limit(MAX_QUEUE):
                if d.get("url_id") in urls:
                    self._push(0.0, d["_id"], urls[d["url_id"]], d["event"], d["body"].encode(),
                               int(d.get("attempts") or 0))
                    n += 1
        except PyMongoError as e:
            _log(f"could not resume pending deliveries: {type(e).__name__}")
        return n

    def run(self) -> None:
        n = self.requeue()
        if n:
            _log(f"resumed {n} pending webhook deliveries")
        while True:
            with self.cv:
                while not self.heap or self.heap[0][0] > time.time():
                    self.cv.wait(None if not self.heap else max(0.05, self.heap[0][0] - time.time()))
                item = heapq.heappop(self.heap)
            try:
                self.deliver(*item[2:])
            except Exception as e:  # noqa: BLE001 - the sender must never die
                _log(f"delivery crashed: {e}")


def emit(event: str, key: str, data: dict) -> int:
    """Queue a webhook event if webhooks are on; no-op otherwise."""
    hooks = _state.get("hooks")
    return hooks.emit(event, key, data) if hooks else 0


WATCH_PIPELINE = [{"$match": {"operationType": {"$in": ["insert", "update", "replace"]}, "$or": [
    {"ns.coll": "sar_drafts"},
    {"ns.coll": "calls", "fullDocument.recommendation": "HOLD"},
    {"ns.coll": "rings", "fullDocument.tier": "escalate"},
]}}]


def _watch(hooks: Webhooks) -> None:
    """Change stream on calls, sar_drafts and rings; resume token saved after queueing (at-least-once)."""
    while True:
        try:
            token = load_token(WATCH_KEY)
            kw = {"resume_after": token} if token else {}
            with db().watch(WATCH_PIPELINE, full_document="updateLookup", max_await_time_ms=1000, **kw) as stream:
                _state["watching"] = True
                last_save = time.time()
                while stream.alive:
                    ch = stream.try_next()
                    if ch is None:
                        if time.time() - last_save > 10 and stream.resume_token:
                            save_token(WATCH_KEY, stream.resume_token)
                            last_save = time.time()
                        continue
                    for event, key, data in events_from_change(ch):
                        hooks.emit(event, key, data)
                    save_token(WATCH_KEY, ch["_id"])
                    last_save = time.time()
        except Exception as e:  # noqa: BLE001
            _state["watching"] = False
            msg = str(e)
            if getattr(e, "code", None) in (260, 280, 286) or "ChangeStreamHistoryLost" in msg:
                _log(f"resume token unusable, restarting the stream from now: {msg[:120]}")
                try:
                    db().watch_state.delete_one({"_id": WATCH_KEY})
                except PyMongoError:
                    pass
            else:
                _log(f"change stream error, retrying in 3 s: {msg[:200]}")
            time.sleep(3)


# ---------------------------------------------------------------- SAR draft export (FinCEN BSA SAR-style)
SAR_FORMAT = "FinCEN BSA SAR-style draft (sections follow the SAR form; not the FinCEN e-filing schema)"
SAR_DISCLAIMER = ("DRAFT for analyst review. NOT FILED with FinCEN. SAR confidentiality applies (31 CFR 1020.320(e)): "
                  "do not disclose that this report exists.")
SAR_CATEGORY = {"FAN-IN": "Money laundering: funnel account (suggested; the analyst confirms)",
                "FAN-OUT": "Money laundering: suspicious use of multiple accounts (suggested; the analyst confirms)"}
_XML_BAD = re.compile("[^\u0009\u000a\u000d -퟿-�\U00010000-\U0010ffff]")


def build_sar_report(sar: dict, ring: dict, txn_docs: dict, bank_name: str) -> dict:
    """SAR-style draft. Structured parts use only citations the validator verified against Mongo."""
    edges = {e.get("txn_id"): e for e in ring.get("edges") or [] if e.get("txn_id")}
    cits = sar.get("citations") or []
    ids = list(dict.fromkeys(c["txn_id"] for c in cits if c.get("valid") and c.get("txn_id")))
    txns = []
    for tid in ids:
        e = edges.get(tid) or txn_docs.get(tid)
        if e:
            txns.append({"txn_id": tid, "ts": _iso(e.get("ts")), "from_account": e.get("src"),
                         "to_account": e.get("dst"), "amount": e.get("amount"), "currency": e.get("currency"),
                         "usd": e.get("usd")})
    txns.sort(key=lambda t: t["ts"] or "")
    subjects: list = []
    for t in txns:
        for a in (t["from_account"], t["to_account"]):
            if a and all(s["account_id"] != a for s in subjects):
                subjects.append({"account_id": a, "role": "hub" if a == ring.get("hub") else "counterparty"})
    usd = [float(t["usd"]) for t in txns if t["usd"] is not None]
    dates = [t["ts"][:10] for t in txns if t["ts"]]
    verified = sum(1 for c in cits if c.get("valid"))
    return {
        "status": "DRAFT", "filed": False, "disclaimer": SAR_DISCLAIMER, "format": SAR_FORMAT,
        "data_label": DATA_LABEL, "generated_at": now().isoformat(),
        "sar_id": sar.get("_id"), "revision": sar.get("revision"), "ring_id": sar.get("ring_id"),
        "author": sar.get("author"), "received_at": _iso(sar.get("received_at")),
        "analyst_decision": sar.get("decision") or "pending", "decided_by": sar.get("decided_by"),
        "decided_at": _iso(sar.get("decided_at")),
        "filing_institution": {"name": bank_name},
        "subjects": subjects,
        "suspicious_activity": {"date_from": min(dates) if dates else None, "date_to": max(dates) if dates else None,
                                "total_usd": round(sum(usd), 2) if usd else None, "transaction_count": len(txns),
                                "pattern": ring.get("type"), "category": SAR_CATEGORY.get(ring.get("type")),
                                "transactions": txns},
        "ring_context": {"ring_id": ring.get("_id"), "type": ring.get("type"), "hub": ring.get("hub"),
                         "tier": ring.get("tier"), "n_accounts": len(ring.get("accounts") or []),
                         "n_transactions": ring.get("n_txns") or len(edges), "total_usd": ring.get("total_usd"),
                         "found_at": _iso(ring.get("found_at"))},
        "validation": {"citations_total": len(cits), "citations_verified": verified,
                       "unverified_excluded": len(cits) - verified, "valid_all": bool(sar.get("valid_all"))},
        "narrative": sar.get("narrative") or "",
    }


def _x(v) -> str:
    """Text safe for XML 1.0 (ElementTree escapes markup; this drops illegal control characters)."""
    return _XML_BAD.sub("", "" if v is None else str(v))


def _money_txt(v) -> Optional[str]:
    if v is None:
        return None
    x = float(v)
    return f"{x:.2f}" if x == 0 or x >= 0.01 else f"{x:.8f}".rstrip("0")   # keep tiny crypto amounts


def sar_xml(rep: dict) -> bytes:
    """Well-formed XML for a SAR-style draft (ElementTree escapes all text)."""
    def sub(parent, tag, text=None, **attrs):
        el = ET.SubElement(parent, tag, {k: _x(v) for k, v in attrs.items() if v is not None})
        if text is not None:
            el.text = _x(text)
        return el

    root = ET.Element("SuspiciousActivityReportDraft", {"status": "DRAFT", "filed": "false", "sarId": _x(rep["sar_id"])})
    root.append(ET.Comment(" DRAFT - NOT FILED. Prepared for analyst review; never submitted to FinCEN by this system. "))
    sub(root, "Disclaimer", rep["disclaimer"])
    hdr = sub(root, "DraftHeader")
    for tag, key in (("Format", "format"), ("DataLabel", "data_label"), ("GeneratedAt", "generated_at"),
                     ("Revision", "revision"), ("RingId", "ring_id"), ("Author", "author"),
                     ("ReceivedAt", "received_at"), ("AnalystDecision", "analyst_decision"),
                     ("DecidedBy", "decided_by"), ("DecidedAt", "decided_at")):
        if rep.get(key) is not None:
            sub(hdr, tag, rep[key])
    sub(sub(root, "FilingInstitution", section="Part IV"), "Name", rep["filing_institution"]["name"])
    subj = sub(root, "Subjects", section="Part I", count=len(rep["subjects"]))
    for s in rep["subjects"]:
        sub(sub(subj, "Subject", role=s["role"]), "AccountId", s["account_id"])
    sa = rep["suspicious_activity"]
    act = sub(root, "SuspiciousActivity", section="Part II")
    for tag, key in (("DateFrom", "date_from"), ("DateTo", "date_to"), ("Pattern", "pattern"), ("Category", "category")):
        if sa.get(key) is not None:
            sub(act, tag, sa[key])
    if sa["total_usd"] is not None:
        sub(act, "TotalAmount", _money_txt(sa["total_usd"]), currency="USD")
    txs = sub(act, "Transactions", count=sa["transaction_count"], basis="validated citations only")
    for t in sa["transactions"]:
        sub(txs, "Transaction", txnId=t["txn_id"], timestamp=t["ts"], fromAccount=t["from_account"],
            toAccount=t["to_account"], amount=_money_txt(t["amount"]), currency=t["currency"],
            amountUSD=_money_txt(t["usd"]))
    rc = rep["ring_context"]
    sub(root, "RingContext", source="GPU ring finder", ringId=rc["ring_id"], type=rc["type"], hub=rc["hub"],
        tier=rc["tier"], accounts=rc["n_accounts"], transactions=rc["n_transactions"],
        totalUSD=_money_txt(rc["total_usd"]), foundAt=rc["found_at"])
    v = rep["validation"]
    sub(root, "CitationValidation", total=v["citations_total"], verified=v["citations_verified"],
        excludedUnverified=v["unverified_excluded"], allValid=str(v["valid_all"]).lower())
    sub(root, "Narrative", rep["narrative"], section="Part V")
    ET.indent(root)
    return ET.tostring(root, encoding="utf-8", xml_declaration=True)


def sar_report(sar_id: str) -> Optional[dict]:
    d = db()
    sar = d.sar_drafts.find_one({"_id": sar_id})
    if not sar:
        return None
    ring = d.rings.find_one({"_id": sar.get("ring_id")}) or {}
    have = {e.get("txn_id") for e in ring.get("edges") or []}
    missing = [c["txn_id"] for c in sar.get("citations") or []
               if c.get("valid") and c.get("txn_id") and c["txn_id"] not in have]
    docs = {t["_id"]: t for t in d.transactions.find({"_id": {"$in": missing}})} if missing else {}
    return build_sar_report(sar, ring, docs, branding()["bank_name"])


def _sar_or_error(sar_id: str, fmt: str) -> dict:
    if not ID_RE.match(sar_id):
        raise HTTPException(400, "malformed sar_id")
    try:
        rep = sar_report(sar_id)
    except PyMongoError as e:
        raise HTTPException(503, f"database unavailable ({type(e).__name__})") from None
    if rep is None:
        raise HTTPException(404, f"unknown SAR {sar_id}")
    try:   # SAR access is part of the audit trail
        audit("integration", "sar_draft_exported", sar_id=sar_id, format=fmt)
    except Exception as e:  # noqa: BLE001
        _log(f"audit of SAR export failed: {type(e).__name__}")
    return rep


NO_STORE = {"Cache-Control": "no-store"}


@router.get("/sar/{sar_id}/fincen.xml", dependencies=AUTH, summary="SAR draft as FinCEN-style XML (DRAFT, not filed)")
def sar_fincen_xml(sar_id: str):
    rep = _sar_or_error(sar_id, "xml")
    return Response(sar_xml(rep), media_type="application/xml",
                    headers={**NO_STORE, "Content-Disposition": f'inline; filename="{sar_id}-DRAFT.xml"'})


@router.get("/sar/{sar_id}.json", dependencies=AUTH, summary="SAR draft as JSON (same content as the XML)")
def sar_json(sar_id: str):
    return JSONResponse(json.loads(json.dumps(_sar_or_error(sar_id, "json"), default=str)), headers=NO_STORE)


# ---------------------------------------------------------------- case-management export
CASE_COLUMNS = ("ring_id", "ring_type", "tier", "case_status", "total_usd", "n_transactions", "n_accounts", "hub",
                "accounts", "sar_id", "sar_status", "sar_valid_all", "citations_verified", "citations_total",
                "analyst_decision", "decided_at", "ring_found_at", "case_first_event_at", "case_last_event_at",
                "sar_received_at")


def case_rows(cases: list, sars: list, rings: dict, include_escalated: bool = False) -> list:
    """One row per case (ring), joined with its ring and SAR draft."""
    case_by, sar_by = {c["_id"]: c for c in cases}, {s.get("ring_id"): s for s in sars if s.get("ring_id")}
    ids = list(dict.fromkeys(list(case_by) + list(sar_by)))
    if include_escalated:
        ids += [rid for rid, r in rings.items() if r.get("tier") == "escalate" and rid not in case_by and rid not in sar_by]
    rows = []
    for rid in ids:
        c, s, r = case_by.get(rid) or {}, sar_by.get(rid) or {}, rings.get(rid) or {}
        tl, cits = c.get("timeline") or [], s.get("citations") or []
        rows.append({
            "ring_id": rid, "ring_type": r.get("type"), "tier": r.get("tier"),
            "case_status": c.get("status") or ("sar_drafted" if s else "not_started"),
            "total_usd": r.get("total_usd"), "n_transactions": r.get("n_txns"),
            "n_accounts": len(r.get("accounts") or []) or None, "hub": r.get("hub"),
            "accounts": ";".join(r.get("accounts") or []),
            "sar_id": s.get("_id"), "sar_status": (s.get("decision") or "drafted") if s else "none",
            "sar_valid_all": s.get("valid_all") if s else None,
            "citations_verified": sum(1 for x in cits if x.get("valid")) if s else None,
            "citations_total": len(cits) if s else None,
            "analyst_decision": s.get("decision"), "decided_at": _iso(s.get("decided_at")),
            "ring_found_at": _iso(r.get("found_at")),
            "case_first_event_at": _iso(tl[0].get("ts")) if tl else None,
            "case_last_event_at": _iso(tl[-1].get("ts")) if tl else None,
            "sar_received_at": _iso(s.get("received_at"))})
    return rows


def _cell(v) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return "true" if v else "false"
    s = str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@", "\t", "\r") else s   # no spreadsheet formulas


def to_csv(rows: list, columns=CASE_COLUMNS) -> str:
    buf = io.StringIO()
    w = csv.writer(buf, lineterminator="\r\n")
    w.writerow(columns)
    for r in rows:
        w.writerow([_cell(r.get(k)) for k in columns])
    return buf.getvalue()


@router.get("/cases/export.csv", dependencies=AUTH,
            summary="Case-management export (scope=cases, or scope=escalated to add escalated rings without a case)")
def cases_export(scope: str = "cases"):
    try:
        d = db()
        cases = list(d.cases.find({}, {"status": 1, "timeline": 1}))
        sars = list(d.sar_drafts.find({}, {"narrative": 0}))
        ids = list({c["_id"] for c in cases} | {s.get("ring_id") for s in sars if s.get("ring_id")})
        q = {"$or": [{"_id": {"$in": ids}}, {"tier": "escalate"}]} if scope == "escalated" else {"_id": {"$in": ids}}
        rings = {r["_id"]: r for r in d.rings.find(q, {"edges": 0})}
    except PyMongoError as e:
        raise HTTPException(503, f"database unavailable ({type(e).__name__})") from None
    body = to_csv(case_rows(cases, sars, rings, include_escalated=scope == "escalated"))
    name = f"fast-and-fraudless-cases-{now():%Y%m%d-%H%M}.csv"
    return Response(body, media_type="text/csv; charset=utf-8",
                    headers={**NO_STORE, "Content-Disposition": f'attachment; filename="{name}"'})


# ---------------------------------------------------------------- white-label branding
BRAND_DEFAULTS = {"bank_name": "Your Bank", "product_name": "Fast and Fraudless", "primary_color": "#0c1016",
                  "accent_color": "#76b900", "logo_path": "", "timezone": "America/New_York"}
COLOR_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")
LOGO_TYPES = {".png": "image/png", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
              ".webp": "image/webp"}


def _brand_file() -> Path:
    return Path(os.environ.get("TW_BRANDING_FILE") or CONFIG_DIR / "branding.json")


def _logo(p, brand_file: Path) -> Optional[Path]:
    if not p:
        return None
    lp = Path(str(p))
    lp = lp if lp.is_absolute() else brand_file.parent / lp
    return lp if lp.suffix.lower() in LOGO_TYPES and lp.is_file() else None


def branding() -> dict:
    """Defaults overlaid with the branding file (flat keys only); bad colours fall back with a warning."""
    path = _brand_file()
    raw = _read_json(path) or {}
    out = dict(BRAND_DEFAULTS)
    out.update({k: (v.strip() if isinstance(v, str) else v) for k, v in raw.items()
                if not k.startswith("_") and isinstance(v, (str, int, float, bool))})
    warnings = []
    for k in ("bank_name", "product_name"):
        if not str(out[k]).strip():
            out[k] = BRAND_DEFAULTS[k]
    for k in ("primary_color", "accent_color"):
        if not COLOR_RE.match(str(out[k])):
            warnings.append(f"{k} {out[k]!r} is not #RGB or #RRGGBB; default used")
            out[k] = BRAND_DEFAULTS[k]
    out["logo_url"] = "/api/integrations/branding/logo" if _logo(out.get("logo_path"), path) else None
    out["source"] = path.name if raw else "defaults"
    if warnings:
        out["warnings"] = warnings
    return out


@router.get("/branding", summary="White-label settings for the UI (bank name, colours, logo, timezone)")
def get_branding():
    return branding()


@router.get("/branding/logo", summary="The configured logo file")
def get_logo():
    path = _brand_file()
    lp = _logo((_read_json(path) or {}).get("logo_path"), path)
    if lp is None:
        raise HTTPException(404, "no logo configured")
    return FileResponse(str(lp), media_type=LOGO_TYPES[lp.suffix.lower()],
                        headers={"Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'",
                                 "X-Content-Type-Options": "nosniff", "Cache-Control": "max-age=300"})


# ---------------------------------------------------------------- health + start
@router.get("/health", summary="Integration status: webhooks, delivery log, inbound counts")
def integrations_health():
    cfg, hooks, b = webhook_config(), _state["hooks"], branding()
    out = {"ok": True, "started": _state["started"],
           "webhooks": {"enabled": hooks is not None, "status": _state["note"], "watching": _state["watching"],
                        "configured": [_redact(h["url"]) for h in cfg["hooks"]], "signed": bool(cfg["secret"]),
                        "bank_internal_only": not cfg["allow_public"], "queued": hooks.queued() if hooks else 0,
                        "last_delivery": hooks.last if hooks else None},
           "auth": {"token_required": bool(os.environ.get("TW_INTEGRATIONS_TOKEN"))},
           "branding": {"bank_name": b["bank_name"], "source": b["source"]}, "data_label": DATA_LABEL}
    try:
        d = db()
        out["counts"] = {"inbound_payments": d.inbound_payments.estimated_document_count(),
                         "inbound_transactions": d.inbound_transactions.estimated_document_count(),
                         "webhook_deliveries": {r["_id"]: r["n"] for r in d.webhook_deliveries.aggregate(
                             [{"$group": {"_id": "$status", "n": {"$sum": 1}}}])}}
        if out["webhooks"]["last_delivery"] is None:
            last = d.webhook_deliveries.find_one({"status": {"$ne": "pending"}}, {"body": 0, "log": 0},
                                                 sort=[("updated_at", -1)])
            if last:
                out["webhooks"]["last_delivery"] = {k: _iso(last.get(k)) if k == "updated_at" else last.get(k)
                                                    for k in ("event", "url", "status", "last_detail", "attempts",
                                                              "updated_at")}
    except PyMongoError as e:
        out.update(ok=False, error=f"database unavailable ({type(e).__name__})")
    return out


def _ensure_indexes() -> None:
    try:
        d = db()
        d.inbound_transactions.create_index("batch_id")
        d.inbound_payments.create_index("received_at")
        d.webhook_deliveries.create_index([("status", 1), ("updated_at", -1)])
    except Exception as e:  # noqa: BLE001 - indexes are an optimisation only
        _log(f"index setup skipped: {type(e).__name__}")


def start() -> None:
    """Called once from the app lifespan. Never blocks; webhooks stay off unless URLs and a secret are set."""
    with _start_lock:
        if _state["started"]:
            return
        _state["started"] = True
    threading.Thread(target=_ensure_indexes, name="integrations-init", daemon=True).start()
    cfg = webhook_config()
    if not cfg["hooks"]:
        _state["note"] = "off: no webhook URLs configured (TW_WEBHOOKS or config/integrations.json)"
    elif not cfg["secret"]:
        _state["note"] = "off: TW_WEBHOOK_SECRET is not set (unsigned webhooks are never sent)"
    else:
        hooks = Webhooks(cfg)
        _state["hooks"] = hooks
        threading.Thread(target=hooks.run, name="integrations-webhooks", daemon=True).start()
        threading.Thread(target=_watch, args=(hooks,), name="integrations-watch", daemon=True).start()
        _state["note"] = (f"on: {len(cfg['hooks'])} URL(s), "
                          + ("public destinations allowed" if cfg["allow_public"] else "bank-internal destinations only"))
    _log(f"webhooks {_state['note']}")
