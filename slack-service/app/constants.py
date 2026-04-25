"""
KWLT Production Automation — Configuration

Mirrors Config.gs constants. This is the Python equivalent of the
Apps Script configuration constants.
"""

# ─── Production Types ─────────────────────────────────────────────────────────

class PRODUCTION_TYPE:
    MAINSTAGE = "Mainstage"
    STUDIO_SERIES = "Studio Series"


PRODUCTION_TYPES_LIST = [PRODUCTION_TYPE.MAINSTAGE, PRODUCTION_TYPE.STUDIO_SERIES]

# ─── Sheet Names ──────────────────────────────────────────────────────────────

SHEET_CONFIG = "⚙️ Config"
SHEET_SHOW_SETUP = "🎭 Show Setup"
SHEET_TASK_TEMPLATE = "📋 Task Template"           # legacy name (pre-production-type)
SHEET_TASK_TEMPLATE_MAINSTAGE = "📋 Mainstage Tasks"
SHEET_TASK_TEMPLATE_STUDIO = "📋 Studio Series Tasks"
SHEET_MSG_TEMPLATES = "✉️ Message Templates"
SHEET_SEASON_OVERVIEW = "📅 Season Overview"
SHEET_SEND_LOG = "📨 Send Log"
SHEET_README = "📖 README"

# Prefix used for per-show timeline tabs (e.g. "🎬 Hamlet")
SHOW_TAB_PREFIX = "🎬 "

# ─── Anchor Date Labels (must match column headers in Show Setup) ─────────────

ANCHOR_AUDITION_START = "Audition Start Date"
ANCHOR_AUDITION_END = "Audition End Date"
ANCHOR_READTHROUGH = "Readthrough Date"
ANCHOR_BUILD_POSSESSION = "Build / Possession Date"
ANCHOR_TECH_WEEKEND_START = "Tech Weekend Start"
ANCHOR_TECH_WEEKEND_END = "Tech Weekend End"
ANCHOR_OPENING_NIGHT = "Opening Night"
ANCHOR_CLOSING_NIGHT = "Closing Night"

ANCHOR = {
    "AUDITION_START": ANCHOR_AUDITION_START,
    "AUDITION_END": ANCHOR_AUDITION_END,
    "READTHROUGH": ANCHOR_READTHROUGH,
    "BUILD_POSSESSION": ANCHOR_BUILD_POSSESSION,
    "TECH_WEEKEND_START": ANCHOR_TECH_WEEKEND_START,
    "TECH_WEEKEND_END": ANCHOR_TECH_WEEKEND_END,
    "OPENING_NIGHT": ANCHOR_OPENING_NIGHT,
    "CLOSING_NIGHT": ANCHOR_CLOSING_NIGHT,
}

# ─── Reminder Windows ─────────────────────────────────────────────────────────

REMINDER_ADVANCE_DAYS = 7
REMINDER_URGENT_DAYS = 1
OVERDUE_ESCALATION_DAYS = 2

# ─── Trigger Hour ─────────────────────────────────────────────────────────────

TRIGGER_HOUR = 9

# ─── Status Values ────────────────────────────────────────────────────────────

class STATUS:
    PENDING = "Pending"
    ADVANCE_SENT = "Advance Reminder Sent"
    URGENT_SENT = "Urgent Reminder Sent"
    OVERDUE = "Overdue — Escalated"
    DONE = "Done"
    SKIPPED = "Skipped"


# ─── Column Indices (0-based) in per-show timeline tabs ───────────────────────

class COL:
    TASK = 0           # A — Task description
    RESPONSIBLE = 1    # B — Responsible party
    GENERAL_RULE = 2   # C — Human-readable timing rule
    ANCHOR_REF = 3     # D — Which anchor date this is relative to
    OFFSET_DAYS = 4    # E — Days offset from anchor (negative = before)
    COMPUTED_DATE = 5  # F — Computed deadline date
    STATUS = 6         # G — Current status
    NOTIFY_VIA = 7     # H — "slack", "email", or "both"
    LAST_NOTIFIED = 8  # I — Timestamp of last notification sent
    NOTES = 9          # J — Free-form notes


SHOW_TIMELINE_COLS = 10
