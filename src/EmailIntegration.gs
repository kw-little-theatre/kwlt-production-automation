/**
 * KWLT Production Automation — Email Integration
 *
 * Sends reminder emails via Gmail (using the script owner's Google account).
 * Since KWLT has Google Workspace, this sends from the authenticated user's
 * @kwlt.org address automatically.
 */

/**
 * Strips emoji and other non-ASCII symbol characters from a string.
 * Keeps standard punctuation, accented letters, and common symbols.
 */
 function _stripEmoji(str) {
  if (!str) return str;
  // Remove emoji and misc symbol blocks, keep basic latin + extended latin + common punctuation
  return str.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE00}-\u{FE0F}\u{200D}\u{20E3}\u{E0020}-\u{E007F}]/gu, '').replace(/  +/g, ' ').trim();
}

/**
 * Sends a plain-text email reminder.
 *
 * @param {string} to — recipient email address
 * @param {string} subject — email subject line
 * @param {string} body — email body (plain text)
 * @returns {boolean} — true if sent successfully
 */
function sendEmailReminder(to, subject, body) {
  if (!to) {
    Logger.log('Email: No recipient address. Skipping.');
    return false;
  }

  try {
    GmailApp.sendEmail(to, _stripEmoji(subject), _stripEmoji(body), {
      name: 'KWLT Show Support',
      noReply: false,  // Allow replies
    });
    Logger.log('Email: Sent to ' + to + ' — ' + subject);
    return true;
  } catch (e) {
    Logger.log('Email: Error sending to ' + to + ' — ' + e.message);
    return false;
  }
}

/**
 * Sends an HTML email with a styled "Mark Done" button.
 * Falls back to plain text if HTML sending fails.
 *
 * @param {string} to — recipient email
 * @param {string} subject — email subject
 * @param {string} plainBody — plain text body (used as fallback and alt text)
 * @param {string} markDoneUrl — URL for the "Mark Done" button
 * @returns {boolean}
 */
function sendHtmlEmailReminder(to, subject, plainBody, markDoneUrl) {
  if (!to) {
    Logger.log('Email: No recipient address. Skipping.');
    return false;
  }

  // Convert plain text body to HTML paragraphs
  const bodyHtml = plainBody
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n\n/g, '</p><p>')
    .replace(/\n/g, '<br>');

  const htmlBody = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="' +
    'font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; ' +
    'color: #1f2937; line-height: 1.6; max-width: 600px; margin: 0 auto; padding: 20px;">' +
    '<p>' + bodyHtml + '</p>' +
    (markDoneUrl ? (
      '<div style="margin: 24px 0; text-align: center;">' +
      '<a href="' + markDoneUrl + '" style="' +
      'display: inline-block; padding: 12px 32px; ' +
      'background-color: #059669; color: #ffffff; ' +
      'text-decoration: none; border-radius: 8px; ' +
      'font-weight: 600; font-size: 16px;">' +
      '&#10004; Mark This Task Done</a>' +
      '</div>' +
      '<p style="color: #6b7280; font-size: 13px; text-align: center;">' +
      'Or copy this link: ' + markDoneUrl + '</p>'
    ) : '') +
    '<hr style="border: none; border-top: 1px solid #e5e7eb; margin: 24px 0;">' +
    '<p style="color: #9ca3af; font-size: 12px;">KWLT Show Support</p>' +
    '</body></html>';

  try {
    GmailApp.sendEmail(to, _stripEmoji(subject), _stripEmoji(plainBody), {
      name: 'KWLT Show Support',
      htmlBody: htmlBody,
      noReply: false,
    });
    Logger.log('Email (HTML): Sent to ' + to + ' — ' + subject);
    return true;
  } catch (e) {
    Logger.log('Email (HTML): Error — ' + e.message + '. Falling back to plain text.');
    return sendEmailReminder(to, subject, plainBody);
  }
}

/**
 * Sends the daily digest email to the Show Support Committee member.
 * Aggregates all reminders sent today into a single summary.
 *
 * @param {Array} digestItems — array of { show, task, responsible, deadline, action, daysUntil, success }
 * @param {Object} config — loaded config
 */
function _sendDailyDigest(digestItems, config) {
  if (!config.showSupportEmail) {
    Logger.log('Digest: No Show Support email configured. Skipping.');
    return;
  }

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Group by show
  const byShow = {};
  for (const item of digestItems) {
    if (!byShow[item.show]) byShow[item.show] = [];
    byShow[item.show].push(item);
  }

  let body = 'Daily Show Support Digest — ' + today + '\n';
  body += '═'.repeat(50) + '\n\n';

  for (const [show, items] of Object.entries(byShow)) {
    body += '🎭 ' + show + '\n';
    body += '─'.repeat(40) + '\n';

    for (const item of items) {
      const statusIcon = item.action === 'overdue' ? '🚨' : item.action === 'urgent' ? '⚠️' : '📋';
      const sendStatus = item.success ? '✓ sent' : '✗ FAILED';
      body += statusIcon + ' ' + item.task + '\n';
      body += '   Responsible: ' + item.responsible + '\n';
      body += '   Deadline: ' + item.deadline;
      if (item.daysUntil < 0) {
        body += ' (' + Math.abs(item.daysUntil) + ' days overdue)';
      } else if (item.daysUntil === 0) {
        body += ' (TODAY)';
      } else {
        body += ' (' + item.daysUntil + ' days remaining)';
      }
      body += '\n';
      body += '   Reminder: ' + item.action + ' — ' + sendStatus + '\n\n';
    }
  }

  body += '─'.repeat(50) + '\n';
  body += 'Total reminders sent today: ' + digestItems.filter(i => i.success).length + '/' + digestItems.length + '\n';
  body += '\nThis is an automated message from KWLT Show Support.';

  // Use the Daily Digest template subject if available
  const digestTemplate = _getTemplate(config.ss, 'Daily Digest');
  const subject = digestTemplate
    ? _renderTemplate(digestTemplate.subject, { date: today })
    : '[KWLT] Daily Show Support Digest — ' + today;

  sendEmailReminder(config.showSupportEmail, subject, body);
}

/**
 * Test function — sends a test email to the configured Show Support address.
 */
function testEmailConnection() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = _loadConfig(ss);

  if (!config.showSupportEmail) {
    SpreadsheetApp.getUi().alert(
      'No Email Configured',
      'Please set the Show Support Email in the ⚙️ Config sheet first.',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
    return;
  }

  const ok = sendEmailReminder(
    config.showSupportEmail,
    '[KWLT] Test — Show Support Automation',
    'This is a test email from the KWLT Production Automation system.\n\n' +
    'If you received this, your email integration is working!\n\n' +
    'Sent at: ' + new Date().toLocaleString() + '\n\n' +
    '— KWLT Show Support'
  );

  SpreadsheetApp.getUi().alert(
    ok ? '✅ Success' : '❌ Failed',
    ok ? 'Test email sent to ' + config.showSupportEmail + '!' : 'Failed to send. Check your email permissions.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
