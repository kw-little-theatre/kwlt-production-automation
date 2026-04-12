"""
Tests for Slack interaction handlers.

These test the handler routing and business logic using mocked
SheetRepository and SlackClient — no real Sheets API or Slack calls.
"""

from unittest.mock import MagicMock
from typing import Optional

from app.handlers import handle_block_action
from app.models import MarkTaskResult


class TestHandleMarkDone:
    """Tests for the Mark Done button interaction handler."""

    def _make_payload(self, action_id: str, channel_id: str = "C12345") -> dict:
        return {
            "type": "block_actions",
            "actions": [{"action_id": action_id}],
            "user": {"id": "U12345", "name": "testuser"},
            "channel": {"id": channel_id},
            "response_url": "https://hooks.slack.com/actions/test",
        }

    def test_mark_done_success_sends_confirmation(self):
        """Successful mark done should send a confirmation with Undo button."""
        sheets = MagicMock()
        sheets.mark_task_done.return_value = MarkTaskResult(success=True, message="Task marked as done.")
        slack = MagicMock()

        payload = self._make_payload("mark_done:Test%20Show:Book%20extra%20audition%20days")
        handle_block_action("mark_done:Test%20Show:Book%20extra%20audition%20days", payload, sheets, slack)

        sheets.mark_task_done.assert_called_once_with("Test Show", "Book extra audition days")
        slack.send_message.assert_called_once()
        # Verify confirmation was sent to the right channel with attachments
        call_args = slack.send_message.call_args
        assert call_args[0][0] == "C12345"  # channel is first positional arg
        assert "attachments" in call_args[1]

    def test_mark_done_failure_sends_error(self):
        """Failed mark done should send error via response_url."""
        sheets = MagicMock()
        sheets.mark_task_done.return_value = MarkTaskResult(success=False, message="Task not found.")
        slack = MagicMock()

        payload = self._make_payload("mark_done:Show:Task")
        handle_block_action("mark_done:Show:Task", payload, sheets, slack)

        sheets.mark_task_done.assert_called_once_with("Show", "Task")
        slack.send_response_url.assert_called_once()
        call_args = slack.send_response_url.call_args[0]
        assert "Could not mark task done" in call_args[1]

    def test_mark_done_decodes_url_encoded_values(self):
        """Show and task names with special chars should be URL-decoded."""
        sheets = MagicMock()
        sheets.mark_task_done.return_value = MarkTaskResult(success=True, message="Done.")
        slack = MagicMock()

        payload = self._make_payload("mark_done:My%20Show%20%26%20More:Task%20with%20spaces")
        handle_block_action("mark_done:My%20Show%20%26%20More:Task%20with%20spaces", payload, sheets, slack)

        sheets.mark_task_done.assert_called_once_with("My Show & More", "Task with spaces")

    def test_mark_done_falls_back_to_response_url_without_channel(self):
        """When channel is empty, should use response_url instead of send_message."""
        sheets = MagicMock()
        sheets.mark_task_done.return_value = MarkTaskResult(success=True, message="Done.")
        slack = MagicMock()

        payload = self._make_payload("mark_done:Show:Task")
        payload["channel"] = {"id": ""}  # empty channel
        handle_block_action("mark_done:Show:Task", payload, sheets, slack)

        slack.send_message.assert_not_called()
        slack.send_response_url.assert_called_once()
        assert "marked done" in slack.send_response_url.call_args[0][1]


class TestHandleMarkUndone:
    """Tests for the Undo (Mark Undone) button interaction handler."""

    def _make_payload(self, action_id: str) -> dict:
        return {
            "type": "block_actions",
            "actions": [{"action_id": action_id}],
            "user": {"id": "U12345"},
            "channel": {"id": "C12345"},
            "response_url": "https://hooks.slack.com/actions/test",
        }

    def test_mark_undone_success(self):
        sheets = MagicMock()
        sheets.mark_task_undone.return_value = MarkTaskResult(success=True, message="Reverted.")
        slack = MagicMock()

        handle_block_action("mark_undone:Show:Task", self._make_payload("mark_undone:Show:Task"), sheets, slack)

        sheets.mark_task_undone.assert_called_once_with("Show", "Task")
        slack.send_response_url.assert_called_once()
        assert "marked undone" in slack.send_response_url.call_args[0][1]

    def test_mark_undone_failure(self):
        sheets = MagicMock()
        sheets.mark_task_undone.return_value = MarkTaskResult(success=False, message="Not found.")
        slack = MagicMock()

        handle_block_action("mark_undone:Show:Task", self._make_payload("mark_undone:Show:Task"), sheets, slack)

        slack.send_response_url.assert_called_once()
        assert "Could not undo" in slack.send_response_url.call_args[0][1]


class TestHandleReadthroughDate:
    """Tests for the readthrough date picker interaction handler."""

    def _make_payload(self, action_id: str, selected_date: Optional[str] = "2026-06-15") -> dict:
        return {
            "type": "block_actions",
            "actions": [{"action_id": action_id, "selected_date": selected_date}],
            "user": {"id": "U12345"},
            "channel": {"id": "C12345"},
            "response_url": "https://hooks.slack.com/actions/test",
        }

    def test_date_selected_sends_confirmation(self):
        sheets = MagicMock()
        slack = MagicMock()

        payload = self._make_payload("readthrough_date:Test%20Show", "2026-06-15")
        handle_block_action("readthrough_date:Test%20Show", payload, sheets, slack)

        slack.send_message.assert_called_once()
        call_args = slack.send_message.call_args
        assert call_args[0][0] == "C12345"  # channel is first positional arg

    def test_no_date_sends_error(self):
        sheets = MagicMock()
        slack = MagicMock()

        payload = self._make_payload("readthrough_date:Show", selected_date=None)
        handle_block_action("readthrough_date:Show", payload, sheets, slack)

        slack.send_response_url.assert_called_once()
        assert "No date selected" in slack.send_response_url.call_args[0][1]


class TestHandleChangeReadthroughDate:
    """Tests for the Change Date button handler."""

    def test_posts_new_date_picker(self):
        sheets = MagicMock()
        slack = MagicMock()

        payload = {
            "type": "block_actions",
            "actions": [{"action_id": "change_readthrough_date:Show"}],
            "user": {"id": "U12345"},
            "channel": {"id": "C12345"},
            "response_url": "https://hooks.slack.com/actions/test",
        }
        handle_block_action("change_readthrough_date:Show", payload, sheets, slack)

        # Should send a date picker message to the channel
        slack.send_message.assert_called_once()
        # Should also send ephemeral guidance via response_url
        slack.send_response_url.assert_called_once()


class TestActionIdRouting:
    """Tests for action_id routing and edge cases."""

    def test_unknown_action_id_does_not_crash(self):
        sheets = MagicMock()
        slack = MagicMock()

        payload = {
            "type": "block_actions",
            "actions": [{"action_id": "something_unknown:data"}],
            "user": {"id": "U12345"},
            "channel": {"id": "C12345"},
            "response_url": "",
        }
        # Should not raise
        handle_block_action("something_unknown:data", payload, sheets, slack)

        sheets.mark_task_done.assert_not_called()
        sheets.mark_task_undone.assert_not_called()

    def test_malformed_action_id_without_task_separator(self):
        """action_id like 'mark_done:ShowNameOnly' (missing :task) should not crash."""
        sheets = MagicMock()
        slack = MagicMock()

        payload = {
            "type": "block_actions",
            "actions": [{"action_id": "mark_done:ShowNameOnly"}],
            "user": {"id": "U12345"},
            "channel": {"id": "C12345"},
            "response_url": "https://hooks.slack.com/test",
        }
        # Should not raise — the handler should catch the ValueError
        handle_block_action("mark_done:ShowNameOnly", payload, sheets, slack)
        sheets.mark_task_done.assert_not_called()
