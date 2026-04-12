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
