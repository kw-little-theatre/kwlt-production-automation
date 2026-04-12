"""
KWLT Production Automation — Application Settings

Loads configuration from environment variables using pydantic-settings.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    # Slack
    slack_bot_token: str = ""
    slack_signing_secret: str = ""

    # Google Sheets
    google_sheets_credentials_file: str = "credentials.json"
    spreadsheet_id: str = ""

    # Show Support
    show_support_channel: str = ""
    show_support_email: str = ""
    membership_email: str = ""
    web_app_url: str = ""

    # Reminder timing (defaults match Config.gs)
    advance_reminder_days: int = 7
    urgent_reminder_days: int = 1
    overdue_escalation_days: int = 2

    # Feature flags
    send_email: bool = True
    send_slack: bool = True

    # Handbook
    handbook_url: str = ""

    # RAG (Phase 4)
    openai_api_key: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
