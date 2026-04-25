"""
Endpoint-level tests using FastAPI TestClient.

These test the HTTP layer: signature verification, payload parsing,
response codes, and HTML responses — without hitting real Sheets/Slack.
"""

import json
import time
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.main import app
from app.models import MarkTaskResult

client = TestClient(app)


class TestHealthEndpoint:
    def test_health_returns_ok(self):
        response = client.get("/health")
        assert response.status_code == 200
        assert response.json() == {"status": "ok"}


class TestMarkDoneEndpoint:
    """Tests for GET /mark-done (email Mark Done links)."""

    @patch("app.main._get_sheets")
    @patch("app.main.settings")
    def test_valid_token_marks_done(self, mock_settings, mock_get_sheets):
        mock_settings.spreadsheet_id = "test-spreadsheet"
        mock_sheets = MagicMock()
        mock_sheets.mark_task_done.return_value = MarkTaskResult(success=True, message="Done.")
        mock_get_sheets.return_value = mock_sheets

        # Generate valid token
        from app.reminder_logic import generate_token
        token = generate_token("test-spreadsheet", "Hamlet", "Book days")

        response = client.get(f"/mark-done?action=done&show=Hamlet&task=Book+days&token={token}")
        assert response.status_code == 200
        assert "Task Marked Done" in response.text
        mock_sheets.mark_task_done.assert_called_once_with("Hamlet", "Book days")

    @patch("app.main.settings")
    def test_invalid_token_rejected(self, mock_settings):
        mock_settings.spreadsheet_id = "test-spreadsheet"

        response = client.get("/mark-done?action=done&show=Hamlet&task=Book+days&token=badtoken1234")
        assert response.status_code == 200  # HTML response, not 401
        assert "Invalid Token" in response.text

    def test_missing_params_rejected(self):
        response = client.get("/mark-done?action=done&show=Hamlet")
        assert response.status_code == 200
        assert "Invalid Request" in response.text

    @patch("app.main._get_sheets")
    @patch("app.main.settings")
    def test_xss_in_error_message_is_escaped(self, mock_settings, mock_get_sheets):
        """Error messages containing user input should be HTML-escaped."""
        mock_settings.spreadsheet_id = "test-spreadsheet"
        mock_sheets = MagicMock()
        mock_sheets.mark_task_done.return_value = MarkTaskResult(
            success=False,
            message='Task "<script>alert(1)</script>" not found.',
        )
        mock_get_sheets.return_value = mock_sheets

        from app.reminder_logic import generate_token
        token = generate_token("test-spreadsheet", "Show", "<script>alert(1)</script>")

        response = client.get(f"/mark-done?action=done&show=Show&task=%3Cscript%3Ealert(1)%3C/script%3E&token={token}")
        assert "<script>" not in response.text
        assert "&lt;script&gt;" in response.text


class TestSlackInteractionsEndpoint:
    """Tests for POST /slack/interactions."""

    @patch("app.main.settings")
    def test_missing_payload_returns_400(self, mock_settings):
        mock_settings.slack_signing_secret = ""  # skip verification
        response = client.post("/slack/interactions", data={})
        assert response.status_code == 400

    @patch("app.main.settings")
    def test_valid_payload_returns_200(self, mock_settings):
        mock_settings.slack_signing_secret = ""  # skip verification
        payload = json.dumps({
            "type": "block_actions",
            "actions": [{"action_id": "mark_done:Show:Task"}],
            "user": {"id": "U123"},
            "channel": {"id": "C123"},
            "response_url": "https://hooks.slack.com/actions/test",
        })
        response = client.post("/slack/interactions", data={"payload": payload})
        assert response.status_code == 200

    def test_invalid_signature_returns_401(self):
        with patch("app.main.settings") as mock_settings:
            mock_settings.slack_signing_secret = "real-secret"

            response = client.post(
                "/slack/interactions",
                data={"payload": "{}"},
                headers={
                    "X-Slack-Request-Timestamp": str(int(time.time())),
                    "X-Slack-Signature": "v0=invalid",
                },
            )
            assert response.status_code == 401


class TestRemindersSendEndpoint:
    """Tests for POST /reminders/send."""

    @patch("app.main._get_slack")
    def test_send_reminder_success(self, mock_get_slack):
        mock_slack = MagicMock()
        mock_slack.send_message.return_value = {"ok": True, "ts": "123.456"}
        mock_get_slack.return_value = mock_slack

        payload = {
            "show_name": "Test Show",
            "task": "Submit poster",
            "responsible": "Producer",
            "deadline": "2026-05-01",
            "days_until": 5,
            "slack_channel": "show-test",
        }
        response = client.post("/reminders/send", json=payload)
        assert response.status_code == 200
        assert response.json()["ok"] is True
        # Parent message + threaded reply = 2 calls
        assert mock_slack.send_message.call_count == 2

    @patch("app.main._get_slack")
    def test_send_reminder_no_channel(self, mock_get_slack):
        payload = {
            "show_name": "Test Show",
            "task": "Submit poster",
            "responsible": "Producer",
            "slack_channel": "",
        }
        response = client.post("/reminders/send", json=payload)
        assert response.status_code == 200
        assert response.json()["ok"] is False

    @patch("app.main._get_slack")
    def test_send_optional_reminder_has_skip_button(self, mock_get_slack):
        mock_slack = MagicMock()
        mock_slack.send_message.return_value = {"ok": True, "ts": "123.456"}
        mock_get_slack.return_value = mock_slack

        payload = {
            "show_name": "Test Show",
            "task": "Do headshots",
            "responsible": "Producer",
            "deadline": "2026-05-01",
            "days_until": 5,
            "slack_channel": "show-test",
            "is_optional": True,
        }
        response = client.post("/reminders/send", json=payload)
        assert response.status_code == 200
        # Verify the attachments contain skip button
        call_args = mock_slack.send_message.call_args_list[0]
        attachments = call_args[1]["attachments"]
        buttons = attachments[0]["blocks"][1]["elements"]
        assert len(buttons) == 2  # Mark Done + Skip


class TestRemindersDigestEndpoint:
    """Tests for POST /reminders/digest."""

    @patch("app.main._get_slack")
    @patch("app.main.settings")
    def test_digest_sends_to_show_support(self, mock_settings, mock_get_slack):
        mock_settings.show_support_channel = "show-support"
        mock_slack = MagicMock()
        mock_slack.send_message.return_value = {"ok": True, "ts": "123.456"}
        mock_get_slack.return_value = mock_slack

        items = [
            {"show": "Hamlet", "task": "Book days", "responsible": "Director", "deadline": "2026-05-01", "action": "advance", "days_until": 5, "success": True},
            {"show": "Hamlet", "task": "Get keys", "responsible": "SM", "deadline": "2026-05-02", "action": "urgent", "days_until": 1, "success": True},
        ]
        response = client.post("/reminders/digest", json=items)
        assert response.status_code == 200
        assert response.json()["ok"] is True
        mock_slack.send_message.assert_called_once()
        text = mock_slack.send_message.call_args[1]["text"]
        assert "Hamlet" in text
        assert "2/2 reminders sent successfully" in text

    @patch("app.main.settings")
    def test_digest_no_channel_returns_error(self, mock_settings):
        mock_settings.show_support_channel = ""
        response = client.post("/reminders/digest", json=[])
        assert response.status_code == 200
        assert response.json()["ok"] is False


class TestReadthroughPromptEndpoint:
    """Tests for POST /reminders/readthrough-prompt."""

    @patch("app.main._get_slack")
    def test_sends_date_picker(self, mock_get_slack):
        mock_slack = MagicMock()
        mock_slack.send_message.return_value = {"ok": True, "ts": "123.456"}
        mock_get_slack.return_value = mock_slack

        response = client.post("/reminders/readthrough-prompt?show_name=Hamlet&channel=show-hamlet")
        assert response.status_code == 200
        assert response.json()["ok"] is True
        mock_slack.send_message.assert_called_once()
        # Verify attachments contain datepicker
        call_args = mock_slack.send_message.call_args
        attachments = call_args[1]["attachments"]
        assert any("datepicker" in str(b) for b in attachments[0]["blocks"])

    @patch("app.main._get_slack")
    def test_no_channel_returns_error(self, mock_get_slack):
        response = client.post("/reminders/readthrough-prompt?show_name=Hamlet&channel=")
        assert response.status_code == 200
        assert response.json()["ok"] is False
