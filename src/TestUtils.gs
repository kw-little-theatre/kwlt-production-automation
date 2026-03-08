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
    slackChannel: config.slackDefaultChannel || '',
    handbookUrl: config.handbookUrl || 'https://example.com/handbook',
    notifyVia: 'both',
    markDoneUrl: config.webAppUrl
      ? buildMarkDoneUrl(config.webAppUrl, '[TEST] Sample Show', 'Submit poster for approval (TEST)')
      : '',
  };

  const results = [];

  const slackReady = config.slackBotToken && config.sendSlack;
  const slackChannel = context.slackChannel;

  if (slackReady && !slackChannel) {
    results.push('Slack: ⏭ skipped — no Slack Default Channel set in Config sheet');
  }

  // ── Test 1: Advance Reminder (Slack) ────────────────────────────────────
  if (slackReady && slackChannel) {
    if (config.webAppUrl) {
      const result = sendSlackBlockMessageWithButton(config, context, 'advance');
      results.push('Slack advance (with button): ' + (result && result.ok ? '✅ sent' : '❌ failed — ' + (result && result.error || 'unknown')));
    } else {
      const tpl = _getTemplate(ss, 'Advance Reminder');
      if (tpl) {
        const msg = _renderTemplate(tpl, context);
        const result = sendSlack(config, msg, slackChannel);
        results.push('Slack advance (plain): ' + (result && result.ok ? '✅ sent' : '❌ failed — ' + (result && result.error || 'unknown')));
      }
    }
  } else if (!slackReady) {
    results.push('Slack advance: ⏭ skipped (no bot token or Slack disabled)');
  }

  // ── Test 2: Urgent Reminder (Slack) ─────────────────────────────────────
  if (slackReady && slackChannel) {
    const urgentContext = Object.assign({}, context, { daysUntil: 1 });
    if (config.webAppUrl) {
      const result = sendSlackBlockMessageWithButton(config, urgentContext, 'urgent');
      results.push('Slack urgent (with button): ' + (result && result.ok ? '✅ sent' : '❌ failed — ' + (result && result.error || 'unknown')));
    } else {
      const tpl = _getTemplate(ss, 'Urgent Reminder');
      if (tpl) {
        const msg = _renderTemplate(tpl, urgentContext);
        const result = sendSlack(config, msg, slackChannel);
        results.push('Slack urgent (plain): ' + (result && result.ok ? '✅ sent' : '❌ failed — ' + (result && result.error || 'unknown')));
      }
    }
  } else if (!slackReady) {
    results.push('Slack urgent: ⏭ skipped');
  }

  // ── Test 3: Overdue (Slack) ─────────────────────────────────────────────
  if (slackReady && slackChannel) {
    const overdueContext = Object.assign({}, context, { daysUntil: -3, daysOverdue: 3 });
    if (config.webAppUrl) {
      const result = sendSlackBlockMessageWithButton(config, overdueContext, 'overdue');
      results.push('Slack overdue (with button): ' + (result && result.ok ? '✅ sent' : '❌ failed — ' + (result && result.error || 'unknown')));
    }
  } else if (!slackReady) {
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

  // ── Test 6: Overdue Escalation (Slack to Show Support channel) ─────────
  if (slackReady && config.showSupportChannel) {
    const overdueContext = Object.assign({}, context, { daysUntil: -3, daysOverdue: 3 });
    const escText = '🚨 *Overdue Task — ' + overdueContext.showName + '*\n\n' +
      '*' + overdueContext.task + '* is now ' + overdueContext.daysOverdue + ' days overdue (deadline: ' + overdueContext.deadline + ')\n' +
      'Responsible: ' + overdueContext.responsible;
    const result = sendSlack(config, escText, config.showSupportChannel);
    results.push('Slack overdue escalation (to show support): ' + (result && result.ok ? '✅ sent' : '❌ failed — ' + (result && result.error || 'unknown')));
  } else {
    results.push('Slack overdue escalation: ⏭ skipped (no show support channel set)');
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
