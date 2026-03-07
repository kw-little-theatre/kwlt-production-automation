# KWLT Production Automation

Automated reminder system for Kitchener-Waterloo Little Theatre production teams. Built on Google Sheets + Apps Script — free, runs inside your existing Google Workspace, and requires only spreadsheet skills to operate.

## What It Does

- **Computes all production deadlines** from a few anchor dates (audition dates, opening night, etc.) using the timing rules from the KWLT Mainstage Runbook
- **Sends automated reminders** via Slack and/or email as deadlines approach
- **One-click "Mark Done"** — production team members can mark tasks complete directly from Slack buttons or email links
- **Escalates overdue tasks** to the Show Support Committee member
- **Provides a dashboard** (Season Overview) showing upcoming deadlines across all concurrent shows
- **Sends a daily digest email** summarizing all reminders sent that day

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Google Sheets                             │
│                                                              │
│  ⚙️ Config          — Slack webhook, emails, settings        │
│  🎭 Show Setup      — Anchor dates & contacts per show      │
│  📋 Task Template   — Master task list with timing rules     │
│  ✉️ Message Templates — Editable reminder text               │
│  📅 Season Overview  — Cross-show deadline dashboard         │
│  📨 Send Log         — History of all sent reminders         │
│  📖 README           — In-sheet usage guide                  │
│                                                              │
│  🎬 Show Name        — One tab per show (auto-generated)     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│                Google Apps Script                             │
│                                                              │
│  Daily trigger (9 AM) → checks all active show tabs →        │
│    → sends Slack messages with ✅ Mark Done buttons          │
│    → sends HTML emails with ✅ Mark Done links               │
│    → logs everything to Send Log                             │
│    → sends daily digest to Show Support                      │
│                                                              │
│  Web App endpoint → handles "Mark Done" clicks from          │
│    → Slack interactive buttons (POST)                        │
│    → Email link clicks (GET)                                 │
│    → Updates task status to Done in the spreadsheet          │
└──────────────────────────────────────────────────────────────┘
```

## Deployment

There are **two ways** to deploy this. Choose whichever you're more comfortable with.

### Option A: Copy-Paste (no tools required)

1. **Create a new Google Sheet** in your KWLT Google Workspace
2. Open the **Script Editor**: Extensions → Apps Script
3. Delete any code in the default `Code.gs` file
4. Create new script files (File → New → Script file) for each `.gs` file in the `src/` folder:
   - `Config.gs`
   - `TaskTemplateData.gs`
   - `Setup.gs`
   - `ShowTimeline.gs`
   - `ReminderEngine.gs`
   - `SlackIntegration.gs`
   - `EmailIntegration.gs`
   - `SeasonOverview.gs`
   - `WebApp.gs`
5. Copy-paste the contents of each file from `src/` into the corresponding Apps Script file
6. **Also** replace the `appsscript.json` manifest: In the script editor, click ⚙️ Project Settings → check "Show appsscript.json manifest file" → edit it with the contents of `src/appsscript.json`
7. Delete the original empty `Code.gs` file
8. Save all files (Ctrl+S / Cmd+S)
9. Go back to your Google Sheet, reload the page, and the **🎭 KWLT Automation** menu should appear
10. Click **🎭 KWLT Automation → Initial Setup** to create all sheets

### Option B: Deploy with clasp (command line)

[clasp](https://github.com/google/clasp) is Google's CLI for Apps Script.

```bash
# Install clasp globally
npm install -g @google/clasp

# Log in with your KWLT Google account
clasp login

# Create a new Google Sheet and note the URL
# Then create a bound Apps Script project:
clasp create --type sheets --title "KWLT Production Automation" --rootDir src

# Or, if you already created the Sheet manually:
# 1. Open Extensions → Apps Script and note the Script ID from the URL
# 2. Put that Script ID in .clasp.json
# 3. Then push:
clasp push

# Open the Sheet and reload — the menu should appear
```

## First-Time Setup (after deployment)

1. **Run Initial Setup**: In the Sheet, click 🎭 KWLT Automation → Initial Setup
2. **Deploy the Web App** (enables "Mark Done" buttons):
   - In Apps Script editor: Deploy → New deployment
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (so production team can click links without logging in)
   - Copy the deployed URL
3. **Configure settings** in the ⚙️ Config sheet:
   - **Slack Webhook URL**: Create one at https://api.slack.com/messaging/webhooks
   - **Escalation Email**: e.g., `executive-producer@kwlt.org`
   - **Show Support Email**: e.g., `show-support@kwlt.org`
   - **Handbook URL**: Link to your Production Handbook document
   - **Web App URL**: Paste the URL from step 2
4. **Set up Slack interactivity** (optional, for in-Slack buttons):
   - Go to https://api.slack.com/apps and create/select your KWLT app
   - Navigate to **Interactivity & Shortcuts** → toggle **On**
   - Set **Request URL** to the same Web App URL from step 2
   - Save Changes
   - Note: Even without this step, Slack messages include a clickable "Mark Done" link that opens in the browser
5. **Test connections**: Run `testSlackConnection()` and `testEmailConnection()` from the script editor (Run menu)
6. **Install the daily trigger**: 🎭 KWLT Automation → Install Daily Trigger

## Setting Up a New Show

1. Go to the **🎭 Show Setup** sheet
2. Fill in a new row:
   - **Show Name**: e.g., "Hamlet"
   - **Slack Channel**: e.g., "#show-hamlet"
   - **Anchor Dates**: Fill in the ~10 key dates (the system computes everything else)
   - **Production Team**: Names and emails for Director, SM, TD, Producer
3. Click **🎭 KWLT Automation → Create New Show**
4. A new **🎬 Hamlet** tab appears with ~50 computed tasks
5. **Review the dates** — adjust any that need manual tweaking
6. Set **Active? = TRUE** in Show Setup when ready for reminders

## Day-to-Day Operations

| What | How |
|------|-----|
| Mark a task done | Click ✅ in Slack or the email button, OR change Status to "Done" in the sheet |
| Skip a task that doesn't apply | Change Status to "Skipped" |
| Override a deadline | Edit the date in the "Computed Deadline" column |
| Change how you're notified | Change "Notify Via" to slack, email, both, or none |
| See what's coming up | 🎭 KWLT Automation → Refresh Season Overview |
| Check what was sent | Look at the 📨 Send Log sheet |
| Edit reminder wording | Go to ✉️ Message Templates and edit the Body column |
| Stop all reminders | 🎭 KWLT Automation → Remove All Triggers |

## Permissions

When you first run the script, Google will ask you to authorize these permissions:

- **Google Sheets** — read/write the spreadsheet data
- **Gmail** — send reminder emails from your @kwlt.org account
- **External requests** — call the Slack webhook API
- **Script triggers** — install the daily automated trigger

This is normal. The script only accesses this one spreadsheet and sends messages to the configured recipients.

## Customization

### Adding/removing tasks
Edit the **📋 Task Template** sheet (or `TaskTemplateData.gs` for permanent changes). New shows will pick up the updated template. Existing show tabs are not affected — edit those directly.

### Changing reminder timing
In ⚙️ Config:
- **Advance Reminder Days** (default: 7) — first heads-up
- **Urgent Reminder Days** (default: 1) — final nudge
- **Overdue Escalation Days** (default: 2) — days past deadline before escalation

### Changing message text
Edit the **✉️ Message Templates** sheet. Available placeholders:
```
{{SHOW_NAME}}  {{TASK}}  {{RESPONSIBLE_PARTY}}  {{DEADLINE}}
{{DAYS_UNTIL}}  {{DAYS_OVERDUE}}  {{GENERAL_RULE}}
{{SLACK_CHANNEL}}  {{HANDBOOK_URL}}  {{MARK_DONE_URL}}  {{DATE}}
```

## File Structure

```
src/
├── appsscript.json       — Apps Script manifest (timezone, scopes)
├── Config.gs             — Constants and configuration
├── TaskTemplateData.gs   — Master task list from the KWLT Runbook
├── Setup.gs              — Initial setup, menu, sheet creation
├── ShowTimeline.gs       — Per-show timeline generation & date computation
├── ReminderEngine.gs     — Daily reminder logic, template rendering
├── SlackIntegration.gs   — Slack webhook messaging + interactive buttons
├── EmailIntegration.gs   — Gmail sending (HTML + plain text), daily digest
├── SeasonOverview.gs     — Cross-show dashboard, trigger management
└── WebApp.gs             — Web app endpoint for "Mark Done" (email links + Slack buttons)
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Menu doesn't appear | Reload the sheet. If still missing, open Apps Script and check for errors. |
| Reminders stopped sending | Check if the trigger is still installed: 🎭 KWLT Automation → Install Daily Trigger |
| Slack messages not arriving | Verify the webhook URL in ⚙️ Config. Run `testSlackConnection()` from the script editor. |
| Emails not sending | The script owner needs Gmail permissions. Re-authorize if prompted. |
| Wrong dates computed | Check the anchor dates in 🎭 Show Setup. Manually override in the show's tab if needed. |
| "Mark Done" links not working | Deploy the web app (Deploy → New deployment → Web app) and paste the URL into ⚙️ Config → Web App URL. |
| Slack buttons not responding | Set up Interactivity in your Slack app settings, pointing to the Web App URL. Without it, buttons fall back to opening the link in a browser. |
| "Too many reminders" | Change task Notify Via to "none" or Status to "Skipped" for irrelevant tasks. |

## Original Resources

The `resources/` folder contains the original KWLT production documentation that this automation is based on:
- **KWLT Runbook Template: Mainstage Production** — the task timeline this system automates
- **KWLT Runbook Template: Season** — season-level tasks (manual for now)
- **KWLT Production Handbook** — detailed role descriptions and processes
- **KWLT Policy Manual** — organizational policies
- Various templates, guides, and logo assets
