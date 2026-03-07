/**
 * KWLT Production Automation — Slack Integration
 *
 * Sends reminder messages to Slack channels. Supports two modes:
 *   1. Bot Token (recommended) — uses chat.postMessage API. Can post to ANY
 *      channel the bot is invited to. Respects the Slack Channel column in
 *      Show Setup. Set "Slack Bot Token" in ⚙️ Config.
 *   2. Incoming Webhook (fallback) — posts to whatever channel the webhook
 *      was created for. Set "Slack Webhook URL" in ⚙️ Config.
 *
 * Setup for Bot Token:
 *   1. Go to https://api.slack.com/apps → select your KWLT app
 *   2. OAuth & Permissions → add Bot Token Scope: chat:write
 *   3. Install/reinstall the app to your workspace
 *   4. Copy the "Bot User OAuth Token" (starts with xoxb-)
 *   5. Paste into ⚙️ Config → Slack Bot Token
 *   6. Invite the bot to each show channel: /invite @YourAppName
 */

// ─── Smart Send (picks bot token or webhook) ─────────────────────────────────

/**
 * Sends a message to Slack using the best available method.
 * Bot token takes priority (supports per-channel routing).
 * Falls back to webhook if no bot token is configured.
 *
 * @param {Object} config — loaded config (needs slackBotToken or slackWebhookUrl)
 * @param {string} text — message text (Slack mrkdwn)
 * @param {string} channel — channel name or ID (e.g., "#show-hamlet")
 * @param {Object} [opts] — optional: { attachments }
 * @returns {boolean}
 */
function sendSlack(config, text, channel, opts) {
  if (config.slackBotToken) {
    return _sendViaBotToken(config.slackBotToken, text, channel, opts);
  } else if (config.slackWebhookUrl) {
    return _sendViaWebhook(config.slackWebhookUrl, text, channel, opts);
  } else {
    Logger.log('Slack: No bot token or webhook URL configured. Skipping.');
    return { ok: false, error: 'No Slack bot token or webhook configured' };
  }
}

// ─── Bot Token API (chat.postMessage) ─────────────────────────────────────────

function _sendViaBotToken(botToken, text, channel, opts) {
  if (!botToken || !channel) {
    var msg = 'Missing ' + (!botToken ? 'token' : 'channel');
    Logger.log('Slack Bot: ' + msg + '. Skipping.');
    return { ok: false, error: msg };
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
      headers: { 'Authorization': 'Bearer ' + botToken },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const result = JSON.parse(response.getContentText());
    if (result.ok) {
      Logger.log('Slack Bot: Message sent to #' + ch);
      return { ok: true };
    } else {
      var errMsg = result.error +
        (result.error === 'channel_not_found' ? ' (is the bot invited to #' + ch + '?)' : '') +
        (result.error === 'not_in_channel' ? ' (run /invite @YourApp in #' + ch + ')' : '');
      Logger.log('Slack Bot: Error — ' + errMsg);
      return { ok: false, error: errMsg };
    }
  } catch (e) {
    Logger.log('Slack Bot: Exception — ' + e.message);
    return { ok: false, error: e.message };
  }
}

// ─── Webhook Fallback ─────────────────────────────────────────────────────────

function _sendViaWebhook(webhookUrl, text, channel, opts) {
  if (!webhookUrl) {
    Logger.log('Slack Webhook: No URL configured. Skipping.');
    return { ok: false, error: 'No webhook URL configured' };
  }

  const payload = {
    text: text,
    unfurl_links: false,
    unfurl_media: false,
  };

  if (channel) payload.channel = channel;
  if (opts && opts.attachments) payload.attachments = opts.attachments;

  try {
    const response = UrlFetchApp.fetch(webhookUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const code = response.getResponseCode();
    if (code === 200) {
      Logger.log('Slack Webhook: Message sent.');
      return { ok: true };
    } else {
      var errMsg = 'HTTP ' + code + ' — ' + response.getContentText();
      Logger.log('Slack Webhook: Error ' + errMsg);
      return { ok: false, error: errMsg };
    }
  } catch (e) {
    Logger.log('Slack Webhook: Exception — ' + e.message);
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

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: emoji + ' ' + context.showName + ' — ' + (action === 'overdue' ? 'Overdue Task' : 'Upcoming Deadline'),
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: '*Task:*\n' + context.task },
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

/**
 * Sends a rich block message WITHOUT a button (fallback).
 */
function sendSlackBlockMessage(config, context, action) {
  const emoji = action === 'overdue' ? '🚨' : action === 'urgent' ? '⚠️' : '📋';
  const color = action === 'overdue' ? '#dc2626' : action === 'urgent' ? '#f59e0b' : '#2563eb';

  const text = emoji + ' *' + context.showName + '*\n*' + context.task + '* — due ' + context.deadline + '\nResponsible: ' + context.responsible;

  return sendSlack(config, text, context.slackChannel, {
    attachments: [{
      color: color,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: emoji + ' ' + context.showName } },
        { type: 'section', fields: [
          { type: 'mrkdwn', text: '*Task:*\n' + context.task },
          { type: 'mrkdwn', text: '*Responsible:*\n' + context.responsible },
          { type: 'mrkdwn', text: '*Deadline:*\n' + context.deadline },
          { type: 'mrkdwn', text: '*Status:*\n' + (action === 'overdue' ? context.daysOverdue + ' days overdue' : context.daysUntil + ' days remaining') },
        ]},
        { type: 'context', elements: [{ type: 'mrkdwn', text: '📌 ' + context.generalRule }] },
      ],
    }],
  });
}

// ─── Test Function ────────────────────────────────────────────────────────────

function testSlackConnection() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = _loadConfig(ss);

  if (!config.slackBotToken && !config.slackWebhookUrl) {
    SpreadsheetApp.getUi().alert(
      'No Slack Configured',
      'Please set "Slack Bot Token" (recommended) or "Slack Webhook URL" in the ⚙️ Config sheet.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }

  const method = config.slackBotToken ? 'Bot Token' : 'Webhook';
  const testChannel = config.slackDefaultChannel || '';
  const message = '✅ *KWLT Production Automation* — Test message via ' + method + '.\n\n' +
    'If you see this, your Slack integration is working! 🎭\n' +
    '_Sent at ' + new Date().toLocaleString() + '_';

  const result = sendSlack(config, message, testChannel);
  const ok = result && result.ok;

  SpreadsheetApp.getUi().alert(
    ok ? '✅ Success' : '❌ Failed',
    ok
      ? 'Test message sent via ' + method + '!'
      : 'Failed to send via ' + method + '. ' +
        (result && result.error ? 'Error: ' + result.error : '') + '\n\n' +
        (config.slackBotToken
          ? 'Check the bot token and ensure the bot is invited to the channel.'
          : 'Check the webhook URL in ⚙️ Config.'),
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
