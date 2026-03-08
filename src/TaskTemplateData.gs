/**
 * KWLT Production Automation — Task Template Data
 *
 * This is the master list of tasks derived from the KWLT Mainstage Production
 * Runbook. Each task specifies which anchor date it's relative to and the
 * offset in days. The setup script writes these into the "📋 Task Template"
 * sheet, from which per-show timelines are generated.
 *
 * Fields per task:
 *   task         — description of the task
 *   responsible  — role responsible (Director, Stage Manager, Producer, etc.)
 *   generalRule  — human-readable timing (from the original runbook)
 *   anchorRef    — key from ANCHOR constant that this date is relative to
 *   offsetDays   — number of days offset (negative = before, positive = after)
 *   notifyVia    — default notification channel: "slack", "email", or "both"
 *   recurring    — if true, this is a recurring reminder (weekly during phase)
 *   phase        — which phase this belongs to (for recurring tasks & grouping)
 */

function getTaskTemplateData() {
  return [
    // ── Pre-Production Phase ───────────────────────────────────────────────
    {

      task: 'Book extra audition days if needed with Rentals',
      responsible: 'Director',
      generalRule: '1 month before auditions',
      anchorRef: ANCHOR.AUDITION_START,
      offsetDays: -30,
      notifyVia: 'slack',
      recurring: false,
      phase: 'Pre-Production',
    },
    {
      task: 'Hold first Production meeting (invite Show Support Committee representative)',
      responsible: 'Production team',
      generalRule: '1-2 months before auditions',
      anchorRef: ANCHOR.AUDITION_START,
      offsetDays: -45,
      notifyVia: 'both',
      recurring: false,
      phase: 'Pre-Production',
    },

    // ── Audition Preparation Phase ──────────────────────────────────────────
    {
      task: 'Set up audition pre-booking form and confirmation/reminder system (if doing pre-bookings)',
      responsible: 'Stage Manager',
      generalRule: '3 weeks before auditions',
      anchorRef: ANCHOR.AUDITION_START,
      offsetDays: -21,
      notifyVia: 'both',
      recurring: false,
      phase: 'Audition Prep',
    },
    {
      task: 'Create marketing materials for auditions',
      responsible: 'Producer',
      generalRule: '3 weeks before auditions',
      anchorRef: ANCHOR.AUDITION_START,
      offsetDays: -21,
      notifyVia: 'slack',
      recurring: false,
      phase: 'Audition Prep',
    },
    {
      task: 'Receive keys and get walkthrough of 44 Gaukel & 9 Princess',
      responsible: 'Stage Manager',
      generalRule: '1 week before auditions',
      anchorRef: ANCHOR.AUDITION_START,
      offsetDays: -7,
      notifyVia: 'email',
      recurring: false,
      phase: 'Audition Prep',
    },
    {
      task: 'Create rough marketing plan for the show and review with Communications Committee',
      responsible: 'Producer',
      generalRule: 'Deadline is auditions',
      anchorRef: ANCHOR.AUDITION_START,
      offsetDays: -7,
      notifyVia: 'slack',
      recurring: false,
      phase: 'Audition Prep',
    },
    {
      task: 'Find audition wranglers',
      responsible: 'Production Team',
      generalRule: 'Deadline is auditions',
      anchorRef: ANCHOR.AUDITION_START,
      offsetDays: -7,
      notifyVia: 'slack',
      recurring: false,
      phase: 'Audition Prep',
    },
    {
      task: 'Prepare in-audition materials (audition form, info sheets, printed monologues, scripts)',
      responsible: 'Stage Manager',
      generalRule: 'Deadline is auditions',
      anchorRef: ANCHOR.AUDITION_START,
      offsetDays: -3,
      notifyVia: 'slack',
      recurring: false,
      phase: 'Audition Prep',
    },

    // ── Auditions & Casting Phase ───────────────────────────────────────────
    {
      task: 'Obtain Vulnerable Sector Checks for show leadership (if minors in cast/crew)',
      responsible: 'Production team',
      generalRule: '2 months before auditions',
      anchorRef: ANCHOR.AUDITION_START,
      offsetDays: -60,
      notifyVia: 'email',
      recurring: false,
      phase: 'Auditions',
    },
    {
      task: 'IMPORTANT: Send acceptance and rejection notifications to ALL auditionees (required within 5 days per policy)',
      responsible: 'Director',
      generalRule: '1 day after last day of auditions',
      anchorRef: ANCHOR.AUDITION_END,
      offsetDays: 1,
      notifyVia: 'both',
      recurring: false,
      phase: 'Auditions',
    },
    {
      task: 'Schedule rehearsals & readthrough (invite Show Support rep and Membership Director)',
      responsible: 'Stage Manager',
      generalRule: '1 day after last day of auditions',
      anchorRef: ANCHOR.AUDITION_END,
      offsetDays: 1,
      notifyVia: 'both',
      recurring: false,
      phase: 'Auditions',
    },

    // ── Readthrough & Rehearsal Phase ───────────────────────────────────────
    {
      task: 'Collect parental permission forms and emergency contact forms from cast & crew',
      responsible: 'Stage Manager',
      generalRule: 'At readthrough',
      anchorRef: ANCHOR.READTHROUGH,
      offsetDays: 0,
      notifyVia: 'both',
      recurring: false,
      phase: 'Rehearsals',
    },
    // ── Rehearsal Phase (cont.) ────────────────────────────────────
    {
      task: 'Write press release and send to Communications Committee',
      responsible: 'Producer',
      generalRule: '6 weeks before opening',
      anchorRef: ANCHOR.OPENING_NIGHT,
      offsetDays: -42,
      notifyVia: 'both',
      recurring: false,
      phase: 'Rehearsals',
    },
    {
      task: 'Submit poster for approval to Show Support representative',
      responsible: 'Producer',
      generalRule: '6 weeks before opening (1 week before printing)',
      anchorRef: ANCHOR.OPENING_NIGHT,
      offsetDays: -42,
      notifyVia: 'both',
      recurring: false,
      phase: 'Rehearsals',
    },
    {
      task: 'Do headshots',
      responsible: 'Producer',
      generalRule: '1 month before opening',
      anchorRef: ANCHOR.OPENING_NIGHT,
      offsetDays: -30,
      notifyVia: 'slack',
      recurring: false,
      phase: 'Rehearsals',
    },
    {
      task: 'Do poster run around town',
      responsible: 'Producer',
      generalRule: '1 month before opening',
      anchorRef: ANCHOR.OPENING_NIGHT,
      offsetDays: -30,
      notifyVia: 'slack',
      recurring: false,
      phase: 'Rehearsals',
    },
    {
      task: 'Submit seating plan for approval to Show Support representative',
      responsible: 'Technical Director',
      generalRule: '60 days after auditions',
      anchorRef: ANCHOR.AUDITION_END,
      offsetDays: 60,
      notifyVia: 'both',
      recurring: false,
      phase: 'Rehearsals',
    },
    {
      task: 'Invite the board to your second dress rehearsal',
      responsible: 'Director',
      generalRule: '2 weeks before opening',
      anchorRef: ANCHOR.OPENING_NIGHT,
      offsetDays: -14,
      notifyVia: 'email',
      recurring: false,
      phase: 'Rehearsals',
    },

    // ── Build & Tech Phase ──────────────────────────────────────────────────
    {
      task: 'Create program & get sign off from production',
      responsible: 'Producer',
      generalRule: 'Build weekend',
      anchorRef: ANCHOR.BUILD_POSSESSION,
      offsetDays: 0,
      notifyVia: 'slack',
      recurring: false,
      phase: 'Build & Tech',
    },
    {
      task: 'Get safety training',
      responsible: 'Technical Director',
      generalRule: 'On possession',
      anchorRef: ANCHOR.BUILD_POSSESSION,
      offsetDays: 0,
      notifyVia: 'email',
      recurring: false,
      phase: 'Build & Tech',
    },
    {
      task: 'Take possession of theatre',
      responsible: 'Production team',
      generalRule: 'Build day',
      anchorRef: ANCHOR.BUILD_POSSESSION,
      offsetDays: 0,
      notifyVia: 'slack',
      recurring: false,
      phase: 'Build & Tech',
    },
    {
      task: 'Walk through theatre with strike checklist and inform board of any problems',
      responsible: 'Stage Manager & Technical Director',
      generalRule: 'On possession',
      anchorRef: ANCHOR.BUILD_POSSESSION,
      offsetDays: 0,
      notifyVia: 'both',
      recurring: false,
      phase: 'Build & Tech',
    },
    {
      task: 'Invite Show Support committee representative to tech weekend Day 1',
      responsible: 'Stage Manager',
      generalRule: 'Start of first day of tech weekend',
      anchorRef: ANCHOR.TECH_WEEKEND_START,
      offsetDays: 0,
      notifyVia: 'both',
      recurring: false,
      phase: 'Build & Tech',
    },
    {
      task: 'Remove everything from Gaukel',
      responsible: 'Production team',
      generalRule: 'By tech weekend',
      anchorRef: ANCHOR.TECH_WEEKEND_START,
      offsetDays: 0,
      notifyVia: 'both',
      recurring: false,
      phase: 'Build & Tech',
    },
    {
      task: 'Write front of house speech',
      responsible: 'Director',
      generalRule: 'Tech weekend',
      anchorRef: ANCHOR.TECH_WEEKEND_END,
      offsetDays: 0,
      notifyVia: 'both',
      recurring: false,
      phase: 'Build & Tech',
    },
    {
      task: 'Print photos for lobby and programs',
      responsible: 'Producer',
      generalRule: 'After dress rehearsals, before opening',
      anchorRef: ANCHOR.OPENING_NIGHT,
      offsetDays: -3,
      notifyVia: 'slack',
      recurring: false,
      phase: 'Build & Tech',
    },

    // ── Show Run Phase ──────────────────────────────────────────────────────
    {
      task: 'Plan for strike',
      responsible: 'Stage Manager & Technical Director',
      generalRule: 'Before close',
      anchorRef: ANCHOR.CLOSING_NIGHT,
      offsetDays: -7,
      notifyVia: 'both',
      recurring: false,
      phase: 'Shows',
    },

    // ── Post-Show Phase ─────────────────────────────────────────────────────
    {
      task: 'Return keys',
      responsible: 'Production Team',
      generalRule: '1 week after close',
      anchorRef: ANCHOR.CLOSING_NIGHT,
      offsetDays: 7,
      notifyVia: 'both',
      recurring: false,
      phase: 'Post-Show',
    },
    {
      task: 'Submit receipts for reimbursement',
      responsible: 'Production Team',
      generalRule: 'Within 1 month of close',
      anchorRef: ANCHOR.CLOSING_NIGHT,
      offsetDays: 30,
      notifyVia: 'email',
      recurring: false,
      phase: 'Post-Show',
    },
  ];
}
