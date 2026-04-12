"""
KWLT Production Automation — Sheet Repository

Abstracts all Google Sheets access behind a clean Python interface.
Uses gspread with a service account to read/write the KWLT spreadsheet.

This replaces the direct SpreadsheetApp calls in Apps Script and provides
a seam for testing (can be mocked or pointed at a test spreadsheet).
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

import gspread
from google.oauth2.service_account import Credentials

from app.constants import (
    ANCHOR_AUDITION_END,
    ANCHOR_AUDITION_START,
    ANCHOR_READTHROUGH,
    COL,
    SHEET_SEND_LOG,
    SHEET_SHOW_SETUP,
    SHOW_TAB_PREFIX,
    STATUS,
)
from app.models import ActiveShow, MarkTaskResult

logger = logging.getLogger(__name__)

SCOPES = ["https://www.googleapis.com/auth/spreadsheets"]


class SheetRepository:
    """
    Encapsulates all Google Sheets operations for the KWLT spreadsheet.

    Mirrors the data access patterns in WebApp.gs and ReminderEngine.gs
    but uses the Google Sheets API via gspread instead of SpreadsheetApp.
    """

    def __init__(self, credentials_file: str, spreadsheet_id: str):
        self.spreadsheet_id = spreadsheet_id
        creds = Credentials.from_service_account_file(credentials_file, scopes=SCOPES)
        self.gc = gspread.authorize(creds)
        self.spreadsheet = self.gc.open_by_key(spreadsheet_id)

    def _get_show_sheet(self, show_name: str) -> Optional[gspread.Worksheet]:
        """Get the timeline worksheet for a show, or None if not found."""
        tab_name = SHOW_TAB_PREFIX + show_name
        try:
            return self.spreadsheet.worksheet(tab_name)
        except gspread.WorksheetNotFound:
            return None

    # ─── Task Operations ───────────────────────────────────────────────

    def mark_task_done(self, show_name: str, task_text: str) -> MarkTaskResult:
        """
        Finds a task in a show's timeline tab and marks it Done.
        Port of _markTaskDone() from WebApp.gs.
        """
        sheet = self._get_show_sheet(show_name)
        if not sheet:
            return MarkTaskResult(
                success=False,
                message=f'Show tab "{SHOW_TAB_PREFIX}{show_name}" not found.',
            )

        data = sheet.get_all_values()

        for row_idx, row in enumerate(data[1:], start=2):  # 1-indexed, skip header
            current_task = str(row[COL.TASK])
            current_status = row[COL.STATUS]

            # Match by exact text or substring containment (same as Apps Script)
            if current_task == task_text or task_text in current_task or current_task in task_text:
                if current_status == STATUS.DONE:
                    return MarkTaskResult(success=True, message="Task was already marked done.")

                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                existing_notes = row[COL.NOTES] if len(row) > COL.NOTES else ""
                new_notes = (
                    (existing_notes + "\n" if existing_notes else "")
                    + f"Marked done via Slack at {now_str}"
                )

                # Batch update: status, last_notified, notes
                sheet.update_cell(row_idx, COL.STATUS + 1, STATUS.DONE)
                sheet.update_cell(row_idx, COL.LAST_NOTIFIED + 1, now_str)
                sheet.update_cell(row_idx, COL.NOTES + 1, new_notes)

                self.log_send(show_name, current_task, row[COL.RESPONSIBLE], "slack", "mark-done", True)

                return MarkTaskResult(success=True, message="Task marked as done.")

        return MarkTaskResult(
            success=False,
            message=f'Task "{task_text}" not found in the {show_name} timeline.',
        )

    def mark_task_undone(self, show_name: str, task_text: str) -> MarkTaskResult:
        """
        Finds a task in a show's timeline tab and reverts it to Pending.
        Port of _markTaskUndone() from WebApp.gs.
        """
        sheet = self._get_show_sheet(show_name)
        if not sheet:
            return MarkTaskResult(
                success=False,
                message=f'Show tab "{SHOW_TAB_PREFIX}{show_name}" not found.',
            )

        data = sheet.get_all_values()

        for row_idx, row in enumerate(data[1:], start=2):
            current_task = str(row[COL.TASK])
            current_status = row[COL.STATUS]

            if current_task == task_text or task_text in current_task or current_task in task_text:
                if current_status != STATUS.DONE:
                    return MarkTaskResult(
                        success=True,
                        message=f"Task is not currently marked done (status: {current_status}).",
                    )

                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                existing_notes = row[COL.NOTES] if len(row) > COL.NOTES else ""
                new_notes = (
                    (existing_notes + "\n" if existing_notes else "")
                    + f"Undone via Slack at {now_str}"
                )

                sheet.update_cell(row_idx, COL.STATUS + 1, STATUS.PENDING)
                sheet.update_cell(row_idx, COL.NOTES + 1, new_notes)

                self.log_send(show_name, current_task, row[COL.RESPONSIBLE], "slack", "mark-undone", True)

                return MarkTaskResult(success=True, message="Task reverted to Pending.")

        return MarkTaskResult(
            success=False,
            message=f'Task "{task_text}" not found in the {show_name} timeline.',
        )

    # ─── Send Log ──────────────────────────────────────────────────────

    def log_send(
        self,
        show_name: str,
        task: str,
        responsible: str,
        channel: str,
        reminder_type: str,
        success: bool,
        error: str = "",
    ) -> None:
        """
        Appends a row to the Send Log sheet.
        Port of _logSend() from ReminderEngine.gs.
        """
        try:
            sheet = self.spreadsheet.worksheet(SHEET_SEND_LOG)
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            sheet.append_row(
                [now_str, show_name, task, responsible, channel, reminder_type, "Sent" if success else "Failed", error],
                value_input_option="USER_ENTERED",
            )
        except Exception as e:
            logger.warning(f"Failed to write to Send Log: {e}")

    # ─── Active Shows ─────────────────────────────────────────────────

    def get_active_shows(self) -> list[ActiveShow]:
        """
        Returns active shows from the Show Setup sheet.
        Port of _getActiveShows() from ReminderEngine.gs.
        """
        try:
            sheet = self.spreadsheet.worksheet(SHEET_SHOW_SETUP)
        except gspread.WorksheetNotFound:
            return []

        data = sheet.get_all_values()
        if len(data) <= 1:
            return []

        headers = data[0]
        name_col = 0
        slack_col = _find_col(headers, "Slack Channel")
        email_col = _find_col(headers, "Show Email")
        resources_col = _find_col(headers, "Resources Folder URL")
        active_col = _find_col(headers, "Active?")

        if active_col == -1:
            return []

        # Find anchor date columns (headers may have suffixes like " *", " (auto)")
        audition_start_col = _find_col_startswith(headers, ANCHOR_AUDITION_START)
        audition_end_col = _find_col_startswith(headers, ANCHOR_AUDITION_END)
        readthrough_col = _find_col_startswith(headers, ANCHOR_READTHROUGH)
        prompt_col = _find_col(headers, "Readthrough Prompt Last Sent")

        shows = []
        for i, row in enumerate(data[1:], start=1):
            active = str(row[active_col]).upper() if active_col < len(row) else ""
            if active not in ("TRUE", "YES"):
                continue

            audition_end = _parse_date_cell(row, audition_end_col)
            if not audition_end:
                audition_start = _parse_date_cell(row, audition_start_col)
                if audition_start:
                    from datetime import timedelta
                    audition_end = audition_start + timedelta(days=2)

            shows.append(ActiveShow(
                name=row[name_col],
                slack_channel=_safe_get(row, slack_col, ""),
                show_email=_safe_get(row, email_col, ""),
                resources_url=_safe_get(row, resources_col, ""),
                audition_end=audition_end,
                readthrough_date=_parse_date_cell(row, readthrough_col),
                readthrough_prompt_last_sent=_parse_date_cell(row, prompt_col),
                setup_row_index=i,
            ))

        return shows


# ─── Helper Functions ──────────────────────────────────────────────────────────


def _find_col(headers: list[str], name: str) -> int:
    """Find exact column index by header name, or -1."""
    try:
        return headers.index(name)
    except ValueError:
        return -1


def _find_col_startswith(headers: list[str], prefix: str) -> int:
    """Find column index where header starts with prefix, or -1."""
    for i, h in enumerate(headers):
        if str(h).startswith(prefix):
            return i
    return -1


def _safe_get(row: list, col: int, default: Any = "") -> Any:
    """Safely get a cell value, returning default if column is out of bounds or -1."""
    if col == -1 or col >= len(row):
        return default
    return row[col]


def _parse_date_cell(row: list, col: int) -> Optional[datetime]:
    """Parse a date cell value, returning None if empty or invalid."""
    val = _safe_get(row, col, "")
    if not val:
        return None
    if isinstance(val, datetime):
        return val
    try:
        # Try common date formats from Google Sheets
        for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%d/%m/%Y", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(str(val), fmt)
            except ValueError:
                continue
        return None
    except Exception:
        return None
