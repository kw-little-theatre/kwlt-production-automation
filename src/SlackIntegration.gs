/**
 * KWLT Production Automation — Slack Integration
 *
 * Sends reminder messages to Slack channels via incoming webhooks.
 * Supports two modes:
 *   1. Plain text messages (works with any incoming webhook)
 *   2. Rich block messages with "Mark Done" buttons (requires a Slack app
 *      with Interactivity enabled, pointing to the Web App URL)
 *
 * Setup: See README.md for full Slack configuration instructions.
 */

/**
 * Sends a formatted message to Slack via an incoming webhook.
 *
 * @param {string} webhookUrl — Slack incoming webhook URL
 * @param {string} message — the message text (supports Slack mrkdwn formatting)
 * @param {string} [channel] — optional channel override (e.g., "#show-hamlet")
 * @returns {boolean} — true if the message was sent successfully
 */
function sendSlackMessage(webhookUrl, message, channel) {
  if (!webhookUrl) {
    Logger.log('Slack: No webhook URL configured. Skipping.');
    return false;
  }

  const payload = {
    text: message,
    unfurl_links: false,
    unfurl_media: false,
  };

  // If a specific channel is provided, include it
  // (only works with legacy webhooks or apps with chat:write scope)
  if (channel) {
    payload.channel = channel;
  }

  try {
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(webhookUrl, options);
    const code = response.getResponseCode();

    if (code === 200) {
      Logger.log('Slack: Message sent successfully.');
      return true;
    } else {
      Logger.log('Slack: Error ' + code + ' — ' + response.getContentText());
      return false;
    }
  } catch (e) {
    Logger.log('Slack: Exception — ' + e.message);
    return false;
  }
}

/**
 * Sends a rich "block kit" message to Slack for more structured reminders.
 * Falls back to plain text if blocks fail.
 *
 * @param {string} webhookUrl — webhook URL
 * @param {Object} context — reminder context with show/task details
 * @param {string} action — 'advance', 'urgent', or 'overdue'
 * @returns {boolean}
 */
function sendSlackBlockMessage(webhookUrl, context, action) {
  if (!webhookUrl) return false;

  const emoji = action === 'overdue' ? '🚨' : action === 'urgent' ? '⚠️' : '📋';
  const color = action === 'overdue' ? '#dc2626' : action === 'urgent' ? '#f59e0b' : '#2563eb';

  const payload = {
    attachments: [{
      color: color,
      blocks: [
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
      ],
    }],
  };

  if (context.slackChannel) {
    payload.channel = context.slackChannel;
  }

  try {
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(webhookUrl, options);
    if (response.getResponseCode() === 200) return true;

    // Fall back to plain text
    Logger.log('Slack blocks failed (' + response.getResponseCode() + '), falling back to plain text.');
    return sendSlackMessage(webhookUrl,
      emoji + ' *' + context.showName + '*\n' +
      '*' + context.task + '* — due ' + context.deadline + '\n' +
      'Responsible: ' + context.responsible,
      context.slackChannel
    );
  } catch (e) {
    Logger.log('Slack blocks exception: ' + e.message);
    return false;
  }
}

/**
 * Sends a rich block message WITH a "✅ Mark Done" button.
 * The button has two modes:
 *   - If Slack Interactivity is configured: button posts back to the web app (instant)
 *   - Always includes a fallback "Mark Done" link that opens in the browser
 *
 * @param {string} webhookUrl — webhook URL
 * @param {Object} context — reminder context (must include markDoneUrl)
 * @param {string} action — 'advance', 'urgent', or 'overdue'
 * @returns {boolean}
 */
function sendSlackBlockMessageWithButton(webhookUrl, context, action) {
  if (!webhookUrl) return false;

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

  // Add "Mark Done" actions block
  if (context.markDoneUrl) {
    blocks.push({
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: '✅ Mark Done', emoji: true },
          style: 'primary',
          action_id: 'mark_done:' + encodeURIComponent(context.showName) + ':' + encodeURIComponent(context.task),
          url: context.markDoneUrl,  // Fallback: opens in browser if interactivity isn't set up
        },
      ],
    });
  }

  const payload = {
    attachments: [{
      color: color,
      blocks: blocks,
    }],
  };

  // Fallback text for notifications
  payload.text = emoji + ' ' + context.showName + ': ' + context.task + ' — due ' + context.deadline;

  if (context.slackChannel) {
    payload.channel = context.slackChannel;
  }

  try {
    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(webhookUrl, options);
    if (response.getResponseCode() === 200) return true;

    // Fall back to block message without button
    Logger.log('Slack button blocks failed (' + response.getResponseCode() + '), trying without button.');
    return sendSlackBlockMessage(webhookUrl, context, action);
  } catch (e) {
    Logger.log('Slack button blocks exception: ' + e.message);
    return sendSlackBlockMessage(webhookUrl, context, action);
  }
}

/**
 * Test function — sends a test message to the configured webhook.
 * Run this manually to verify your Slack setup.
 */
function testSlackConnection() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = _loadConfig(ss);

  if (!config.slackWebhookUrl) {
    SpreadsheetApp.getUi().alert(
      'No Webhook URL',
      'Please set the Slack Webhook URL in the ⚙️ Config sheet first.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }

  const ok = sendSlackMessage(
    config.slackWebhookUrl,
    '✅ *KWLT Production Automation* — Test message.\n\n' +
    'If you see this, your Slack integration is working! 🎭\n' +
    '_Sent at ' + new Date().toLocaleString() + '_'
  );

  SpreadsheetApp.getUi().alert(
    ok ? '✅ Success' : '❌ Failed',
    ok ? 'Test message sent to Slack!' : 'Failed to send. Check the webhook URL in ⚙️ Config and try again.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
