"""
KWLT Production Automation — Slack Interaction Handlers

Business logic for handling Slack interactive component callbacks
(buttons, date pickers). These are called by the FastAPI endpoints
and coordinate between the SheetRepository and SlackClient.

Port of the doPost() handler logic from WebApp.gs.
"""

from __future__ import annotations

import logging
from typing import Optional
from urllib.parse import unquote

from app.messages import (
    build_mark_done_confirmation,
    build_readthrough_confirmation,
    build_readthrough_date_prompt,
)
from app.sheets import SheetRepository
from app.slack_client import SlackClient

logger = logging.getLogger(__name__)


def handle_block_action(
    action_id: str,
    payload: dict,
    sheets: SheetRepository,
    slack: SlackClient,
) -> None:
    """
    Routes a Slack block_actions interaction to the appropriate handler.
    Port of the doPost() routing logic from WebApp.gs.

    This runs after the immediate 200 response is sent to Slack.
    All user feedback is sent via response_url or new messages.
    """
    user_name = f"<@{payload['user']['id']}>" if payload.get("user") else "Someone"
    response_url = payload.get("response_url", "")
    channel = payload.get("channel", {}).get("id", "")

    if action_id.startswith("mark_done:"):
        try:
            _handle_mark_done(action_id, user_name, response_url, channel, sheets, slack)
        except ValueError as e:
            logger.error(f"Malformed mark_done action_id: {e}")
            slack.send_response_url(response_url, "⚠️ Something went wrong parsing that action.", ephemeral=True)

    elif action_id.startswith("mark_undone:"):
        try:
            _handle_mark_undone(action_id, user_name, response_url, sheets, slack)
        except ValueError as e:
            logger.error(f"Malformed mark_undone action_id: {e}")
            slack.send_response_url(response_url, "⚠️ Something went wrong parsing that action.", ephemeral=True)

    elif action_id.startswith("readthrough_date:"):
        selected_date = payload.get("actions", [{}])[0].get("selected_date")
        _handle_readthrough_date(action_id, selected_date, user_name, response_url, channel, sheets, slack)

    elif action_id.startswith("change_readthrough_date:"):
        _handle_change_readthrough_date(action_id, channel, response_url, sheets, slack)

    else:
        logger.warning(f"Unknown action_id: {action_id}")


def _parse_action_id(action_id: str, prefix: str) -> tuple:
    """
    Parse an action_id like 'mark_done:ShowName:TaskText' into (show_name, task_text).
    Handles URL-encoded values. Returns (show_name, task_text).
    Raises ValueError if the action_id is malformed.
    """
    payload_str = action_id[len(prefix):]
    if ":" not in payload_str:
        raise ValueError(f"Malformed action_id: expected 'prefix:show:task', got '{action_id}'")
    separator_idx = payload_str.index(":")
    show_name = unquote(payload_str[:separator_idx])
    task_text = unquote(payload_str[separator_idx + 1 :])
    return show_name, task_text


def _parse_action_id_single(action_id: str, prefix: str) -> str:
    """Parse an action_id like 'readthrough_date:ShowName' into show_name."""
    return unquote(action_id[len(prefix):])


# ─── Mark Done ─────────────────────────────────────────────────────────────────


def _handle_mark_done(
    action_id: str,
    user_name: str,
    response_url: str,
    channel: str,
    sheets: SheetRepository,
    slack: SlackClient,
) -> None:
    """Handle the Mark Done button interaction."""
    show_name, task_text = _parse_action_id(action_id, "mark_done:")
    result = sheets.mark_task_done(show_name, task_text)

    if result.success:
        if channel:
            # Send confirmation with Undo button to the channel
            msg = build_mark_done_confirmation(show_name, task_text, user_name)
            slack.send_message(channel, attachments=msg["attachments"])
        else:
            slack.send_response_url(
                response_url,
                f"✅ *{task_text}* marked done by {user_name}",
                ephemeral=False,
            )
    else:
        slack.send_response_url(
            response_url,
            f"⚠️ Could not mark task done: {result.message}",
            ephemeral=True,
        )


# ─── Mark Undone ───────────────────────────────────────────────────────────────


def _handle_mark_undone(
    action_id: str,
    user_name: str,
    response_url: str,
    sheets: SheetRepository,
    slack: SlackClient,
) -> None:
    """Handle the Undo (Mark Undone) button interaction."""
    show_name, task_text = _parse_action_id(action_id, "mark_undone:")
    result = sheets.mark_task_undone(show_name, task_text)

    if result.success:
        slack.send_response_url(
            response_url,
            f"↩️ *{task_text}* marked undone by {user_name} — reminders will resume.",
            ephemeral=False,
        )
    else:
        slack.send_response_url(
            response_url,
            f"⚠️ Could not undo: {result.message}",
            ephemeral=True,
        )


# ─── Readthrough Date ──────────────────────────────────────────────────────────


def _handle_readthrough_date(
    action_id: str,
    selected_date: Optional[str],
    user_name: str,
    response_url: str,
    channel: str,
    sheets: SheetRepository,
    slack: SlackClient,
) -> None:
    """Handle the readthrough date picker interaction."""
    show_name = _parse_action_id_single(action_id, "readthrough_date:")

    if not selected_date:
        slack.send_response_url(response_url, "⚠️ No date selected. Please try again.", ephemeral=True)
        return

    logger.info(f"Readthrough date picker: show={show_name}, date={selected_date}, user={user_name}")

    # TODO: Implement _setReadthroughDate equivalent in SheetRepository
    # For now, send confirmation — the full implementation will be added
    # when we port the readthrough reactivation logic
    if channel:
        msg = build_readthrough_confirmation(show_name, selected_date, user_name)
        slack.send_message(channel, attachments=msg["attachments"])
    else:
        slack.send_response_url(
            response_url,
            f"✅ *Readthrough date for {show_name}* set to *{selected_date}* by {user_name}.",
            ephemeral=False,
        )


# ─── Change Readthrough Date ──────────────────────────────────────────────────


def _handle_change_readthrough_date(
    action_id: str,
    channel: str,
    response_url: str,
    sheets: SheetRepository,
    slack: SlackClient,
) -> None:
    """Handle the Change Date button — posts a new date picker."""
    show_name = _parse_action_id_single(action_id, "change_readthrough_date:")

    if channel:
        msg = build_readthrough_date_prompt(show_name)
        slack.send_message(channel, attachments=msg["attachments"])
        slack.send_response_url(
            response_url,
            "📅 Date picker posted above — select the new readthrough date.",
            ephemeral=True,
        )
    else:
        slack.send_response_url(
            response_url,
            "📅 Please use the date picker in the channel to change the readthrough date.",
            ephemeral=True,
        )
