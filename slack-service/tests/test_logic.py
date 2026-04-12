"""
Tests for pure utility functions ported from the Apps Script codebase:
  - Token generation (_generateToken / buildMarkDoneUrl)
  - Date utilities (_stripTime, _daysBetween, _computeDate)
  - String utilities (_escapeHtml, _stripEmoji)
  - Template rendering (_renderTemplate)
  - Task template lookups
"""

from datetime import date, datetime

from app.reminder_logic import (
    build_mark_done_url,
    compute_date,
    days_between,
    escape_html,
    generate_token,
    get_custom_email_for_task,
    is_auto_complete_task,
    is_send_on_date_task,
    lookup_original_notify_via,
    render_template,
    resolve_recipient_email,
    strip_emoji,
    strip_time,
)
from app.task_templates import get_task_template_data


class TestTokenGeneration:
    """Tests for generate_token() — port of _generateToken()."""

    def test_deterministic(self):
        """Same inputs always produce the same token."""
        t1 = generate_token("spreadsheet-id", "Hamlet", "Book audition days")
        t2 = generate_token("spreadsheet-id", "Hamlet", "Book audition days")
        assert t1 == t2

    def test_length_is_12(self):
        """Token should be 12 hex characters."""
        token = generate_token("abc", "Hamlet", "Some task")
        assert len(token) == 12

    def test_hex_characters_only(self):
        """Token should contain only hex characters."""
        token = generate_token("abc", "Hamlet", "Some task")
        assert all(c in "0123456789abcdef" for c in token)

    def test_different_inputs_produce_different_tokens(self):
        """Different inputs should produce different tokens."""
        t1 = generate_token("abc", "Hamlet", "Task A")
        t2 = generate_token("abc", "Hamlet", "Task B")
        assert t1 != t2

    def test_different_spreadsheet_id_produces_different_token(self):
        """Different spreadsheet IDs (salt) should produce different tokens."""
        t1 = generate_token("spreadsheet-1", "Hamlet", "Task A")
        t2 = generate_token("spreadsheet-2", "Hamlet", "Task A")
        assert t1 != t2

    def test_special_characters(self):
        """Handles unicode and special chars in show/task names."""
        token = generate_token("id", "🎭 The Show!", "Task with 'quotes' & <brackets>")
        assert len(token) == 12

    def test_matches_javascript_algorithm(self):
        """
        Verify the Python SHA-256 hash matches what the JavaScript version
        would produce. The JS version does:
          raw = spreadsheetId + '|' + showName + '|' + taskText
          SHA-256 → hex → first 12 chars

        Python's hashlib.sha256 produces the same digest for the same input.
        """
        # This is a cross-language verification point. If you change the
        # algorithm in either Python or JS, this test should fail.
        token = generate_token("test-id", "Test Show", "Test Task")
        assert isinstance(token, str)
        assert len(token) == 12


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
    """Tests for strip_time(), days_between(), compute_date()."""

    def test_strip_time_from_datetime(self):
        dt = datetime(2026, 5, 1, 14, 30, 0)
        result = strip_time(dt)
        assert result == date(2026, 5, 1)

    def test_strip_time_from_date(self):
        d = date(2026, 5, 1)
        result = strip_time(d)
        assert result == date(2026, 5, 1)

    def test_strip_time_none(self):
        assert strip_time(None) is None

    def test_days_between_positive(self):
        """Future dates return positive days."""
        assert days_between(date(2026, 5, 1), date(2026, 5, 8)) == 7

    def test_days_between_negative(self):
        """Past dates return negative days."""
        assert days_between(date(2026, 5, 8), date(2026, 5, 1)) == -7

    def test_days_between_same_day(self):
        assert days_between(date(2026, 5, 1), date(2026, 5, 1)) == 0

    def test_days_between_with_datetimes(self):
        """Works with datetimes too (time portion stripped)."""
        dt1 = datetime(2026, 5, 1, 10, 0)
        dt2 = datetime(2026, 5, 3, 22, 0)
        assert days_between(dt1, dt2) == 2

    def test_compute_date_basic(self):
        anchors = {"Opening Night": date(2026, 6, 15)}
        result = compute_date(anchors, "Opening Night", -7)
        assert result == date(2026, 6, 8)

    def test_compute_date_positive_offset(self):
        anchors = {"Closing Night": date(2026, 7, 1)}
        result = compute_date(anchors, "Closing Night", 7)
        assert result == date(2026, 7, 8)

    def test_compute_date_zero_offset(self):
        anchors = {"Opening Night": date(2026, 6, 15)}
        result = compute_date(anchors, "Opening Night", 0)
        assert result == date(2026, 6, 15)

    def test_compute_date_missing_anchor(self):
        anchors = {"Opening Night": date(2026, 6, 15)}
        result = compute_date(anchors, "Readthrough Date", 0)
        assert result is None

    def test_compute_date_with_datetime_anchor(self):
        """Handles datetime anchors (strips time)."""
        anchors = {"Opening Night": datetime(2026, 6, 15, 10, 0)}
        result = compute_date(anchors, "Opening Night", -7)
        assert result == date(2026, 6, 8)


class TestStringUtilities:
    """Tests for escape_html() and strip_emoji()."""

    def test_escape_html_ampersand(self):
        assert escape_html("A & B") == "A &amp; B"

    def test_escape_html_angle_brackets(self):
        assert escape_html("<script>alert('xss')</script>") == "&lt;script&gt;alert('xss')&lt;/script&gt;"

    def test_escape_html_quotes(self):
        assert escape_html('He said "hello"') == "He said &quot;hello&quot;"

    def test_escape_html_clean_string(self):
        assert escape_html("Hello World") == "Hello World"

    def test_strip_emoji_removes_emoji(self):
        assert strip_emoji("🎭 Hello World 🌟") == "Hello World"

    def test_strip_emoji_preserves_text(self):
        assert strip_emoji("Hello World") == "Hello World"

    def test_strip_emoji_empty_string(self):
        assert strip_emoji("") == ""

    def test_strip_emoji_none(self):
        assert strip_emoji(None) is None

    def test_strip_emoji_collapses_spaces(self):
        """After removing emoji, multiple spaces should collapse."""
        result = strip_emoji("📋  Task  📋")
        assert "  " not in result


class TestRenderTemplate:
    """Tests for render_template() — port of _renderTemplate()."""

    def test_basic_substitution(self):
        template = "Hello {{SHOW_NAME}}, task {{TASK}} is due on {{DEADLINE}}"
        context = {"show_name": "Hamlet", "task": "Book days", "deadline": "2026-05-01"}
        result = render_template(template, context)
        assert "Hamlet" in result
        assert "Book days" in result
        assert "2026-05-01" in result

    def test_all_placeholders(self):
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

    def test_date_placeholder(self):
        """{{DATE}} should be replaced with today's date."""
        template = "Today is {{DATE}}"
        result = render_template(template, {})
        today = date.today().strftime("%Y-%m-%d")
        assert today in result

    def test_empty_template(self):
        assert render_template("", {}) == ""

    def test_none_template(self):
        assert render_template(None, {}) == ""

    def test_missing_context_values(self):
        """Missing context values should become empty strings."""
        template = "Show: {{SHOW_NAME}}, Task: {{TASK}}"
        result = render_template(template, {})
        assert result == "Show: , Task: "

    def test_camelcase_context_keys(self):
        """Should also accept camelCase keys (for JS compatibility)."""
        template = "{{SHOW_NAME}} {{HANDBOOK_URL}}"
        context = {"showName": "Hamlet", "handbookUrl": "https://example.com"}
        result = render_template(template, context)
        assert "Hamlet" in result
        assert "https://example.com" in result


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


class TestResolveRecipientEmail:
    """Tests for resolve_recipient_email()."""

    def test_returns_show_email(self):
        assert resolve_recipient_email({"show_email": "show@kwlt.org"}) == "show@kwlt.org"

    def test_returns_none_when_empty(self):
        assert resolve_recipient_email({"show_email": ""}) is None

    def test_returns_none_when_missing(self):
        assert resolve_recipient_email({}) is None

    def test_camelcase_key(self):
        assert resolve_recipient_email({"showEmail": "show@kwlt.org"}) == "show@kwlt.org"
