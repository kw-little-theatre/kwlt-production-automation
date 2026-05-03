/**
 * KWLT Production Automation — Configuration
 *
 * Central configuration constants. Edit these to match your KWLT setup.
 * This file is the ONLY place you should need to change code-level settings.
 */

// ─── Production Types ─────────────────────────────────────────────────────────
const PRODUCTION_TYPE = {
  MAINSTAGE:     'Mainstage',
  STUDIO_SERIES: 'Studio Series',
  NWF:           'NWF',
};

const PRODUCTION_TYPES_LIST = [PRODUCTION_TYPE.MAINSTAGE, PRODUCTION_TYPE.STUDIO_SERIES, PRODUCTION_TYPE.NWF];

// ─── Sheet Names ──────────────────────────────────────────────────────────────
const SHEET_CONFIG          = '⚙️ Config';
const SHEET_SHOW_SETUP      = '🎭 Show Setup';
const SHEET_TASK_TEMPLATE   = '📋 Task Template';           // legacy name (pre-production-type)
const SHEET_TASK_TEMPLATE_MAINSTAGE = '📋 Mainstage Tasks';
const SHEET_TASK_TEMPLATE_STUDIO    = '📋 Studio Series Tasks';
const SHEET_TASK_TEMPLATE_NWF       = '📋 NWF Tasks';
const SHEET_MSG_TEMPLATES   = '✉️ Message Templates';
const SHEET_SEASON_OVERVIEW = '📅 Season Overview';
const SHEET_SEND_LOG        = '📨 Send Log';
const SHEET_README          = '📖 README';

// Prefix used for per-show timeline tabs (e.g. "🎬 Hamlet")
const SHOW_TAB_PREFIX = '🎬 ';

// ─── Anchor Date Labels (must match column headers in Show Setup) ─────────────
const ANCHOR = {
  AUDITION_START:      'Audition Start Date',
  AUDITION_END:        'Audition End Date',
  READTHROUGH:         'Readthrough Date',
  BUILD_POSSESSION:    'Build / Possession Date',
  TECH_WEEKEND_START:  'Tech Weekend Start',
  TECH_WEEKEND_END:    'Tech Weekend End',
  OPENING_NIGHT:       'Opening Night',
  CLOSING_NIGHT:       'Closing Night',
};

// ─── Derived Anchors (computed, not stored in Show Setup) ─────────────────────
// These are calculated from sheet-backed anchors during timeline generation.
const DERIVED_ANCHOR = {
  SCRIPT_FREEZE: 'Script Freeze',   // NWF only: Opening Night - 42 days
};

// ─── Reminder Windows ─────────────────────────────────────────────────────────
// How many days before a deadline each reminder fires.
// "advance" = heads-up; "urgent" = final nudge.
const REMINDER_ADVANCE_DAYS = 7;
const REMINDER_URGENT_DAYS  = 1;

// ─── Escalation ───────────────────────────────────────────────────────────────
// How many days past deadline before an overdue escalation is sent.
const OVERDUE_ESCALATION_DAYS = 2;

// ─── Trigger Hour ─────────────────────────────────────────────────────────────
// What hour (0-23) the daily trigger runs. 9 = 9:00 AM local time.
const TRIGGER_HOUR = 9;

// ─── Status Values ────────────────────────────────────────────────────────────
const STATUS = {
  PENDING:         'Pending',
  ADVANCE_SENT:    'Advance Reminder Sent',
  URGENT_SENT:     'Urgent Reminder Sent',
  OVERDUE:         'Overdue — Escalated',
  DONE:            'Done',
  SKIPPED:         'Skipped',
};

// ─── Column Indices (0-based) in per-show timeline tabs ───────────────────────
// These must match the columns created by _buildShowTimeline().
const COL = {
  TASK:           0,   // A — Task description
  RESPONSIBLE:    1,   // B — Responsible party
  GENERAL_RULE:   2,   // C — Human-readable timing rule
  ANCHOR_REF:     3,   // D — Which anchor date this is relative to
  OFFSET_DAYS:    4,   // E — Days offset from anchor (negative = before)
  COMPUTED_DATE:  5,   // F — Computed deadline date
  STATUS:         6,   // G — Current status
  NOTIFY_VIA:     7,   // H — "slack", "email", or "both"
  LAST_NOTIFIED:  8,   // I — Timestamp of last notification sent
  NOTES:          9,   // J — Free-form notes
};

// Total columns in show timeline
const SHOW_TIMELINE_COLS = 10;
