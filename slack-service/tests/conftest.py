"""
Shared test fixtures for KWLT Slack Service tests.
"""

import pytest


@pytest.fixture
def sample_context():
    """A standard task context for testing, matching the golden files."""
    return {
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


@pytest.fixture
def overdue_context(sample_context):
    """A context for an overdue task."""
    return {
        **sample_context,
        "days_until": -3,
        "days_overdue": 3,
    }


@pytest.fixture
def urgent_context(sample_context):
    """A context for an urgent task."""
    return {
        **sample_context,
        "days_until": 1,
        "days_overdue": 0,
    }
