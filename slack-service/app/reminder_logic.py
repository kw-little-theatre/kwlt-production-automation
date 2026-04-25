"""
KWLT Production Automation — Reminder Logic (Pure Functions)

Python ports of the pure functions from ReminderEngine.gs, ShowTimeline.gs,
WebApp.gs, and EmailIntegration.gs. These have no external dependencies
(no Google APIs, no Slack API) and are fully unit-testable.
"""

from __future__ import annotations

import hashlib
import re
from datetime import date, datetime, timedelta
from urllib.parse import quote

from typing import Optional

from app.constants import STATUS
from app.task_templates import get_task_template_data, get_task_template_for_type


# ─── Action Determination ─────────────────────────────────────────────────────


def determine_action(
    days_until: int,
    current_status: str,
    advance_days: int = 7,
    urgent_days: int = 1,
    overdue_days: int = 2,
) -> Optional[str]:
    """
    Decides what reminder action (if any) to take.
    Port of _determineAction() from ReminderEngine.gs.

    Args:
        days_until: Days until deadline (negative = overdue)
        current_status: Current status value
        advance_days: Config: how many days before deadline for advance reminder
        urgent_days: Config: how many days before deadline for urgent reminder
        overdue_days: Config: how many days past deadline for escalation

    Returns:
        'advance', 'urgent', 'overdue', or None
    """
    # Overdue escalation
    if days_until <= -overdue_days and current_status != STATUS.OVERDUE:
        return "overdue"

    # Urgent reminder
    if (
        days_until <= urgent_days
        and days_until > -overdue_days
        and current_status != STATUS.URGENT_SENT
        and current_status != STATUS.OVERDUE
    ):
        return "urgent"

    # Advance reminder
    if days_until <= advance_days and days_until > urgent_days and current_status == STATUS.PENDING:
        return "advance"

    return None


def status_after_action(action: str) -> str:
    """
    Maps an action to its resulting status value.
    Port of _statusAfterAction() from ReminderEngine.gs.
    """
    mapping = {
        "advance": STATUS.ADVANCE_SENT,
        "urgent": STATUS.URGENT_SENT,
        "overdue": STATUS.OVERDUE,
    }
    return mapping.get(action, STATUS.PENDING)


# ─── Template Helpers ──────────────────────────────────────────────────────────


def slack_template_name(action: str) -> str:
    """Port of _slackTemplateName() from ReminderEngine.gs."""
    mapping = {
        "advance": "Advance Reminder",
        "urgent": "Urgent Reminder",
        "overdue": "Overdue Escalation",
    }
    return mapping.get(action, "Advance Reminder")


def email_template_name(action: str) -> str:
    """Port of _emailTemplateName() from ReminderEngine.gs."""
    mapping = {
        "advance": "Advance Reminder (Email)",
        "urgent": "Urgent Reminder (Email)",
        "overdue": "Overdue Escalation",
    }
    return mapping.get(action, "Advance Reminder (Email)")


def render_template(template: str, context: dict) -> str:
    """
    Replaces {{PLACEHOLDER}} tokens in a template string with context values.
    Port of _renderTemplate() from ReminderEngine.gs.

    Note: The Apps Script version uses Utilities.formatDate for {{DATE}}.
    Here we use Python's date formatting.
    """
    if not template:
        return ""

    today_str = date.today().strftime("%Y-%m-%d")

    replacements = {
        "{{SHOW_NAME}}": context.get("show_name", context.get("showName", "")),
        "{{TASK}}": context.get("task", ""),
        "{{RESPONSIBLE_PARTY}}": context.get("responsible", ""),
        "{{DEADLINE}}": context.get("deadline", ""),
        "{{DAYS_UNTIL}}": str(context.get("days_until", context.get("daysUntil", 0))),
        "{{DAYS_OVERDUE}}": str(context.get("days_overdue", context.get("daysOverdue", 0))),
        "{{GENERAL_RULE}}": context.get("general_rule", context.get("generalRule", "")),
        "{{SLACK_CHANNEL}}": context.get("slack_channel", context.get("slackChannel", "")),
        "{{HANDBOOK_URL}}": context.get("handbook_url", context.get("handbookUrl", "")),
        "{{RESOURCES_URL}}": context.get("resources_url", context.get("resourcesUrl", "")),
        "{{MARK_DONE_URL}}": context.get("mark_done_url", context.get("markDoneUrl", "")),
        "{{DATE}}": today_str,
    }

    result = template
    for placeholder, value in replacements.items():
        result = result.replace(placeholder, str(value))

    return result


# ─── Task Template Lookups ─────────────────────────────────────────────────────


def is_optional_task(task_name: str, production_type: Optional[str] = None) -> bool:
    """
    Checks if a task has the optional flag set.
    Optional tasks get softer reminders (advance only, no urgent/overdue).
    """
    for t in get_task_template_for_type(production_type):
        if t.get("optional") and (t["task"] == task_name or t["task"] in task_name):
            return True
    return False


def is_auto_complete_task(task_name: str, production_type: Optional[str] = None) -> bool:
    """
    Checks if a task has the autoComplete flag set.
    Port of _isAutoCompleteTask() from ReminderEngine.gs.
    """
    for t in get_task_template_for_type(production_type):
        if t.get("autoComplete") and (t["task"] == task_name or t["task"] in task_name):
            return True
    return False


def is_send_on_date_task(task_name: str, production_type: Optional[str] = None) -> bool:
    """
    Checks if a task has the sendOnDate flag set.
    Port of _isSendOnDateTask() from ReminderEngine.gs.
    """
    for t in get_task_template_for_type(production_type):
        if t.get("sendOnDate") and (t["task"] == task_name or t["task"] in task_name):
            return True
    return False


def get_custom_email_for_task(task_name: str, production_type: Optional[str] = None) -> Optional[dict]:
    """
    Looks up a task's custom email template.
    Port of _getCustomEmailForTask() from ReminderEngine.gs.

    Returns: dict with 'emailSubject' and 'emailBody', or None
    """
    for t in get_task_template_for_type(production_type):
        if t.get("emailBody") and (t["task"] == task_name or t["task"] in task_name):
            return {"emailSubject": t["emailSubject"], "emailBody": t["emailBody"]}
    return None


def lookup_original_notify_via(task_name: str, production_type: Optional[str] = None) -> Optional[str]:
    """
    Looks up the original notifyVia value for a task from the template data.
    Port of _lookupOriginalNotifyVia() from WebApp.gs.
    """
    for t in get_task_template_for_type(production_type):
        if t["task"] == task_name or t["task"] in task_name:
            return t.get("notifyVia")
    return None


# ─── Date Utilities ────────────────────────────────────────────────────────────


def strip_time(d) -> Optional[date]:
    """
    Strips the time portion from a datetime.
    Port of _stripTime() from ReminderEngine.gs.
    """
    if d is None:
        return None
    if isinstance(d, datetime):
        return d.date()
    return d


def days_between(from_date: date | datetime, to_date: date | datetime) -> int:
    """
    Returns the number of days between two dates (positive = future).
    Port of _daysBetween() from ReminderEngine.gs.
    """
    from_d = strip_time(from_date) if isinstance(from_date, datetime) else from_date
    to_d = strip_time(to_date) if isinstance(to_date, datetime) else to_date
    if from_d is None or to_d is None:
        return 0
    return (to_d - from_d).days


def compute_date(anchors: dict, anchor_ref: str, offset_days: int) -> Optional[date]:
    """
    Computes a deadline date from an anchor + offset.
    Port of _computeDate() from ShowTimeline.gs.

    Returns: The computed date, or None if anchor not found.
    """
    base = anchors.get(anchor_ref)
    if base is None:
        return None
    if isinstance(base, datetime):
        base = base.date()
    return base + timedelta(days=offset_days)


# ─── String Utilities ──────────────────────────────────────────────────────────


def strip_emoji(s: str) -> str:
    """
    Strips emoji and other non-ASCII symbol characters from a string.
    Port of _stripEmoji() from EmailIntegration.gs.
    """
    if not s:
        return s
    # Remove emoji and misc symbol blocks
    result = re.sub(
        r"[\U0001F300-\U0001FAFF\u2600-\u27BF\uFE00-\uFE0F\u200D\u20E3\U000E0020-\U000E007F]",
        "",
        s,
    )
    # Collapse multiple spaces
    result = re.sub(r"  +", " ", result)
    return result.strip()


# ─── Token Generation ──────────────────────────────────────────────────────────


def generate_token(spreadsheet_id: str, show_name: str, task_text: str) -> str:
    """
    Generates a verification token for a show+task combination.
    Port of _generateToken() from WebApp.gs.

    Uses the spreadsheet ID as a secret salt, same as the Apps Script version.
    """
    raw = f"{spreadsheet_id}|{show_name}|{task_text}"
    digest = hashlib.sha256(raw.encode("utf-8")).hexdigest()
    return digest[:12]


def build_mark_done_url(web_app_url: str, spreadsheet_id: str, show_name: str, task_text: str) -> str:
    """
    Builds a "Mark Done" URL for a specific task.
    Port of buildMarkDoneUrl() from WebApp.gs.
    """
    if not web_app_url:
        return ""

    token = generate_token(spreadsheet_id, show_name, task_text)
    return (
        f"{web_app_url}"
        f"?action=done"
        f"&show={quote(show_name)}"
        f"&task={quote(task_text)}"
        f"&token={token}"
    )


# ─── Recipient Resolution ─────────────────────────────────────────────────────


def resolve_recipient_email(context: dict) -> Optional[str]:
    """Port of _resolveRecipientEmail() from ReminderEngine.gs."""
    return context.get("show_email") or context.get("showEmail") or None
