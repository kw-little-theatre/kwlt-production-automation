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
                    "👋 *Hey there! I'm the Show Support Bot.*\n\n"
                    "I'll be sending task reminders to this channel as your "
                    "production deadlines approach."
                ),
            },
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    "📋 *Send reminders* — advance (7 days out), urgent (1 day), "
                    "and overdue alerts\n"
                    "✅ *Mark Done buttons* — update task status right from Slack (with undo!)\n"
                    "⏭️ *Skip optional tasks* — some tasks are optional and can be skipped\n"
                    "📅 *Readthrough date picker* — I'll ask for the readthrough date after auditions"
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
                    "text": "💡 *Tip:* Mention me anytime with `help` to see what I can answer.",
                }
            ],
        },
    ]

    return {
        "attachments": [
            {
                "color": "#2563eb",
                "fallback": "👋 Show Support Bot has joined the channel! Mention me with help for info.",
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
                    "• `@Show Support Bot about` — What does this bot do?\n"
                    "• `@Show Support Bot done` — How do I mark a task done?\n"
                    "• `@Show Support Bot handbook` — Where's the production handbook?\n"
                    "• `@Show Support Bot deadlines` — What are the upcoming deadlines?\n"
                    "• `@Show Support Bot date` — How do I change a date?"
                ),
            },
        },
        {
            "type": "context",
            "elements": [
                {
                    "type": "mrkdwn",
                    "text": "_These are the topics I can help with right now._",
                }
            ],
        },
    ]

    return {
        "attachments": [
            {
                "color": "#6d28d9",
                "fallback": "📖 Show Support Bot Help — mention me with: about, done, handbook, deadlines, date",
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
        "or reach out in *#comm-show-support*."
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
                    "is listed for your show, or ask in *#comm-show-support*."
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


def build_faq_handbook() -> dict:
    """FAQ: Where can I find the production handbook?"""
    handbook_url = "https://drive.google.com/drive/folders/1_O9M8-m0Y3iGB0527LKbhTb3tlpP1KGW?usp=drive_link"
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": (
                    "📖 *Production Handbook & Resources*\n\n"
                    f"📖 <{handbook_url}|Click here to open the Production Handbook>\n\n"
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
    blocks = [
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": f"📅 *Upcoming Deadlines — {show_name}*",
            },
        },
    ]

    if not tasks:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "_No upcoming tasks found — all caught up! 🎉_",
            },
        })
    else:
        for t in tasks:
            is_done = t["status"] in ("Done", "Skipped")
            status_icon = "✅" if t["status"] == "Done" else "⏭️" if t["status"] == "Skipped" else "📋"
            task_text = f"{status_icon} *{t['task']}*\n{t['responsible']}  ·  {t['deadline']}"

            section = {
                "type": "section",
                "text": {
                    "type": "mrkdwn",
                    "text": task_text,
                },
            }

            # Add Mark Done button for pending tasks
            if not is_done:
                section["accessory"] = {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "✅ Done", "emoji": True},
                    "action_id": f"mark_done:{quote(show_name)}:{quote(t['task'])}",
                }

            blocks.append(section)

    blocks.append({
        "type": "context",
        "elements": [
            {
                "type": "mrkdwn",
                "text": "_Showing the next pending tasks. Check the show's timeline tab for the full list._",
            }
        ],
    })

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
                    "is listed for your show, or ask in *#comm-show-support*."
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
                    "`help` · `about` · `done` · `handbook` · `deadlines` · `date`"
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


# ─── App Home Tab Views ──────────────────────────────────────────────────────
# Home tab views use top-level blocks (not attachments).
# They return {"type": "home", "blocks": [...]} for views.publish().


def build_home_tab_select_show(shows: list[dict]) -> dict:
    """
    Builds the initial Home tab view with a show selector dropdown.
    Shown when the user hasn't selected a show yet.
    """
    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": "🎭 KWLT Show Support Bot", "emoji": True},
        },
        {
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "Welcome! Select your show below to see tasks and deadlines.",
            },
        },
        {"type": "divider"},
    ]

    if shows:
        options = [
            {
                "text": {"type": "plain_text", "text": s["show_name"], "emoji": True},
                "value": s["show_name"],
            }
            for s in shows
        ]
        blocks.append({
            "type": "actions",
            "elements": [
                {
                    "type": "static_select",
                    "placeholder": {"type": "plain_text", "text": "Choose a show…"},
                    "action_id": "home_select_show",
                    "options": options,
                }
            ],
        })
    else:
        blocks.append({
            "type": "section",
            "text": {
                "type": "mrkdwn",
                "text": "_No shows found in the spreadsheet._",
            },
        })

    return {"type": "home", "blocks": blocks}


def build_home_tab(show_name: str, task_groups: dict, all_shows: list[dict]) -> dict:
    """
    Builds the full Home tab view for a selected show.
    task_groups has keys: overdue, due_soon, upcoming, completed.
    Each value is a list of dicts: task, responsible, deadline, status.
    """
    # Header + show selector
    show_options = [
        {
            "text": {"type": "plain_text", "text": s["show_name"], "emoji": True},
            "value": s["show_name"],
        }
        for s in all_shows
    ]

    blocks = [
        {
            "type": "header",
            "text": {"type": "plain_text", "text": f"🎭 {show_name}", "emoji": True},
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "static_select",
                    "placeholder": {"type": "plain_text", "text": "Switch show…"},
                    "action_id": "home_select_show",
                    "options": show_options,
                    "initial_option": next(
                        (o for o in show_options if o["value"] == show_name),
                        show_options[0] if show_options else None,
                    ),
                },
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "🔄 Refresh", "emoji": True},
                    "action_id": f"home_refresh:{quote(show_name)}",
                },
            ],
        },
        {"type": "divider"},
    ]

    # ─── Task sections by urgency ────────────────────────────────────
    section_configs = [
        ("overdue", "🚨 Overdue"),
        ("due_soon", "⚠️ Due Soon (next 7 days)"),
        ("upcoming", "📋 Upcoming"),
        ("completed", "✅ Completed"),
    ]

    total_tasks = sum(len(task_groups.get(key, [])) for key in ["overdue", "due_soon", "upcoming", "completed"])

    if total_tasks == 0:
        blocks.append({
            "type": "section",
            "text": {"type": "mrkdwn", "text": "_No tasks found for this show._"},
        })
    else:
        for group_key, group_label in section_configs:
            tasks = task_groups.get(group_key, [])
            if not tasks:
                continue

            # Section header
            blocks.append({
                "type": "header",
                "text": {"type": "plain_text", "text": f"{group_label} ({len(tasks)})", "emoji": True},
            })

            # Task rows
            is_completed = group_key == "completed"
            for t in tasks:
                blocks.extend(_build_home_task_row(show_name, t, is_completed))

            blocks.append({"type": "divider"})

    # Keep blocks under 100 limit — trim completed if needed
    if len(blocks) > 95:
        # Find where completed section starts and truncate
        blocks = blocks[:92]
        blocks.append({
            "type": "context",
            "elements": [{"type": "mrkdwn", "text": "_Some completed tasks hidden. Check the spreadsheet for the full list._"}],
        })

    return {
        "type": "home",
        "private_metadata": show_name,
        "blocks": blocks,
    }


def _build_home_task_row(show_name: str, task: dict, is_completed: bool) -> list[dict]:
    """
    Builds the Block Kit blocks for a single task row in the Home tab.
    Returns a list of 1-2 blocks (section + optional actions).
    """
    task_text = task["task"]
    responsible = task["responsible"]
    deadline = task["deadline"] or "No date"
    status = task["status"]

    if is_completed:
        icon = "✅" if status == "Done" else "⏭️"
        section_text = f"{icon} ~{task_text}~\n_{responsible}  ·  {deadline}_"
        return [{
            "type": "section",
            "text": {"type": "mrkdwn", "text": section_text},
        }]

    # Pending task — show with Done button and date picker as accessories
    section_text = f"*{task_text}*\n{responsible}  ·  📅 {deadline}"

    blocks = [
        {
            "type": "section",
            "text": {"type": "mrkdwn", "text": section_text},
            "accessory": {
                "type": "datepicker",
                "action_id": f"home_change_date:{quote(show_name)}:{quote(task_text)}",
                "placeholder": {"type": "plain_text", "text": "Change date"},
                **({"initial_date": deadline} if _is_valid_date(deadline) else {}),
            },
        },
        {
            "type": "actions",
            "elements": [
                {
                    "type": "button",
                    "text": {"type": "plain_text", "text": "✅ Mark Done", "emoji": True},
                    "style": "primary",
                    "action_id": f"home_mark_done:{quote(show_name)}:{quote(task_text)}",
                },
            ],
        },
    ]

    return blocks


def _is_valid_date(date_str: str) -> bool:
    """Check if a string is a valid YYYY-MM-DD date for Slack's datepicker."""
    import re
    return bool(re.match(r"^\d{4}-\d{2}-\d{2}$", date_str))
