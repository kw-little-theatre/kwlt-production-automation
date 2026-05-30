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
from typing import Optional

import gspread
from google.oauth2.service_account import Credentials

from app.constants import (
    COL,
    SETUP_COL,
    SHEET_SEND_LOG,
    SHEET_SHOW_SETUP,
    SHOW_TAB_PREFIX,
    SHOW_TIMELINE_COLS,
    STATUS,
)
from app.models import MarkTaskResult

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

    @staticmethod
    def _pad_row(row: list) -> list:
        """Pad a row to SHOW_TIMELINE_COLS to avoid IndexError on short rows.
        gspread's get_all_values() omits trailing empty cells."""
        if len(row) >= SHOW_TIMELINE_COLS:
            return row
        return row + [""] * (SHOW_TIMELINE_COLS - len(row))

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

        for row_idx, raw_row in enumerate(data[1:], start=2):  # 1-indexed, skip header
            row = self._pad_row(raw_row)
            current_task = str(row[COL.TASK])
            current_status = row[COL.STATUS]

            # Match by exact text or substring containment (same as Apps Script)
            if current_task == task_text or task_text in current_task or current_task in task_text:
                if current_status == STATUS.DONE:
                    return MarkTaskResult(success=True, message="Task was already marked done.")

                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                existing_notes = row[COL.NOTES]
                new_notes = (
                    (existing_notes + "\n" if existing_notes else "")
                    + f"Marked done via Slack at {now_str}"
                )

                # Batch update: status, last_notified, notes (single API call)
                status_cell = gspread.utils.rowcol_to_a1(row_idx, COL.STATUS + 1)
                notified_cell = gspread.utils.rowcol_to_a1(row_idx, COL.LAST_NOTIFIED + 1)
                notes_cell = gspread.utils.rowcol_to_a1(row_idx, COL.NOTES + 1)
                sheet.batch_update([
                    {"range": status_cell, "values": [[STATUS.DONE]]},
                    {"range": notified_cell, "values": [[now_str]]},
                    {"range": notes_cell, "values": [[new_notes]]},
                ])

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

        for row_idx, raw_row in enumerate(data[1:], start=2):
            row = self._pad_row(raw_row)
            current_task = str(row[COL.TASK])
            current_status = row[COL.STATUS]

            if current_task == task_text or task_text in current_task or current_task in task_text:
                if current_status != STATUS.DONE:
                    return MarkTaskResult(
                        success=True,
                        message=f"Task is not currently marked done (status: {current_status}).",
                    )

                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                existing_notes = row[COL.NOTES]
                new_notes = (
                    (existing_notes + "\n" if existing_notes else "")
                    + f"Undone via Slack at {now_str}"
                )

                sheet.batch_update([
                    {"range": gspread.utils.rowcol_to_a1(row_idx, COL.STATUS + 1), "values": [[STATUS.PENDING]]},
                    {"range": gspread.utils.rowcol_to_a1(row_idx, COL.NOTES + 1), "values": [[new_notes]]},
                ])

                self.log_send(show_name, current_task, row[COL.RESPONSIBLE], "slack", "mark-undone", True)

                return MarkTaskResult(success=True, message="Task reverted to Pending.")

        return MarkTaskResult(
            success=False,
            message=f'Task "{task_text}" not found in the {show_name} timeline.',
        )

    def mark_task_skipped(self, show_name: str, task_text: str) -> MarkTaskResult:
        """
        Finds a task in a show's timeline tab and marks it Skipped.
        Used for optional tasks that a production team decides not to do.
        """
        sheet = self._get_show_sheet(show_name)
        if not sheet:
            return MarkTaskResult(
                success=False,
                message=f'Show tab "{SHOW_TAB_PREFIX}{show_name}" not found.',
            )

        data = sheet.get_all_values()

        for row_idx, raw_row in enumerate(data[1:], start=2):
            row = self._pad_row(raw_row)
            current_task = str(row[COL.TASK])
            current_status = row[COL.STATUS]

            if current_task == task_text or task_text in current_task or current_task in task_text:
                if current_status == STATUS.SKIPPED:
                    return MarkTaskResult(success=True, message="Task was already skipped.")

                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                existing_notes = row[COL.NOTES]
                new_notes = (
                    (existing_notes + "\n" if existing_notes else "")
                    + f"Skipped via Slack at {now_str}"
                )

                sheet.batch_update([
                    {"range": gspread.utils.rowcol_to_a1(row_idx, COL.STATUS + 1), "values": [[STATUS.SKIPPED]]},
                    {"range": gspread.utils.rowcol_to_a1(row_idx, COL.LAST_NOTIFIED + 1), "values": [[now_str]]},
                    {"range": gspread.utils.rowcol_to_a1(row_idx, COL.NOTES + 1), "values": [[new_notes]]},
                ])

                self.log_send(show_name, current_task, row[COL.RESPONSIBLE], "slack", "skip-task", True)

                return MarkTaskResult(success=True, message="Task skipped.")

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

    # ─── Show Lookup ───────────────────────────────────────────────────

    def get_show_by_channel(self, channel_id: str) -> Optional[dict]:
        """
        Find the active show whose Slack channel matches the given channel ID or name.
        Returns a dict with show_name, show_email, resources_url, or None.
        """
        try:
            sheet = self.spreadsheet.worksheet(SHEET_SHOW_SETUP)
        except gspread.WorksheetNotFound:
            return None

        data = sheet.get_all_values()
        if len(data) < 2:
            return None

        for row in data[1:]:
            # Pad to avoid IndexError on short rows
            while len(row) < 6:
                row.append("")

            row_channel = row[SETUP_COL.SLACK_CHANNEL].strip()

            # Match by channel ID (C...) or channel name (with or without #)
            if row_channel and (
                row_channel == channel_id
                or row_channel.lstrip("#") == channel_id
                or channel_id == row_channel.lstrip("#")
            ):
                return {
                    "show_name": row[SETUP_COL.SHOW_NAME].strip(),
                    "show_email": row[SETUP_COL.SHOW_EMAIL].strip(),
                    "resources_url": row[SETUP_COL.RESOURCES_URL].strip(),
                }

        return None

    def get_upcoming_tasks(self, show_name: str, limit: int = 5) -> list[dict]:
        """
        Return the next N pending/upcoming tasks with deadlines for a show.
        Returns a list of dicts with: task, responsible, deadline, status.
        """
        sheet = self._get_show_sheet(show_name)
        if not sheet:
            return []

        data = sheet.get_all_values()
        if len(data) < 2:
            return []

        from datetime import date

        today = date.today()
        upcoming = []

        for raw_row in data[1:]:
            row = self._pad_row(raw_row)
            status = row[COL.STATUS].strip()
            deadline_str = row[COL.COMPUTED_DATE].strip()
            task_text = row[COL.TASK].strip()

            if not task_text or not deadline_str:
                continue

            # Parse deadline — accept yyyy-MM-dd or other formats
            try:
                deadline_date = datetime.strptime(deadline_str, "%Y-%m-%d").date()
            except ValueError:
                try:
                    deadline_date = datetime.strptime(deadline_str, "%m/%d/%Y").date()
                except ValueError:
                    continue

            # Include pending tasks from today onward, and recently overdue (within 7 days)
            if status in (STATUS.DONE, STATUS.SKIPPED):
                continue
            if deadline_date < today and (today - deadline_date).days > 7:
                continue

            upcoming.append({
                "task": task_text,
                "responsible": row[COL.RESPONSIBLE].strip(),
                "deadline": deadline_str,
                "status": status,
                "deadline_date": deadline_date,
            })

        # Sort by deadline, take the first N
        upcoming.sort(key=lambda t: t["deadline_date"])
        # Remove the sort key before returning
        for t in upcoming:
            del t["deadline_date"]

        return upcoming[:limit]

    # ─── Active Shows (Phase 3) ──────────────────────────────────────
    # get_active_shows() will be added when the daily reminder cycle
    # is ported from Apps Script. Not needed for Phase 2 interactions.
