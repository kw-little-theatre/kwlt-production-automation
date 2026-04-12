"""
KWLT Production Automation — Pydantic Data Models

Type-safe data contracts for the Slack service. These mirror the shapes
returned by _loadConfig(), _getActiveShows(), and the context objects
passed through the reminder engine.
"""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.constants import (
    OVERDUE_ESCALATION_DAYS,
    REMINDER_ADVANCE_DAYS,
    REMINDER_URGENT_DAYS,
)


class Config(BaseModel):
    """Mirrors the object returned by _loadConfig() in ReminderEngine.gs."""

    slack_bot_token: str = ""
    show_support_channel: str = ""
    show_support_email: str = ""
    web_app_url: str = ""
    membership_email: str = ""
    slack_default_channel: str = ""
    advance_reminder_days: int = REMINDER_ADVANCE_DAYS
    urgent_reminder_days: int = REMINDER_URGENT_DAYS
    overdue_escalation_days: int = OVERDUE_ESCALATION_DAYS
    send_email: bool = True
    send_slack: bool = True
    handbook_url: str = ""


class ActiveShow(BaseModel):
    """Mirrors the objects returned by _getActiveShows() in ReminderEngine.gs."""

    name: str
    slack_channel: str = ""
    show_email: str = ""
    resources_url: str = ""
    audition_end: datetime | None = None
    readthrough_date: datetime | None = None
    readthrough_prompt_last_sent: datetime | None = None
    setup_row_index: int = 0  # 0-based data row index


class TaskContext(BaseModel):
    """
    The context object built per-task during the reminder cycle.
    Mirrors the `context` object in runDailyReminders().
    """

    show_name: str
    task: str
    responsible: str
    general_rule: str = ""
    deadline: str = ""  # yyyy-MM-dd formatted
    days_until: int = 0
    days_overdue: int = 0
    slack_channel: str = ""
    show_email: str = ""
    resources_url: str = ""
    handbook_url: str = ""
    notify_via: str = "both"  # "slack" | "email" | "both" | "none"
    mark_done_url: str = ""


class TaskTemplate(BaseModel):
    """A single task from the master task template list (TaskTemplateData.gs)."""

    task: str
    responsible: str
    general_rule: str = Field(alias="generalRule", default="")
    anchor_ref: str = Field(alias="anchorRef", default="")
    offset_days: int = Field(alias="offsetDays", default=0)
    notify_via: str = Field(alias="notifyVia", default="both")
    recurring: bool = False
    phase: str = ""
    auto_complete: bool = Field(alias="autoComplete", default=False)
    send_on_date: bool = Field(alias="sendOnDate", default=False)
    email_subject: str = Field(alias="emailSubject", default="")
    email_body: str = Field(alias="emailBody", default="")

    model_config = {"populate_by_name": True}


class MarkTaskResult(BaseModel):
    """Result of marking a task done or undone."""

    success: bool
    message: str


class SetReadthroughResult(BaseModel):
    """Result of setting a readthrough date."""

    success: bool
    message: str
    reactivated: int = 0
    was_change: bool = False


class DigestItem(BaseModel):
    """A single item in the daily reminder digest."""

    show: str
    task: str
    responsible: str
    deadline: str
    action: str  # "advance" | "urgent" | "overdue"
    days_until: int
    success: bool
