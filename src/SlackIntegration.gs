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
 * Sends a slim block message with a "✅ Mark Done" button, then threads
 * a reply with extended details (responsible, timing rule, handbook, etc.).
 *
 * The primary message is a single descriptive line so the channel stays
 * scannable. All supporting context lives in the thread.
 */
function sendSlackBlockMessageWithButton(config, context, action) {
  const emoji = action === 'overdue' ? '🚨' : action === 'urgent' ? '⚠️' : '📋';
  const color = action === 'overdue' ? '#dc2626' : action === 'urgent' ? '#f59e0b' : '#2563eb';

  const label = action === 'overdue' ? 'Overdue' : action === 'urgent' ? 'Due tomorrow' : 'Upcoming';

  // ── Primary message: single line + Mark Done button ────────────────────
  const primaryBlocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: emoji + ' *' + label + ':* ' + context.task + ' — due ' + context.deadline,
      },
    },
  ];

  if (context.markDoneUrl) {
    primaryBlocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '✅ Mark Done', emoji: true },
        style: 'primary',
        action_id: 'mark_done:' + encodeURIComponent(context.showName) + ':' + encodeURIComponent(context.task),
        url: context.markDoneUrl,
      }],
    });
  }

  // Fallback text shown in notifications / previews (no show name)
  const fallbackText = emoji + ' ' + label + ': ' + context.task + ' — due ' + context.deadline;

  const parentResult = sendSlack(config, '', context.slackChannel, {
    attachments: [{ color: color, fallback: fallbackText, blocks: primaryBlocks }],
  });

  // ── Threaded reply: full details & resources ───────────────────────────
  if (parentResult && parentResult.ok && parentResult.ts) {
    const statusLine = action === 'overdue'
      ? '🚨 ' + context.daysOverdue + ' days overdue'
      : '🗓️ ' + context.daysUntil + ' days remaining';

    const detailLines = [
      '*Responsible:* ' + context.responsible,
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
