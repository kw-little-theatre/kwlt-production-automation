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
    is_optional = context.get("is_optional", context.get("isOptional", False))
    emoji = "❔" if is_optional else "🚨" if action == "overdue" else "⚠️" if action == "urgent" else "📋"
    color = "#a78bfa" if is_optional else "#dc2626" if action == "overdue" else "#f59e0b" if action == "urgent" else "#2563eb"
    label = "Optional" if is_optional else "Overdue" if action == "overdue" else "Due tomorrow" if action == "urgent" else "Upcoming"

    show_name = context.get("show_name", context.get("showName", ""))
    task = context.get("task", "")
    responsible = context.get("responsible", "")
    deadline = context.get("deadline", "")
    days_until = context.get("days_until", context.get("daysUntil", 0))
    days_overdue = context.get("days_overdue", context.get("daysOverdue", 0))
    general_rule = context.get("general_rule", context.get("generalRule", ""))
    handbook_url = context.get("handbook_url", context.get("handbookUrl", ""))
    resources_url = context.get("resources_url", context.get("resourcesUrl", ""))

    # Primary message text
    task_line = f"{emoji} *{label}:* {task}\n👤 *Responsible:* {responsible}  |  📅 *Due:* {deadline}"
    if is_optional:
        task_line += "\n_This task is optional — skip it if not applicable to your production._"

    # Primary message blocks
    primary_blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": task_line,
            },
        },
    ]

    # Buttons: Mark Done + Skip (for optional) or just Mark Done
    buttons = [
        {
            "type": "button",
            "text": {"type": "plain_text", "text": "✅ Mark Done", "emoji": True},
            "style": "primary",
            "action_id": f"mark_done:{quote(show_name)}:{quote(task)}",
        }
    ]

    if is_optional:
        buttons.append({
            "type": "button",
            "text": {"type": "plain_text", "text": "⏭️ Skip", "emoji": True},
            "action_id": f"skip_task:{quote(show_name)}:{quote(task)}",
        })

    primary_blocks.append({
        "type": "actions",
        "elements": buttons,
    })

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


# ─── Welcome & Help Messages ─────────────────────────────────────────────────


def build_welcome_message() -> dict:
    """
    Builds the welcome message posted when the bot joins a channel.
    Introduces the bot and explains what it does.
    """
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    "👋 *Hey there! I'm the KWLT Production Bot.*\n\n"
                    "I'll be sending task reminders to this channel as your "
                    "production deadlines approach. Here's what I do:\n\n"
                    "• 📋 *Send reminders* — advance (7 days out), urgent (1 day), "
                    "and overdue alerts for your production tasks\n"
                    "• ✅ *Mark Done buttons* — click to mark tasks complete "
                    "right from Slack (with undo!)\n"
                    "• ⏭️ *Skip optional tasks* — some tasks are optional and can be skipped\n"
                    "• 📅 *Readthrough date picker* — I'll ask for your "
                    "readthrough date after auditions wrap"
                ),
            },
        },
        {
            "type": "divider",
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "💡 *Tip:* Mention me with `@KWLT Bot help` anytime to see what I can answer.",
                }
            ],
        },
    ]

    return {
        "attachments": [
            {
                "color": "#2563eb",
                "fallback": "👋 KWLT Production Bot has joined the channel! Mention me with @KWLT Bot help for info.",
                "blocks": blocks,
            }
        ],
    }


def build_help_menu() -> dict:
    """
    Builds the full help/FAQ menu listing all available topics.
    Shown in response to '@bot help'.
    """
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    "📖 *KWLT Production Bot — Help*\n\n"
                    "Mention me with any of these topics and I'll give you the details:\n\n"
                    "• `@bot about` — What does this bot do?\n"
                    "• `@bot done` — How do I mark a task done?\n"
                    "• `@bot contacts` — Who are my show contacts?\n"
                    "• `@bot handbook` — Where's the production handbook?\n"
                    "• `@bot deadlines` — What are the upcoming deadlines?\n"
                    "• `@bot date` — How do I change a date?"
                ),
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "_I can only answer these canned topics for now. Full Q&A coming soon!_",
                }
            ],
        },
    ]

    return {
        "attachments": [
            {
                "color": "#6d28d9",
                "fallback": "📖 KWLT Bot Help — mention me with: about, done, contacts, handbook, deadlines, date",
                "blocks": blocks,
            }
        ],
    }


def build_faq_about() -> dict:
    """FAQ: What does this bot do?"""
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    "🤖 *What does this bot do?*\n\n"
                    "I'm the KWLT Production Automation bot. I help production teams "
                    "stay on track by:\n\n"
                    "• Sending *task reminders* as deadlines approach (7 days, 1 day, and overdue)\n"
                    "• Providing *Mark Done* buttons so you can update task status right from Slack\n"
                    "• *Escalating overdue tasks* to Show Support if they're not addressed\n"
                    "• *Prompting for the readthrough date* after auditions wrap\n"
                    "• Posting a *daily summary* to the Show Support channel\n\n"
                    "All the task data lives in a Google Sheet managed by Show Support. "
                    "I just make sure nothing falls through the cracks!"
                ),
            },
        },
    ]

    return {
        "attachments": [
            {
                "color": "#0891b2",
                "fallback": "🤖 I'm the KWLT Production Bot — I send task reminders and track deadlines.",
                "blocks": blocks,
            }
        ],
    }


def build_faq_mark_done() -> dict:
    """FAQ: How do I mark a task done?"""
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    "✅ *How do I mark a task done?*\n\n"
                    "There are two ways:\n\n"
                    "*1. Slack button* — When you get a reminder, click the "
                    "✅ *Mark Done* button right on the message. A confirmation "
                    "will appear with an ↩️ Undo button in case you clicked by mistake.\n\n"
                    "*2. Email link* — Reminder emails include a ✅ Mark Done link "
                    "that opens a confirmation page.\n\n"
                    "You can also skip optional tasks using the ⏭️ *Skip* button — "
                    "no more reminders will be sent for that task."
                ),
            },
        },
    ]

    return {
        "attachments": [
            {
                "color": "#0891b2",
                "fallback": "✅ Mark tasks done via the button on Slack reminders or the link in emails.",
                "blocks": blocks,
            }
        ],
    }


def build_faq_contacts(show_name: str, show_email: str, resources_url: str) -> dict:
    """FAQ: Who are my show contacts? Uses live data from the sheet."""
    detail_lines = [f"🎭 *Show:* {show_name}"]

    if show_email:
        detail_lines.append(f"📧 *Show Email:* {show_email}")
    if resources_url:
        detail_lines.append(f"📁 *Resources:* <{resources_url}|Show Resources Folder>")

    detail_lines.append(
        "\nFor other contacts, check the Show Setup tab in the spreadsheet "
        "or reach out in the Show Support channel."
    )

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "👥 *Show Contacts*\n\n" + "\n".join(detail_lines),
            },
        },
    ]

    return {
        "attachments": [
            {
                "color": "#0891b2",
                "fallback": f"👥 Show contacts for {show_name}",
                "blocks": blocks,
            }
        ],
    }


def build_faq_contacts_no_show() -> dict:
    """FAQ: Contacts fallback when no show is linked to this channel."""
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    "👥 *Show Contacts*\n\n"
                    "I couldn't find a show linked to this channel. "
                    "Check the *🎭 Show Setup* sheet to make sure this channel "
                    "is listed for your show, or ask in the Show Support channel."
                ),
            },
        },
    ]

    return {
        "attachments": [
            {
                "color": "#0891b2",
                "fallback": "👥 No show found for this channel — check Show Setup.",
                "blocks": blocks,
            }
        ],
    }


def build_faq_handbook(handbook_url: str) -> dict:
    """FAQ: Where can I find the production handbook?"""
    if handbook_url:
        link_text = f"📖 <{handbook_url}|Click here to open the Production Handbook>"
    else:
        link_text = "_(No handbook URL is configured — ask Show Support for the link.)_"

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    "📖 *Production Handbook & Resources*\n\n"
                    f"{link_text}\n\n"
                    "The handbook covers role responsibilities, timeline expectations, "
                    "and processes for every stage of production. It's your go-to reference!"
                ),
            },
        },
    ]

    return {
        "attachments": [
            {
                "color": "#0891b2",
                "fallback": "📖 Production Handbook — check the link in the message.",
                "blocks": blocks,
            }
        ],
    }


def build_faq_deadlines(show_name: str, tasks: list[dict]) -> dict:
    """
    FAQ: What are the key deadlines? Uses live data from the sheet.
    tasks is a list of dicts with keys: task, responsible, deadline, status.
    """
    if not tasks:
        task_lines = "_No upcoming tasks found — all caught up! 🎉_"
    else:
        lines = []
        for t in tasks:
            status_icon = "✅" if t["status"] == "Done" else "⏭️" if t["status"] == "Skipped" else "📋"
            lines.append(f"  {status_icon} *{t['task']}* — {t['responsible']} — {t['deadline']}")
        task_lines = "\n".join(lines)

    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"📅 *Upcoming Deadlines — {show_name}*\n\n"
                    f"{task_lines}"
                ),
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "_Showing the next pending tasks. Check the show's timeline tab for the full list._",
                }
            ],
        },
    ]

    return {
        "attachments": [
            {
                "color": "#0891b2",
                "fallback": f"📅 Upcoming deadlines for {show_name}",
                "blocks": blocks,
            }
        ],
    }


def build_faq_deadlines_no_show() -> dict:
    """FAQ: Deadlines fallback when no show is linked to this channel."""
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    "📅 *Upcoming Deadlines*\n\n"
                    "I couldn't find a show linked to this channel. "
                    "Check the *🎭 Show Setup* sheet to make sure this channel "
                    "is listed for your show."
                ),
            },
        },
    ]

    return {
        "attachments": [
            {
                "color": "#0891b2",
                "fallback": "📅 No show found for this channel — check Show Setup.",
                "blocks": blocks,
            }
        ],
    }


def build_faq_change_date() -> dict:
    """FAQ: How do I change a date?"""
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    "📅 *How do I change a date?*\n\n"
                    "• *Readthrough date:* I'll send a date picker after auditions — "
                    "just pick a new date. You can also click 📅 *Change Date* on the "
                    "confirmation message.\n\n"
                    "• *Task deadlines:* Edit the *Computed Deadline* column in your "
                    "show's 🎬 timeline tab in the spreadsheet.\n\n"
                    "• *Anchor dates* (Opening Night, Audition Start, etc.): "
                    "Edit the *🎭 Show Setup* sheet. Note that changing anchor dates "
                    "doesn't automatically recompute existing task deadlines — you may "
                    "need to regenerate the timeline."
                ),
            },
        },
    ]

    return {
        "attachments": [
            {
                "color": "#0891b2",
                "fallback": "📅 Change dates in the spreadsheet or use the readthrough date picker.",
                "blocks": blocks,
            }
        ],
    }


def build_faq_unknown(user_text: str) -> dict:
    """Fallback when no FAQ keyword matches the user's mention text."""
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    f"🤔 I'm not sure what you mean by \"{user_text}\".\n\n"
                    "Try mentioning me with one of these:\n"
                    "`help` · `about` · `done` · `contacts` · `handbook` · `deadlines` · `date`"
                ),
            },
        },
    ]

    return {
        "attachments": [
            {
                "color": "#6d28d9",
                "fallback": "🤔 I didn't understand that — try @bot help",
                "blocks": blocks,
            }
        ],
    }
