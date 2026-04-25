"""
Contract tests for Slack Block Kit message builders.

These tests compare the output of the Python message builders against
golden files that capture the exact Slack payloads produced by the
original Apps Script code. This ensures the Python port produces
identical messages.
"""

import json
from pathlib import Path

import pytest

from app.messages import (
    build_mark_done_confirmation,
    build_readthrough_confirmation,
    build_readthrough_date_prompt,
    build_reminder_blocks,
)

GOLDEN_DIR = Path(__file__).parent / "golden"


def load_golden(filename: str) -> dict:
    """Load a golden file."""
    with open(GOLDEN_DIR / filename) as f:
        return json.load(f)


# ─── Shared Context ───────────────────────────────────────────────────────────

REMINDER_CONTEXT = {
    "show_name": "Test Show",
    "task": "Submit poster for approval to Show Support representative",
    "responsible": "Producer",
    "general_rule": "6 weeks before opening (1 week before printing)",
    "deadline": "2026-05-01",
    "days_until": 5,
    "days_overdue": 0,
    "slack_channel": "show-test",
    "show_email": "test@kwlt.org",
    "resources_url": "https://example.com/resources",
    "handbook_url": "https://example.com/handbook",
    "notify_via": "both",
    "mark_done_url": "https://example.com/mark-done",
}


# ─── Reminder Block Tests ─────────────────────────────────────────────────────


class TestReminderBlocks:
    """Verify reminder message blocks match golden files."""

    @pytest.fixture
    def golden(self):
        return load_golden("reminder_blocks.json")

    def test_advance_attachments(self, golden):
        result = build_reminder_blocks(REMINDER_CONTEXT, "advance")
        assert result["attachments"] == golden["advance"]["attachments"]

    def test_advance_thread_text(self, golden):
        result = build_reminder_blocks(REMINDER_CONTEXT, "advance")
        assert result["thread_text"] == golden["advance"]["thread_text"]

    def test_urgent_attachments(self, golden):
        ctx = {**REMINDER_CONTEXT, "days_until": 1}
        result = build_reminder_blocks(ctx, "urgent")
        assert result["attachments"] == golden["urgent"]["attachments"]

    def test_urgent_thread_text(self, golden):
        ctx = {**REMINDER_CONTEXT, "days_until": 1}
        result = build_reminder_blocks(ctx, "urgent")
        assert result["thread_text"] == golden["urgent"]["thread_text"]

    def test_overdue_attachments(self, golden):
        ctx = {**REMINDER_CONTEXT, "days_until": -3, "days_overdue": 3}
        result = build_reminder_blocks(ctx, "overdue")
        assert result["attachments"] == golden["overdue"]["attachments"]

    def test_overdue_thread_text(self, golden):
        ctx = {**REMINDER_CONTEXT, "days_until": -3, "days_overdue": 3}
        result = build_reminder_blocks(ctx, "overdue")
        assert result["thread_text"] == golden["overdue"]["thread_text"]


# ─── Interaction Block Tests ──────────────────────────────────────────────────


class TestInteractionBlocks:
    """Verify interaction confirmation blocks match golden files."""

    @pytest.fixture
    def golden(self):
        return load_golden("interaction_blocks.json")

    def test_readthrough_prompt(self, golden):
        result = build_readthrough_date_prompt("Test Show")
        assert result == golden["readthrough_prompt"]

    def test_mark_done_confirmation(self, golden):
        result = build_mark_done_confirmation("Test Show", "Submit poster for approval", "<@U12345>")
        assert result == golden["mark_done_confirmation"]

    def test_readthrough_confirmation(self, golden):
        result = build_readthrough_confirmation(
            "Test Show",
            "2026-06-15",
            "<@U12345>",
            "\n2 dependent task(s) reactivated.",
        )
        assert result == golden["readthrough_confirmation"]


# ─── Action ID Format Tests ──────────────────────────────────────────────────


class TestActionIdFormat:
    """
    Verify action_id patterns match the format expected by doPost() in WebApp.gs.
    These are the contracts between the message sender and the interaction handler.
    """

    def test_mark_done_action_id_format(self):
        result = build_reminder_blocks(REMINDER_CONTEXT, "advance")
        action_id = result["attachments"][0]["blocks"][1]["elements"][0]["action_id"]
        assert action_id.startswith("mark_done:")
        # Should be: mark_done:<encoded_show>:<encoded_task>
        parts = action_id.split(":", 2)
        assert len(parts) == 3
        assert parts[0] == "mark_done"

    def test_mark_undone_action_id_format(self):
        result = build_mark_done_confirmation("Show", "Task", "User")
        action_id = result["attachments"][0]["blocks"][1]["elements"][0]["action_id"]
        assert action_id.startswith("mark_undone:")
        parts = action_id.split(":", 2)
        assert len(parts) == 3

    def test_readthrough_date_action_id_format(self):
        result = build_readthrough_date_prompt("My Show")
        action_id = result["attachments"][0]["blocks"][1]["elements"][0]["action_id"]
        assert action_id.startswith("readthrough_date:")

    def test_change_readthrough_date_action_id_format(self):
        result = build_readthrough_confirmation("Show", "2026-01-01", "User")
        action_id = result["attachments"][0]["blocks"][1]["elements"][0]["action_id"]
        assert action_id.startswith("change_readthrough_date:")

    def test_action_id_url_encodes_special_chars(self):
        """Show names with spaces and special chars must be URL-encoded in action_ids."""
        ctx = {**REMINDER_CONTEXT, "show_name": "My Show & More"}
        result = build_reminder_blocks(ctx, "advance")
        action_id = result["attachments"][0]["blocks"][1]["elements"][0]["action_id"]
        assert "My%20Show%20%26%20More" in action_id

    def test_action_id_under_255_chars(self):
        """Slack enforces a 255-char limit on action_id."""
        ctx = {**REMINDER_CONTEXT, "show_name": "A" * 100, "task": "B" * 100}
        result = build_reminder_blocks(ctx, "advance")
        action_id = result["attachments"][0]["blocks"][1]["elements"][0]["action_id"]
        assert len(action_id) <= 255


class TestOptionalTaskBlocks:
    """Verify optional task messages have the right styling and buttons."""

    def test_optional_uses_question_mark_emoji(self):
        ctx = {**REMINDER_CONTEXT, "is_optional": True}
        result = build_reminder_blocks(ctx, "advance")
        text = result["attachments"][0]["blocks"][0]["text"]["text"]
        assert "❔" in text
        assert "*Optional:*" in text

    def test_optional_uses_purple_color(self):
        ctx = {**REMINDER_CONTEXT, "is_optional": True}
        result = build_reminder_blocks(ctx, "advance")
        assert result["attachments"][0]["color"] == "#a78bfa"

    def test_optional_includes_skip_disclaimer(self):
        ctx = {**REMINDER_CONTEXT, "is_optional": True}
        result = build_reminder_blocks(ctx, "advance")
        text = result["attachments"][0]["blocks"][0]["text"]["text"]
        assert "optional" in text.lower()
        assert "skip" in text.lower()

    def test_optional_has_skip_button(self):
        ctx = {**REMINDER_CONTEXT, "is_optional": True}
        result = build_reminder_blocks(ctx, "advance")
        buttons = result["attachments"][0]["blocks"][1]["elements"]
        assert len(buttons) == 2
        assert buttons[0]["action_id"].startswith("mark_done:")
        assert buttons[1]["action_id"].startswith("skip_task:")

    def test_non_optional_has_no_skip_button(self):
        result = build_reminder_blocks(REMINDER_CONTEXT, "advance")
        buttons = result["attachments"][0]["blocks"][1]["elements"]
        assert len(buttons) == 1
        assert buttons[0]["action_id"].startswith("mark_done:")


# Note: TestColorCodes removed — colors are already verified by the golden
# file contract tests above. Duplicating them here adds maintenance burden
# without catching additional bugs.
