# Copilot Instructions — KWLT Production Automation

## Project Overview

This is a Google Apps Script project that automates production task reminders for Kitchener-Waterloo Little Theatre (KWLT). It runs inside a Google Sheet and sends reminders via Slack and email to production teams as deadlines approach.

The codebase is in `src/` and is deployed to Google Apps Script via `clasp push`. The web app must be **redeployed** (new version) after pushing for the `/exec` endpoint to pick up changes.

## Key Architecture Decisions

- **Google Apps Script runtime** — all code runs server-side in Google's V8 environment. No npm, no modules, no `import`/`export`. All `.gs` files share a single global scope.
- **Slack integration** uses the Bot Token API (`chat.postMessage`) and Slack Interactivity (`doPost` handler). The bot cannot read messages — it only sends and receives interactions.
- **Secrets** are stored in `PropertiesService.getScriptProperties()`, not in the spreadsheet. Managed via the 🔐 Manage Secrets menu.
- **Task templates** are defined in code (`TaskTemplateData.gs`) and written to the sheet during setup. Per-show timelines are generated from these templates + anchor dates.
- **Readthrough date** is optional — if blank at timeline creation, dependent tasks are skipped. After auditions, the system prompts via Slack date picker and reactivates tasks when the date is set.

## Code Conventions

- Plain JavaScript (ES6 features OK — const/let, arrow functions, template literals, destructuring). No TypeScript.
- Functions prefixed with `_` are internal/private (convention only — no actual access control in Apps Script).
- Sheet names use emoji prefixes: `⚙️ Config`, `🎭 Show Setup`, `📋 Task Template`, `🎬 ShowName`, etc.
- Column indices are 0-based constants in `Config.gs` (`COL.TASK`, `COL.STATUS`, etc.).
- Status values are constants in `Config.gs` (`STATUS.PENDING`, `STATUS.DONE`, etc.).

## Working with Slack Block Kit

- When sending block messages, pass empty string `''` for the `text` parameter and put content in `attachments[].blocks`. If both `text` and blocks have content, Slack renders both (double message).
- Use `attachments[].fallback` for notification preview text.
- For user feedback on interactions, POST to `payload.response_url` via `_sendSlackResponseUrl()` — don't rely on the HTTP response body from `doPost`.
- For feedback that includes interactive elements (buttons), use `sendSlack()` with blocks instead of `response_url` (which only supports text).
- Use `<@USER_ID>` format (from `payload.user.id`) for user mentions — `payload.user.name` is just the short handle.
- `action_id` has a 255-character limit in Slack.

## Deployment Workflow

1. Edit code locally in `src/`
2. `clasp push` to sync to Apps Script
3. For changes to `doPost`/`doGet` (web app), you must also **redeploy**: Apps Script editor → Deploy → Manage deployments → edit → New version → Deploy
4. `clasp push` alone is sufficient for changes to the daily trigger (`runDailyReminders`) and other non-web-app functions

## When Making Changes

- **Always check if README.md needs updating** after implementing features, changing setup steps, modifying secrets, or altering user-facing behavior.
- **Always check if FUTURE_FEATURES.md needs updating** when implementing a planned feature (mark it done) or discovering new feature ideas.
- After modifying `_getActiveShows()`, verify that all fields it returns are still being populated correctly — multiple features depend on it.
- After modifying `doPost()`, remember the user needs to redeploy the web app.
- When adding new secrets, update both `Secrets.gs` (the `SECRETS` array) and `_loadConfig()` in `ReminderEngine.gs`.
- When adding new Slack interactive elements, add the handler in `doPost()` in `WebApp.gs`.
- The `onShowSetupEdit` installable trigger must be reinstalled if its behavior changes (Menu → Install Daily Trigger).

## File Responsibilities

| File | Purpose |
|------|---------|
| `Config.gs` | Constants: sheet names, column indices, status values, anchor labels, timing defaults |
| `TaskTemplateData.gs` | Master task list — the single source of truth for what tasks exist |
| `Setup.gs` | `onOpen` menu, `initialSetup`, sheet creation functions |
| `ShowTimeline.gs` | Per-show tab generation, anchor date retrieval, date computation |
| `ReminderEngine.gs` | Daily trigger logic, action determination, notification dispatch, config loading, active show retrieval, readthrough prompting |
| `SlackIntegration.gs` | `sendSlack()`, block message builders, readthrough date prompt |
| `EmailIntegration.gs` | `sendEmailReminder()`, HTML email, daily digest email |
| `SeasonOverview.gs` | Dashboard refresh, trigger installation |
| `WebApp.gs` | `doGet`/`doPost` handlers, Mark Done/Undone, readthrough date setting, task reactivation, date change detection, Slack confirmations |
| `Secrets.gs` | Script Properties management UI |
| `TestUtils.gs` | Test functions for all message types |

## Testing

- Use the **🧪 Test All Message Types** menu item to test Slack and email output.
- Use **▶️ Run Reminders Now** to test the full daily cycle.
- For Slack interactivity testing, the web app must be deployed and the Slack app's Interactivity Request URL must point to it.
- Check **View → Executions** in the Apps Script editor for logs and errors.
- Check the **📨 Send Log** sheet for a history of all sent messages.
