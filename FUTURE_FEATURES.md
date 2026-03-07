# Future Features

Tracked ideas for improving the KWLT Production Automation system.

## Planned

### Slack prompt for Readthrough date
After the last day of auditions, automatically post a message in the show's Slack channel asking the Stage Manager / Director to provide the readthrough date. When they reply (or fill in the Show Setup sheet), the system updates the timeline and activates the readthrough-dependent tasks.

**Why**: Readthrough date is almost never known far in advance and is typically determined after auditions. Making it optional at setup avoids forcing a guess, but we need a mechanism to collect it later.

**Complexity**: Medium — requires either a Slack app with message-reading capability, or a simpler "fill in the sheet and re-run" workflow with a Slack nudge.

---

### Season-level task automation
The Season Runbook (`KWLT Runbook Template_ Season`) has ~27 tasks that are currently not automated. These are board/committee-level tasks (rights acquisition, budgets, Eventbrite setup, etc.) that could follow the same anchor-date pattern with season-level anchor dates (board approval date, season announcement date, etc.).

---

### Recurring task acknowledgment
Currently, recurring weekly tasks (rehearsals, cleaning, social media content) generate many rows. Consider a "recurring reminder" mode that sends a single weekly ping without creating individual rows — less visual clutter in the timeline.

---

### Slack reaction tracking
Monitor Slack reactions (e.g., ✅) on reminder messages and auto-mark tasks as Done. Requires upgrading from an incoming webhook to a full Slack app with `reactions:read` scope.

---

### Per-show Slack webhooks
Currently there's one global webhook. Support per-show webhooks so reminders post to each show's dedicated channel (e.g., `#show-hamlet`). The Slack Channel column in Show Setup is already there but not yet used for routing.

---

### Show support dashboard improvements
- Color-code the Season Overview by show
- Add a "days since last update" column
- Auto-highlight shows that haven't had any activity in 2+ weeks

---

## Completed

_(Move items here as they're implemented)_
