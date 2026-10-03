"""Bank integration: ISO 20022 intake, core-banking batch ingest, branding, health (see INTEGRATION.md).

Everything stays on the box. Screening reuses calls.payee_check (GPU ring map) and rules.decide (code decides).
"""
import csv
import hashlib
import hmac
import io
import json
import math
import os
import re
import threading
import uuid
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Callable, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import FileResponse, JSONResponse
from pymongo.errors import DuplicateKeyError, PyMongoError

from .bus import bus
from .db import db, now

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


# ---------------------------------------------------------------- outbound webhooks (filled in below)
def emit(event: str, key: str, data: dict) -> int:
    """Queue a webhook event if webhooks are on; no-op otherwise."""
    hooks = _state.get("hooks")
    return hooks.emit(event, key, data) if hooks else 0


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
    b = branding()
    out = {"ok": True, "started": _state["started"],
           "webhooks": {"enabled": _state["hooks"] is not None, "status": _state["note"]},
           "auth": {"token_required": bool(os.environ.get("TW_INTEGRATIONS_TOKEN"))},
           "branding": {"bank_name": b["bank_name"], "source": b["source"]}, "data_label": DATA_LABEL}
    try:
        d = db()
        out["counts"] = {"inbound_payments": d.inbound_payments.estimated_document_count(),
                         "inbound_transactions": d.inbound_transactions.estimated_document_count()}
    except PyMongoError as e:
        out.update(ok=False, error=f"database unavailable ({type(e).__name__})")
    return out


def start() -> None:
    """Called once from the app lifespan; never blocks."""
    with _start_lock:
        if _state["started"]:
            return
        _state["started"] = True
    _state["note"] = "off"
    _log("started")
