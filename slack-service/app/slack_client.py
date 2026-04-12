"""
KWLT Production Automation — Slack Client

Thin wrapper around slack_sdk for sending messages to Slack.
Replaces the sendSlack() / UrlFetchApp.fetch() calls from
SlackIntegration.gs.
"""

from __future__ import annotations

import logging

from typing import Optional

from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError

logger = logging.getLogger(__name__)


class SlackClient:
    """Wraps slack_sdk.WebClient for sending messages."""

    def __init__(self, bot_token: str):
        self.client = WebClient(token=bot_token)

    def send_message(
        self,
        channel: str,
        text: str = "",
        attachments: Optional[list] = None,
        thread_ts: Optional[str] = None,
    ) -> dict:
        """
        Send a message to a Slack channel.
        Port of sendSlack() from SlackIntegration.gs.

        Returns: { "ok": bool, "ts": str | None, "error": str | None }
        """
        if not channel:
            return {"ok": False, "error": "No channel specified"}

        # Strip # prefix — API expects channel name without #
        ch = channel.lstrip("#")

        try:
            kwargs: dict = {
                "channel": ch,
                "text": text,
                "unfurl_links": False,
                "unfurl_media": False,
            }
            if attachments:
                kwargs["attachments"] = attachments
            if thread_ts:
                kwargs["thread_ts"] = thread_ts

            response = self.client.chat_postMessage(**kwargs)
            logger.info(f"Slack: Message sent to #{ch}")
            return {"ok": True, "ts": response.get("ts")}

        except SlackApiError as e:
            error_msg = e.response.get("error", str(e))
            logger.error(f"Slack: Error — {error_msg}")
            return {"ok": False, "error": error_msg}
        except Exception as e:
            logger.error(f"Slack: Exception — {e}")
            return {"ok": False, "error": str(e)}

    def send_response_url(self, response_url: str, text: str, ephemeral: bool = True) -> None:
        """
        Post a follow-up message via Slack's response_url.
        Port of _sendSlackResponseUrl() from WebApp.gs.
        """
        if not response_url:
            return

        # Validate the URL is a legitimate Slack endpoint (SSRF protection)
        if not response_url.startswith("https://hooks.slack.com/"):
            logger.warning(f"Rejecting non-Slack response_url: {response_url}")
            return

        import httpx

        try:
            httpx.post(
                response_url,
                json={
                    "response_type": "ephemeral" if ephemeral else "in_channel",
                    "replace_original": False,
                    "text": text,
                },
                timeout=5.0,
            )
        except Exception as e:
            logger.error(f"Failed to send response_url message: {e}")
