"""
Tests for _determineAction() and _statusAfterAction() — the core reminder
decision engine. These are the most critical pure functions to get right.

Port verification: Each test case mirrors the behavior of the original
JavaScript functions in ReminderEngine.gs.
"""

import pytest

from app.constants import STATUS
from app.reminder_logic import determine_action, status_after_action


class TestDetermineAction:
    """Tests for determine_action() — port of _determineAction()."""

    # ── Advance Reminder Tests ─────────────────────────────────────────

    def test_advance_fires_at_7_days(self):
        """Advance reminder fires when exactly at advance_days threshold."""
        assert determine_action(7, STATUS.PENDING) == "advance"

    def test_advance_fires_at_5_days(self):
        """Advance fires for any day between advance and urgent thresholds."""
        assert determine_action(5, STATUS.PENDING) == "advance"

    def test_advance_fires_at_3_days(self):
        assert determine_action(3, STATUS.PENDING) == "advance"

    def test_advance_does_not_fire_at_8_days(self):
        """No action when deadline is far away."""
        assert determine_action(8, STATUS.PENDING) is None

    def test_advance_does_not_fire_at_30_days(self):
        assert determine_action(30, STATUS.PENDING) is None

    def test_advance_does_not_fire_if_already_sent(self):
        """Don't resend advance if status shows it was already sent."""
        assert determine_action(5, STATUS.ADVANCE_SENT) is None

    def test_advance_does_not_fire_if_urgent_sent(self):
        """Skip advance if we've already escalated to urgent."""
        assert determine_action(5, STATUS.URGENT_SENT) is None

    # ── Urgent Reminder Tests ──────────────────────────────────────────

    def test_urgent_fires_at_1_day(self):
        """Urgent fires at exactly urgent_days threshold."""
        assert determine_action(1, STATUS.PENDING) == "urgent"

    def test_urgent_fires_at_0_days(self):
        """Urgent fires on the deadline day itself."""
        assert determine_action(0, STATUS.PENDING) == "urgent"

    def test_urgent_fires_at_minus_1_day(self):
        """Urgent fires at 1 day overdue (before escalation threshold)."""
        assert determine_action(-1, STATUS.PENDING) == "urgent"

    def test_urgent_fires_when_advance_already_sent(self):
        """Urgent should fire even if advance was already sent."""
        assert determine_action(1, STATUS.ADVANCE_SENT) == "urgent"

    def test_urgent_does_not_fire_if_already_sent(self):
        """Don't resend urgent."""
        assert determine_action(0, STATUS.URGENT_SENT) is None

    def test_urgent_does_not_fire_at_2_days(self):
        """2 days remaining should be advance, not urgent."""
        assert determine_action(2, STATUS.PENDING) == "advance"

    # ── Overdue Escalation Tests ───────────────────────────────────────

    def test_overdue_fires_at_minus_2_days(self):
        """Overdue escalation fires at exactly overdue_days threshold."""
        assert determine_action(-2, STATUS.PENDING) == "overdue"

    def test_overdue_fires_at_minus_5_days(self):
        """Overdue fires for any day past the threshold."""
        assert determine_action(-5, STATUS.PENDING) == "overdue"

    def test_overdue_fires_at_minus_2_from_urgent(self):
        """Overdue fires even if urgent was already sent."""
        assert determine_action(-2, STATUS.URGENT_SENT) == "overdue"

    def test_overdue_fires_at_minus_2_from_advance(self):
        """Overdue fires even if only advance was sent."""
        assert determine_action(-2, STATUS.ADVANCE_SENT) == "overdue"

    def test_overdue_does_not_fire_if_already_escalated(self):
        """Don't re-escalate if already overdue."""
        assert determine_action(-5, STATUS.OVERDUE) is None

    # ── No Action Tests ────────────────────────────────────────────────

    def test_no_action_for_done_task(self):
        """Done tasks should never get any action."""
        assert determine_action(5, STATUS.DONE) is None

    def test_no_action_for_skipped_task(self):
        """Skipped tasks should never get any action."""
        # Note: In the actual engine, skipped tasks are filtered before
        # calling determine_action. But the function should return None
        # for advance (since status != PENDING).
        assert determine_action(5, STATUS.SKIPPED) is None

    def test_no_action_far_future(self):
        assert determine_action(100, STATUS.PENDING) is None

    # ── Custom Config Values ───────────────────────────────────────────

    def test_custom_advance_days(self):
        """Custom advance_days config changes the threshold."""
        assert determine_action(14, STATUS.PENDING, advance_days=14) == "advance"
        assert determine_action(14, STATUS.PENDING, advance_days=7) is None

    def test_custom_urgent_days(self):
        """Custom urgent_days config changes the threshold."""
        assert determine_action(3, STATUS.PENDING, urgent_days=3) == "urgent"
        assert determine_action(3, STATUS.PENDING, urgent_days=1) == "advance"

    def test_custom_overdue_days(self):
        """Custom overdue_days config changes the threshold."""
        assert determine_action(-3, STATUS.PENDING, overdue_days=3) == "overdue"
        assert determine_action(-3, STATUS.PENDING, overdue_days=5) == "urgent"

    # ── Boundary Conditions ────────────────────────────────────────────

    def test_boundary_between_advance_and_urgent(self):
        """At exactly urgent_days+1, should be advance (not urgent)."""
        assert determine_action(2, STATUS.PENDING) == "advance"

    def test_boundary_between_urgent_and_overdue(self):
        """At exactly -overdue_days+1, should be urgent (not overdue)."""
        assert determine_action(-1, STATUS.PENDING) == "urgent"


class TestStatusAfterAction:
    """Tests for status_after_action() — port of _statusAfterAction().

    Note: This is a simple dict lookup, but we keep one parametrized test
    as a cross-language contract — if the mapping changes in the JS version,
    this should be updated to match.
    """

    @pytest.mark.parametrize(
        "action,expected",
        [
            ("advance", STATUS.ADVANCE_SENT),
            ("urgent", STATUS.URGENT_SENT),
            ("overdue", STATUS.OVERDUE),
            ("unknown", STATUS.PENDING),
        ],
    )
    def test_action_to_status_mapping(self, action, expected):
        assert status_after_action(action) == expected
