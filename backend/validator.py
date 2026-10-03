"""SAR validator: checks every transaction id and dollar amount an agent-written narrative cites.

Code, not a model, decides whether a citation is real (ARCHITECTURE.md section 4.A step 6).

    validate(ring_id, narrative) -> {"citations": [{txn_id, amount, valid, reason}], "valid_all": bool}

Rules
* Every `T<digits>` in the narrative is a cited transaction. It is valid only if it exists (Mongo
  `transactions`, or the ring's own `edges`) AND belongs to this ring.
* Every money amount ($9,524.21 / 9,524.21 USD / 1,000.00 Euro / 9524.21) is attached to the nearest
  cited id within NEAR_CHARS characters. An attached amount must equal that transaction's `amount`
  or `usd` within 1%.
* An amount attached to no id is checked against the ring-level figures the case pack shows
  (each edge amount/usd, total_usd, median, per-currency totals). Anything else is flagged.
* Bare integers (counts, account numbers, dates, times) are not treated as money.

Pure function; the Mongo collections can be injected (tests use fakes).
"""
from __future__ import annotations

import re
from statistics import median
from typing import Any, Iterable

NEAR_CHARS = 120
TOL = 0.01  # 1%

# an amount next to a cited id is that id's amount, unless one of these words introduces it
AGG_RE = re.compile(r"\b(total(?:l?ing|led)?|sum|overall|combined|aggregate|median|average|largest|smallest|"
                    r"in all|altogether)\b", re.I)
TXN_RE = re.compile(r"(?<![A-Za-z0-9_])T\d+(?![A-Za-z0-9_])")

_CUR_WORDS = (r"US\s?Dollars?|USD|US\$|dollars?|Euros?|EUR|Yuan|CNY|Yen|JPY|UK\s?Pounds?|GBP|Rupees?|INR|"
              r"Rubles?|RUB|Canadian\s?Dollars?|CAD|Australian\s?Dollars?|AUD|Swiss\s?Francs?|CHF|"
              r"Mexican\s?Pesos?|MXN|Brazil(?:ian)?\s?Reals?|BRL|Shekels?|ILS|Saudi\s?Riyals?|Bitcoins?|BTC")
_NUM = r"\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?"
# group "a": prefixed by a currency symbol; "b": followed by a currency word; "c": prefixed by a code;
# "d": bare number that looks like money (comma-grouped or exactly 2 decimals)
MONEY_RE = re.compile(
    rf"(?:[$€£¥]\s?(?P<a>{_NUM})(?P<ak>\s?[kKmM](?![A-Za-z]))?)"
    rf"|(?:(?<![\w.,/:\-])(?P<b>{_NUM})\s?(?:{_CUR_WORDS})(?![A-Za-z]))"
    rf"|(?:\b(?:USD|EUR|GBP)\s?(?P<c>{_NUM}))"
    rf"|(?:(?<![\w.,/:\-$€£¥])(?P<d>\d{{1,3}}(?:,\d{{3}})+(?:\.\d{{1,2}})?|\d+\.\d{{2}})(?![\w.,/:\-%]))"
)


def _num(s: str) -> float:
    return float(s.replace(",", ""))


def extract_txn_ids(text: str) -> list[tuple[str, int, int]]:
    return [(m.group(0), m.start(), m.end()) for m in TXN_RE.finditer(text)]


def extract_amounts(text: str) -> list[tuple[float, str, int, int]]:
    """Money-like numbers: (value, raw text, start, end)."""
    out = []
    for m in MONEY_RE.finditer(text):
        raw = m.group("a") or m.group("b") or m.group("c") or m.group("d")
        if raw is None:
            continue
        v = _num(raw)
        suf = (m.group("ak") or "").strip().lower()
        if suf == "k":
            v *= 1_000
        elif suf == "m":
            v *= 1_000_000
        out.append((v, m.group(0).strip(), m.start(), m.end()))
    return out


def _matches(stated: float, ref: Any) -> bool:
    if ref is None:
        return False
    try:
        ref = float(ref)
    except (TypeError, ValueError):
        return False
    return abs(stated - ref) <= max(TOL * abs(ref), 0.005)


def _gap(a: tuple[int, int], b: tuple[int, int]) -> int:
    """Characters between two spans (0 if they touch/overlap)."""
    return max(0, max(a[0], b[0]) - min(a[1], b[1]))


def _fmt(v: float) -> str:
    return f"{v:,.2f}"


def validate(ring_id: str, narrative: str, *, txns=None, rings=None) -> dict:
    """Check every cited transaction id and amount against Mongo. See module docstring."""
    if txns is None or rings is None:
        from .db import db
        d = db()
        txns = d.transactions if txns is None else txns
        rings = d.rings if rings is None else rings

    text = narrative or ""
    ids = extract_txn_ids(text)
    amounts = extract_amounts(text)

    ring = rings.find_one({"_id": ring_id}) or {}
    edges = ring.get("edges") or []
    edge_by_id = {e.get("txn_id"): e for e in edges if e.get("txn_id")}

    uniq_ids = list(dict.fromkeys(t for t, _, _ in ids))
    found: dict[str, dict] = {}
    if uniq_ids:
        for doc in txns.find({"_id": {"$in": uniq_ids}}):
            found[doc["_id"]] = doc

    def ref_of(tid: str) -> dict | None:
        # the ring's own edge is authoritative for membership; the transactions doc for existence
        return edge_by_id.get(tid) or found.get(tid)

    aggregates = [(n, v) for n, v in _ring_figures(ring) if not n.startswith(("amount of", "USD value of"))]

    # ---- attach each amount to a cited id. Candidates are only the id immediately before and the
    # id immediately after the amount (within NEAR_CHARS), so swapped amounts cannot both validate.
    attached: dict[str, list[tuple[float, str]]] = {t: [] for t in uniq_ids}
    unattached: list[tuple[float, str]] = []
    for val, raw, s, e in amounts:
        before = [(s - te, tid) for tid, ts, te in ids if te <= s and s - te <= NEAR_CHARS]
        after = [(ts - e, tid) for tid, ts, te in ids if ts >= e and ts - e <= NEAR_CHARS]
        near = sorted(([min(before)] if before else []) + ([min(after)] if after else []))
        if not near:
            unattached.append((val, raw))
            continue
        # "T1 (X)": an amount right after an id belongs to that id, even if X matches a neighbour (E-026)
        if before and min(before)[0] <= 2:
            attached[min(before)[1]].append((val, raw))
            continue
        pick = None
        for _, tid in near:
            r = ref_of(tid)
            if r and (_matches(val, r.get("amount")) or _matches(val, r.get("usd"))):
                pick = tid
                break
        if (pick is None and AGG_RE.search(text[max(0, s - 40):s])
                and any(_matches(val, ref) for _, ref in aggregates)):
            unattached.append((val, raw))   # e.g. "... T102 $12,000.00. Total $22,614.21."
            continue
        attached[pick or near[0][1]].append((val, raw))

    citations: list[dict] = []
    for tid in uniq_ids:
        stated = attached[tid]
        amount = stated[0][0] if stated else None
        edge = edge_by_id.get(tid)
        doc = found.get(tid)
        if edge is None and doc is None:
            citations.append({"txn_id": tid, "amount": amount, "valid": False,
                              "reason": "transaction id does not exist"})
            continue
        owner = doc.get("ring_id") if doc else None
        if edge is None and owner != ring_id:
            citations.append({"txn_id": tid, "amount": amount, "valid": False,
                              "reason": f"transaction belongs to ring {owner or 'none'}, not {ring_id}"})
            continue
        ref = edge or doc
        bad = [raw for v, raw in stated if not (_matches(v, ref.get("amount")) or _matches(v, ref.get("usd")))]
        if bad:
            real = _fmt(float(ref.get("amount") or 0))
            cur = ref.get("currency") or ""
            usd = ref.get("usd")
            real_s = f"{real} {cur}".strip() + (f" / {_fmt(float(usd))} USD" if usd is not None else "")
            citations.append({"txn_id": tid, "amount": amount, "valid": False,
                              "reason": f"amount {', '.join(bad)} does not match record ({real_s})"})
        elif stated:
            citations.append({"txn_id": tid, "amount": amount, "valid": True,
                              "reason": "id and amount match the record"})
        else:
            citations.append({"txn_id": tid, "amount": None, "valid": True,
                              "reason": "id verified; no amount stated"})

    # ---- amounts not next to any id: must be a figure the case pack shows
    allowed = _ring_figures(ring)
    for val, raw in unattached:
        hit = next((name for name, ref in allowed if _matches(val, ref)), None)
        citations.append({"txn_id": None, "amount": val, "valid": hit is not None,
                          "reason": f"matches {hit}" if hit else
                          f"amount {raw} is not a figure in the case evidence"})

    valid_all = bool(citations) and all(c["valid"] for c in citations)
    return {"citations": citations, "valid_all": valid_all}


def _ring_figures(ring: dict) -> list[tuple[str, float]]:
    """Ring-level numbers the case pack prints (kept in sync with agent_api.case_pack)."""
    edges = ring.get("edges") or []
    figs: list[tuple[str, float]] = []
    if ring.get("total_usd") is not None:
        figs.append(("ring total (USD)", float(ring["total_usd"])))
    usd = [float(e["usd"]) for e in edges if e.get("usd") is not None]
    if usd:
        figs.append(("ring total (USD)", sum(usd)))
        figs.append(("median transaction (USD)", median(usd)))
        figs.append(("largest transaction (USD)", max(usd)))
        figs.append(("smallest transaction (USD)", min(usd)))
    if ring.get("amt_med_usd") is not None:
        figs.append(("median transaction (USD)", float(ring["amt_med_usd"])))
    for cur, total in currency_totals(edges).items():
        figs.append((f"total in {cur}", total))
    for e in edges:
        if e.get("amount") is not None:
            figs.append((f"amount of {e.get('txn_id')}", float(e["amount"])))
        if e.get("usd") is not None:
            figs.append((f"USD value of {e.get('txn_id')}", float(e["usd"])))
    return figs


def currency_totals(edges: Iterable[dict]) -> dict[str, float]:
    tot: dict[str, float] = {}
    for e in edges:
        if e.get("amount") is None:
            continue
        cur = e.get("currency") or "?"
        tot[cur] = tot.get(cur, 0.0) + float(e["amount"])
    return tot
