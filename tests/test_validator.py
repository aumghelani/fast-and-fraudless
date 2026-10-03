"""SAR validator tests. No Mongo: fake collections implement the two calls the validator makes."""
from __future__ import annotations

from backend.validator import extract_amounts, extract_txn_ids, validate


class FakeColl:
    def __init__(self, docs):
        self.docs = {d["_id"]: d for d in docs}

    def find_one(self, flt, projection=None):
        return self.docs.get(flt["_id"])

    def find(self, flt):
        ids = flt["_id"]["$in"]
        return [self.docs[i] for i in ids if i in self.docs]


EDGES = [
    {"txn_id": "T100", "src": "800AAA111", "dst": "802225A40", "amount": 9524.21, "currency": "US Dollar",
     "usd": 9524.21, "ts": "2022-09-01T13:20:00"},
    {"txn_id": "T101", "src": "800BBB222", "dst": "802225A40", "amount": 1000.00, "currency": "Euro",
     "usd": 1090.00, "ts": "2022-09-01T15:05:00"},
    {"txn_id": "T102", "src": "800CCC333", "dst": "802225A40", "amount": 12000.00, "currency": "US Dollar",
     "usd": 12000.00, "ts": "2022-09-02T09:00:00"},
]
RING = {"_id": "R-102", "type": "FAN-IN", "hub": "802225A40", "edges": EDGES,
        "total_usd": 22614.21, "amt_med_usd": 9524.21, "tier": "escalate"}
OTHER_RING_TXN = {"_id": "T900", "ring_id": "R-007", "src": "x", "dst": "y", "amount": 5000.0,
                  "currency": "US Dollar", "usd": 5000.0, "ts": "2022-09-01T00:00:00"}


def colls():
    txns = FakeColl([{"_id": e["txn_id"], "ring_id": "R-102", **{k: e[k] for k in
                     ("src", "dst", "amount", "currency", "usd", "ts")}} for e in EDGES] + [OTHER_RING_TXN])
    rings = FakeColl([RING])
    return txns, rings


def run(text):
    txns, rings = colls()
    return validate("R-102", text, txns=txns, rings=rings)


def by_id(res):
    return {c["txn_id"]: c for c in res["citations"]}


def test_all_valid_pipe_format():
    text = ("Account 800AAA111 sent T100 | 2022-09-01 13:20 | 800AAA111 -> 802225A40 | 9,524.21 USD. "
            "Then T101 moved 1,000.00 Euro (about $1,090.00). T102 for $12,000.00 completed the pattern. "
            "Total $22,614.21.")
    res = run(text)
    assert res["valid_all"], res
    c = by_id(res)
    assert c["T100"]["amount"] == 9524.21
    assert c["T101"]["valid"] and c["T102"]["valid"]
    assert c[None]["reason"].startswith("matches ring total")


def test_wrong_amount_flagged():
    res = run("T100 for $9,900.00 and T102 for $12,000.00.")
    c = by_id(res)
    assert not c["T100"]["valid"]
    assert "does not match" in c["T100"]["reason"]
    assert c["T102"]["valid"]
    assert res["valid_all"] is False


def test_within_one_percent_ok():
    res = run("T100 ($9,520) ")
    assert by_id(res)["T100"]["valid"]


def test_unknown_id_flagged():
    res = run("T100 $9,524.21 and T555 $3,000.00")
    c = by_id(res)
    assert c["T555"]["valid"] is False
    assert "does not exist" in c["T555"]["reason"]
    assert c["T100"]["valid"]


def test_other_ring_txn_flagged():
    res = run("T900 for $5,000.00")
    c = by_id(res)
    assert not c["T900"]["valid"]
    assert "R-007" in c["T900"]["reason"]


def test_invented_unattached_amount_flagged():
    text = "T100 $9,524.21. " + ("x" * 200) + " The group laundered roughly $1,250,000.00 overall."
    res = run(text)
    c = by_id(res)
    assert c[None]["valid"] is False
    assert res["valid_all"] is False


def test_amount_before_id_attached_correctly():
    res = run("$9,524.21 (T100), $12,000.00 (T102), 1,000.00 Euro (T101)")
    assert res["valid_all"], res


def test_id_without_amount_is_valid():
    res = run("Transaction T102 completed the fan-in.")
    c = by_id(res)
    assert c["T102"]["valid"] and c["T102"]["amount"] is None


def test_no_citations_not_valid():
    assert run("A ring was found.")["valid_all"] is False


def test_extractors_ignore_dates_counts_accounts():
    text = "On 2022-09-01 13:20, 14 transfers from 800737690 and 802225A40 hit the hub (49.00%)."
    assert extract_amounts(text) == []
    assert extract_txn_ids("T12, T3x, xT4, (T56)") == [("T12", 0, 3), ("T56", 16, 19)]


def test_sar_word_not_money():
    assert extract_amounts("This 2022 SAR covers T100.") == []


def test_k_suffix():
    vals = [v for v, *_ in extract_amounts("about $9.5k")]
    assert vals == [9500.0]


def test_swapped_amounts_not_both_valid():
    res = run("T100 $12,000.00, T102 $9,524.21")
    assert res["valid_all"] is False
    res = run("$12,000.00 (T100), $9,524.21 (T102)")
    assert res["valid_all"] is False
