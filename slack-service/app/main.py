"""
KWLT Production Automation — FastAPI Application

Entry point for the Slack service. Handles:
  - Slack interactive component callbacks (buttons, date pickers)
  - Slack Events API (app_mention for RAG Q&A — Phase 4)
  - Email Mark Done links (GET requests)
  - Health check
"""

from fastapi import FastAPI

app = FastAPI(
    title="KWLT Slack Service",
    description="Slack bot service for KWLT Production Automation",
    version="0.1.0",
)


@app.get("/health")
async def health_check():
    """Health check endpoint for Cloud Run."""
    return {"status": "ok"}


# ── Slack Interaction Handlers (Phase 2) ─────────────────────────────────────
# TODO: POST /slack/interactions — replaces doPost() from WebApp.gs
# TODO: GET /mark-done — replaces doGet() from WebApp.gs

# ── Slack Events API (Phase 4 — RAG Q&A) ────────────────────────────────────
# TODO: POST /slack/events — handles app_mention events
