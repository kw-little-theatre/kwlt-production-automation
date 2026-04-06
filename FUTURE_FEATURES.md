# Future Features

Tracked ideas for improving the KWLT Production Automation system.

## Planned

### ~~Slack prompt for Readthrough date~~ ✅ Implemented
After the last day of auditions, automatically post a message in the show's Slack channel with a Slack date picker asking the Stage Manager / Director to provide the readthrough date. When they select a date via the picker, the system updates the Show Setup sheet and the daily run reactivates any readthrough-dependent tasks that were skipped.

**Implementation notes:**
- Posts a Block Kit message with a `datepicker` element 1 day after audition end
- Re-prompts weekly until the date is set
- `doPost` handler in WebApp.gs processes the Slack interaction and writes the date to Show Setup
- `_reactivateReadthroughTasks()` in ReminderEngine.gs detects newly-set dates and recomputes deadlines
- **Requires**: Slack app Interactivity enabled with Request URL set to the Apps Script web app URL

---

### Season-level task automation
The Season Runbook (`KWLT Runbook Template_ Season`) has ~27 tasks that are currently not automated. These are board/committee-level tasks (rights acquisition, budgets, Eventbrite setup, etc.) that could follow the same anchor-date pattern with season-level anchor dates (board approval date, season announcement date, etc.).

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

## Longer-term: Standalone KWLT Slack App

### Vision
Separate the Slack bot from the Apps Script spreadsheet into a standalone app that becomes the general-purpose hub for the KWLT ecosystem. The spreadsheet stays as the data layer and reminder engine; the Slack app becomes the interface for everything.

### Architecture

**Google Apps Script + Spreadsheet** (current system, unchanged)
- Owns show data: timelines, dates, task statuses, config
- Runs the daily reminder engine on a cron
- Exposes a simple API (web app endpoints) for reading/writing show data

**Standalone Slack App** (new — "KWLT Bot")
- Single Slack identity for all KWLT automation
- Receives all interactions (button clicks, date pickers, messages, @mentions)
- Routes actions: task management → spreadsheet API; questions → LLM
- Hosts LLM integration with KWLT docs as knowledge base
- Extensible to future integrations (Eventbrite, Google Drive, membership DB, etc.)

### LLM-powered Q&A
- Production teams can @ the bot or DM it with questions
- Answers from KWLT-specific knowledge: policy manual, production handbook, show timelines
- Examples: "When is our poster deadline?", "What's the strike policy?", "Who's responsible for the press release?"
- Knowledge base: handbook + policy manual loaded as context, show-specific data queried from the spreadsheet on demand

### Suggested tech stack
- **Framework**: Bolt for JavaScript or Python (Slack's official SDK)
- **Hosting**: Cloudflare Workers, Google Cloud Run, Railway, or Fly.io (all have free/cheap tiers)
- **LLM**: Gemini (free tier, stays in Google ecosystem) or OpenAI
- **Knowledge base**: Markdown files from this repo (handbook, policy manual) loaded at startup; show data via Sheets API or existing web app endpoints

### Incremental migration path
1. **Phase 1 — Proxy**: Deploy standalone app, proxy all interactions to existing Apps Script web app. Everything works as-is, just routed through the new app.
2. **Phase 2 — LLM**: Add conversational Q&A. Load handbook and policy manual as context. Bot can answer questions.
3. **Phase 3 — Message ownership**: Move Slack message-sending from Apps Script to the Slack app (spreadsheet triggers via webhook). Bot controls all its own messages.
4. **Phase 4 — Expand**: Add integrations (Eventbrite, Drive, membership database, onboarding flows, etc.)

**Key principle**: The spreadsheet automation never breaks — it keeps running independently throughout all phases.
