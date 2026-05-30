"""
KWLT Production Automation — Slack Interaction Handlers

Business logic for handling Slack interactive component callbacks
(buttons, date pickers) and Events API events (bot joins, @mentions).
These are called by the FastAPI endpoints and coordinate between
the SheetRepository and SlackClient.

Port of the doPost() handler logic from WebApp.gs.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from typing import Optional
from urllib.parse import unquote

from app.config import settings
from app.constants import FAQ_KEYWORDS
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
    build_home_tab,
    build_home_tab_select_show,
    build_mark_done_confirmation,
    build_readthrough_confirmation,
    build_readthrough_date_prompt,
    build_welcome_message,
)
from app.sheets import SheetRepository
from app.slack_client import SlackClient

logger = logging.getLogger(__name__)

# Per-user lock to prevent concurrent Home tab refreshes
_home_tab_locks: dict[str, threading.Lock] = {}
_locks_lock = threading.Lock()

# Per-user cache for Home tab data (avoids re-fetching on tab switches)
_home_tab_cache: dict[str, dict] = {}
HOME_TAB_CACHE_TTL = 30  # seconds


def _get_user_lock(user_id: str) -> threading.Lock:
    """Get or create a lock for a specific user's Home tab operations."""
    with _locks_lock:
        if user_id not in _home_tab_locks:
            _home_tab_locks[user_id] = threading.Lock()
        return _home_tab_locks[user_id]


def _get_cached_data(user_id: str, show_name: str) -> Optional[dict]:
    """Get cached sheet data if still fresh."""
    key = f"{user_id}:{show_name}"
    cached = _home_tab_cache.get(key)
    if cached and time.time() - cached["ts"] < HOME_TAB_CACHE_TTL:
        return cached
    return None


def _set_cached_data(user_id: str, show_name: str, all_shows: list, task_groups: dict) -> None:
    """Cache sheet data for a user+show."""
    key = f"{user_id}:{show_name}"
    _home_tab_cache[key] = {
        "ts": time.time(),
        "all_shows": all_shows,
        "task_groups": task_groups,
    }


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

    elif action_id.startswith("skip_task:"):
        try:
            _handle_skip_task(action_id, user_name, response_url, channel, sheets, slack)
        except ValueError as e:
            logger.error(f"Malformed skip_task action_id: {e}")
            slack.send_response_url(response_url, "⚠️ Something went wrong parsing that action.", ephemeral=True)

    elif action_id.startswith("readthrough_date:"):
        selected_date = payload.get("actions", [{}])[0].get("selected_date")
        _handle_readthrough_date(action_id, selected_date, user_name, response_url, channel, sheets, slack)

    elif action_id.startswith("change_readthrough_date:"):
        _handle_change_readthrough_date(action_id, channel, response_url, sheets, slack)

    elif action_id.startswith("change_task_date:"):
        selected_date = payload.get("actions", [{}])[0].get("selected_date")
        if selected_date:
            try:
                show_name, task_text = _parse_action_id(action_id, "change_task_date:")
                user_name = f"<@{payload['user']['id']}>" if payload.get("user") else "Someone"
                result = sheets.update_task_date(show_name, task_text, selected_date)

                if result.success:
                    slack.send_response_url(
                        response_url,
                        f"📅 *{task_text}* deadline changed to *{selected_date}* by {user_name}",
                        ephemeral=False,
                    )
                    # Notify show support
                    if settings.show_support_channel:
                        slack.send_message(
                            settings.show_support_channel,
                            text=f"📅 *Date changed — {show_name}*\n*{task_text}* deadline moved to *{selected_date}* by {user_name}",
                        )
                else:
                    slack.send_response_url(
                        response_url,
                        f"⚠️ Could not change date: {result.message}",
                        ephemeral=True,
                    )
            except ValueError as e:
                logger.error(f"Malformed change_task_date action_id: {e}")
                slack.send_response_url(response_url, "⚠️ Something went wrong parsing that action.", ephemeral=True)

    elif action_id.startswith("home_select_show"):
        selected = payload.get("actions", [{}])[0].get("selected_option", {})
        show_name = selected.get("value", "")
        user_id = payload.get("user", {}).get("id", "")
        if show_name and user_id:
            _refresh_home_tab(user_id, show_name, sheets, slack)

    elif action_id.startswith("home_mark_done:"):
        try:
            show_name, task_text = _parse_action_id(action_id, "home_mark_done:")
            sheets.mark_task_done(show_name, task_text)
            user_id = payload.get("user", {}).get("id", "")
            if user_id:
                _refresh_home_tab(user_id, show_name, sheets, slack, invalidate_cache=True)
        except ValueError as e:
            logger.error(f"Malformed home_mark_done action_id: {e}")

    elif action_id.startswith("home_mark_undone:"):
        try:
            show_name, task_text = _parse_action_id(action_id, "home_mark_undone:")
            sheets.mark_task_undone(show_name, task_text)
            user_id = payload.get("user", {}).get("id", "")
            if user_id:
                _refresh_home_tab(user_id, show_name, sheets, slack, view_mode="completed", invalidate_cache=True)
        except ValueError as e:
            logger.error(f"Malformed home_mark_undone action_id: {e}")

    elif action_id.startswith("home_change_date:"):
        selected_date = payload.get("actions", [{}])[0].get("selected_date")
        if selected_date:
            try:
                show_name, task_text = _parse_action_id(action_id, "home_change_date:")
                result = sheets.update_task_date(show_name, task_text, selected_date)
                user_name = f"<@{payload['user']['id']}>" if payload.get("user") else "Someone"
                user_id = payload.get("user", {}).get("id", "")

                # Notify show support channel about the date change
                if result.success and settings.show_support_channel:
                    slack.send_message(
                        settings.show_support_channel,
                        text=f"📅 *Date changed — {show_name}*\n*{task_text}* deadline moved to *{selected_date}* by {user_name}",
                    )

                if user_id:
                    _refresh_home_tab(user_id, show_name, sheets, slack, invalidate_cache=True)
            except ValueError as e:
                logger.error(f"Malformed home_change_date action_id: {e}")

    elif action_id.startswith("home_refresh:"):
        show_name = _parse_action_id_single(action_id, "home_refresh:")
        user_id = payload.get("user", {}).get("id", "")
        if user_id:
            _refresh_home_tab(user_id, show_name, sheets, slack, invalidate_cache=True)

    elif action_id.startswith("home_view_outstanding:"):
        show_name = _parse_action_id_single(action_id, "home_view_outstanding:")
        user_id = payload.get("user", {}).get("id", "")
        if user_id:
            _refresh_home_tab(user_id, show_name, sheets, slack, view_mode="upcoming")

    elif action_id.startswith("home_view_completed:"):
        show_name = _parse_action_id_single(action_id, "home_view_completed:")
        user_id = payload.get("user", {}).get("id", "")
        if user_id:
            _refresh_home_tab(user_id, show_name, sheets, slack, view_mode="completed")

    elif action_id.startswith("home_view_overdue:"):
        show_name = _parse_action_id_single(action_id, "home_view_overdue:")
        user_id = payload.get("user", {}).get("id", "")
        if user_id:
            _refresh_home_tab(user_id, show_name, sheets, slack, view_mode="overdue")

    elif action_id.startswith("home_view_upcoming:"):
        show_name = _parse_action_id_single(action_id, "home_view_upcoming:")
        user_id = payload.get("user", {}).get("id", "")
        if user_id:
            _refresh_home_tab(user_id, show_name, sheets, slack, view_mode="upcoming")

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


# ─── Skip Task ─────────────────────────────────────────────────────────────────


def _handle_skip_task(
    action_id: str,
    user_name: str,
    response_url: str,
    channel: str,
    sheets: SheetRepository,
    slack: SlackClient,
) -> None:
    """Handle the Skip button interaction for optional tasks."""
    show_name, task_text = _parse_action_id(action_id, "skip_task:")
    result = sheets.mark_task_skipped(show_name, task_text)

    if result.success:
        slack.send_response_url(
            response_url,
            f"⏭️ *{task_text}* skipped by {user_name} — no further reminders will be sent.",
            ephemeral=False,
        )
    else:
        slack.send_response_url(
            response_url,
            f"⚠️ Could not skip: {result.message}",
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


# ─── Events API Handlers ─────────────────────────────────────────────────────


def handle_event(event_body: dict, sheets: SheetRepository, slack: SlackClient) -> None:
    """
    Routes a Slack Events API callback to the appropriate handler.
    Called from the /slack/events endpoint after 200 response.
    """
    event = event_body.get("event", {})
    event_type = event.get("type", "")

    if event_type == "member_joined_channel":
        _handle_member_joined(event, slack)
    elif event_type == "app_mention":
        _handle_app_mention(event, sheets, slack)
    elif event_type == "app_home_opened":
        _handle_app_home_opened(event, sheets, slack)
    else:
        logger.debug(f"Unhandled event type: {event_type}")


def _handle_member_joined(event: dict, slack: SlackClient) -> None:
    """
    Handle the member_joined_channel event.
    Only sends a welcome message if the joining user is the bot itself.
    """
    joining_user = event.get("user", "")
    channel = event.get("channel", "")

    bot_user_id = slack.get_bot_user_id()
    if not bot_user_id or joining_user != bot_user_id:
        return  # Not the bot joining — ignore

    logger.info(f"Bot joined channel {channel} — sending welcome message")
    msg = build_welcome_message()
    slack.send_message(channel, attachments=msg["attachments"])


def _handle_app_mention(event: dict, sheets: SheetRepository, slack: SlackClient) -> None:
    """
    Handle @bot mentions. Parses the mention text for FAQ keywords
    and responds with the matching canned response in a thread.
    """
    text = event.get("text", "")
    channel = event.get("channel", "")
    thread_ts = event.get("thread_ts") or event.get("ts", "")

    # Strip the <@BOT_ID> mention prefix to get the user's query
    query = re.sub(r"<@\w+>", "", text).strip().lower()

    # Match the first keyword found
    topic = _match_faq_topic(query)

    if topic == "help":
        msg = build_help_menu()
    elif topic == "about":
        msg = build_faq_about()
    elif topic == "mark_done":
        msg = build_faq_mark_done()
    elif topic == "handbook":
        msg = build_faq_handbook()
    elif topic == "change_date":
        msg = build_faq_change_date()
    elif topic == "deadlines":
        msg = _build_deadlines_response(channel, sheets, slack)
    else:
        # No keyword matched
        display_query = query if query else "that"
        msg = build_faq_unknown(display_query)

    slack.send_message(channel, attachments=msg["attachments"], thread_ts=thread_ts)


def _match_faq_topic(query: str) -> Optional[str]:
    """
    Match user query text against FAQ keywords.
    Returns the topic identifier or None if no match.
    """
    if not query:
        return "help"  # Bare mention with no text → show help

    words = query.split()
    for word in words:
        if word in FAQ_KEYWORDS:
            return FAQ_KEYWORDS[word]
    return None


def _build_contacts_response(channel: str, sheets: SheetRepository) -> dict:
    """Build contacts FAQ response, looking up show data if possible."""
    try:
        show = sheets.get_show_by_channel(channel)
    except Exception:
        logger.error("Error looking up show by channel", exc_info=True)
        show = None

    if show:
        return build_faq_contacts(show["show_name"], show["show_email"], show["resources_url"])
    return build_faq_contacts_no_show()


def _resolve_channel_name(channel_id: str, slack: SlackClient) -> str:
    """Resolve a Slack channel ID to its name for sheet matching."""
    name = slack.get_channel_name(channel_id)
    return name if name else channel_id


def _build_deadlines_response(channel: str, sheets: SheetRepository, slack: SlackClient) -> dict:
    """Build deadlines FAQ response, looking up upcoming tasks if possible."""
    try:
        channel_name = _resolve_channel_name(channel, slack)
        show = sheets.get_show_by_channel(channel_name)
    except Exception:
        logger.error("Error looking up show by channel", exc_info=True)
        show = None

    if not show:
        return build_faq_deadlines_no_show()

    try:
        tasks = sheets.get_upcoming_tasks(show["show_name"], limit=5)
    except Exception:
        logger.error("Error fetching upcoming tasks", exc_info=True)
        tasks = []

    return build_faq_deadlines(show["show_name"], tasks)


# ─── App Home Tab ─────────────────────────────────────────────────────────────


def _handle_app_home_opened(event: dict, sheets: SheetRepository, slack: SlackClient) -> None:
    """
    Handle the app_home_opened event.
    Publishes the Home tab view with task dashboard for the user.
    """
    user_id = event.get("user", "")
    tab = event.get("tab", "")

    if tab != "home" or not user_id:
        return

    # Check if the user previously selected a show (stored in private_metadata)
    view = event.get("view")
    previous_show = None
    previous_mode = "upcoming"
    if view and isinstance(view, dict):
        metadata = view.get("private_metadata", "")
        if "|" in metadata:
            previous_show, previous_mode = metadata.split("|", 1)
        elif metadata:
            previous_show = metadata

    if previous_show:
        _refresh_home_tab(user_id, previous_show, sheets, slack, view_mode=previous_mode)
    else:
        # First visit or no show selected — show the selector
        try:
            shows = sheets.get_all_active_shows()
        except Exception:
            logger.error("Error fetching shows for Home tab", exc_info=True)
            shows = []

        home_view = build_home_tab_select_show(shows)
        slack.publish_home_tab(user_id, home_view)


def _refresh_home_tab(user_id: str, show_name: str, sheets: SheetRepository, slack: SlackClient, view_mode: str = "upcoming", invalidate_cache: bool = False) -> None:
    """Re-fetch task data and re-publish the Home tab for a user.
    Uses per-user locking and caching to keep tab switches fast."""
    lock = _get_user_lock(user_id)
    if not lock.acquire(blocking=False):
        logger.debug(f"Skipping Home tab refresh for {user_id} — already in progress")
        return

    try:
        if invalidate_cache:
            key = f"{user_id}:{show_name}"
            _home_tab_cache.pop(key, None)

        cached = _get_cached_data(user_id, show_name)
        if cached:
            all_shows = cached["all_shows"]
            task_groups = cached["task_groups"]
        else:
            try:
                all_shows = sheets.get_all_active_shows()
                task_groups = sheets.get_all_tasks(show_name)
                _set_cached_data(user_id, show_name, all_shows, task_groups)
            except Exception:
                logger.error("Error refreshing Home tab data", exc_info=True)
                all_shows = []
                task_groups = {"overdue": [], "due_soon": [], "upcoming": [], "completed": []}

        home_view = build_home_tab(show_name, task_groups, all_shows, view_mode=view_mode)
        slack.publish_home_tab(user_id, home_view)
    finally:
        lock.release()
