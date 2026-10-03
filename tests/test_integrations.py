"""Bank integration tests: ISO 20022 parsing, ring screening, batch ingest, branding. Fakes only (no Mongo, no network)."""
import hashlib
import hmac
import json
import os
import sys
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest
from pymongo.errors import DuplicateKeyError

from backend import calls, integrations as integ

SAMPLES = Path(__file__).resolve().parent.parent / "samples"


# ---------------------------------------------------------------- fakes
class FakeCursor(list):
    def limit(self, n):
        return FakeCursor(self[:n])

    def sort(self, *a, **k):
        return self


class FakeColl:
    def __init__(self, docs=()):
        self.docs = {d["_id"]: dict(d) for d in docs}

    @staticmethod
    def _match(d, flt):
        for k, v in (flt or {}).items():
            if isinstance(v, dict) and "$in" in v:
                if d.get(k) not in v["$in"]:
                    return False
            elif isinstance(d.get(k), list):
                if v not in d[k]:
                    return False
            elif d.get(k) != v:
                return False
        return True

    def find(self, flt=None, projection=None, **kw):
        return FakeCursor(dict(d) for d in self.docs.values() if self._match(d, flt))

    def find_one(self, flt=None, projection=None, **kw):
        r = self.find(flt)
        return r[0] if r else None

    def insert_one(self, doc):
        if doc["_id"] in self.docs:
            raise DuplicateKeyError("duplicate key")
        self.docs[doc["_id"]] = dict(doc)

    def update_one(self, flt, upd, upsert=False):
        d = self.docs.setdefault(flt["_id"], {"_id": flt["_id"]})
        d.update(upd.get("$set", {}))
        for k, v in upd.get("$push", {}).items():
            d.setdefault(k, []).extend(v["$each"] if isinstance(v, dict) else [v])

    def bulk_write(self, ops, ordered=True):
        new = old = 0
        for op in ops:
            _id = op._filter["_id"]
            if _id in self.docs:
                old += 1
            else:
                self.docs[_id] = {"_id": _id, **op._doc["$setOnInsert"]}
                new += 1
        return type("R", (), {"upserted_count": new, "matched_count": old})()

    def estimated_document_count(self):
        return len(self.docs)


class FakeDB:
    def __init__(self, **colls):
        self.__dict__.update(colls)

    def __getattr__(self, name):
        c = FakeColl()
        setattr(self, name, c)
        return c


RING = {"_id": "R-102", "type": "FAN-IN", "hub": "8041F18B0", "tier": "escalate", "found_at": "2026-10-03T12:00:00",
        "accounts": ["8007E16E0", "802225A40", "8041F18B0"]}


@pytest.fixture
def fake(monkeypatch):
    d = FakeDB(rings=FakeColl([RING]))
    published = []
    monkeypatch.setattr(calls, "db", lambda: d)
    monkeypatch.setattr(integ, "db", lambda: d)
    monkeypatch.setattr(integ.bus, "publish", lambda t, data: published.append((t, data)))
    d.published = published
    return d


def sample(name: str) -> bytes:
    return (SAMPLES / name).read_bytes()


# ---------------------------------------------------------------- parsing
def test_pacs008_sample_namespaced_othr_id():
    m = integ.parse_iso20022(sample("pacs008_margaret.xml"))
    assert (m["kind"], m["version"], m["message_id"]) == ("pacs.008", "pacs.008.001.08", "YB-20261003-W000412")
    (t,) = m["transactions"]
    assert t["creditor"]["account"] == "802225A40" and t["creditor"]["scheme"] == "Othr"
    assert t["debtor"]["account"] == "TW-MARG-0001" and t["debtor"]["name"].startswith("Margaret")
    assert (t["amount"], t["currency"], t["remittance"]) == (40000.0, "USD", "bail - grandson")
    assert t["creditor"]["agent"] == "021015" and t["settlement_date"] == "2026-10-03"
    assert m["warnings"] == []


PACS_PLAIN = b"""<?xml version="1.0" encoding="UTF-8"?>
<Document><FIToFICstmrCdtTrf>
  <GrpHdr><MsgId>M-1</MsgId><NbOfTxs>1</NbOfTxs><IntrBkSttlmDt>2026-10-02</IntrBkSttlmDt></GrpHdr>
  <CdtTrfTxInf>
    <PmtId><EndToEndId>E2E-1</EndToEndId></PmtId>
    <IntrBkSttlmAmt Ccy="eur">1250.50</IntrBkSttlmAmt>
    <Dbtr><Nm>A Debtor</Nm></Dbtr><DbtrAcct><Id><IBAN>GB29NWBK60161331926819</IBAN></Id></DbtrAcct>
    <CdtrAgt><FinInstnId><BICFI>ABCDDEFFXXX</BICFI></FinInstnId></CdtrAgt>
    <Cdtr><Nm>A Creditor</Nm></Cdtr><CdtrAcct><Id><IBAN>de89 3704 0044 0532 0130 00</IBAN></Id></CdtrAcct>
    <RmtInf><Strd><CdtrRefInf><Ref>RF18539007547034</Ref></CdtrRefInf></Strd></RmtInf>
  </CdtTrfTxInf>
</FIToFICstmrCdtTrf></Document>"""


def test_pacs008_without_namespace_iban():
    m = integ.parse_iso20022(PACS_PLAIN)
    assert m["kind"] == "pacs.008" and m["version"] is None
    (t,) = m["transactions"]
    assert t["creditor"] == {"name": "A Creditor", "account": "DE89370400440532013000", "scheme": "IBAN",
                             "iban_valid": True, "agent": "ABCDDEFFXXX"}
    assert t["debtor"]["account"] == "GB29NWBK60161331926819"
    assert (t["currency"], t["amount_text"], t["remittance"]) == ("EUR", "1250.50", "RF18539007547034")
    assert t["settlement_date"] == "2026-10-02"   # from GrpHdr


def test_pacs008_inside_business_envelope():
    doc = PACS_PLAIN.split(b"?>", 1)[1]
    env = (b'<BizMsgEnvlp><AppHdr xmlns="urn:iso:std:iso:20022:tech:xsd:head.001.001.02"><BizMsgIdr>B-1</BizMsgIdr>'
           b'<MsgDefIdr>pacs.008.001.08</MsgDefIdr></AppHdr>' + doc + b"</BizMsgEnvlp>")
    m = integ.parse_iso20022(env)
    assert m["kind"] == "pacs.008" and m["message_id"] == "M-1" and len(m["transactions"]) == 1


def test_pain001_sample_iban_and_othr():
    m = integ.parse_iso20022(sample("pain001_example.xml"))
    assert (m["kind"], m["version"], m["message_id"]) == ("pain.001", "pain.001.001.09", "HT-PAY-20261003-01")
    a, b = m["transactions"]
    assert a["creditor"]["scheme"] == "IBAN" and a["creditor"]["iban_valid"] and a["currency"] == "EUR"
    assert b["creditor"]["account"] == "802225A40" and b["amount"] == 5000.0
    assert a["debtor"]["account"] == b["debtor"]["account"] == "TW-CORP-0001"   # debtor from PmtInf
    assert a["requested_date"] == "2026-10-03" and m["warnings"] == []          # CtrlSum and NbOfTxs agree


PAIN_V3 = b"""<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.001.001.03"><CstmrCdtTrfInitn>
  <GrpHdr><MsgId>OLD-1</MsgId><NbOfTxs>3</NbOfTxs><CtrlSum>10.00</CtrlSum></GrpHdr>
  <PmtInf><PmtInfId>P1</PmtInfId><ReqdExctnDt>2026-10-05</ReqdExctnDt>
    <Dbtr><Nm>D</Nm></Dbtr><DbtrAcct><Id><Othr><Id>ACC-1</Id><SchmeNm><Cd>BBAN</Cd></SchmeNm></Othr></Id></DbtrAcct>
    <DbtrAgt><FinInstnId><BIC>ABCDUS33</BIC></FinInstnId></DbtrAgt>
    <CdtTrfTxInf><PmtId><EndToEndId>E1</EndToEndId></PmtId><Amt><InstdAmt Ccy="USD">12.00</InstdAmt></Amt>
      <CdtrAcct><Id><Othr><Id>ACC-2</Id></Othr></Id></CdtrAcct></CdtTrfTxInf>
  </PmtInf></CstmrCdtTrfInitn></Document>"""


def test_pain001_old_version_and_header_warnings():
    m = integ.parse_iso20022(PAIN_V3)
    assert m["version"] == "pain.001.001.03"
    (t,) = m["transactions"]
    assert t["requested_date"] == "2026-10-05" and t["debtor"]["agent"] == "ABCDUS33"
    assert t["debtor"]["scheme"] == "BBAN" and t["creditor"]["name"] is None
    assert len(m["warnings"]) == 2   # NbOfTxs and CtrlSum both disagree


@pytest.mark.parametrize("raw,why", [
    (b'<?xml version="1.0"?><!DOCTYPE x [<!ENTITY a "b">]><Document/>', "DTD"),
    (b"<Document><FIToFICstmrCdtTrf>", "malformed"),
    (b"<Document><Other/></Document>", "no pacs.008"),
    (PACS_PLAIN.replace(b"<MsgId>M-1</MsgId>", b""), "MsgId"),
    (PACS_PLAIN.replace(b'Ccy="eur"', b'Ccy="EURO"'), "Ccy"),
    (PACS_PLAIN.replace(b">1250.50<", b">-5<"), "positive"),
    (PACS_PLAIN.replace(b"<CdtrAcct><Id><IBAN>de89 3704 0044 0532 0130 00</IBAN></Id></CdtrAcct>", b""), "creditor"),
    ("<Document>é</Document>".encode("latin-1"), "UTF-8"),
])
def test_rejects_bad_messages(raw, why):
    with pytest.raises(ValueError, match=why):
        integ.parse_iso20022(raw)


def test_iban_check_digits():
    assert integ.iban_ok("DE89370400440532013000") and integ.iban_ok("GB29NWBK60161331926819")
    assert not integ.iban_ok("DE89370400440532013001") and not integ.iban_ok("802225A40")
    m = integ.parse_iso20022(PACS_PLAIN.replace(b"0532 0130 00", b"0532 0130 01"))
    assert m["transactions"][0]["creditor"]["iban_valid"] is False and "check-digit" in m["warnings"][0]


# ---------------------------------------------------------------- screening (calls.payee_check on a fake ring map)
def test_screening_ring_match_uses_payee_check(fake):
    r = integ.screen_message(integ.parse_iso20022(sample("pacs008_margaret.xml")))
    assert (r["screening"], r["ring_id"], r["hops"], r["hold_recommended"], r["recommendation"]) == \
        ("RING_MATCH", "R-102", 2, True, "HOLD")
    assert r["transactions"][0]["path"] == ["TW-MARG-0001", "802225A40", "8041F18B0"]
    assert any("ring R-102" in x for x in r["reasons"]) and r["questions"]


def test_screening_clear(fake):
    r = integ.screen_message(integ.parse_iso20022(sample("pacs008_rent.xml")))
    assert (r["screening"], r["ring_id"], r["hold_recommended"], r["recommendation"]) == ("CLEAR", None, False, "NO_HOLD")
    assert "TW-LAND-0001" in r["reasons"][0]


def test_screening_batch_worst_wins(fake):
    r = integ.screen_message(integ.parse_iso20022(sample("pain001_example.xml")))
    assert r["screening"] == "RING_MATCH" and r["hold_recommended"] is True
    assert [t["screening"] for t in r["transactions"]] == ["CLEAR", "RING_MATCH"]
    assert all(x.startswith(("INV-2026-117:", "INV-2026-118:")) for x in r["reasons"])


def test_screening_unavailable_is_not_clear():
    msg = integ.parse_iso20022(sample("pacs008_rent.xml"))
    r = integ.screen_message(msg, check=lambda a, b: {"in_ring": False, "error": "ring map unavailable: X"})
    assert (r["screening"], r["hold_recommended"], r["recommendation"]) == ("UNAVAILABLE", None, None)


def test_intake_persists_publishes_and_is_idempotent(fake):
    raw = sample("pacs008_margaret.xml")
    code, body = integ.intake(raw, "pacs.008")
    assert code == 200 and body["persisted"] and not body["duplicate"]
    doc = fake.inbound_payments.docs["pacs.008:YB-20261003-W000412"]
    assert doc["sha256"] == body["sha256"] and "802225A40" in doc["raw_xml"]
    assert fake.published == [("integration", {"kind": "pacs.008", "ref": "YB-20261003-W000412", "result": {
        "screening": "RING_MATCH", "ring_id": "R-102", "hops": 2, "hold_recommended": True, "transactions": 1}})]
    code, again = integ.intake(raw, "pacs.008")
    assert code == 200 and again["duplicate"] and again["screening"] == "RING_MATCH" and len(fake.published) == 1
    code, err = integ.intake(raw.replace(b"40000.00", b"41000.00"), "pacs.008")
    assert code == 409 and "different content" in err["error"]
    code, err = integ.intake(sample("pain001_example.xml"), "pacs.008")
    assert code == 422 and "pain001" in err["error"]


# ---------------------------------------------------------------- batch ingest
IBM_CSV = """Timestamp,From Bank,Account,To Bank,Account,Amount Received,Receiving Currency,Amount Paid,Payment Currency,Payment Format,Is Laundering
2022/09/03 12:16,021015,802225A40,029817,8041F18B0,5547.92,US Dollar,5547.92,US Dollar,ACH,1
2022/09/03 12:16,021015,802225A40,029817,8041F18B0,5547.92,US Dollar,5547.92,US Dollar,ACH,1
2022/09/04 04:57,012,800E21640,029817,8041F18B0,10040.96,US Dollar,10040.96,US Dollar,ACH
not-a-date,012,800E21640,029817,8041F18B0,1.00,US Dollar,1.00,US Dollar,ACH,0
2022/09/04 05:00,012,800E21640
"""


def test_batch_csv_counts_and_idempotency():
    coll = FakeColl()
    rows = integ.parse_csv_rows(IBM_CSV)
    r = integ.ingest(rows, "csv", coll=coll)
    assert (r["received"], r["accepted"], r["inserted"], r["duplicates"], r["rejected"]) == (5, 3, 3, 0, 2)
    assert [e["row"] for e in r["errors"]] == [4, 5] and "ts" in r["errors"][0]["error"]
    first = coll.docs[sorted(coll.docs)[0]]
    assert first["src"] == "802225A40" and first["ts"] == "2022-09-03T12:16:00" and first["batch_id"] == r["batch_id"]
    again = integ.ingest(rows, "csv", coll=coll)
    assert (again["inserted"], again["duplicates"]) == (0, 3)


def test_batch_json_and_dry_run():
    coll = FakeColl()
    rows = [{"ts": "2026-10-03T10:41:00", "src": "TW-MARG-0001", "dst": "802225A40", "amount": 40000,
             "currency": "US Dollar", "format": "Wire", "ref": "CORE-778899"},
            {"ts": "2026-10-03T10:41:00", "src": "", "dst": "x", "amount": 1, "currency": "USD"},
            {"ts": "2026-10-03T10:41:00", "src": "A1", "dst": "B1", "amount": -3, "currency": "USD"}]
    r = integ.ingest(rows, "json", dry_run=True, coll=coll)
    assert (r["accepted"], r["rejected"], r["inserted"], coll.docs) == (1, 2, 0, {})
    r = integ.ingest(rows, "json", coll=coll)
    assert list(coll.docs) == ["IN-CORE-778899"] and coll.docs["IN-CORE-778899"]["amount_rec"] == 40000.0


# ---------------------------------------------------------------- branding
def test_branding_defaults_and_override(tmp_path, monkeypatch):
    monkeypatch.setenv("TW_BRANDING_FILE", str(tmp_path / "missing.json"))
    b = integ.branding()
    assert (b["bank_name"], b["product_name"], b["source"], b["logo_url"]) == \
        ("Your Bank", "Fast and Fraudless", "defaults", None)
    (tmp_path / "logo.svg").write_text("<svg xmlns='http://www.w3.org/2000/svg'/>")
    f = tmp_path / "brand.json"
    f.write_text('{"bank_name": "First Harbor Bank", "accent_color": "green", "logo_path": "logo.svg", '
                 '"support_phone": "800-555-0100", "nested": {"x": 1}}')
    monkeypatch.setenv("TW_BRANDING_FILE", str(f))
    b = integ.branding()
    assert b["bank_name"] == "First Harbor Bank" and b["accent_color"] == "#76b900" and b["warnings"]
    assert b["logo_url"] == "/api/integrations/branding/logo" and b["support_phone"] == "800-555-0100"
    assert "nested" not in b


def test_repo_branding_file_is_valid():
    b = integ.branding() if not os.environ.get("TW_BRANDING_FILE") else None
    if b:
        assert b["source"] == "branding.json" and "warnings" not in b


# ---------------------------------------------------------------- outbound webhooks
HOOK = "http://10.20.30.40:8443/aml/inbound"


def hook_cfg(**kw):
    return {"hooks": [{"url": HOOK, "events": list(integ.EVENTS)}], "secret": "s3cret", "allow_public": False,
            "max_attempts": 3, "timeout_s": 1, "base_url": "http://fraud-box.bank.internal:8790", **kw}


def test_sign_and_verify():
    body = b'{"event":"sar_drafted"}'
    want = "sha256=" + hmac.new(b"s3cret", body, hashlib.sha256).hexdigest()
    assert integ.sign(body, "s3cret") == want
    assert integ.verify(body, "s3cret", want)
    assert not integ.verify(body + b" ", "s3cret", want) and not integ.verify(body, "other", want)
    assert [integ.backoff(n) for n in (1, 2, 3, 7, 12)] == [1, 2, 4, 60, 60]


def test_internal_destinations_only():
    assert integ.is_internal("http://10.1.2.3/x") and integ.is_internal("https://[fd00::1]:8443/x")
    assert integ.is_internal("http://localhost/x", resolve=lambda h, p: [(0, 0, 0, "", ("127.0.0.1", 0))])
    assert not integ.is_internal("http://8.8.8.8/x")
    assert not integ.is_internal("https://example.org/x", resolve=lambda h, p: [(0, 0, 0, "", ("93.184.216.34", 0))])


def test_webhook_config_env_beats_file(tmp_path, monkeypatch):
    f = tmp_path / "integrations.json"
    f.write_text(json.dumps({"webhooks": [{"url": HOOK, "events": ["sar_drafted", "bogus"]}, "ftp://x/y"],
                             "max_attempts": 4}))
    monkeypatch.setenv("TW_INTEGRATIONS_FILE", str(f))
    monkeypatch.delenv("TW_WEBHOOKS", raising=False)
    monkeypatch.delenv("TW_WEBHOOK_SECRET", raising=False)
    c = integ.webhook_config()
    assert c["hooks"] == [{"url": HOOK, "events": ["sar_drafted"]}] and c["max_attempts"] == 4 and c["secret"] == ""
    monkeypatch.setenv("TW_WEBHOOKS", "http://10.0.0.9/a, http://10.0.0.10/b")
    monkeypatch.setenv("TW_WEBHOOK_SECRET", "k")
    c = integ.webhook_config()
    assert [h["url"] for h in c["hooks"]] == ["http://10.0.0.9/a", "http://10.0.0.10/b"] and c["secret"] == "k"
    assert c["hooks"][0]["events"] == list(integ.EVENTS)


def test_delivery_is_signed_retried_and_logged():
    sent, codes = [], [ConnectionError("refused"), 503, 200]

    def post(url, body, headers, timeout):
        sent.append((url, body, headers))
        r = codes.pop(0)
        if isinstance(r, Exception):
            raise r
        return r

    coll = FakeColl()
    w = integ.Webhooks(hook_cfg(), post=post, coll=coll)
    data = {"sar_id": "SAR-R-102", "ring_id": "R-102"}
    assert w.emit("sar_drafted", "sar_drafted:SAR-R-102:r1:1", data) == 1
    assert w.emit("sar_drafted", "sar_drafted:SAR-R-102:r1:1", data) == 0   # deduped
    (did,) = coll.docs
    statuses = []
    while w.heap:
        item = w.heap.pop(0)
        statuses.append(w.deliver(*item[2:]))
    assert statuses == ["pending", "pending", "delivered"]
    url, body, headers = sent[-1]
    assert url == HOOK and integ.verify(body, "s3cret", headers["X-FastFraudless-Signature"])
    assert headers["X-FastFraudless-Event"] == "sar_drafted" and headers["X-FastFraudless-Delivery"] == did
    assert sent[0][1] == body   # retries resend the same signed bytes
    payload = json.loads(body)
    assert payload["data"] == data and payload["bank"] and payload["event_id"]
    assert payload["links"]["sar_xml"] == ("http://fraud-box.bank.internal:8790"
                                           "/api/integrations/sar/SAR-R-102/fincen.xml")
    doc = coll.docs[did]
    assert doc["status"] == "delivered" and doc["attempts"] == 3 and len(doc["log"]) == 3
    assert doc["url"] == HOOK and "s3cret" not in doc["body"]


def test_delivery_permanent_failures():
    w = integ.Webhooks(hook_cfg(), post=lambda *a: 400, coll=FakeColl())
    assert w.deliver("d1", HOOK, "ring_escalated", b"{}", 0) == "failed"   # 4xx: no retry
    w = integ.Webhooks(hook_cfg(), post=lambda *a: 500, coll=FakeColl())
    assert w.deliver("d2", HOOK, "ring_escalated", b"{}", 2) == "failed"   # max_attempts reached
    called = []
    w = integ.Webhooks(hook_cfg(), post=lambda *a: called.append(a) or 200, coll=FakeColl())
    assert w.deliver("d3", "http://8.8.8.8/x", "ring_escalated", b"{}", 0) == "failed" and called == []
    assert "not bank-internal" in w.last["detail"]


def test_subscriptions_filter_events():
    w = integ.Webhooks(hook_cfg(hooks=[{"url": HOOK, "events": ["sar_decided"]}]), post=lambda *a: 200,
                       coll=FakeColl())
    assert w.emit("ring_escalated", "ring:R-1:x", {"ring_id": "R-1"}) == 0
    assert w.emit("sar_decided", "sar_decided:SAR-R-1:approved:1", {"sar_id": "SAR-R-1", "ring_id": "R-1"}) == 1


def test_events_from_change_docs():
    call = {"_id": "0412", "recommendation": "HOLD", "started_at": "t0", "synthetic": True,
            "payee_check": {"in_ring": True, "ring_id": "R-102", "hops": 2},
            "cues": [{"cue": "URGENCY", "quote": "today"}, {"cue": "SECRECY", "quote": "q"}],
            "customer": {"name": "Margaret Doyle (fictional)"}, "transcript": "secret words"}
    (ev,) = integ.events_from_change({"ns": {"coll": "calls"}, "operationType": "replace", "fullDocument": call})
    assert ev[0] == "hold_recommended" and ev[2]["ring_id"] == "R-102" and ev[2]["cues"] == ["SECRECY", "URGENCY"]
    assert "Margaret" not in json.dumps(ev[2]) and "secret words" not in json.dumps(ev[2])   # ids and status only
    assert integ.events_from_change({"ns": {"coll": "calls"}, "operationType": "replace",
                                     "fullDocument": {**call, "recommendation": "NO_HOLD"}}) == []
    sar = {"_id": "SAR-R-102", "ring_id": "R-102", "revision": 1, "received_at_ms": 5, "valid_all": True,
           "citations": [{"txn_id": "T1", "valid": True}, {"txn_id": "T2", "valid": False}], "decision": None}
    (ev,) = integ.events_from_change({"ns": {"coll": "sar_drafts"}, "operationType": "insert", "fullDocument": sar})
    assert ev[0] == "sar_drafted" and (ev[2]["citations_verified"], ev[2]["citations_total"]) == (1, 2)
    (ev,) = integ.events_from_change({"ns": {"coll": "sar_drafts"}, "operationType": "update",
                                      "fullDocument": {**sar, "decision": "approved", "decided_by": "analyst"}})
    assert ev[0] == "sar_decided" and ev[2]["decision"] == "approved"
    ring = {"_id": "R-102", "tier": "escalate", "type": "FAN-IN", "accounts": ["a", "b"], "n_txns": 13, "found_at": "f"}
    (ev,) = integ.events_from_change({"ns": {"coll": "rings"}, "operationType": "replace", "fullDocument": ring})
    assert ev[0] == "ring_escalated" and ev[2]["n_accounts"] == 2 and ev[1] == "ring:R-102:f"
    assert integ.events_from_change({"ns": {"coll": "rings"}, "operationType": "replace",
                                     "fullDocument": {**ring, "tier": "watch"}}) == []


def test_start_without_urls_or_secret_is_a_noop(monkeypatch, fake):
    for k in ("TW_WEBHOOKS", "TW_WEBHOOK_SECRET"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("TW_INTEGRATIONS_FILE", str(SAMPLES / "missing.json"))
    monkeypatch.setitem(integ._state, "started", False)
    monkeypatch.setitem(integ._state, "hooks", None)
    integ.start()
    assert integ._state["hooks"] is None and "no webhook URLs" in integ._state["note"]
    assert integ.emit("ring_escalated", "k", {"ring_id": "R-1"}) == 0
    monkeypatch.setitem(integ._state, "started", False)
    monkeypatch.setenv("TW_WEBHOOKS", HOOK)
    integ.start()
    assert integ._state["hooks"] is None and "TW_WEBHOOK_SECRET" in integ._state["note"]   # never unsigned


# ---------------------------------------------------------------- SAR draft (FinCEN-style) + case CSV
import xml.etree.ElementTree as ET  # noqa: E402

EDGES = [
    {"txn_id": "T100", "src": "802225A40", "dst": "8041F18B0", "amount": 5547.92, "currency": "US Dollar",
     "usd": 5547.92, "ts": "2022-09-03T12:16:00"},
    {"txn_id": "T101", "src": "800E21640", "dst": "8041F18B0", "amount": 9211.89, "currency": "Euro",
     "usd": 10040.96, "ts": "2022-09-04T04:57:00"},
    {"txn_id": "T102", "src": "8007E16E0", "dst": "8041F18B0", "amount": 11218.97, "currency": "US Dollar",
     "usd": 11218.97, "ts": "2022-09-02T15:18:00"},
]
SAR_RING = {**RING, "edges": EDGES, "n_txns": 3, "total_usd": 26807.85}
SAR = {"_id": "SAR-R-102", "ring_id": "R-102", "revision": 2, "author": "agent", "valid_all": False,
       "received_at": "2026-10-03T13:00:00+00:00", "decision": None,
       "narrative": 'Hub 8041F18B0 <b>&</b> "funnel" \x01 T100 ($5,547.92), T101, T555 ($9,999.00), T900.',
       "citations": [{"txn_id": "T100", "amount": 5547.92, "valid": True},
                     {"txn_id": "T101", "amount": None, "valid": True},
                     {"txn_id": "T555", "amount": 9999.0, "valid": False, "reason": "transaction id does not exist"},
                     {"txn_id": "T900", "amount": None, "valid": False, "reason": "belongs to ring R-007"},
                     {"txn_id": None, "amount": 26807.85, "valid": True, "reason": "matches ring total (USD)"}]}


def test_sar_report_uses_only_validated_citations():
    rep = integ.build_sar_report(SAR, SAR_RING, {}, "First Harbor Bank")
    sa = rep["suspicious_activity"]
    assert [t["txn_id"] for t in sa["transactions"]] == ["T100", "T101"]          # T102 not cited, T555/T900 invalid
    assert (sa["date_from"], sa["date_to"], sa["total_usd"]) == ("2022-09-03", "2022-09-04", 15588.88)
    assert [s["account_id"] for s in rep["subjects"]] == ["802225A40", "8041F18B0", "800E21640"]
    assert rep["subjects"][1]["role"] == "hub" and "funnel account" in sa["category"]
    assert (rep["status"], rep["filed"], rep["analyst_decision"]) == ("DRAFT", False, "pending")
    assert rep["validation"] == {"citations_total": 5, "citations_verified": 3, "unverified_excluded": 2,
                                 "valid_all": False}
    assert rep["filing_institution"]["name"] == "First Harbor Bank" and rep["data_label"].startswith("SYNTHETIC")


def test_sar_xml_is_well_formed_and_marked_draft():
    raw = integ.sar_xml(integ.build_sar_report(SAR, SAR_RING, {}, "Your Bank"))
    assert raw.startswith(b"<?xml") and b"DRAFT - NOT FILED" in raw
    root = ET.fromstring(raw)
    assert root.tag == "SuspiciousActivityReportDraft" and root.get("status") == "DRAFT" and root.get("filed") == "false"
    txs = root.find("SuspiciousActivity/Transactions")
    assert [t.get("txnId") for t in txs] == ["T100", "T101"] and txs.get("count") == "2"
    assert txs[1].get("amount") == "9211.89" and txs[1].get("amountUSD") == "10040.96"
    assert {t.get("txnId") for t in root.iter("Transaction")}.isdisjoint({"T555", "T900", "T102"})
    assert root.find("SuspiciousActivity/TotalAmount").text == "15588.88"
    assert root.find("CitationValidation").get("excludedUnverified") == "2"
    assert root.find("Narrative").text.startswith('Hub 8041F18B0 <b>&</b> "funnel"  T100')   # escaped, control char dropped
    assert "NOT FILED" in root.find("Disclaimer").text


def test_case_rows_and_csv():
    cases = [{"_id": "R-102", "status": "sar_drafted", "timeline": [{"ts": 1791046004695, "msg": "woke"},
                                                                    {"ts": 1791046017661, "msg": "SAR"}]}]
    sars = [{**SAR, "decision": "approved", "decided_at": "2026-10-03T13:05:00+00:00"}]
    rings = {"R-102": {**SAR_RING, "accounts": ["=HYPERLINK(1)", "802225A40"]},
             "R-200": {"_id": "R-200", "tier": "escalate", "type": "FAN-OUT", "accounts": ["a"]}}
    rows = integ.case_rows(cases, sars, rings, include_escalated=True)
    assert [r["ring_id"] for r in rows] == ["R-102", "R-200"]
    assert (rows[0]["sar_status"], rows[0]["citations_verified"], rows[1]["case_status"]) == ("approved", 3, "not_started")
    text = integ.to_csv(rows)
    lines = text.split("\r\n")
    assert lines[0].split(",") == list(integ.CASE_COLUMNS)
    assert lines[0] == ("ring_id,ring_type,tier,case_status,total_usd,n_transactions,n_accounts,hub,accounts,sar_id,"
                        "sar_status,sar_valid_all,citations_verified,citations_total,analyst_decision,decided_at,"
                        "ring_found_at,case_first_event_at,case_last_event_at,sar_received_at")
    assert "'=HYPERLINK(1);802225A40" in text and "2026-" in lines[1]


# ---------------------------------------------------------------- HTTP routes (FastAPI TestClient, fake Mongo)
@pytest.fixture
def client(fake, monkeypatch):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
    fake.rings.docs["R-102"] = SAR_RING
    fake.sar_drafts = FakeColl([SAR])
    fake.cases = FakeColl([{"_id": "R-102", "status": "sar_drafted", "timeline": [{"ts": 1791046004695, "msg": "x"}]}])
    audits = []
    monkeypatch.setattr(integ, "audit", lambda *a, **k: audits.append((a, k)))
    monkeypatch.delenv("TW_INTEGRATIONS_TOKEN", raising=False)
    app = FastAPI()
    app.include_router(integ.router)
    c = TestClient(app)
    c.audits = audits
    return c


def test_routes_end_to_end(client):
    r = client.post("/api/integrations/iso20022/pacs008", content=sample("pacs008_margaret.xml"),
                    headers={"Content-Type": "application/xml"})
    assert r.status_code == 200 and r.json()["screening"] == "RING_MATCH" and r.json()["hold_recommended"] is True
    r = client.post("/api/integrations/iso20022/pain001", content=sample("pain001_example.xml"))
    assert r.status_code == 200 and [t["screening"] for t in r.json()["transactions"]] == ["CLEAR", "RING_MATCH"]
    assert client.post("/api/integrations/iso20022/pacs008", content=b"<oops").status_code == 400
    r = client.post("/api/integrations/transactions?dry_run=true", content=IBM_CSV, headers={"Content-Type": "text/csv"})
    assert r.status_code == 200 and (r.json()["accepted"], r.json()["rejected"], r.json()["dry_run"]) == (3, 2, True)
    r = client.get("/api/integrations/sar/SAR-R-102.json")
    assert r.status_code == 200 and r.json()["status"] == "DRAFT" and r.headers["cache-control"] == "no-store"
    r = client.get("/api/integrations/sar/SAR-R-102/fincen.xml")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/xml")
    assert ET.fromstring(r.content).get("sarId") == "SAR-R-102"
    assert [a[1]["format"] for a in client.audits] == ["json", "xml"]
    assert client.get("/api/integrations/sar/SAR-R-999.json").status_code == 404
    assert client.get("/api/integrations/sar/bad$id/fincen.xml").status_code == 400
    r = client.get("/api/integrations/cases/export.csv")
    assert r.status_code == 200 and r.text.startswith("ring_id,ring_type,tier,case_status,total_usd")
    assert "attachment" in r.headers["content-disposition"]
    assert client.get("/api/integrations/branding").json()["product_name"] == "Fast and Fraudless"


def test_routes_token(client, monkeypatch):
    monkeypatch.setenv("TW_INTEGRATIONS_TOKEN", "t0ken")
    assert client.get("/api/integrations/cases/export.csv").status_code == 401
    assert client.get("/api/integrations/cases/export.csv", headers={"Authorization": "Bearer t0ken"}).status_code == 200
    assert client.get("/api/integrations/sar/SAR-R-102.json", headers={"X-API-Key": "t0ken"}).status_code == 200
    assert client.get("/api/integrations/branding").status_code == 200   # the UI reads branding without a token
