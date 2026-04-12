"""
KWLT Production Automation — Slack Message Builders

Builds Slack Block Kit message payloads. These are pure functions that
return dictionaries — no network calls. The actual sending is done by
slack_client.py.

Port of the block-building logic from SlackIntegration.gs and WebApp.gs.
"""

from __future__ import annotations

from urllib.parse import quote


def build_reminder_blocks(context: dict, action: str) -> dict:
    """
    Builds the Slack Block Kit payload for a task reminder message.
    Port of sendSlackBlockMessageWithButton() from SlackIntegration.gs.

    Returns a dict with 'attachments' (for the parent message) and
    'thread_text' (for the threaded reply).
    """
    emoji = "🚨" if action == "overdue" else "⚠️" if action == "urgent" else "📋"
    color = "#dc2626" if action == "overdue" else "#f59e0b" if action == "urgent" else "#2563eb"
    label = "Overdue" if action == "overdue" else "Due tomorrow" if action == "urgent" else "Upcoming"

    show_name = context.get("show_name", context.get("showName", ""))
    task = context.get("task", "")
    responsible = context.get("responsible", "")
    deadline = context.get("deadline", "")
    days_until = context.get("days_until", context.get("daysUntil", 0))
    days_overdue = context.get("days_overdue", context.get("daysOverdue", 0))
    general_rule = context.get("general_rule", context.get("generalRule", ""))
    handbook_url = context.get("handbook_url", context.get("handbookUrl", ""))
    resources_url = context.get("resources_url", context.get("resourcesUrl", ""))

    # Primary message blocks
    primary_blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"{emoji} *{label}:* {task}\n👤 *Responsible:* {responsible}  |  📅 *Due:* {deadline}",
            },
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "✅ Mark Done", "emoji": True},
                    "style": "primary",
                    "action_id": f"mark_done:{quote(show_name)}:{quote(task)}",
                }
            ],
        },
    ]

    fallback_text = f"{emoji} {label}: {task} ({responsible}) — due {deadline}"

    attachments = [{"color": color, "fallback": fallback_text, "blocks": primary_blocks}]

    # Threaded reply text
    if action == "overdue":
        status_line = f"🚨 {days_overdue} days overdue"
    else:
        status_line = f"🗓️ {days_until} days remaining"

    detail_lines = [
        f"*Deadline:* {deadline}",
        f"*Status:* {status_line}",
        "",
        f"📌 *Timing:* {general_rule}",
    ]

    if handbook_url:
        detail_lines.append(f"📖 <{handbook_url}|Production Handbook>")
    if resources_url:
        detail_lines.append(f"📁 <{resources_url}|Show Resources Folder>")

    return {
        "attachments": attachments,
        "thread_text": "\n".join(detail_lines),
    }


def build_overdue_escalation_blocks(context: dict) -> dict:
    """
    Builds the Slack Block Kit payload for an overdue escalation message
    sent to the Show Support channel.
    Port of the escalation logic in _executeAction() from ReminderEngine.gs.
    """
    show_name = context.get("show_name", context.get("showName", ""))
    task = context.get("task", "")
    responsible = context.get("responsible", "")
    deadline = context.get("deadline", "")
    days_overdue = context.get("days_overdue", context.get("daysOverdue", 0))
    general_rule = context.get("general_rule", context.get("generalRule", ""))

    esc_text = (
        f"🚨 *Overdue Task — {show_name}*\n\n"
        f"*{task}* is now {days_overdue} days overdue (deadline: {deadline})\n"
        f"Responsible: {responsible}\n"
        f"Timing: {general_rule}"
    )

    blocks = [
        {"type": "section", "text": {"type": "mrkdwn", "text": esc_text}},
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "✅ Mark Done", "emoji": True},
                    "style": "primary",
                    "action_id": f"mark_done:{quote(show_name)}:{quote(task)}",
                }
            ],
        },
    ]

    return {
        "attachments": [{"color": "#dc2626", "blocks": blocks}],
    }


def build_readthrough_date_prompt(show_name: str) -> dict:
    """
    Builds the Slack Block Kit payload for the readthrough date picker prompt.
    Port of sendReadthroughDatePrompt() from SlackIntegration.gs.
    """
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"📅 *Readthrough Date Needed — {show_name}*\n\n"
                    "Auditions are wrapped! When is the readthrough? "
                    "Pick a date below so reminders for readthrough-dependent tasks can be scheduled."
                ),
            },
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "datepicker",
                    "action_id": f"readthrough_date:{quote(show_name)}",
                    "placeholder": {
                        "type": "plain_text",
                        "text": "Choose readthrough date",
                    },
                }
            ],
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "_This prompt will repeat daily until the date is set._",
                }
            ],
        },
    ]

    fallback_text = (
        f"📅 Readthrough date needed for {show_name} — "
        "please set it in the Show Setup sheet or use the date picker."
    )

    return {
        "attachments": [{"color": "#6d28d9", "fallback": fallback_text, "blocks": blocks}],
    }


def build_mark_done_confirmation(show_name: str, task_text: str, user_name: str) -> dict:
    """
    Builds the Slack Block Kit payload for a "marked done" confirmation.
    Port of _sendMarkDoneConfirmation() from WebApp.gs.
    """
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"✅ *{task_text}* marked done by {user_name}",
            },
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "↩️ Undo", "emoji": True},
                    "action_id": f"mark_undone:{quote(show_name)}:{quote(task_text)}",
                }
            ],
        },
    ]

    return {
        "attachments": [
            {
                "color": "#059669",
                "fallback": f"✅ {task_text} marked done by {user_name}",
                "blocks": blocks,
            }
        ],
    }


def build_readthrough_confirmation(
    show_name: str, date_str: str, user_name: str, extra_msg: str = ""
) -> dict:
    """
    Builds the Slack Block Kit payload for a readthrough date confirmation.
    Port of _sendReadthroughConfirmation() from WebApp.gs.
    """
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"✅ *Readthrough date for {show_name}* set to *{date_str}* by {user_name}."
                    f"{extra_msg}"
                    "\nMembership Director and Show Support have been notified."
                ),
            },
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "📅 Change Date", "emoji": True},
                    "action_id": f"change_readthrough_date:{quote(show_name)}",
                }
            ],
        },
    ]

    return {
        "attachments": [
            {
                "color": "#6d28d9",
                "fallback": f"✅ Readthrough date for {show_name} set to {date_str}",
                "blocks": blocks,
            }
        ],
    }
