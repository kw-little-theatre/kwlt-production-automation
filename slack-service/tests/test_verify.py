"""
Tests for Slack signature verification.
"""

import hashlib
import hmac
import time

from app.verify import verify_slack_signature


class TestVerifySlackSignature:
    """Tests for Slack request signature verification."""

    SIGNING_SECRET = "test-signing-secret-12345"

    def _make_signature(self, timestamp: str, body: str) -> str:
        """Generate a valid Slack signature for testing."""
        sig_basestring = f"v0:{timestamp}:{body}"
        return "v0=" + hmac.new(
            self.SIGNING_SECRET.encode("utf-8"),
            sig_basestring.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    def test_valid_signature_passes(self):
        timestamp = str(int(time.time()))
        body = "payload=%7B%22test%22%3A%22data%22%7D"
        signature = self._make_signature(timestamp, body)

        assert verify_slack_signature(self.SIGNING_SECRET, timestamp, body.encode(), signature) is True

    def test_invalid_signature_fails(self):
        timestamp = str(int(time.time()))
        body = "payload=%7B%22test%22%3A%22data%22%7D"

        assert verify_slack_signature(self.SIGNING_SECRET, timestamp, body.encode(), "v0=invalid") is False

    def test_old_timestamp_rejected(self):
        """Requests older than 5 minutes should be rejected (replay protection)."""
        old_timestamp = str(int(time.time()) - 600)  # 10 minutes ago
        body = "payload=%7B%22test%22%3A%22data%22%7D"
        signature = self._make_signature(old_timestamp, body)

        assert verify_slack_signature(self.SIGNING_SECRET, old_timestamp, body.encode(), signature) is False

    def test_tampered_body_fails(self):
        """Modified body should fail verification."""
        timestamp = str(int(time.time()))
        body = "payload=%7B%22test%22%3A%22data%22%7D"
        signature = self._make_signature(timestamp, body)

        tampered_body = "payload=%7B%22hacked%22%3A%22data%22%7D"
        assert verify_slack_signature(self.SIGNING_SECRET, timestamp, tampered_body.encode(), signature) is False
