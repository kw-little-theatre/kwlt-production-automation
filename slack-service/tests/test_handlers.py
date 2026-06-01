"""
Tests for Slack interaction handlers.

These test the handler routing and business logic using mocked
SheetRepository and SlackClient — no real Sheets API or Slack calls.
"""

import time
from unittest.mock import MagicMock, patch
from typing import Optional

from app.handlers import handle_block_action, _DateChangeBatcher
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


class TestHandleSkipTask:
    """Tests for the Skip button interaction handler."""

    def _make_payload(self, action_id: str) -> dict:
        return {
            "type": "block_actions",
            "actions": [{"action_id": action_id}],
            "user": {"id": "U12345"},
            "channel": {"id": "C12345"},
            "response_url": "https://hooks.slack.com/actions/test",
        }

    def test_skip_success(self):
        sheets = MagicMock()
        sheets.mark_task_skipped.return_value = MarkTaskResult(success=True, message="Task skipped.")
        slack = MagicMock()

        handle_block_action("skip_task:Show:Task", self._make_payload("skip_task:Show:Task"), sheets, slack)

        sheets.mark_task_skipped.assert_called_once_with("Show", "Task")
        slack.send_response_url.assert_called_once()
        assert "skipped" in slack.send_response_url.call_args[0][1]

    def test_skip_failure(self):
        sheets = MagicMock()
        sheets.mark_task_skipped.return_value = MarkTaskResult(success=False, message="Not found.")
        slack = MagicMock()

        handle_block_action("skip_task:Show:Task", self._make_payload("skip_task:Show:Task"), sheets, slack)

        slack.send_response_url.assert_called_once()
        assert "Could not skip" in slack.send_response_url.call_args[0][1]


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


class TestDateChangeBatcher:
    """Tests for the debounced date-change notification batcher."""

    def test_single_change_sends_after_delay(self):
        """A single date change should send one notification after the delay."""
        batcher = _DateChangeBatcher()
        slack = MagicMock()

        with patch("app.handlers.settings") as mock_settings:
            mock_settings.show_support_channel = "C_SUPPORT"
            with patch("app.handlers.BATCH_DELAY", 0.1):
                batcher.add("Hamlet", "Submit poster", "2026-07-15", "<@U123>", slack)
                time.sleep(0.3)

        slack.send_message.assert_called_once()
        call_text = slack.send_message.call_args[1]["text"]
        assert "Hamlet" in call_text
        assert "Submit poster" in call_text
        assert "2026-07-15" in call_text

    def test_multiple_changes_batched_into_one_message(self):
        """Multiple rapid date changes for the same show should batch into one message."""
        batcher = _DateChangeBatcher()
        slack = MagicMock()

        with patch("app.handlers.settings") as mock_settings:
            mock_settings.show_support_channel = "C_SUPPORT"
            with patch("app.handlers.BATCH_DELAY", 0.2):
                batcher.add("Hamlet", "Submit poster", "2026-07-15", "<@U123>", slack)
                batcher.add("Hamlet", "Book audition space", "2026-07-20", "<@U123>", slack)
                batcher.add("Hamlet", "Confirm director", "2026-07-25", "<@U456>", slack)
                time.sleep(0.5)

        slack.send_message.assert_called_once()
        call_text = slack.send_message.call_args[1]["text"]
        assert "3 dates changed" in call_text
        assert "Submit poster" in call_text
        assert "Book audition space" in call_text
        assert "Confirm director" in call_text

    def test_different_shows_batch_separately(self):
        """Date changes for different shows should produce separate notifications."""
        batcher = _DateChangeBatcher()
        slack = MagicMock()

        with patch("app.handlers.settings") as mock_settings:
            mock_settings.show_support_channel = "C_SUPPORT"
            with patch("app.handlers.BATCH_DELAY", 0.1):
                batcher.add("Hamlet", "Submit poster", "2026-07-15", "<@U123>", slack)
                batcher.add("Macbeth", "Book venue", "2026-08-01", "<@U123>", slack)
                time.sleep(0.3)

        assert slack.send_message.call_count == 2

    def test_no_channel_configured_skips_send(self):
        """If show_support_channel is not set, no message should be sent."""
        batcher = _DateChangeBatcher()
        slack = MagicMock()

        with patch("app.handlers.settings") as mock_settings:
            mock_settings.show_support_channel = ""
            with patch("app.handlers.BATCH_DELAY", 0.1):
                batcher.add("Hamlet", "Submit poster", "2026-07-15", "<@U123>", slack)
                time.sleep(0.3)

        slack.send_message.assert_not_called()
