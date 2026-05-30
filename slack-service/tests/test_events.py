"""
Tests for the Slack Events API: endpoint, event handlers, and message builders.

Covers:
  - POST /slack/events endpoint (URL verification, event dispatch, signature)
  - member_joined_channel handler (welcome message on bot join)
  - app_mention handler (FAQ keyword matching and responses)
  - Welcome and help/FAQ message builders
"""

import json
import time
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.handlers import handle_event, _match_faq_topic
from app.main import app
from app.messages import (
    build_faq_about,
    build_faq_change_date,
    build_faq_contacts,
    build_faq_contacts_no_show,
    build_faq_deadlines,
    build_faq_deadlines_no_show,
    build_faq_handbook,
    build_faq_mark_done,
    build_faq_unknown,
    build_help_menu,
    build_welcome_message,
)

client = TestClient(app)


# ─── Endpoint Tests ──────────────────────────────────────────────────────────


class TestSlackEventsEndpoint:
    """Tests for POST /slack/events."""

    @patch("app.main.settings")
    def test_url_verification_challenge(self, mock_settings):
        """Slack URL verification should echo back the challenge."""
        mock_settings.slack_signing_secret = ""  # skip verification

        payload = {
            "type": "url_verification",
            "challenge": "test_challenge_abc123",
            "token": "test_token",
        }
        response = client.post(
            "/slack/events",
            content=json.dumps(payload),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 200
        assert response.json()["challenge"] == "test_challenge_abc123"

    @patch("app.main.settings")
    def test_event_callback_returns_200(self, mock_settings):
        """Event callbacks should return 200 immediately."""
        mock_settings.slack_signing_secret = ""

        payload = {
            "type": "event_callback",
            "event": {
                "type": "member_joined_channel",
                "user": "U_BOT",
                "channel": "C12345",
            },
        }
        response = client.post(
            "/slack/events",
            content=json.dumps(payload),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 200

    def test_invalid_signature_returns_401(self):
        """Invalid Slack signatures should be rejected."""
        with patch("app.main.settings") as mock_settings:
            mock_settings.slack_signing_secret = "real-secret"

            payload = json.dumps({"type": "url_verification", "challenge": "x"})
            response = client.post(
                "/slack/events",
                content=payload,
                headers={
                    "Content-Type": "application/json",
                    "X-Slack-Request-Timestamp": str(int(time.time())),
                    "X-Slack-Signature": "v0=invalid",
                },
            )
            assert response.status_code == 401

    @patch("app.main.settings")
    def test_unknown_type_returns_200(self, mock_settings):
        """Unknown event types should still return 200 (don't fail)."""
        mock_settings.slack_signing_secret = ""

        payload = {"type": "some_unknown_type"}
        response = client.post(
            "/slack/events",
            content=json.dumps(payload),
            headers={"Content-Type": "application/json"},
        )
        assert response.status_code == 200


# ─── Event Handler Tests ─────────────────────────────────────────────────────


class TestMemberJoinedHandler:
    """Tests for the member_joined_channel event handler."""

    def test_bot_join_sends_welcome(self):
        """When the bot itself joins, it should send a welcome message."""
        sheets = MagicMock()
        slack = MagicMock()
        slack.get_bot_user_id.return_value = "U_BOT"

        event_body = {
            "event": {
                "type": "member_joined_channel",
                "user": "U_BOT",
                "channel": "C12345",
            }
        }
        handle_event(event_body, sheets, slack)

        slack.send_message.assert_called_once()
        call_args = slack.send_message.call_args
        assert call_args[0][0] == "C12345"
        assert "attachments" in call_args[1]

    def test_other_user_join_no_message(self):
        """When a non-bot user joins, no message should be sent."""
        sheets = MagicMock()
        slack = MagicMock()
        slack.get_bot_user_id.return_value = "U_BOT"

        event_body = {
            "event": {
                "type": "member_joined_channel",
                "user": "U_OTHER_USER",
                "channel": "C12345",
            }
        }
        handle_event(event_body, sheets, slack)

        slack.send_message.assert_not_called()

    def test_bot_id_unavailable_no_crash(self):
        """If we can't get the bot user ID, don't crash."""
        sheets = MagicMock()
        slack = MagicMock()
        slack.get_bot_user_id.return_value = None

        event_body = {
            "event": {
                "type": "member_joined_channel",
                "user": "U_BOT",
                "channel": "C12345",
            }
        }
        handle_event(event_body, sheets, slack)
        slack.send_message.assert_not_called()


class TestAppMentionHandler:
    """Tests for the app_mention event handler."""

    def _make_event_body(self, text: str, channel: str = "C12345", ts: str = "1234.5678"):
        return {
            "event": {
                "type": "app_mention",
                "text": text,
                "channel": channel,
                "ts": ts,
            }
        }

    def test_help_keyword_returns_help_menu(self):
        sheets = MagicMock()
        slack = MagicMock()

        handle_event(self._make_event_body("<@U_BOT> help"), sheets, slack)

        slack.send_message.assert_called_once()
        attachments = slack.send_message.call_args[1]["attachments"]
        assert "Help" in attachments[0]["blocks"][0]["text"]["text"]

    def test_bare_mention_returns_help(self):
        """A bare @bot mention with no text should show the help menu."""
        sheets = MagicMock()
        slack = MagicMock()

        handle_event(self._make_event_body("<@U_BOT>"), sheets, slack)

        slack.send_message.assert_called_once()
        attachments = slack.send_message.call_args[1]["attachments"]
        assert "Help" in attachments[0]["blocks"][0]["text"]["text"]

    def test_about_keyword(self):
        sheets = MagicMock()
        slack = MagicMock()

        handle_event(self._make_event_body("<@U_BOT> about"), sheets, slack)

        slack.send_message.assert_called_once()
        attachments = slack.send_message.call_args[1]["attachments"]
        assert "What does this bot do" in attachments[0]["blocks"][0]["text"]["text"]

    def test_done_keyword(self):
        sheets = MagicMock()
        slack = MagicMock()

        handle_event(self._make_event_body("<@U_BOT> done"), sheets, slack)

        slack.send_message.assert_called_once()
        attachments = slack.send_message.call_args[1]["attachments"]
        assert "mark a task done" in attachments[0]["blocks"][0]["text"]["text"].lower()

    def test_handbook_keyword(self):
        sheets = MagicMock()
        slack = MagicMock()

        handle_event(self._make_event_body("<@U_BOT> handbook"), sheets, slack)

        slack.send_message.assert_called_once()
        attachments = slack.send_message.call_args[1]["attachments"]
        assert "handbook" in attachments[0]["blocks"][0]["text"]["text"].lower()

    def test_date_keyword(self):
        sheets = MagicMock()
        slack = MagicMock()

        handle_event(self._make_event_body("<@U_BOT> date"), sheets, slack)

        slack.send_message.assert_called_once()
        attachments = slack.send_message.call_args[1]["attachments"]
        assert "change a date" in attachments[0]["blocks"][0]["text"]["text"].lower()

    def test_deadlines_with_show(self):
        """Deadlines should pull live task data from the sheet."""
        sheets = MagicMock()
        sheets.get_show_by_channel.return_value = {
            "show_name": "Hamlet",
            "show_email": "hamlet@kwlt.org",
            "resources_url": "",
        }
        sheets.get_upcoming_tasks.return_value = [
            {"task": "Submit poster", "responsible": "Producer", "deadline": "2026-06-01", "status": "Pending"},
            {"task": "Book days", "responsible": "Director", "deadline": "2026-06-05", "status": "Pending"},
        ]
        slack = MagicMock()
        slack.get_channel_name.return_value = "show-hamlet"

        handle_event(self._make_event_body("<@U_BOT> deadlines"), sheets, slack)

        sheets.get_upcoming_tasks.assert_called_once_with("Hamlet", limit=5)
        slack.send_message.assert_called_once()
        blocks = slack.send_message.call_args[1]["attachments"][0]["blocks"]
        # Header + 2 task blocks + context = 4 blocks
        block_texts = [b["text"]["text"] for b in blocks if b["type"] == "section"]
        assert any("Hamlet" in t for t in block_texts)
        assert any("Submit poster" in t for t in block_texts)

    def test_deadlines_no_show(self):
        sheets = MagicMock()
        sheets.get_show_by_channel.return_value = None
        slack = MagicMock()

        handle_event(self._make_event_body("<@U_BOT> deadlines"), sheets, slack)

        slack.send_message.assert_called_once()
        text = slack.send_message.call_args[1]["attachments"][0]["blocks"][0]["text"]["text"]
        assert "couldn't find a show" in text.lower()

    def test_unknown_keyword_returns_fallback(self):
        sheets = MagicMock()
        slack = MagicMock()

        handle_event(self._make_event_body("<@U_BOT> xyzzy"), sheets, slack)

        slack.send_message.assert_called_once()
        text = slack.send_message.call_args[1]["attachments"][0]["blocks"][0]["text"]["text"]
        assert "not sure" in text.lower()

    def test_response_is_threaded(self):
        """Responses should be sent as threaded replies to the mention."""
        sheets = MagicMock()
        slack = MagicMock()

        handle_event(self._make_event_body("<@U_BOT> help", ts="9999.1234"), sheets, slack)

        call_kwargs = slack.send_message.call_args[1]
        assert call_kwargs["thread_ts"] == "9999.1234"

    def test_sheets_error_doesnt_crash(self):
        """Sheet lookup errors should be handled gracefully."""
        sheets = MagicMock()
        sheets.get_show_by_channel.side_effect = Exception("Sheet unavailable")
        slack = MagicMock()

        # Should not raise
        handle_event(self._make_event_body("<@U_BOT> deadlines"), sheets, slack)

        slack.send_message.assert_called_once()
        # Should show the no-show fallback
        text = slack.send_message.call_args[1]["attachments"][0]["blocks"][0]["text"]["text"]
        assert "couldn't find a show" in text.lower()


# ─── Keyword Matching Tests ──────────────────────────────────────────────────


class TestFaqKeywordMatching:
    """Tests for the _match_faq_topic() function."""

    def test_empty_query_returns_help(self):
        assert _match_faq_topic("") == "help"

    @pytest.mark.parametrize("word,expected", [
        ("help", "help"),
        ("about", "about"),
        ("what", "about"),
        ("done", "mark_done"),
        ("mark", "mark_done"),
        ("button", "mark_done"),
        ("complete", "mark_done"),
        ("handbook", "handbook"),
        ("resources", "handbook"),
        ("guide", "handbook"),
        ("deadlines", "deadlines"),
        ("upcoming", "deadlines"),
        ("tasks", "deadlines"),
        ("schedule", "deadlines"),
        ("date", "change_date"),
        ("change", "change_date"),
        ("reschedule", "change_date"),
    ])
    def test_keyword_matches(self, word, expected):
        assert _match_faq_topic(word) == expected

    def test_multi_word_matches_first_keyword(self):
        result = _match_faq_topic("what are the deadlines")
        # "what" maps to "about" and comes first in the query
        assert result == "about"

    def test_no_match_returns_none(self):
        assert _match_faq_topic("xyzzy") is None
        assert _match_faq_topic("banana smoothie recipe") is None

    def test_case_insensitive_input(self):
        # The handler lowercases before calling this function,
        # but keywords themselves are lowercase
        assert _match_faq_topic("help") == "help"


# ─── Message Builder Tests ───────────────────────────────────────────────────


class TestWelcomeMessage:
    """Tests for build_welcome_message()."""

    def test_has_attachments(self):
        msg = build_welcome_message()
        assert "attachments" in msg
        assert len(msg["attachments"]) == 1

    def test_has_blue_color(self):
        msg = build_welcome_message()
        assert msg["attachments"][0]["color"] == "#2563eb"

    def test_contains_introduction(self):
        msg = build_welcome_message()
        text = msg["attachments"][0]["blocks"][0]["text"]["text"]
        assert "Show Support Bot" in text

    def test_has_help_tip(self):
        msg = build_welcome_message()
        # Should have a context block with help tip
        blocks = msg["attachments"][0]["blocks"]
        context_texts = [b["elements"][0]["text"] for b in blocks if b["type"] == "context"]
        assert any("help" in t.lower() for t in context_texts)

    def test_has_fallback(self):
        msg = build_welcome_message()
        assert msg["attachments"][0]["fallback"]


class TestHelpMenu:
    """Tests for build_help_menu()."""

    def test_has_attachments(self):
        msg = build_help_menu()
        assert "attachments" in msg
        assert len(msg["attachments"]) == 1

    def test_lists_all_topics(self):
        msg = build_help_menu()
        text = msg["attachments"][0]["blocks"][0]["text"]["text"]
        for topic in ["about", "done", "handbook", "deadlines", "date"]:
            assert topic in text.lower()

    def test_has_purple_color(self):
        msg = build_help_menu()
        assert msg["attachments"][0]["color"] == "#6d28d9"


class TestFaqBuilders:
    """Tests for individual FAQ message builders."""

    def test_about_message(self):
        msg = build_faq_about()
        text = msg["attachments"][0]["blocks"][0]["text"]["text"]
        assert "bot do" in text.lower()

    def test_mark_done_message(self):
        msg = build_faq_mark_done()
        text = msg["attachments"][0]["blocks"][0]["text"]["text"]
        assert "Mark Done" in text

    def test_contacts_with_data(self):
        msg = build_faq_contacts("Hamlet", "hamlet@kwlt.org", "https://drive.google.com/hamlet")
        text = msg["attachments"][0]["blocks"][0]["text"]["text"]
        assert "Hamlet" in text
        assert "hamlet@kwlt.org" in text
        assert "drive.google.com" in text

    def test_contacts_minimal_data(self):
        msg = build_faq_contacts("Hamlet", "", "")
        text = msg["attachments"][0]["blocks"][0]["text"]["text"]
        assert "Hamlet" in text

    def test_contacts_no_show(self):
        msg = build_faq_contacts_no_show()
        text = msg["attachments"][0]["blocks"][0]["text"]["text"]
        assert "couldn't find" in text.lower()

    def test_handbook_with_url(self):
        msg = build_faq_handbook()
        text = msg["attachments"][0]["blocks"][0]["text"]["text"]
        assert "drive.google.com" in text

    def test_deadlines_with_tasks(self):
        tasks = [
            {"task": "Submit poster", "responsible": "Producer", "deadline": "2026-06-01", "status": "Pending"},
            {"task": "Book days", "responsible": "Director", "deadline": "2026-06-05", "status": "Done"},
        ]
        msg = build_faq_deadlines("Hamlet", tasks)
        blocks = msg["attachments"][0]["blocks"]
        section_blocks = [b for b in blocks if b["type"] == "section"]
        # Header + 2 tasks = 3 section blocks
        assert len(section_blocks) == 3
        assert "Hamlet" in section_blocks[0]["text"]["text"]
        assert "Submit poster" in section_blocks[1]["text"]["text"]
        # Pending task should have a Mark Done button
        assert "accessory" in section_blocks[1]
        assert section_blocks[1]["accessory"]["action_id"].startswith("mark_done:")
        # Done task should NOT have a button
        assert "accessory" not in section_blocks[2]

    def test_deadlines_empty(self):
        msg = build_faq_deadlines("Hamlet", [])
        blocks = msg["attachments"][0]["blocks"]
        section_texts = [b["text"]["text"] for b in blocks if b["type"] == "section"]
        assert any("all caught up" in t.lower() for t in section_texts)

    def test_deadlines_no_show(self):
        msg = build_faq_deadlines_no_show()
        text = msg["attachments"][0]["blocks"][0]["text"]["text"]
        assert "couldn't find" in text.lower()

    def test_change_date_message(self):
        msg = build_faq_change_date()
        text = msg["attachments"][0]["blocks"][0]["text"]["text"]
        assert "change" in text.lower() or "date" in text.lower()

    def test_unknown_keyword(self):
        msg = build_faq_unknown("xyzzy")
        text = msg["attachments"][0]["blocks"][0]["text"]["text"]
        assert "xyzzy" in text
        assert "help" in text.lower()

    def test_all_faq_messages_have_cyan_color(self):
        """All FAQ answer messages should use the cyan color."""
        messages = [
            build_faq_about(),
            build_faq_mark_done(),
            build_faq_contacts("Show", "email", "url"),
            build_faq_contacts_no_show(),
            build_faq_handbook(),
            build_faq_deadlines("Show", []),
            build_faq_deadlines_no_show(),
            build_faq_change_date(),
        ]
        for msg in messages:
            assert msg["attachments"][0]["color"] == "#0891b2", (
                f"Expected cyan #0891b2, got {msg['attachments'][0]['color']}"
            )

    def test_unknown_and_help_use_purple(self):
        """Help menu and unknown use deep purple."""
        assert build_faq_unknown("x")["attachments"][0]["color"] == "#6d28d9"
        assert build_help_menu()["attachments"][0]["color"] == "#6d28d9"


# ─── Unhandled Event Type ────────────────────────────────────────────────────


class TestUnhandledEventType:
    """Unknown event types should not crash."""

    def test_unknown_event_type_ignored(self):
        sheets = MagicMock()
        slack = MagicMock()

        event_body = {
            "event": {
                "type": "channel_archive",
                "channel": "C12345",
            }
        }
        handle_event(event_body, sheets, slack)
        slack.send_message.assert_not_called()
