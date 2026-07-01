# KWLT Slack Service

FastAPI service that handles Slack interactions for the KWLT Production Automation
system, deployed to **Google Cloud Run**. This is the Python half of a hybrid
architecture — the Apps Script project (`../src/`) remains the data layer and
reminder engine.

## Architecture (hybrid model)

Two components share one Google Sheet as the data layer:

| Component | Runtime | Responsibilities |
|-----------|---------|------------------|
| **Apps Script** (`../src/`) | Google Apps Script, daily 9 AM trigger | Computes deadlines, runs the daily reminder cycle, reactivates readthrough-dependent tasks once a date is set, refreshes the dashboard. Sends outbound Slack **through this service** when `PYTHON_SERVICE_URL` is configured (falls back to sending Slack directly if the service is unreachable). |
| **Slack service** (this dir) | Python / FastAPI on Cloud Run | Receives **all** Slack interactions (buttons, date pickers, modal submissions), Events API events (welcome, `@mentions`, App Home tab), and the outbound reminder/digest endpoints that Apps Script calls. Reads/writes the sheet via `gspread`. |

The Slack app has exactly **one** Interactivity Request URL and **one** Events
Request URL — both point at this service in production. Apps Script's `doPost`
still exists but is legacy/fallback (plus some NWF multi-date readthrough logic
that was never ported — see `FUTURE_FEATURES.md`).

### Endpoints (`app/main.py`)

- `POST /slack/interactions` — buttons, date pickers, modal (`view_submission`)
- `POST /slack/events` — `member_joined_channel`, `app_mention`, `app_home_opened` (handles the URL-verification challenge)
- `POST /reminders/send` · `/reminders/digest` · `/reminders/overdue-digest` · `/reminders/readthrough-prompt` — called by Apps Script
- `GET /mark-done` — email "Mark Done" link fallback
- `GET /health` — health check

### Module layout (`app/`)

| File | Purpose |
|------|---------|
| `main.py` | FastAPI app, endpoints, background-task dispatch, signature verification |
| `handlers.py` | Business logic for interactions & events (routing, mark done/undone/skip, readthrough date, Home tab, add-task modal, date-change batcher) |
| `sheets.py` | `SheetRepository` — all Google Sheets access via gspread (ADC-first auth) |
| `slack_client.py` | `SlackClient` — thin wrapper over `slack_sdk` (post/update messages, Home tab, modals) |
| `messages.py` | Pure Block Kit builders (reminders, confirmations, Home tab, modals) |
| `reminder_logic.py` | Reminder action determination + template rendering |
| `models.py` | Pydantic models (`Config`, `TaskContext`, `MarkTaskResult`, `SetReadthroughResult`, …) |
| `config.py` · `constants.py` · `task_templates.py` · `verify.py` | Settings, constants (mirror `Config.gs`), task data, Slack signature verification |

Tests live in `tests/` (pytest); golden Block Kit payloads in `tests/golden/`.

## Local development & testing

> **Canonical process — start here when working on this service.**

### Prerequisites

- The `.venv` in this directory (`python -m venv .venv && pip install -r requirements.txt`). Local Python may be 3.9; prod is 3.11. Fine for tests.
- `gcloud` CLI, authenticated as a KWLT Google account.
- `ngrok` (to expose the local server to Slack).

### 1. Set up authentication (one time)

See [Authentication](#authentication) below — use impersonated ADC. Without it
the service starts but every Sheets call fails with `Invalid JWT Signature` /
`cache warming failed`.

### 2. Point at the TEST environment

From the repo root:

```bash
./env.sh test      # switches .env SPREADSHEET_ID + SHOW_SUPPORT_CHANNEL to the test sheet/channel
./env.sh status    # confirm
```

Run `./env.sh prod` when you're done testing.

### 3. Run the service (UNSANDBOXED)

```bash
cd slack-service
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8080
```

**Must run outside any sandbox** — the service reads ADC from `~/.config/gcloud`,
which sandboxes block. A clean startup with **no** `cache warming failed`
traceback means Sheets auth worked. (`uvicorn` has no `--reload` here, so restart
it after code changes.)

### 4. Expose to Slack

```bash
ngrok http 8080
```

Copy the `https` URL. In the [Slack app config](https://api.slack.com/apps):

- **Interactivity & Shortcuts** → Request URL → `<ngrok-url>/slack/interactions`
- **Event Subscriptions** → Request URL → `<ngrok-url>/slack/events` *(only if testing events)*

> ⚠️ **The Slack app has only one of each URL.** When you finish testing, point
> them **back to production** and run `./env.sh prod`:
> `https://kwlt-slack-service-1079589186133.us-east1.run.app/slack/interactions`

### 5. Run tests & lint

```bash
source .venv/bin/activate
python -m pytest tests/ -q     # tests mock Slack + Sheets — no network or creds needed
ruff check .
```

CI runs both on every push (`.github/workflows/slack-service-tests.yml`).

## Authentication

`SheetRepository.__init__` (`app/sheets.py`) tries **ADC (`google.auth.default()`)
first**, then falls back to a credentials file. In practice ADC is always used;
there is **no credentials key file** in this repo (a previously committed key was
leaked and rotated — do not add another).

### Production (Cloud Run)

- Runs as service account `kwlt-slackbot@kwlt-slackbot.iam.gserviceaccount.com`,
  attached at deploy time via `--service-account` (**required** — see Deployment).
- The production Google Sheet is shared with that SA (Editor).
- A Secret Manager secret `google-sheets-credentials` is also mounted at
  `/secrets/credentials.json` (`GOOGLE_SHEETS_CREDENTIALS_FILE`), but the attached
  SA (ADC) takes precedence. No key material is baked into the image.

### Local (impersonated ADC — keyless)

Plain user ADC with the `spreadsheets` scope is **blocked** by org policy, so
impersonate the service account instead:

```bash
gcloud auth application-default login \
  --impersonate-service-account=kwlt-slackbot@kwlt-slackbot.iam.gserviceaccount.com
```

This requires `roles/iam.serviceAccountTokenCreator` on the SA for your user:

```bash
gcloud iam service-accounts add-iam-policy-binding \
  kwlt-slackbot@kwlt-slackbot.iam.gserviceaccount.com \
  --member="user:you@kwlt.org" \
  --role="roles/iam.serviceAccountTokenCreator" --project=kwlt-slackbot
```

Notes:
- IAM propagation can take 1–2 minutes before impersonation works.
- The test sheet is already shared with the SA, so no sharing changes are needed.
- Because ADC lives in `~/.config/gcloud`, **run `gcloud` and `uvicorn` unsandboxed**.
- Verify from `slack-service/`: a clean `uvicorn` startup, or run a one-off read.

## Deployment (Cloud Run)

Manual deploy from source (no auto-deploy pipeline):

```bash
cd slack-service
gcloud run deploy kwlt-slack-service \
  --source . \
  --project=kwlt-slackbot \
  --region=us-east1 \
  --service-account=kwlt-slackbot@kwlt-slackbot.iam.gserviceaccount.com
```

- The `--service-account` flag is **required**. Without it Cloud Run uses the
  default compute SA, which lacks access to the production sheet.
- Builds from the `Dockerfile` via Cloud Build. Env vars, the Secret Manager
  volume mount, and service config are preserved across revisions.
- After deploy, verify: `curl https://kwlt-slack-service-1079589186133.us-east1.run.app/health`
  and check `gcloud run services logs read kwlt-slack-service --region=us-east1`
  for a clean startup.

### The Slack bot token lives in TWO places

When it changes, update **both** or one system gets `invalid_auth`:

1. **Apps Script:** 🔐 Manage Secrets → `SLACK_BOT_TOKEN`
2. **Cloud Run:** `gcloud run services update kwlt-slack-service --project=kwlt-slackbot --region=us-east1 --update-env-vars="SLACK_BOT_TOKEN=xoxb-..."`
