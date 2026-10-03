"""Notifier: content-free sanitizer, dedupe, fallback labelling. No network, no Mongo, no nemoclaw."""
from __future__ import annotations

import pytest

from backend import notifier


@pytest.fixture(autouse=True)
def isolate(monkeypatch):
    monkeypatch.setattr(notifier, "_scenario_names", lambda: {"Margaret"})
    monkeypatch.setattr(notifier, "_count_success", lambda: None)
    monkeypatch.setattr(notifier, "_channels", lambda: [("telegram", "111"), ("slack", "C123")])
    notifier._seen.clear()
    notifier._recent.clear()


@pytest.mark.parametrize("text", [
    "Ring R-102 escalated — SAR draft ready for analyst review",
    "Ring R-102: SAR approved by analyst",
    "Ring R-007: SAR rejected by analyst",
    "Call 0412: HOLD advised",
])
def test_templates_pass_unchanged(text):
    assert notifier.sanitize(text) == text
    assert notifier.is_clean(text)


@pytest.mark.parametrize("dirty,leak", [
    ("Ring R-102: $9,524.21 moved", "9,524"),
    ("Ring R-102 total 22,614.21 USD", "22,614"),
    ("Wire of 45000 dollars held", "45000"),
    ("Wire of $45k held", "45"),
    ("Payee 802225A40 is in ring R-102", "802225A40"),
    ("Account 800737690 flagged", "800737690"),
    ("Txn T123456 cited", "T123456"),
    ("Call from Margaret Thompson: HOLD advised", "Thompson"),
    ("Margaret called again", "Margaret"),
    ("Mrs. Okafor wants to wire", "Okafor"),
    ("Reach me at jane.doe@example.com", "jane.doe"),
    ("Callback +1 (617) 555-0142", "555"),
    ("Amount 1,000.00 Euro", "1,000"),
])
def test_content_stripped(dirty, leak):
    out = notifier.sanitize(dirty)
    assert leak not in out, out
    assert not notifier.is_clean(dirty)


def test_sanitize_idempotent():
    s = notifier.sanitize("Margaret Thompson sent $9,524.21 to 802225A40")
    assert notifier.sanitize(s) == s


def test_openclaw_primary(monkeypatch):
    monkeypatch.setenv("TW_NOTIFY_MODE", "auto")
    monkeypatch.setattr(notifier, "_send_openclaw", lambda c, t, x: (True, "exit 0"))
    monkeypatch.setattr(notifier, "_send_direct", lambda c, t, x: pytest.fail("no fallback expected"))
    res = notifier.deliver("Ring R-1: SAR approved by analyst", "sar")
    assert [(r["channel"], r["path"], r["ok"]) for r in res] == [("telegram", "openclaw", True),
                                                                ("slack", "openclaw", True)]


def test_fallback_is_labelled(monkeypatch):
    monkeypatch.setenv("TW_NOTIFY_MODE", "auto")
    monkeypatch.setattr(notifier, "_send_openclaw", lambda c, t, x: (False, "exit 1"))
    monkeypatch.setattr(notifier, "_send_direct", lambda c, t, x: (c == "telegram", "HTTP 200 ok"))
    res = notifier.deliver("Ring R-1: SAR approved by analyst", "sar")
    assert res[0]["path"] == "direct-fallback" and res[0]["ok"]
    assert res[1]["path"] == "direct-fallback" and not res[1]["ok"]


def test_direct_mode_skips_openclaw(monkeypatch):
    monkeypatch.setenv("TW_NOTIFY_MODE", "direct")
    monkeypatch.setattr(notifier, "_send_openclaw", lambda c, t, x: pytest.fail("openclaw must be skipped"))
    monkeypatch.setattr(notifier, "_send_direct", lambda c, t, x: (True, "HTTP 200 ok"))
    assert all(r["path"] == "direct-fallback" for r in notifier.deliver("Ring R-1 flagged", "ring"))


def test_notify_dedupes_and_does_not_block(monkeypatch):
    sent = []
    monkeypatch.setattr(notifier, "deliver", lambda text, kind: sent.append(text) or [])
    a = notifier.notify("Ring R-5 escalated — SAR draft ready for analyst review", kind="ring")
    b = notifier.notify("Ring R-5 escalated — SAR draft ready for analyst review", kind="ring")
    assert a["queued"] and not a["deduped"]
    assert b["deduped"] and not b["queued"]


def test_notify_sends_sanitized_text(monkeypatch):
    monkeypatch.setattr(notifier, "deliver", lambda text, kind: [{"text": text}])
    r = notifier.notify("Ring R-9: $5,000.00 from 802225A40", kind="ring", wait=True)
    assert r["sanitized"] and "5,000" not in r["text"] and "802225A40" not in r["text"]


def test_cmd_template_keeps_message_as_one_arg(monkeypatch):
    monkeypatch.delenv("TW_NOTIFY_CMD_TEMPLATE", raising=False)
    cmd = notifier._openclaw_cmd("telegram", "111", "Ring R-1: SAR approved by analyst")
    i = cmd.index("-m")
    assert cmd[i + 1] == "Reply with exactly this text and nothing else: Ring R-1: SAR approved by analyst"
    assert cmd[cmd.index("--reply-channel") + 1] == "telegram"
    assert cmd[cmd.index("--reply-to") + 1] == "111"
    assert "--deliver" in cmd


def test_cmd_template_override(monkeypatch):
    monkeypatch.setenv("TW_NOTIFY_CMD_TEMPLATE",
                       "{nemoclaw} {sandbox} exec -- openclaw message send --channel {channel} "
                       "--target {target} --message {text}")
    cmd = notifier._openclaw_cmd("telegram", "111", "Call 0412: HOLD advised")
    assert cmd[-2:] == ["--message", "Call 0412: HOLD advised"]
