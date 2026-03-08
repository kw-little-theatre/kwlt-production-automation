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

### Show support dashboard improvements
- Color-code the Season Overview by show
- Add a "days since last update" column
- Auto-highlight shows that haven't had any activity in 2+ weeks

---

### Repeated overdue reminders
Currently, overdue escalation fires once (2 days past deadline) then stops. Consider adding periodic follow-up reminders (e.g., every 3 days) for tasks that remain overdue, with escalating urgency. Wait to see how real-world usage goes before implementing.

---

### Board/committee-facing reminders
Some reminders are for the Show Support Committee or Board, not the production team. Examples: strike walkthrough volunteer coordination, debrief scheduling. These would need a separate routing path (to the show support channel or specific board members) rather than the show's Slack channel.

---

### Form-based date collection
For dates that aren't known at season setup (e.g., readthrough date, first production meeting date), provide a form or Slack prompt that the production team can fill in, which automatically updates the Show Setup sheet and activates the dependent tasks.

---

### Form-based debrief scheduling
After closing, automatically send a scheduling form (e.g., Doodle or Google Forms link) to the production team for the post-show debrief meeting, rather than requiring someone to do it manually.

---

### Trim the task template
The current task template has ~50 tasks (plus recurring expansions), which is too many. Review with Show Support to identify which tasks genuinely need automated reminders vs. which are just reference items that belong in the handbook. The template should focus on tasks that are:
- Frequently forgotten
- Have hard external deadlines (e.g., poster approval, rights invoices)
- Require coordination between multiple people
- Have policy-mandated timelines (e.g., 5-day audition notification rule)

Tasks that are "nice to know" but self-evident to experienced production teams should be removed from automated reminders.

---

## Completed

### Per-show Slack channel routing
Implemented via the Bot Token API (`chat.postMessage`). Each show's Slack Channel in Show Setup is used to route reminders to the correct channel. The bot must be invited to each channel (`/invite @AppName`).

_(Move items here as they're implemented)_
