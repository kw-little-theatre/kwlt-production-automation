"""
KWLT Production Automation — Slack Request Verification

Verifies that incoming requests are actually from Slack using
HMAC-SHA256 signature verification. This is a security improvement
over the Apps Script version which did no verification.

See: https://api.slack.com/authentication/verifying-requests-from-slack
"""

from __future__ import annotations

import hashlib
import hmac
import time


def verify_slack_signature(
    signing_secret: str,
    timestamp: str,
    body: bytes,
    signature: str,
) -> bool:
    """
    Verify a Slack request signature.

    Args:
        signing_secret: The Slack app's signing secret
        timestamp: X-Slack-Request-Timestamp header value
        body: Raw request body bytes
        signature: X-Slack-Signature header value

    Returns:
        True if the signature is valid
    """
    # Reject requests older than 5 minutes (replay protection)
    try:
        if abs(time.time() - int(timestamp)) > 300:
            return False
    except (ValueError, TypeError):
        return False

    # Compute expected signature
    sig_basestring = f"v0:{timestamp}:{body.decode('utf-8')}"
    computed = "v0=" + hmac.new(
        signing_secret.encode("utf-8"),
        sig_basestring.encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(computed, signature)
