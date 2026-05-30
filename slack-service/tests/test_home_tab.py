"""
Tests for the App Home Tab feature.

Covers:
  - Home tab view builders (select show, full dashboard)
  - app_home_opened event handler
  - Home tab interaction handlers (select show, mark done, change date, refresh)
  - Sheet methods: get_all_active_shows, get_all_tasks, update_task_date
"""

from unittest.mock import MagicMock, patch
from urllib.parse import quote

import pytest

from app.handlers import handle_block_action, handle_event
from app.messages import (
    _build_home_task_row,
    _is_valid_date,
    build_home_tab,
    build_home_tab_select_show,
)


# ─── View Builder Tests ──────────────────────────────────────────────────────


class TestBuildHomeTabSelectShow:
    """Tests for build_home_tab_select_show()."""

    def test_has_home_type(self):
        view = build_home_tab_select_show([{"show_name": "Hamlet", "slack_channel": "#hamlet"}])
        assert view["type"] == "home"

    def test_contains_header(self):
        view = build_home_tab_select_show([])
        blocks = view["blocks"]
        headers = [b for b in blocks if b["type"] == "header"]
        assert len(headers) >= 1
        assert "KWLT" in headers[0]["text"]["text"] or "Show Support" in headers[0]["text"]["text"]

    def test_shows_dropdown_with_shows(self):
        shows = [
            {"show_name": "Hamlet", "slack_channel": "#hamlet"},
            {"show_name": "Macbeth", "slack_channel": "#macbeth"},
        ]
        view = build_home_tab_select_show(shows)
        actions = [b for b in view["blocks"] if b["type"] == "actions"]
        assert len(actions) == 1
        select = actions[0]["elements"][0]
        assert select["type"] == "static_select"
        assert select["action_id"] == "home_select_show"
        assert len(select["options"]) == 2

    def test_no_shows_message(self):
        view = build_home_tab_select_show([])
        texts = [b["text"]["text"] for b in view["blocks"] if b["type"] == "section"]
        assert any("no shows" in t.lower() for t in texts)


class TestBuildHomeTab:
    """Tests for build_home_tab() — the full dashboard view."""

    SHOWS = [
        {"show_name": "Hamlet", "slack_channel": "#hamlet"},
        {"show_name": "Macbeth", "slack_channel": "#macbeth"},
    ]

    TASK_GROUPS = {
        "overdue": [
            {"task": "Submit poster", "responsible": "Producer", "deadline": "2026-05-20", "status": "Pending"},
        ],
        "due_soon": [
            {"task": "Book days", "responsible": "Director", "deadline": "2026-06-02", "status": "Pending"},
        ],
        "upcoming": [
            {"task": "Get keys", "responsible": "SM", "deadline": "2026-07-01", "status": "Pending"},
        ],
        "completed": [
            {"task": "Rights check", "responsible": "Producer", "deadline": "2026-04-01", "status": "Done"},
        ],
    }

    def test_has_home_type(self):
        view = build_home_tab("Hamlet", self.TASK_GROUPS, self.SHOWS)
        assert view["type"] == "home"

    def test_stores_show_in_private_metadata(self):
        view = build_home_tab("Hamlet", self.TASK_GROUPS, self.SHOWS)
        assert view["private_metadata"] == "Hamlet"

    def test_contains_show_selector(self):
        view = build_home_tab("Hamlet", self.TASK_GROUPS, self.SHOWS)
        actions = [b for b in view["blocks"] if b["type"] == "actions"]
        assert len(actions) >= 1
        elements = actions[0]["elements"]
        select = next(e for e in elements if e["type"] == "static_select")
        assert select["action_id"] == "home_select_show"

    def test_contains_refresh_button(self):
        view = build_home_tab("Hamlet", self.TASK_GROUPS, self.SHOWS)
        actions = [b for b in view["blocks"] if b["type"] == "actions"]
        buttons = [e for a in actions for e in a["elements"] if e["type"] == "button"]
        refresh = [b for b in buttons if b["action_id"].startswith("home_refresh:")]
        assert len(refresh) == 1

    def test_contains_urgency_section_headers(self):
        view = build_home_tab("Hamlet", self.TASK_GROUPS, self.SHOWS)
        headers = [b["text"]["text"] for b in view["blocks"] if b["type"] == "header"]
        header_text = " ".join(headers).lower()
        assert "overdue" in header_text
        assert "due soon" in header_text
        assert "upcoming" in header_text
        assert "completed" in header_text

    def test_pending_tasks_have_done_button(self):
        view = build_home_tab("Hamlet", self.TASK_GROUPS, self.SHOWS)
        action_blocks = [b for b in view["blocks"] if b["type"] == "actions"]
        done_buttons = [
            e for a in action_blocks for e in a["elements"]
            if e.get("type") == "button" and e.get("action_id", "").startswith("home_mark_done:")
        ]
        # 3 pending tasks = 3 done buttons
        assert len(done_buttons) == 3

    def test_pending_tasks_have_date_picker(self):
        view = build_home_tab("Hamlet", self.TASK_GROUPS, self.SHOWS)
        sections_with_datepicker = [
            b for b in view["blocks"]
            if b["type"] == "section" and b.get("accessory", {}).get("type") == "datepicker"
        ]
        assert len(sections_with_datepicker) == 3

    def test_completed_tasks_no_buttons(self):
        view = build_home_tab("Hamlet", self.TASK_GROUPS, self.SHOWS)
        action_blocks = [b for b in view["blocks"] if b["type"] == "actions"]
        done_actions = [
            e for a in action_blocks for e in a["elements"]
            if e.get("action_id", "").startswith("home_mark_done:")
        ]
        # Only pending tasks get buttons, not completed ones
        for btn in done_actions:
            assert "Rights check" not in btn["action_id"]

    def test_empty_groups(self):
        empty = {"overdue": [], "due_soon": [], "upcoming": [], "completed": []}
        view = build_home_tab("Hamlet", empty, self.SHOWS)
        texts = [b["text"]["text"] for b in view["blocks"] if b["type"] == "section"]
        assert any("no tasks" in t.lower() for t in texts)

    def test_under_100_blocks(self):
        """View must stay under Slack's 100-block limit."""
        view = build_home_tab("Hamlet", self.TASK_GROUPS, self.SHOWS)
        assert len(view["blocks"]) <= 100


class TestBuildHomeTaskRow:
    """Tests for _build_home_task_row() helper."""

    def test_pending_task_returns_two_blocks(self):
        task = {"task": "Submit poster", "responsible": "Producer", "deadline": "2026-06-01", "status": "Pending"}
        blocks = _build_home_task_row("Hamlet", task, is_completed=False)
        assert len(blocks) == 2
        assert blocks[0]["type"] == "section"
        assert blocks[1]["type"] == "actions"

    def test_completed_task_returns_one_block(self):
        task = {"task": "Rights check", "responsible": "Producer", "deadline": "2026-04-01", "status": "Done"}
        blocks = _build_home_task_row("Hamlet", task, is_completed=True)
        assert len(blocks) == 1
        assert blocks[0]["type"] == "section"
        # Should have strikethrough
        assert "~" in blocks[0]["text"]["text"]

    def test_datepicker_has_initial_date_for_valid_date(self):
        task = {"task": "Submit", "responsible": "P", "deadline": "2026-06-01", "status": "Pending"}
        blocks = _build_home_task_row("Hamlet", task, is_completed=False)
        datepicker = blocks[0]["accessory"]
        assert datepicker["initial_date"] == "2026-06-01"

    def test_datepicker_no_initial_for_invalid_date(self):
        task = {"task": "Submit", "responsible": "P", "deadline": "6/1/2026", "status": "Pending"}
        blocks = _build_home_task_row("Hamlet", task, is_completed=False)
        datepicker = blocks[0]["accessory"]
        assert "initial_date" not in datepicker


class TestIsValidDate:
    def test_valid(self):
        assert _is_valid_date("2026-06-01") is True

    def test_invalid_format(self):
        assert _is_valid_date("6/1/2026") is False
        assert _is_valid_date("") is False
        assert _is_valid_date("No date") is False


# ─── Event Handler Tests ─────────────────────────────────────────────────────


class TestAppHomeOpenedHandler:
    """Tests for the app_home_opened event handler."""

    def test_first_visit_shows_selector(self):
        """First visit (no previous view) shows the show selector."""
        sheets = MagicMock()
        sheets.get_all_active_shows.return_value = [
            {"show_name": "Hamlet", "slack_channel": "#hamlet"},
        ]
        slack = MagicMock()

        event_body = {
            "event": {
                "type": "app_home_opened",
                "user": "U12345",
                "tab": "home",
            }
        }
        handle_event(event_body, sheets, slack)

        slack.publish_home_tab.assert_called_once()
        view = slack.publish_home_tab.call_args[0][1]
        assert view["type"] == "home"
        # No private_metadata on first visit
        assert "private_metadata" not in view or not view.get("private_metadata")

    def test_return_visit_shows_dashboard(self):
        """Return visit with a previously selected show shows the full dashboard."""
        sheets = MagicMock()
        sheets.get_all_active_shows.return_value = [{"show_name": "Hamlet", "slack_channel": "#hamlet"}]
        sheets.get_all_tasks.return_value = {
            "overdue": [], "due_soon": [], "upcoming": [], "completed": [],
        }
        slack = MagicMock()

        event_body = {
            "event": {
                "type": "app_home_opened",
                "user": "U12345",
                "tab": "home",
                "view": {"private_metadata": "Hamlet"},
            }
        }
        handle_event(event_body, sheets, slack)

        sheets.get_all_tasks.assert_called_once_with("Hamlet")
        slack.publish_home_tab.assert_called_once()
        view = slack.publish_home_tab.call_args[0][1]
        assert view["private_metadata"] == "Hamlet"

    def test_messages_tab_ignored(self):
        """The 'messages' tab should not trigger a Home tab publish."""
        sheets = MagicMock()
        slack = MagicMock()

        event_body = {
            "event": {
                "type": "app_home_opened",
                "user": "U12345",
                "tab": "messages",
            }
        }
        handle_event(event_body, sheets, slack)
        slack.publish_home_tab.assert_not_called()

    def test_sheet_error_doesnt_crash(self):
        """Sheet errors should be handled gracefully."""
        sheets = MagicMock()
        sheets.get_all_active_shows.side_effect = Exception("Sheet unavailable")
        slack = MagicMock()

        event_body = {
            "event": {
                "type": "app_home_opened",
                "user": "U12345",
                "tab": "home",
            }
        }
        handle_event(event_body, sheets, slack)
        # Should still publish something (empty show list)
        slack.publish_home_tab.assert_called_once()


# ─── Interaction Handler Tests ────────────────────────────────────────────────


class TestHomeTabInteractions:
    """Tests for Home tab block_actions handlers."""

    def _make_payload(self, action_id, user_id="U12345", **extra):
        payload = {
            "type": "block_actions",
            "actions": [{"action_id": action_id, **extra}],
            "user": {"id": user_id},
            "channel": {"id": ""},
            "response_url": "",
        }
        return payload

    def test_select_show_refreshes_home(self):
        sheets = MagicMock()
        sheets.get_all_active_shows.return_value = [{"show_name": "Hamlet", "slack_channel": "#hamlet"}]
        sheets.get_all_tasks.return_value = {"overdue": [], "due_soon": [], "upcoming": [], "completed": []}
        slack = MagicMock()

        payload = self._make_payload(
            "home_select_show",
            selected_option={"value": "Hamlet"},
        )
        handle_block_action("home_select_show", payload, sheets, slack)

        sheets.get_all_tasks.assert_called_once_with("Hamlet")
        slack.publish_home_tab.assert_called_once()

    def test_home_mark_done_updates_and_refreshes(self):
        sheets = MagicMock()
        from app.models import MarkTaskResult
        sheets.mark_task_done.return_value = MarkTaskResult(success=True, message="Done.")
        sheets.get_all_active_shows.return_value = [{"show_name": "Hamlet", "slack_channel": "#hamlet"}]
        sheets.get_all_tasks.return_value = {"overdue": [], "due_soon": [], "upcoming": [], "completed": []}
        slack = MagicMock()

        action_id = f"home_mark_done:{quote('Hamlet')}:{quote('Submit poster')}"
        payload = self._make_payload(action_id)
        handle_block_action(action_id, payload, sheets, slack)

        sheets.mark_task_done.assert_called_once_with("Hamlet", "Submit poster")
        slack.publish_home_tab.assert_called_once()

    def test_home_change_date_updates_and_refreshes(self):
        sheets = MagicMock()
        from app.models import MarkTaskResult
        sheets.update_task_date.return_value = MarkTaskResult(success=True, message="Updated.")
        sheets.get_all_active_shows.return_value = [{"show_name": "Hamlet", "slack_channel": "#hamlet"}]
        sheets.get_all_tasks.return_value = {"overdue": [], "due_soon": [], "upcoming": [], "completed": []}
        slack = MagicMock()

        action_id = f"home_change_date:{quote('Hamlet')}:{quote('Submit poster')}"
        payload = self._make_payload(action_id, selected_date="2026-07-15")
        handle_block_action(action_id, payload, sheets, slack)

        sheets.update_task_date.assert_called_once_with("Hamlet", "Submit poster", "2026-07-15")
        slack.publish_home_tab.assert_called_once()

    def test_home_change_date_no_date_does_nothing(self):
        """If no date is selected (e.g. date picker cleared), don't update."""
        sheets = MagicMock()
        slack = MagicMock()

        action_id = f"home_change_date:{quote('Hamlet')}:{quote('Submit poster')}"
        payload = self._make_payload(action_id, selected_date=None)
        handle_block_action(action_id, payload, sheets, slack)

        sheets.update_task_date.assert_not_called()

    def test_home_refresh_refreshes_tab(self):
        sheets = MagicMock()
        sheets.get_all_active_shows.return_value = [{"show_name": "Hamlet", "slack_channel": "#hamlet"}]
        sheets.get_all_tasks.return_value = {"overdue": [], "due_soon": [], "upcoming": [], "completed": []}
        slack = MagicMock()

        action_id = f"home_refresh:{quote('Hamlet')}"
        payload = self._make_payload(action_id)
        handle_block_action(action_id, payload, sheets, slack)

        sheets.get_all_tasks.assert_called_once_with("Hamlet")
        slack.publish_home_tab.assert_called_once()
