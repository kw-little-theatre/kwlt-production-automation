# UI/UX Feedback

Collected feedback on the Slack reminder/task notification experience.

## ~~Simplify task message format~~ ✅

The current task messages are text-heavy and require a lot of reading just to understand what's being asked. Proposed change:

- **Primary message:** Single descriptive sentence as a checklist item with the Mark Done button
  - e.g. *"Send acceptance and rejection notifications to ALL auditionees — due 2026-03-25"*
- **Thread reply:** Longer details, links to useful resources/documentation, examples, etc.

This keeps the channel scannable while still providing all the context people need if they dig in.

> **Addressed 2026-03-23** — Primary message slimmed to a single `section` block + Mark Done button. Details (responsible, deadline, status, timing rule, handbook link, resources folder link) now post as a threaded reply.

## ~~Remove redundant show name from message elements~~ ✅

The show name appears multiple times in the messages. Since these are posted in the show's channel and directed at the show's team, repeating the show name adds bulk without value. Strip it from the generated elements.

> **Addressed 2026-03-23** — Show name removed from visible message fields and fallback text. Retained in `action_id` / Mark Done URL (required for functionality) and in overdue escalation / daily digest messages (which go to the cross-show support channel).
