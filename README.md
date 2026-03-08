# KWLT Production Automation

Automated reminder system for Kitchener-Waterloo Little Theatre production teams. Built on Google Sheets + Apps Script — free, runs inside your existing Google Workspace, and requires only spreadsheet skills to operate.

## What It Does

- **Computes all production deadlines** from just 4 anchor dates using the timing rules from the KWLT Mainstage Runbook
- **Sends automated reminders** via Slack (per-show channels) and email (to show email addresses) as deadlines approach
- **One-click "Mark Done"** — production team members can mark tasks complete directly from Slack buttons or email links
- **Escalates overdue tasks** to the Show Support Committee's Slack channel
- **Provides a dashboard** (Season Overview) showing upcoming deadlines across all concurrent shows, refreshed daily
- **Sends a reminder summary** to the Show Support Slack channel when reminders go out
- **Secrets stored securely** — tokens and sensitive config are in Script Properties, not visible in the spreadsheet

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    Google Sheets                             │
│                                                              │
│  ⚙️ Config          — Non-sensitive settings (reminder       │
│                       timing, feature toggles, handbook URL) │
│  🎭 Show Setup      — Anchor dates, show email, contacts    │
│  📋 Task Template   — Master task list with timing rules     │
│  ✉️ Message Templates — Editable reminder text               │
│  📅 Season Overview  — Cross-show deadline dashboard         │
│  📨 Send Log         — History of all sent reminders         │
│  📖 README           — In-sheet usage guide                  │
│                                                              │
│  🎬 Show Name        — One tab per show (auto-generated)     │
│                                                              │
├──────────────────────────────────────────────────────────────┤
│           Google Apps Script + Script Properties             │
│                                                              │
│  Secrets (Script Properties — not visible in sheet):         │
│    Slack Bot Token, Web App URL, Show Support Channel, etc.  │
│                                                              │
│  Daily trigger (9 AM) → checks all active show tabs →        │
│    → sends Slack messages with ✅ Mark Done buttons          │
│    → sends HTML emails with ✅ Mark Done links               │
│    → posts reminder summary to show support Slack channel     │
│    → escalates overdue tasks to show support Slack channel   │
│    → refreshes Season Overview                               │
│    → logs everything to Send Log                             │
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
   - `Config.gs`, `TaskTemplateData.gs`, `Setup.gs`, `ShowTimeline.gs`
   - `ReminderEngine.gs`, `SlackIntegration.gs`, `EmailIntegration.gs`
   - `SeasonOverview.gs`, `WebApp.gs`, `Secrets.gs`, `TestUtils.gs`
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

# Create a new bound Apps Script project:
clasp create --type sheets --title "KWLT Production Automation" --rootDir src

# This creates a .clasp.json file with your script ID (gitignored).
# Push the code:
clasp push

# Open the Sheet and reload — the menu should appear
```


## First-Time Setup (after deployment)

1. **Run Initial Setup**: In the Sheet, click 🎭 KWLT Automation → Initial Setup

2. **Deploy the Web App** (enables "Mark Done" buttons):
   - In Apps Script editor: Deploy → New deployment
   - Type: **Web app**
   - Execute as: **Me**
   - Who has access: **Anyone** (so production team can click links)
   - Copy the deployed URL

3. **Set up your Slack app**:
   - Go to [api.slack.com/apps](https://api.slack.com/apps) → create or select your KWLT app
   - **OAuth & Permissions** → add Bot Token Scope: `chat:write` → Install/reinstall to workspace
   - Copy the **Bot User OAuth Token** (starts with `xoxb-`)
   - **Interactivity & Shortcuts** (optional) → toggle On → set Request URL to your Web App URL
   - Invite the bot to each show's Slack channel: `/invite @YourAppName`

4. **Configure secrets** via 🎭 KWLT Automation → 🔐 Manage Secrets:
   - **Slack Bot Token**: the `xoxb-` token from step 3
   - **Web App URL**: the URL from step 2
   - **Show Support Channel**: e.g., `#comm-show-support-private`
   - **Show Support Email** and **Escalation Email**: optional (digest and escalations go to Slack by default)

5. **Configure non-sensitive settings** in the ⚙️ Config sheet:
   - **Slack Default Channel**: fallback channel (e.g., `#show-reminders`)
   - **Handbook URL**: link to the Production Handbook
   - Adjust reminder timing if needed (defaults: 7 days advance, 1 day urgent, 2 days overdue)

6. **Test**: 🎭 KWLT Automation → 🧪 Test All Message Types

7. **Install the daily trigger**: 🎭 KWLT Automation → ⏰ Install Daily Trigger

## Setting Up a New Show (or a whole season)

1. Go to the **🎭 Show Setup** sheet
2. Fill in one row per show:
   - **Show Name**: e.g., "Hamlet"
   - **Slack Channel**: e.g., `#show-hamlet`
   - **Show Email**: e.g., `hamlet@kwlt.org`
   - **Resources Folder URL**: link to the show's Google Drive resources folder
   - **Required dates** (green headers, marked `*`): Audition Start, Build/Possession, Opening Night, Closing Night
   - **Auto-derived dates** (blue headers, marked `(auto)`): leave blank or override — Audition End (+2 days), Tech Weekend Start (opening night -6 days), Tech Weekend End (+1 day)
   - **Optional dates** (gray headers, marked `(opt)`): Readthrough — related tasks are skipped if left blank
3. Click **🎭 KWLT Automation → 📋 Generate Show Task Tabs**
   - Confirms the list of shows, then creates all timeline tabs at once
4. **Review the dates** in each 🎬 tab — adjust any that need tweaking
5. Set **Active? = TRUE** for each show when ready for reminders

## Day-to-Day Operations

| What | How |
|------|-----|
| Mark a task done | Click ✅ in Slack or the email button, OR change Status to "Done" in the sheet |
| Skip a task | Change Status to "Skipped" |
| Override a deadline | Edit the date in the "Computed Deadline" column |
| Change notification channel | Change "Notify Via" to slack, email, both, or none |
| See what's coming up | 🎭 KWLT Automation → Refresh Season Overview |
| Check what was sent | Look at the 📨 Send Log sheet |
| Edit reminder wording | Go to ✉️ Message Templates and edit the Body column |
| Test all message types | 🎭 KWLT Automation → 🧪 Test All Message Types |
| Update secrets | 🎭 KWLT Automation → 🔐 Manage Secrets |
| Stop all reminders | 🎭 KWLT Automation → 🛑 Remove All Triggers |

## Security & Privacy

- **Sensitive values** (Slack Bot Token, webhook URL, emails, Web App URL) are stored in **Script Properties**, not the spreadsheet. Only users with script editor access can view or change them.
- **Manage secrets** via the menu: 🎭 KWLT Automation → 🔐 Manage Secrets
- **Spreadsheet permissions**: Production teams can have view-only access. Only Show Support needs edit access.
- The `.clasp.json` file (containing the Apps Script project ID) is gitignored and not committed.

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
{{SLACK_CHANNEL}}  {{HANDBOOK_URL}}  {{RESOURCES_URL}}  {{MARK_DONE_URL}}  {{DATE}}
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
├── SlackIntegration.gs   — Slack Bot Token API + webhook fallback
├── EmailIntegration.gs   — Gmail sending (HTML + plain text)
├── SeasonOverview.gs     — Cross-show dashboard, trigger management
├── WebApp.gs             — Web app endpoint for "Mark Done"
├── Secrets.gs            — Script Properties management for sensitive config
└── TestUtils.gs          — Test functions for all message types
```

## Troubleshooting

| Problem | Solution |
|---------|----------|
| Menu doesn't appear | Reload the sheet. If still missing, open Apps Script and check for errors. |
| Reminders stopped sending | Check if the trigger is still installed: 🎭 KWLT Automation → ⏰ Install Daily Trigger |
| Slack messages going to wrong channel | Ensure the Slack Channel in Show Setup matches the channel name, and the bot is invited (`/invite @AppName`). |
| Slack messages not arriving | Check 🔐 Manage Secrets → Slack Bot Token is set. Run 🧪 Test All Message Types from the menu. |
| Emails not sending | The script owner needs Gmail permissions. Re-authorize by running any function from the script editor. |
| Wrong dates computed | Check the 4 required anchor dates in 🎭 Show Setup. Override specific dates in the show's tab. |
| "Mark Done" links not working | Check 🔐 Manage Secrets → Web App URL. Redeploy the web app if needed (Deploy → Manage deployments → update to latest version). |
| Slack buttons not responding | Set up Interactivity in your Slack app settings, pointing to the Web App URL. Without it, buttons open in the browser instead. |
| "Too many reminders" | Change task Notify Via to "none" or Status to "Skipped" for irrelevant tasks. |
| Permission errors | Run any function from the Apps Script editor to trigger re-authorization. |

## Original Resources

The `resources/` folder (not committed) contains the original KWLT production documentation that this automation is based on:
- **KWLT Runbook Template: Mainstage Production** — the task timeline this system automates
- **KWLT Runbook Template: Season** — season-level tasks (manual for now)
- **KWLT Production Handbook** — detailed role descriptions and processes
- **KWLT Policy Manual** — organizational policies
