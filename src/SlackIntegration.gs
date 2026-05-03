/**
 * KWLT Production Automation — Slack Integration
 *
 * Sends reminder messages to Slack channels via the Bot Token API
 * (chat.postMessage). Can post to ANY channel the bot is invited to.
 *
 * Setup:
 *   1. Go to https://api.slack.com/apps → select your KWLT app
 *   2. OAuth & Permissions → add Bot Token Scope: chat:write
 *   3. Install/reinstall the app to your workspace
 *   4. Copy the "Bot User OAuth Token" (starts with xoxb-)
 *   5. Paste into 🔐 Manage Secrets → Slack Bot Token
 *   6. Invite the bot to each show channel: /invite @YourAppName
 */

// ─── Send Function ────────────────────────────────────────────────────────────

/**
 * Sends a message to Slack via the Bot Token API.
 *
 * @param {Object} config — loaded config (needs slackBotToken)
 * @param {string} text — message text (Slack mrkdwn)
 * @param {string} channel — channel name or ID (e.g., "#show-hamlet")
 * @param {Object} [opts] — optional: { attachments, thread_ts }
 * @returns {{ ok: boolean, ts: string, error: string }}
 */
function sendSlack(config, text, channel, opts) {
  if (!config.slackBotToken) {
    Logger.log('Slack: No bot token configured. Skipping.');
    return { ok: false, error: 'No Slack bot token configured' };
  }

  if (!channel) {
    Logger.log('Slack: No channel specified. Skipping.');
    return { ok: false, error: 'No channel specified' };
  }

  // Strip # prefix if present — API expects channel name without #
  const ch = channel.startsWith('#') ? channel.substring(1) : channel;

  const payload = {
    channel: ch,
    text: text,
    unfurl_links: false,
    unfurl_media: false,
  };

  if (opts && opts.attachments) payload.attachments = opts.attachments;
  if (opts && opts.thread_ts) payload.thread_ts = opts.thread_ts;

  try {
    const response = UrlFetchApp.fetch('https://slack.com/api/chat.postMessage', {
      method: 'post',
      contentType: 'application/json; charset=utf-8',
      headers: { 'Authorization': 'Bearer ' + config.slackBotToken },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const result = JSON.parse(response.getContentText());
    if (result.ok) {
      Logger.log('Slack: Message sent to #' + ch);
      return { ok: true, ts: result.ts };
    } else {
      var errMsg = result.error;
      if (result.needed) errMsg += ' (needed: ' + result.needed + ')';
      if (result.provided) errMsg += ' (provided: ' + result.provided + ')';
      if (result.error === 'channel_not_found') errMsg += ' (is the bot invited to #' + ch + '?)';
      if (result.error === 'not_in_channel') errMsg += ' (run /invite @YourApp in #' + ch + ')';
      Logger.log('Slack: Error — ' + errMsg + ' | Full response: ' + response.getContentText());
      return { ok: false, error: errMsg };
    }
  } catch (e) {
    Logger.log('Slack: Exception — ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ─── Block Message Builders ───────────────────────────────────────────────────

/**
 * Sends a block message with task, responsible party, deadline, and a
 * "✅ Mark Done" button, then threads a reply with extended details
 * (timing rule, handbook, resources).
 *
 * The primary message shows the task, who's responsible, and the deadline
 * so the channel stays scannable. Supporting context lives in the thread.
 */
function sendSlackBlockMessageWithButton(config, context, action) {
  const isOptional = context.isOptional || false;
  const emoji = isOptional ? '❔' : action === 'overdue' ? '🚨' : action === 'urgent' ? '⚠️' : '📋';
  const color = isOptional ? '#a78bfa' : action === 'overdue' ? '#dc2626' : action === 'urgent' ? '#f59e0b' : '#2563eb';

  const label = isOptional ? 'Optional' : action === 'overdue' ? 'Overdue' : action === 'urgent' ? 'Due tomorrow' : 'Upcoming';

  // ── Primary message: task + responsible + deadline + Mark Done button ──
  const taskLine = isOptional
    ? emoji + ' *' + label + ':* ' + context.task + '\n👤 *Responsible:* ' + context.responsible + '  |  📅 *Due:* ' + context.deadline + '\n_This task is optional — skip it if not applicable to your production._'
    : emoji + ' *' + label + ':* ' + context.task + '\n👤 *Responsible:* ' + context.responsible + '  |  📅 *Due:* ' + context.deadline;

  const primaryBlocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: taskLine,
      },
    },
  ];

  // Buttons: Mark Done + Skip (for optional) or just Mark Done
  const buttons = [{
    type: 'button',
    text: { type: 'plain_text', text: '✅ Mark Done', emoji: true },
    style: 'primary',
    action_id: 'mark_done:' + encodeURIComponent(context.showName) + ':' + encodeURIComponent(context.task),
  }];

  if (isOptional) {
    buttons.push({
      type: 'button',
      text: { type: 'plain_text', text: '⏭️ Skip', emoji: true },
      action_id: 'skip_task:' + encodeURIComponent(context.showName) + ':' + encodeURIComponent(context.task),
    });
  }

  // Mark Done button always rendered — it uses Slack Interactivity (action_id), not WEB_APP_URL
  primaryBlocks.push({
    type: 'actions',
    elements: buttons,
  });

  // Fallback text shown in notifications / previews (no show name)
  const fallbackText = emoji + ' ' + label + ': ' + context.task + ' (' + context.responsible + ') — due ' + context.deadline;

  const parentResult = sendSlack(config, '', context.slackChannel, {
    attachments: [{ color: color, fallback: fallbackText, blocks: primaryBlocks }],
  });

  // ── Threaded reply: full details & resources ───────────────────────────
  if (parentResult && parentResult.ok && parentResult.ts) {
    const statusLine = action === 'overdue'
      ? '🚨 ' + context.daysOverdue + ' days overdue'
      : '🗓️ ' + context.daysUntil + ' days remaining';

    const detailLines = [
      '*Deadline:* ' + context.deadline,
      '*Status:* ' + statusLine,
      '',
      '📌 *Timing:* ' + context.generalRule,
    ];

    if (context.handbookUrl) {
      detailLines.push('📖 <' + context.handbookUrl + '|Production Handbook>');
    }
    if (context.resourcesUrl) {
      detailLines.push('📁 <' + context.resourcesUrl + '|Show Resources Folder>');
    }

    sendSlack(config, detailLines.join('\n'), context.slackChannel, {
      thread_ts: parentResult.ts,
    });
  }

  return parentResult;
}

// ─── Consolidated Per-Show Reminder ───────────────────────────────────────────

/**
 * Sends a single Slack message for a group of per-show tasks (NWF feature).
 * Instead of N separate reminders for "Cast shows — Show 1", "Cast shows — Show 2", etc.,
 * sends one message listing all pending shows with a dropdown to mark done per show.
 *
 * @param {Object} config — loaded config
 * @param {Object} context — template context (from first task in group)
 * @param {string} action — 'advance', 'urgent', or 'overdue'
 * @param {string} baseTask — the base task name (without show suffix)
 * @param {string[]} subShows — array of individual show names still pending
 * @returns {{ ok: boolean, ts: string, error: string }}
 */
function sendConsolidatedPerShowReminder(config, context, action, baseTask, subShows) {
  const isOptional = context.isOptional || false;
  const emoji = isOptional ? '❔' : action === 'overdue' ? '🚨' : action === 'urgent' ? '⚠️' : '📋';
  const color = isOptional ? '#a78bfa' : action === 'overdue' ? '#dc2626' : action === 'urgent' ? '#f59e0b' : '#2563eb';
  const label = isOptional ? 'Optional' : action === 'overdue' ? 'Overdue' : action === 'urgent' ? 'Due tomorrow' : 'Upcoming';

  const pendingList = subShows.map(function(s) { return '• ' + s; }).join('\n');

  const taskLine = emoji + ' *' + label + ':* ' + baseTask +
    '\n👤 *Responsible:* ' + context.responsible + '  |  📅 *Due:* ' + context.deadline +
    '\n\n⏳ *Pending for ' + subShows.length + ' show(s):*\n' + pendingList;

  const blocks = [
    {
      type: 'section',
      text: { type: 'mrkdwn', text: taskLine },
    },
  ];

  // Dropdown to mark done for a specific show
  const options = subShows.map(function(s) {
    return {
      text: { type: 'plain_text', text: '✅ ' + s, emoji: true },
      value: s,
    };
  });

  blocks.push({
    type: 'actions',
    elements: [{
      type: 'static_select',
      placeholder: { type: 'plain_text', text: 'Mark done for...', emoji: true },
      action_id: 'mark_done_per_show:' + encodeURIComponent(context.showName) + ':' + encodeURIComponent(baseTask),
      options: options,
    }],
  });

  if (isOptional) {
    // Optional note
    blocks.splice(1, 0, {
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '_This task is optional — skip it if not applicable._' }],
    });
  }

  const fallbackText = emoji + ' ' + label + ': ' + baseTask + ' (' + context.responsible + ') — due ' + context.deadline + ' — ' + subShows.length + ' shows pending';

  return sendSlack(config, '', context.slackChannel, {
    attachments: [{ color: color, fallback: fallbackText, blocks: blocks }],
  });
}

// ─── Readthrough Date Prompt ──────────────────────────────────────────────────

/**
 * Sends a Slack message with a Block Kit date picker asking the production
 * team to select the readthrough date. Used after auditions close when the
 * readthrough date hasn't been set in Show Setup.
 *
 * @param {Object} config — loaded config (needs slackBotToken)
 * @param {string} showName — the show name
 * @param {string} channel — the show's Slack channel
 * @returns {{ ok: boolean, ts: string, error: string }}
 */
function sendReadthroughDatePrompt(config, showName, channel) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '📅 *Readthrough Date Needed — ' + showName + '*\n\n' +
          'Auditions are wrapped! When is the readthrough? ' +
          'Pick a date below so reminders for readthrough-dependent tasks can be scheduled.',
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'datepicker',
          action_id: 'readthrough_date:' + encodeURIComponent(showName),
          placeholder: {
            type: 'plain_text',
            text: 'Choose readthrough date',
          },
        },
      ],
    },
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: '_This prompt will repeat daily until the date is set._',
        },
      ],
    },
  ];

  const fallbackText = '📅 Readthrough date needed for ' + showName + ' — please set it in the Show Setup sheet or use the date picker.';

  return sendSlack(config, '', channel, {
    attachments: [{ color: '#6d28d9', fallback: fallbackText, blocks: blocks }],
  });
}

// ─── Test Function ────────────────────────────────────────────────────────────

function testSlackConnection() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = _loadConfig(ss);

  if (!config.slackBotToken) {
    SpreadsheetApp.getUi().alert(
      'No Slack Configured',
      'Please set the Slack Bot Token via 🔐 Manage Secrets.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }

  const testChannel = config.slackDefaultChannel || '';
  const message = '✅ *KWLT Show Support* — Test message.\n\n' +
    'If you see this, your Slack integration is working! 🎭\n' +
    '_Sent at ' + new Date().toLocaleString() + '_';

  const result = sendSlack(config, message, testChannel);
  const ok = result && result.ok;

  SpreadsheetApp.getUi().alert(
    ok ? '✅ Success' : '❌ Failed',
    ok
      ? 'Test message sent!'
      : 'Failed to send. ' +
        (result && result.error ? 'Error: ' + result.error : '') + '\n\n' +
        'Check the bot token (🔐 Manage Secrets) and ensure the bot is invited to the channel.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
