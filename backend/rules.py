"""Call-guard decision rules (ARCHITECTURE.md section 5). Code decides; the LLM only supplies cues.

Pure and deterministic: no I/O, no model calls, no clock. Same inputs always give the same output.

- HOLD   if payee_in_ring, or >= 2 distinct high-risk cues,
         or (first_wire and amount_ratio >= 5 and >= 1 high-risk cue).
- VERIFY if amount >= $50k with VERIFIED_INDEPENDENTLY and no high-risk cues.
- NO_HOLD otherwise.
"""
from __future__ import annotations

HIGH_RISK = ("URGENCY", "SECRECY", "AUTHORITY", "STORY_CHANGE", "COACHING", "REMOTE_CONTROL")
LOW_RISK = ("VERIFIED_INDEPENDENTLY", "ROUTINE_PAYEE", "AMOUNT_STATED")
ALL_CUES = HIGH_RISK + LOW_RISK

RATIO_HOLD = 5.0          # amount / typical monthly outflow
VERIFY_MIN_USD = 50_000.0

CUE_TEXT = {
    "URGENCY": "Pressure to send now",
    "SECRECY": "Told to keep it secret",
    "AUTHORITY": "Someone claiming authority (police, lawyer, IRS, bank, tech support)",
    "STORY_CHANGE": "Reason for the payment changed during the call",
    "COACHING": "A third party is steering this payment",
    "REMOTE_CONTROL": "Someone has remote access to the customer's device",
    "VERIFIED_INDEPENDENTLY": "Customer says they verified the payee on a number they already had",
    "ROUTINE_PAYEE": "Customer describes a routine, repeat payee",
    "AMOUNT_STATED": "Amount stated",
}

# One banker question per signal, in priority order (the first three that apply are shown).
_Q_ORDER = ("AUTHORITY", "IN_RING", "SECRECY", "COACHING", "REMOTE_CONTROL", "STORY_CHANGE",
            "URGENCY", "FIRST_WIRE", "VERIFY")
QUESTIONS = {
    "AUTHORITY": "Have you spoken to the person directly, on a number you already know?",
    "IN_RING": "Who gave you this account number?",
    "SECRECY": "Can we call your family member together before sending?",
    "COACHING": "Is anyone on the line with you or telling you what to say right now?",
    "REMOTE_CONTROL": "Has anyone asked you to install an app or share your screen?",
    "STORY_CHANGE": "You mentioned a different reason earlier. What exactly is this payment for?",
    "URGENCY": "What would happen if this wire went out tomorrow instead of today?",
    "FIRST_WIRE": "This is your first wire with us. How do you know the person receiving it?",
    "VERIFY": "Can we call the payee back on a number from your own paperwork to confirm the account?",
}
_Q_DEFAULT = (
    "Can you confirm the payee's name and what the payment is for?",
    "Have you sent money to this account before?",
    "Did anyone contact you first and ask for this payment?",
)


def _usd(x: float) -> str:
    return f"${x:,.0f}"


def _norm_cues(cues: list[dict] | None) -> list[dict]:
    out = []
    for c in cues or []:
        name = str(c.get("cue", "")).strip().upper()
        if name in ALL_CUES:
            out.append({"cue": name, "quote": str(c.get("quote", "")).strip()})
    return out


def decide(cues: list[dict], customer: dict, amount: float | None, payee_check: dict | None) -> dict:
    cues = _norm_cues(cues)
    customer = customer or {}
    payee_check = payee_check or {}

    # distinct cue names in first-seen order, with the first quote for each
    first_quote: dict[str, str] = {}
    for c in cues:
        first_quote.setdefault(c["cue"], c["quote"])
    high = [n for n in first_quote if n in HIGH_RISK]
    has = set(first_quote)

    prior = customer.get("prior_wires")
    first_wire = prior is not None and int(prior) == 0
    typical = customer.get("typical_monthly_outflow_usd")
    amt = float(amount) if amount is not None else None
    ratio = (amt / float(typical)) if (amt is not None and typical) else None
    in_ring = bool(payee_check.get("in_ring"))

    hold_why: list[str] = []
    if in_ring:
        hops = payee_check.get("hops")
        where = "is the hub of" if hops == 1 else "feeds"
        acct = payee_check.get("payee_account")
        payee = f"Payee {acct}" if acct else "Payee"
        hold_why.append(f"{payee} {where} ring {payee_check.get('ring_id')} found by the GPU ring finder")
    if len(high) >= 2:
        hold_why.append(f"{len(high)} high-risk cues: {', '.join(high)}")
    if first_wire and ratio is not None and ratio >= RATIO_HOLD and high:
        hold_why.append(f"First-ever wire at {ratio:.1f}x typical monthly outflow, with a high-risk cue")

    if hold_why:
        rec = "HOLD"
    elif amt is not None and amt >= VERIFY_MIN_USD and "VERIFIED_INDEPENDENTLY" in has and not high:
        rec = "VERIFY"
    else:
        rec = "NO_HOLD"

    # human-readable reasons: why this recommendation, then the supporting facts
    reasons: list[str] = list(hold_why)
    if rec == "VERIFY":
        reasons.append(f"Large amount ({_usd(amt)}) with no scam cues; customer says they verified the "
                       "account. Do a callback on a known number before release")
    if first_wire:
        tenure = customer.get("tenure_years")
        reasons.append(f"First wire in {tenure} years" if tenure else "First wire for this customer")
    if ratio is not None and ratio >= RATIO_HOLD:
        reasons.append(f"Amount {_usd(amt)} is {ratio:.1f}x typical monthly outflow ({_usd(float(typical))})")
    for name in first_quote:
        if name == "AMOUNT_STATED":
            continue
        q = first_quote[name]
        reasons.append(f"{CUE_TEXT[name]}: “{q}”" if q else CUE_TEXT[name])
    if rec == "NO_HOLD" and not reasons:
        reasons.append("No scam cues, payee not linked to any ring")
    elif rec == "NO_HOLD":
        reasons.append("Not enough risk to advise a hold")

    # banker questions chosen by signal
    signals = set(high)
    if in_ring:
        signals.add("IN_RING")
    if first_wire:
        signals.add("FIRST_WIRE")
    if rec == "VERIFY":
        signals.add("VERIFY")
    questions = [QUESTIONS[s] for s in _Q_ORDER if s in signals]
    for q in _Q_DEFAULT:
        if len(questions) >= 3:
            break
        if q not in questions:
            questions.append(q)

    return {"recommendation": rec, "reasons": reasons, "questions": questions[:3],
            "features": {"first_wire": first_wire, "amount_ratio": round(ratio, 2) if ratio is not None else None,
                         "high_risk_cues": high, "payee_in_ring": in_ring}}
