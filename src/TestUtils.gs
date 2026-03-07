/**
 * KWLT Production Automation — Test Utilities
 *
 * Functions to test each message type without waiting for real deadlines.
 * Run these from the Apps Script editor (select function → Run) or from
 * the custom menu.
 */

/**
 * Sends one sample of each reminder type (advance, urgent, overdue) via both
 * Slack and email, using fake show data. This lets you verify formatting,
 * delivery, and Mark Done links without touching real show timelines.
 */
function testAllMessageTypes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = _loadConfig(ss);
  const ui = SpreadsheetApp.getUi();

  // Build a fake context
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);

  const context = {
    showName: '[TEST] Sample Show',
    task: 'Submit poster for approval (TEST — not a real task)',
    responsible: 'Producer',
    generalRule: '1 week before printing poster',
    deadline: Utilities.formatDate(tomorrow, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    daysUntil: 7,
    daysOverdue: 0,
    slackChannel: '',
    handbookUrl: config.handbookUrl || 'https://example.com/handbook',
    notifyVia: 'both',
    markDoneUrl: config.webAppUrl
      ? buildMarkDoneUrl(config.webAppUrl, '[TEST] Sample Show', 'Submit poster for approval (TEST)')
      : '',
  };

  const results = [];

  // ── Test 1: Advance Reminder (Slack) ────────────────────────────────────
  if (config.slackWebhookUrl && config.sendSlack) {
    if (config.webAppUrl) {
      const ok = sendSlackBlockMessageWithButton(config.slackWebhookUrl, context, 'advance');
      results.push('Slack advance (with button): ' + (ok ? '✅ sent' : '❌ failed'));
    } else {
      const tpl = _getTemplate(ss, 'Advance Reminder');
      if (tpl) {
        const msg = _renderTemplate(tpl, context);
        const ok = sendSlackMessage(config.slackWebhookUrl, msg);
        results.push('Slack advance (plain): ' + (ok ? '✅ sent' : '❌ failed'));
      }
    }
  } else {
    results.push('Slack advance: ⏭ skipped (no webhook or Slack disabled)');
  }

  // ── Test 2: Urgent Reminder (Slack) ─────────────────────────────────────
  if (config.slackWebhookUrl && config.sendSlack) {
    const urgentContext = Object.assign({}, context, { daysUntil: 1 });
    if (config.webAppUrl) {
      const ok = sendSlackBlockMessageWithButton(config.slackWebhookUrl, urgentContext, 'urgent');
      results.push('Slack urgent (with button): ' + (ok ? '✅ sent' : '❌ failed'));
    } else {
      const tpl = _getTemplate(ss, 'Urgent Reminder');
      if (tpl) {
        const msg = _renderTemplate(tpl, urgentContext);
        const ok = sendSlackMessage(config.slackWebhookUrl, msg);
        results.push('Slack urgent (plain): ' + (ok ? '✅ sent' : '❌ failed'));
      }
    }
  } else {
    results.push('Slack urgent: ⏭ skipped');
  }

  // ── Test 3: Overdue (Slack) ─────────────────────────────────────────────
  if (config.slackWebhookUrl && config.sendSlack) {
    const overdueContext = Object.assign({}, context, { daysUntil: -3, daysOverdue: 3 });
    if (config.webAppUrl) {
      const ok = sendSlackBlockMessageWithButton(config.slackWebhookUrl, overdueContext, 'overdue');
      results.push('Slack overdue (with button): ' + (ok ? '✅ sent' : '❌ failed'));
    }
  } else {
    results.push('Slack overdue: ⏭ skipped');
  }

  // ── Test 4: Advance Reminder (Email) ────────────────────────────────────
  if (config.showSupportEmail && config.sendEmail) {
    const tpl = _getTemplate(ss, 'Advance Reminder (Email)');
    if (tpl) {
      const subject = _renderTemplate(tpl.subject, context);
      const body = _renderTemplate(tpl.body, context);
      const ok = context.markDoneUrl
        ? sendHtmlEmailReminder(config.showSupportEmail, subject, body, context.markDoneUrl)
        : sendEmailReminder(config.showSupportEmail, subject, body);
      results.push('Email advance' + (context.markDoneUrl ? ' (with Mark Done button)' : '') + ': ' + (ok ? '✅ sent' : '❌ failed'));
    }
  } else {
    results.push('Email advance: ⏭ skipped (no email or email disabled)');
  }

  // ── Test 5: Urgent Reminder (Email) ─────────────────────────────────────
  if (config.showSupportEmail && config.sendEmail) {
    const urgentContext = Object.assign({}, context, { daysUntil: 1 });
    const tpl = _getTemplate(ss, 'Urgent Reminder (Email)');
    if (tpl) {
      const subject = _renderTemplate(tpl.subject, urgentContext);
      const body = _renderTemplate(tpl.body, urgentContext);
      const ok = urgentContext.markDoneUrl
        ? sendHtmlEmailReminder(config.showSupportEmail, subject, body, urgentContext.markDoneUrl)
        : sendEmailReminder(config.showSupportEmail, subject, body);
      results.push('Email urgent: ' + (ok ? '✅ sent' : '❌ failed'));
    }
  } else {
    results.push('Email urgent: ⏭ skipped');
  }

  // ── Test 6: Overdue Escalation (Email) ──────────────────────────────────
  const escEmail = config.escalationEmail || config.showSupportEmail;
  if (escEmail && config.sendEmail) {
    const overdueContext = Object.assign({}, context, { daysUntil: -3, daysOverdue: 3 });
    const tpl = _getTemplate(ss, 'Overdue Escalation');
    if (tpl) {
      const subject = _renderTemplate(tpl.subject, overdueContext);
      const body = _renderTemplate(tpl.body, overdueContext);
      const ok = sendEmailReminder(escEmail, subject, body);
      results.push('Email overdue escalation: ' + (ok ? '✅ sent' : '❌ failed'));
    }
  } else {
    results.push('Email overdue: ⏭ skipped');
  }

  // ── Show Results ────────────────────────────────────────────────────────
  ui.alert(
    '🧪 Test Results',
    results.join('\n') +
    '\n\nCheck your Slack channel and email inbox to verify the messages look correct.' +
    (context.markDoneUrl ? '\n\nTry clicking the ✅ Mark Done button in the email or Slack message — it will show a confirmation page (the task won\'t be found since this is a test show, which is expected).' : ''),
    ui.ButtonSet.OK
  );
}
