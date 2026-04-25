"""
KWLT Production Automation — FastAPI Application

Entry point for the Slack service. Handles:
  - Slack interactive component callbacks (buttons, date pickers)
  - Slack Events API (app_mention for RAG Q&A — Phase 4)
  - Email Mark Done links (GET requests)
  - Health check
"""

from __future__ import annotations

import json
import logging

from fastapi import BackgroundTasks, FastAPI, Request, Response

from app.config import settings
from app.handlers import handle_block_action
from app.messages import build_readthrough_date_prompt, build_reminder_blocks
from app.models import DigestItem, TaskContext
from app.reminder_logic import generate_token
from app.verify import verify_slack_signature

logger = logging.getLogger(__name__)

app = FastAPI(
    title="KWLT Slack Service",
    description="Slack bot service for KWLT Production Automation",
    version="0.1.0",
)

# Cached singletons — avoids re-authenticating on every request
_sheets_instance = None
_slack_instance = None


def _get_sheets():
    """Get or create the SheetRepository singleton."""
    global _sheets_instance
    if _sheets_instance is None:
        from app.sheets import SheetRepository
        _sheets_instance = SheetRepository(settings.google_sheets_credentials_file, settings.spreadsheet_id)
    return _sheets_instance


def _get_slack():
    """Get or create the SlackClient singleton."""
    global _slack_instance
    if _slack_instance is None:
        from app.slack_client import SlackClient
        _slack_instance = SlackClient(settings.slack_bot_token)
    return _slack_instance


@app.get("/health")
async def health_check():
    """Health check endpoint for Cloud Run."""
    return {"status": "ok"}


# ─── Slack Interaction Handler ────────────────────────────────────────────────


@app.post("/slack/interactions")
async def slack_interactions(request: Request, background_tasks: BackgroundTasks):
    """
    Handles Slack interactive component callbacks (buttons, date pickers).
    Replaces doPost() from WebApp.gs.

    Slack sends a URL-encoded body with a 'payload' JSON field.
    We must respond with 200 within 3 seconds — all heavy work
    (sheet writes, follow-up messages) runs in a background task.
    """
    body = await request.body()

    # Verify Slack signature (security improvement over Apps Script)
    if settings.slack_signing_secret:
        timestamp = request.headers.get("X-Slack-Request-Timestamp", "")
        signature = request.headers.get("X-Slack-Signature", "")
        if not verify_slack_signature(settings.slack_signing_secret, timestamp, body, signature):
            logger.warning("Slack signature verification failed")
            return Response(status_code=401, content="Invalid signature")

    # Parse the payload
    form_data = await request.form()
    payload_str = form_data.get("payload", "")
    if not payload_str:
        return Response(status_code=400, content="Missing payload")

    payload = json.loads(payload_str)

    if payload.get("type") != "block_actions":
        return Response(status_code=200, content="")

    action = payload.get("actions", [{}])[0]
    action_id = action.get("action_id", "")

    # Return 200 immediately to meet Slack's 3-second deadline.
    # Sheet writes and follow-up messages run in a background task.
    background_tasks.add_task(_process_interaction, action_id, payload)

    return Response(status_code=200, content="")


def _process_interaction(action_id: str, payload: dict) -> None:
    """Background task that processes a Slack interaction after the 200 response."""
    try:
        sheets = _get_sheets()
        slack = _get_slack()
        handle_block_action(action_id, payload, sheets, slack)
    except Exception as e:
        logger.error(f"Error handling interaction: {e}", exc_info=True)


# ─── Email Mark Done Handler ─────────────────────────────────────────────────


@app.get("/mark-done")
def mark_done_get(action: str = "", show: str = "", task: str = "", token: str = ""):
    """
    Handles Mark Done links from emails.
    Replaces doGet() from WebApp.gs.

    URL format: /mark-done?action=done&show=ShowName&task=TaskText&token=abc123

    This is a sync endpoint (not async) because gspread uses blocking I/O.
    FastAPI will run it in a threadpool automatically.
    """
    if action != "done" or not show or not task or not token:
        return _html_response("Invalid Request", "This link appears to be malformed or expired.", False)

    # Verify token
    expected_token = generate_token(settings.spreadsheet_id, show, task)
    if token != expected_token:
        return _html_response("Invalid Token", "This link may have expired or been tampered with.", False)

    try:
        sheets = _get_sheets()
        result = sheets.mark_task_done(show, task)

        if result.success:
            return _html_response(
                "Task Marked Done",
                f"{task} — Show: {show} — You can close this tab.",
                True,
            )
        else:
            return _html_response("Could Not Update", result.message, False)
    except Exception as e:
        logger.error(f"Error handling mark-done: {e}", exc_info=True)
        return _html_response("Error", "An unexpected error occurred.", False)


def _html_response(title: str, body: str, success: bool) -> Response:
    """Renders a simple HTML response page. Port of _htmlResponse() from WebApp.gs.

    Both title and body are HTML-escaped inside this function to prevent XSS.
    Uses html.escape from the standard library (recognized by CodeQL as a
    safe sanitizer).
    """
    import html

    safe_title = html.escape(title)
    safe_body = html.escape(body)

    color = "#059669" if success else "#dc2626"
    bg_color = "#d1fae5" if success else "#fee2e2"
    icon = "🎭" if success else "⚠️"

    html = f"""<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>{safe_title} — KWLT</title>
<style>
body {{ font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
display: flex; justify-content: center; align-items: center; min-height: 100vh;
margin: 0; background: #f9fafb; }}
.card {{ background: white; border-radius: 12px; padding: 40px; max-width: 480px;
box-shadow: 0 4px 6px rgba(0,0,0,0.07); text-align: center; }}
.icon {{ font-size: 48px; margin-bottom: 16px; }}
h1 {{ color: {color}; margin: 0 0 16px 0; font-size: 24px; }}
p {{ color: #374151; line-height: 1.6; margin: 0; }}
.badge {{ display: inline-block; background: {bg_color}; color: {color};
padding: 4px 12px; border-radius: 20px; font-size: 13px; margin-top: 16px; }}
</style></head><body><div class="card">
<div class="icon">{icon}</div>
<h1>{safe_title}</h1>
<p>{safe_body}</p>
<div class="badge">KWLT Production Automation</div>
</div></body></html>"""

    return Response(content=html, media_type="text/html")


# ── Outbound Reminder Endpoints (Phase 3 — thin proxy) ───────────────────────
# Apps Script computes the reminder contexts and POSTs them here.
# The Python service handles Slack message delivery.


@app.post("/reminders/send")
def reminders_send(context: TaskContext):
    """
    Sends a Slack reminder message for a single task.
    Apps Script calls this instead of sendSlackBlockMessageWithButton() directly.

    Accepts a TaskContext, builds the block message, sends it to the show's
    Slack channel, and threads a detail reply. Returns the Slack result.
    """
    slack = _get_slack()

    if not context.slack_channel:
        return {"ok": False, "error": "No Slack channel specified"}

    # Determine action type from days_until
    if context.days_until <= -settings.overdue_escalation_days:
        action = "overdue"
    elif context.days_until <= settings.urgent_reminder_days:
        action = "urgent"
    else:
        action = "advance"

    # Override for optional tasks — only advance
    if context.is_optional:
        action = "advance"

    # Build the block message
    msg = build_reminder_blocks(context.model_dump(), action)

    # Send parent message
    parent_result = slack.send_message(
        context.slack_channel,
        attachments=msg["attachments"],
    )

    # Send threaded reply with details
    if parent_result.get("ok") and parent_result.get("ts") and msg.get("thread_text"):
        slack.send_message(
            context.slack_channel,
            text=msg["thread_text"],
            thread_ts=parent_result["ts"],
        )

    return parent_result


@app.post("/reminders/digest")
def reminders_digest(items: list[DigestItem]):
    """
    Sends the daily reminder digest to the Show Support Slack channel.
    Apps Script calls this instead of _sendDailyDigestSlack() directly.
    """
    slack = _get_slack()

    if not settings.show_support_channel:
        return {"ok": False, "error": "No Show Support channel configured"}

    from datetime import date
    today = date.today().strftime("%Y-%m-%d")

    # Group by show
    by_show: dict[str, list[DigestItem]] = {}
    for item in items:
        by_show.setdefault(item.show, []).append(item)

    text = f"📋 *Show Support Reminder Summary — {today}*\n\n"

    for show, show_items in by_show.items():
        text += f"🎭 *{show}*\n"
        for item in show_items:
            icon = "🚨" if item.action == "overdue" else "⚠️" if item.action == "urgent" else "📋"
            status = "sent" if item.success else "FAILED"
            if item.days_until < 0:
                timing = f"{abs(item.days_until)}d overdue"
            elif item.days_until == 0:
                timing = "TODAY"
            else:
                timing = f"{item.days_until}d remaining"
            text += f"  {icon} {item.task} — {item.responsible} — {timing} [{status}]\n"
        text += "\n"

    sent = sum(1 for i in items if i.success)
    text += f"_{sent}/{len(items)} reminders sent successfully._"

    result = slack.send_message(settings.show_support_channel, text=text)
    return result


@app.post("/reminders/readthrough-prompt")
def reminders_readthrough_prompt(show_name: str, channel: str):
    """
    Sends a readthrough date picker prompt to a show's Slack channel.
    Apps Script calls this instead of sendReadthroughDatePrompt() directly.
    """
    slack = _get_slack()

    if not channel:
        return {"ok": False, "error": "No channel specified"}

    msg = build_readthrough_date_prompt(show_name)
    result = slack.send_message(channel, attachments=msg["attachments"])
    return result


# ── Slack Events API (Phase 4 — RAG Q&A) ────────────────────────────────────
# TODO: POST /slack/events — handles app_mention events
