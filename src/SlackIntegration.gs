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
 * @param {Object} [opts] — optional: { attachments }
 * @returns {{ ok: boolean, error: string }}
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
      return { ok: true };
    } else {
      var errMsg = result.error +
        (result.error === 'channel_not_found' ? ' (is the bot invited to #' + ch + '?)' : '') +
        (result.error === 'not_in_channel' ? ' (run /invite @YourApp in #' + ch + ')' : '');
      Logger.log('Slack: Error — ' + errMsg);
      return { ok: false, error: errMsg };
    }
  } catch (e) {
    Logger.log('Slack: Exception — ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ─── Block Message Builders ───────────────────────────────────────────────────

/**
 * Sends a rich block message with a "✅ Mark Done" button.
 */
function sendSlackBlockMessageWithButton(config, context, action) {
  const emoji = action === 'overdue' ? '🚨' : action === 'urgent' ? '⚠️' : '📋';
  const color = action === 'overdue' ? '#dc2626' : action === 'urgent' ? '#f59e0b' : '#2563eb';

  const headerText = action === 'overdue'
    ? emoji + ' Overdue: ' + context.task
    : action === 'urgent'
    ? emoji + ' Due tomorrow: ' + context.task
    : emoji + ' Upcoming: ' + context.task;

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: headerText,
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*Show:*\n' + context.showName },
        { type: 'mrkdwn', text: '*Responsible:*\n' + context.responsible },
        { type: 'mrkdwn', text: '*Deadline:*\n' + context.deadline },
        { type: 'mrkdwn', text: '*Status:*\n' + (action === 'overdue'
          ? context.daysOverdue + ' days overdue'
          : context.daysUntil + ' days remaining') },
      ],
    },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: '📌 ' + context.generalRule + (context.handbookUrl ? '  |  📖 <' + context.handbookUrl + '|Production Handbook>' : ''),
      }],
    },
  ];

  if (context.markDoneUrl) {
    blocks.push({
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

  const text = emoji + ' ' + context.showName + ': ' + context.task + ' — due ' + context.deadline;

  return sendSlack(config, text, context.slackChannel, {
    attachments: [{ color: color, blocks: blocks }],
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
