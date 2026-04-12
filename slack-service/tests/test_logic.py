"""
Tests for ported utility functions:
  - Token generation (generate_token / build_mark_done_url)
  - Date utilities (days_between, compute_date) — type coercion only
  - Emoji stripping (strip_emoji) — regex pattern validation
  - Template rendering (render_template)
  - Task template lookups (is_auto_complete_task, etc.)
"""

from datetime import date, datetime

from app.reminder_logic import (
    build_mark_done_url,
    compute_date,
    days_between,
    generate_token,
    get_custom_email_for_task,
    is_auto_complete_task,
    is_send_on_date_task,
    lookup_original_notify_via,
    render_template,
    strip_emoji,
)
from app.task_templates import get_task_template_data


class TestTokenGeneration:
    """Tests for generate_token() — port of _generateToken()."""

    def test_deterministic(self):
        """Same inputs always produce the same token."""
        t1 = generate_token("spreadsheet-id", "Hamlet", "Book audition days")
        t2 = generate_token("spreadsheet-id", "Hamlet", "Book audition days")
        assert t1 == t2

    def test_different_inputs_produce_different_tokens(self):
        """Different inputs should produce different tokens."""
        t1 = generate_token("abc", "Hamlet", "Task A")
        t2 = generate_token("abc", "Hamlet", "Task B")
        assert t1 != t2

    def test_spreadsheet_id_is_salt(self):
        """Different spreadsheet IDs (salt) should produce different tokens."""
        t1 = generate_token("spreadsheet-1", "Hamlet", "Task A")
        t2 = generate_token("spreadsheet-2", "Hamlet", "Task A")
        assert t1 != t2

    def test_pinned_hash_matches_javascript(self):
        """
        Cross-language contract: pin a known hash so that if either the
        Python or JavaScript implementation changes, this test fails.

        To regenerate: run in Apps Script console:
          _generateToken('test-spreadsheet-id', 'Hamlet', 'Book audition days')
        """
        actual = generate_token("test-spreadsheet-id", "Hamlet", "Book audition days")
        # Pinned value — if this fails, the hashing algorithm has diverged
        # from the JavaScript version. Regenerate by running in Apps Script:
        #   _generateToken('test-spreadsheet-id', 'Hamlet', 'Book audition days')
        assert actual == "2a57addfc0e7"


class TestBuildMarkDoneUrl:
    """Tests for build_mark_done_url() — port of buildMarkDoneUrl()."""

    def test_basic_url(self):
        url = build_mark_done_url("https://example.com/exec", "id", "Hamlet", "Book days")
        assert url.startswith("https://example.com/exec?action=done")
        assert "show=Hamlet" in url
        assert "task=Book%20days" in url
        assert "token=" in url

    def test_empty_web_app_url_returns_empty(self):
        assert build_mark_done_url("", "id", "Hamlet", "Task") == ""

    def test_url_encoding_special_chars(self):
        url = build_mark_done_url("https://example.com", "id", "Show & Tell", "Task's")
        assert "Show%20%26%20Tell" in url

    def test_token_is_consistent(self):
        """Token in URL matches generate_token() output."""
        url = build_mark_done_url("https://example.com", "id123", "Show", "Task")
        expected_token = generate_token("id123", "Show", "Task")
        assert f"token={expected_token}" in url


class TestDateUtilities:
    """Tests for date utility functions.

    Only tests that verify OUR logic (None handling, type coercion) — not
    that Python's datetime arithmetic works.
    """

    def test_days_between_handles_mixed_datetime_date(self):
        """Our wrapper should accept a mix of datetime and date args."""
        dt = datetime(2026, 5, 1, 10, 0)
        d = date(2026, 5, 3)
        assert days_between(dt, d) == 2
        assert days_between(d, dt) == -2

    def test_compute_date_missing_anchor_returns_none(self):
        """Missing anchor should return None, not raise."""
        anchors = {"Opening Night": date(2026, 6, 15)}
        result = compute_date(anchors, "Readthrough Date", 0)
        assert result is None

    def test_compute_date_coerces_datetime_anchor(self):
        """Anchors stored as datetimes should be handled properly."""
        anchors = {"Opening Night": datetime(2026, 6, 15, 10, 0)}
        result = compute_date(anchors, "Opening Night", -7)
        assert result == date(2026, 6, 8)


class TestStripEmoji:
    """Tests for strip_emoji() — the regex pattern is non-trivial."""

    def test_removes_common_emoji(self):
        """Verify our regex actually catches the emoji ranges we use."""
        assert strip_emoji("🎭 Hello World 🌟") == "Hello World"

    def test_collapses_spaces_after_removal(self):
        """Emoji removal can leave double spaces — verify we collapse them."""
        result = strip_emoji("📋  Task  📋")
        assert "  " not in result


class TestRenderTemplate:
    """Tests for render_template() — port of _renderTemplate()."""

    def test_all_placeholders_replaced(self):
        """Verify every supported placeholder is actually wired up."""
        template = "{{SHOW_NAME}} {{TASK}} {{RESPONSIBLE_PARTY}} {{DEADLINE}} {{DAYS_UNTIL}} {{DAYS_OVERDUE}} {{GENERAL_RULE}} {{SLACK_CHANNEL}} {{HANDBOOK_URL}} {{RESOURCES_URL}} {{MARK_DONE_URL}}"
        context = {
            "show_name": "A",
            "task": "B",
            "responsible": "C",
            "deadline": "D",
            "days_until": 5,
            "days_overdue": 0,
            "general_rule": "E",
            "slack_channel": "F",
            "handbook_url": "G",
            "resources_url": "H",
            "mark_done_url": "I",
        }
        result = render_template(template, context)
        assert "A B C D 5 0 E F G H I" == result

    def test_date_placeholder_uses_today(self):
        """{{DATE}} should be replaced with today's date (not a static value)."""
        template = "Today is {{DATE}}"
        result = render_template(template, {})
        today = date.today().strftime("%Y-%m-%d")
        assert today in result

    def test_camelcase_context_keys_for_js_compat(self):
        """The JS version uses camelCase — verify our dual-key lookup works."""
        template = "{{SHOW_NAME}} {{HANDBOOK_URL}}"
        context = {"showName": "Hamlet", "handbookUrl": "https://example.com"}
        result = render_template(template, context)
        assert "Hamlet" in result
        assert "https://example.com" in result

    def test_snake_case_takes_precedence(self):
        """If both snake_case and camelCase are present, snake_case wins."""
        template = "{{SHOW_NAME}}"
        context = {"show_name": "Snake", "showName": "Camel"}
        result = render_template(template, context)
        assert result == "Snake"


class TestTaskTemplateLookups:
    """Tests for task template lookup functions."""

    def test_task_data_returns_list(self):
        data = get_task_template_data()
        assert isinstance(data, list)
        assert len(data) > 0

    def test_all_tasks_have_required_fields(self):
        for t in get_task_template_data():
            assert "task" in t
            assert "responsible" in t
            assert "anchorRef" in t
            assert "notifyVia" in t

    def test_is_auto_complete_true(self):
        """Tasks with autoComplete flag should be detected."""
        assert is_auto_complete_task("Share resource folder and policies with production team") is True

    def test_is_auto_complete_false(self):
        assert is_auto_complete_task("Book extra audition days if needed with Rentals") is False

    def test_is_auto_complete_substring_match(self):
        """Should match when task name contains the template task."""
        assert is_auto_complete_task("Share resource folder and policies with production team (extra context)") is True

    def test_is_send_on_date_true(self):
        assert is_send_on_date_task(
            "IMPORTANT: Send acceptance and rejection notifications to ALL auditionees (required within 5 days per policy)"
        ) is True

    def test_is_send_on_date_false(self):
        assert is_send_on_date_task("Book extra audition days if needed with Rentals") is False

    def test_get_custom_email_existing(self):
        result = get_custom_email_for_task(
            "Hold first Production meeting (invite Show Support Committee representative)"
        )
        assert result is not None
        assert "emailSubject" in result
        assert "emailBody" in result
        assert "{{SHOW_NAME}}" in result["emailSubject"]

    def test_get_custom_email_nonexistent(self):
        result = get_custom_email_for_task("Book extra audition days if needed with Rentals")
        assert result is None

    def test_lookup_original_notify_via(self):
        result = lookup_original_notify_via("Book extra audition days if needed with Rentals")
        assert result == "slack"

    def test_lookup_original_notify_via_both(self):
        result = lookup_original_notify_via(
            "Hold first Production meeting (invite Show Support Committee representative)"
        )
        assert result == "both"

    def test_lookup_original_notify_via_nonexistent(self):
        result = lookup_original_notify_via("This task does not exist")
        assert result is None


# Note: TestResolveRecipientEmail removed — the function is a trivial
# dict.get() with an `or` chain. No business logic to test.
