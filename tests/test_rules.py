"""rules.decide on all 10 scripted calls (data/scenario/call_scripts.md), given the cues an extractor should find.

Quotes are taken from the Parakeet CPU transcripts (data/demo-audio/parakeet_cpu_transcripts.txt).
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest

from backend.rules import decide

MARGARET = {"name": "Margaret Doyle (fictional)", "age": 78, "tenure_years": 31,
            "typical_monthly_outflow_usd": 2600, "prior_wires": 0}
DAVID = {"name": "David Okafor (fictional)", "age": 34, "tenure_years": None,
         "typical_monthly_outflow_usd": 2100, "prior_wires": 8}
GENERIC = {"tenure_years": 10, "prior_wires": 3, "typical_monthly_outflow_usd": 3000}

RING = {"in_ring": True, "ring_id": "R-102", "hops": 2, "payee_account": "802225A40",
        "path": ["TW-MARG-0001", "802225A40", "8041F18B0"]}
CLEAN = {"in_ring": False, "ring_id": None, "hops": None, "path": []}


def c(*pairs):
    return [{"cue": a, "quote": b} for a, b in pairs]


CASES = [
    ("CALL-01", MARGARET, 40000, RING, c(
        ("URGENCY", "I need to send a wire today."),
        ("AUTHORITY", "the lawyer says the bail has to be paid today"),
        ("STORY_CHANGE", "It is for a renovation."),
        ("SECRECY", "The lawyer said not to tell anyone in the family"),
        ("AMOUNT_STATED", "$40,000")), "HOLD"),
    ("CALL-02", DAVID, 2100, CLEAN, c(
        ("ROUTINE_PAYEE", "same as every month"), ("AMOUNT_STATED", "$2,100")), "NO_HOLD"),
    ("CALL-03", GENERIC, 12000, CLEAN, c(
        ("AUTHORITY", "Microsoft Support said they refunded me too much"),
        ("URGENCY", "I have to wire back $12,000 today"),
        ("COACHING", "They are staying on the line with me.")), "HOLD"),
    ("CALL-04", GENERIC, 25000, CLEAN, c(
        ("COACHING", "My friend Daniel from the dating site is stuck overseas"),
        ("SECRECY", "Please do not tell my son.")), "HOLD"),
    ("CALL-05", GENERIC, 60000, CLEAN, c(
        ("AUTHORITY", "Your fraud department called me"),
        ("COACHING", "a safe account they gave me")), "HOLD"),
    ("CALL-06", GENERIC, 9800, CLEAN, c(("ROUTINE_PAYEE", "same as last semester")), "NO_HOLD"),
    ("CALL-07", GENERIC, 18500, CLEAN, c(("AMOUNT_STATED", "$18,500")), "NO_HOLD"),
    ("CALL-08", GENERIC, 85000, CLEAN, c(
        ("VERIFIED_INDEPENDENTLY", "I confirmed the account number by calling their office number from our contract")),
     "VERIFY"),
    ("CALL-09", GENERIC, 3000, CLEAN, c(("ROUTINE_PAYEE", "the one I always use")), "NO_HOLD"),
    ("CALL-10", GENERIC, 8000, CLEAN, c(
        ("AUTHORITY", "The IRS agent said I will be arrested tonight"),
        ("URGENCY", "arrested tonight unless I pay"),
        ("COACHING", "He is waiting on the other line.")), "HOLD"),
]


@pytest.mark.parametrize("cid,customer,amount,payee,cues,expected", CASES, ids=[x[0] for x in CASES])
def test_scripted_calls(cid, customer, amount, payee, cues, expected):
    out = decide(cues, customer, amount, payee)
    assert out["recommendation"] == expected, out
    assert len(out["questions"]) == 3
    assert out["reasons"]


def test_margaret_holds_on_ring_alone():
    assert decide([], MARGARET, 40000, RING)["recommendation"] == "HOLD"


def test_margaret_holds_without_ring_or_secrecy():
    # ASR dropped the secrecy sentence in a single long pass (E-006); still HOLD on the other cues
    cues = c(("URGENCY", "today"), ("STORY_CHANGE", "It is for a renovation."))
    assert decide(cues, MARGARET, 40000, CLEAN)["recommendation"] == "HOLD"


def test_first_wire_big_ratio_one_cue_holds():
    out = decide(c(("URGENCY", "today")), MARGARET, 40000, CLEAN)
    assert out["recommendation"] == "HOLD"
    assert any("First-ever wire" in r for r in out["reasons"])


def test_one_cue_not_first_wire_no_hold():
    assert decide(c(("URGENCY", "today")), GENERIC, 40000, CLEAN)["recommendation"] == "NO_HOLD"


def test_duplicate_cue_counts_once():
    cues = c(("URGENCY", "today"), ("URGENCY", "right now"), ("URGENCY", "urgent"))
    assert decide(cues, GENERIC, 5000, CLEAN)["recommendation"] == "NO_HOLD"


def test_verify_blocked_by_high_risk_cue():
    cues = c(("VERIFIED_INDEPENDENTLY", "I called their office"), ("URGENCY", "today"))
    assert decide(cues, GENERIC, 85000, CLEAN)["recommendation"] == "NO_HOLD"


def test_verify_needs_large_amount():
    cues = c(("VERIFIED_INDEPENDENTLY", "I called their office"))
    assert decide(cues, GENERIC, 49999, CLEAN)["recommendation"] == "NO_HOLD"


def test_unknown_cues_ignored_and_missing_amount_ok():
    out = decide([{"cue": "MADE_UP", "quote": "x"}, {"cue": "urgency", "quote": "now"}], {}, None, None)
    assert out["recommendation"] == "NO_HOLD"
    assert out["features"]["high_risk_cues"] == ["URGENCY"]


def test_margaret_questions_match_script():
    out = decide(CASES[0][4], MARGARET, 40000, RING)
    assert out["questions"] == [
        "Have you spoken to the person directly, on a number you already know?",
        "Who gave you this account number?",
        "Can we call your family member together before sending?",
    ]


def test_deterministic():
    a = decide(CASES[2][4], GENERIC, 12000, CLEAN)
    b = decide(CASES[2][4], GENERIC, 12000, CLEAN)
    assert a == b
