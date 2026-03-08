/**
 * KWLT Production Automation — Reminder Engine
 *
 * The daily trigger that checks all active shows' timelines and sends
 * reminders for approaching/overdue deadlines. This is the heart of the
 * automation system.
 */

// ─── Daily Trigger Entry Point ────────────────────────────────────────────────

/**
 * Main function called by the daily time-driven trigger.
 * Iterates over all active shows and processes each task.
 */
function runDailyReminders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const config = _loadConfig(ss);
  const today = _stripTime(new Date());
  const activeShows = _getActiveShows(ss);

  if (activeShows.length === 0) {
    Logger.log('No active shows found. Nothing to do.');
    return;
  }

  const digestItems = [];  // Collect items for the reminder summary email

  for (const show of activeShows) {
    const tabName = SHOW_TAB_PREFIX + show.name;
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      Logger.log('Warning: Tab "' + tabName + '" not found for active show "' + show.name + '"');
      continue;
    }

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) continue; // Only headers

    for (let row = 1; row < data.length; row++) {
      const taskData = data[row];
      const status = taskData[COL.STATUS];

      // Skip completed, skipped, or no-notify tasks
      if (status === STATUS.DONE || status === STATUS.SKIPPED) continue;

      const notifyVia = taskData[COL.NOTIFY_VIA];
      if (notifyVia === 'none') continue;

      const deadline = _stripTime(taskData[COL.COMPUTED_DATE]);
      if (!deadline || !(deadline instanceof Date) || isNaN(deadline.getTime())) continue;

      const daysUntil = _daysBetween(today, deadline);
      const action = _determineAction(daysUntil, status, config);

      if (action) {
        const context = {
          showName: show.name,
          task: taskData[COL.TASK],
          responsible: taskData[COL.RESPONSIBLE],
          generalRule: taskData[COL.GENERAL_RULE],
          deadline: Utilities.formatDate(deadline, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
          daysUntil: daysUntil,
          daysOverdue: daysUntil < 0 ? Math.abs(daysUntil) : 0,
          slackChannel: show.slackChannel,
          showEmail: show.showEmail,
          resourcesUrl: show.resourcesUrl,
          handbookUrl: config.handbookUrl,
          notifyVia: notifyVia,
          markDoneUrl: buildMarkDoneUrl(config.webAppUrl, show.name, taskData[COL.TASK]),
        };

        const success = _executeAction(action, context, config);

        // Update status in the sheet if any notification was sent
        if (success) {
          // Check if this task should auto-complete after the first send
          const isAutoComplete = _isAutoCompleteTask(context.task);
          const newStatus = isAutoComplete ? STATUS.DONE : _statusAfterAction(action);
          sheet.getRange(row + 1, COL.STATUS + 1).setValue(newStatus);
          sheet.getRange(row + 1, COL.LAST_NOTIFIED + 1).setValue(new Date());
          if (isAutoComplete) {
            sheet.getRange(row + 1, COL.NOTES + 1).setValue('Auto-completed after sending');
          }
        } else {
          Logger.log('Warning: No notifications sent for "' + taskData[COL.TASK] + '" (' + show.name + '). notifyVia=' + notifyVia + ', sendSlack=' + config.sendSlack + ', sendEmail=' + config.sendEmail + ', showEmail=' + (show.showEmail || 'none') + ', slackChannel=' + (show.slackChannel || 'none'));
        }

        // Add to reminder summary (only for messages sent to the show, not escalations)
        if (action !== 'overdue') {
          digestItems.push({
            show: show.name,
            task: context.task,
            responsible: context.responsible,
            deadline: context.deadline,
            action: action,
            daysUntil: daysUntil,
            success: success,
          });
        }
      }
    }
  }

  // Send reminder summary to show support Slack channel
  if (digestItems.length > 0 && config.showSupportChannel) {
    _sendDailyDigestSlack(digestItems, config);
  }

  // Refresh the Season Overview so it's always current
  _refreshSeasonOverviewSilent(ss);

  Logger.log('Daily reminders complete. Processed ' + digestItems.length + ' items across ' + activeShows.length + ' shows.');
}

// ─── Action Determination ─────────────────────────────────────────────────────

/**
 * Decides what reminder action (if any) to take based on how many days
 * remain until the deadline and the current status of the task.
 *
 * @param {number} daysUntil — days until deadline (negative = overdue)
 * @param {string} currentStatus — current status value
 * @param {Object} config — loaded config values
 * @returns {string|null} — 'advance', 'urgent', 'overdue', or null
 */
function _determineAction(daysUntil, currentStatus, config) {
  const advanceDays = config.advanceReminderDays || REMINDER_ADVANCE_DAYS;
  const urgentDays = config.urgentReminderDays || REMINDER_URGENT_DAYS;
  const overdueDays = config.overdueEscalationDays || OVERDUE_ESCALATION_DAYS;

  // Overdue escalation
  if (daysUntil <= -overdueDays && currentStatus !== STATUS.OVERDUE) {
    return 'overdue';
  }

  // Urgent reminder (1 day before)
  if (daysUntil <= urgentDays && daysUntil > -overdueDays &&
      currentStatus !== STATUS.URGENT_SENT && currentStatus !== STATUS.OVERDUE) {
    return 'urgent';
  }

  // Advance reminder (7 days before)
  if (daysUntil <= advanceDays && daysUntil > urgentDays &&
      currentStatus === STATUS.PENDING) {
    return 'advance';
  }

  return null;
}

/**
 * Maps an action to its resulting status value.
 */
function _statusAfterAction(action) {
  switch (action) {
    case 'advance': return STATUS.ADVANCE_SENT;
    case 'urgent':  return STATUS.URGENT_SENT;
    case 'overdue': return STATUS.OVERDUE;
    default:        return STATUS.PENDING;
  }
}

// ─── Execute Reminder Action ──────────────────────────────────────────────────

/**
 * Sends the appropriate reminder via the configured channels.
 * @returns {boolean} — true if at least one channel succeeded
 */
function _executeAction(action, context, config) {
  let anySuccess = false;

  // Slack reminder to show channel (skip for overdue — escalation handles it)
  if (action !== 'overdue' && (context.notifyVia === 'slack' || context.notifyVia === 'both') && config.sendSlack) {
    // Try rich block message with "Mark Done" button first, fall back to plain text
    if (config.webAppUrl) {
      const result = sendSlackBlockMessageWithButton(config, context, action);
      const ok = result && result.ok;
      _logSend(config.ss, context, 'slack', action, ok, ok ? '' : (result && result.error || 'Unknown error'));
      if (ok) anySuccess = true;
    } else {
      const slackTemplate = _getTemplate(config.ss, _slackTemplateName(action));
      if (slackTemplate) {
        const message = _renderTemplate(slackTemplate, context);
        const result = sendSlack(config, message, context.slackChannel);
        const ok = result && result.ok;
        _logSend(config.ss, context, 'slack', action, ok, ok ? '' : (result && result.error || 'Unknown error'));
        if (ok) anySuccess = true;
      }
    }
  }

  // Email to show (skip for overdue — escalation goes to Show Support Slack only)
  if (action !== 'overdue' && (context.notifyVia === 'email' || context.notifyVia === 'both') && config.sendEmail) {
    const recipientEmail = _resolveRecipientEmail(context, config);
    if (recipientEmail) {
      // Check if this task has a custom email template in TaskTemplateData
      const customEmail = _getCustomEmailForTask(context.task);
      let subject, body;
      if (customEmail) {
        subject = _renderTemplate(customEmail.emailSubject, context);
        body = _renderTemplate(customEmail.emailBody, context);
      } else {
        const emailTemplate = _getTemplate(config.ss, _emailTemplateName(action));
        if (emailTemplate) {
          subject = _renderTemplate(emailTemplate.subject, context);
          body = _renderTemplate(emailTemplate.body, context);
        }
      }
      if (subject && body) {
        const ok = context.markDoneUrl
          ? sendHtmlEmailReminder(recipientEmail, subject, body, context.markDoneUrl)
          : sendEmailReminder(recipientEmail, subject, body);
        _logSend(config.ss, context, 'email', action, ok);
        if (ok) anySuccess = true;
      }
    }
  }

  // Overdue escalation goes to the show support Slack channel
  if (action === 'overdue' && config.showSupportChannel) {
    const escText = '🚨 *Overdue Task — ' + context.showName + '*\n\n' +
      '*' + context.task + '* is now ' + context.daysOverdue + ' days overdue (deadline: ' + context.deadline + ')\n' +
      'Responsible: ' + context.responsible + '\n' +
      'Timing: ' + context.generalRule;

    // Use block kit with a Mark Done button (same as show reminders)
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: escText } },
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

    const escResult = sendSlack(config, '', config.showSupportChannel, {
      attachments: [{ color: '#dc2626', blocks: blocks }],
    });
    _logSend(config.ss, context, 'slack (escalation)', action, escResult && escResult.ok, escResult && !escResult.ok ? escResult.error : '');
    if (escResult && escResult.ok) anySuccess = true;
  }

  return anySuccess;
}

// ─── Template Helpers ─────────────────────────────────────────────────────────

function _slackTemplateName(action) {
  switch (action) {
    case 'advance': return 'Advance Reminder';
    case 'urgent':  return 'Urgent Reminder';
    case 'overdue': return 'Overdue Escalation';
    default:        return 'Advance Reminder';
  }
}

function _emailTemplateName(action) {
  switch (action) {
    case 'advance': return 'Advance Reminder (Email)';
    case 'urgent':  return 'Urgent Reminder (Email)';
    case 'overdue': return 'Overdue Escalation';
    default:        return 'Advance Reminder (Email)';
  }
}

/**
 * Loads a message template by name from the ✉️ Message Templates sheet.
 * @returns {{ subject: string, body: string }|null}
 */
function _getTemplate(ss, templateName) {
  const sheet = ss.getSheetByName(SHEET_MSG_TEMPLATES);
  if (!sheet) return null;

  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === templateName) {
      return {
        subject: data[i][2] || '',
        body: data[i][3] || '',
      };
    }
  }
  return null;
}

/**
 * Checks if a task has the autoComplete flag set.
 * Auto-complete tasks are marked Done after the first notification is sent
 * (used for informational emails that don't require follow-up).
 */
function _isAutoCompleteTask(taskName) {
  const tasks = getTaskTemplateData();
  for (const t of tasks) {
    if (t.autoComplete && (t.task === taskName || taskName.indexOf(t.task) !== -1)) {
      return true;
    }
  }
  return false;
}

/**
 * Looks up a task in the TaskTemplateData to see if it has a custom
 * emailSubject/emailBody. Returns { emailSubject, emailBody } or null.
 */
function _getCustomEmailForTask(taskName) {
  const tasks = getTaskTemplateData();
  for (const t of tasks) {
    if (t.emailBody && (t.task === taskName || taskName.indexOf(t.task) !== -1)) {
      return { emailSubject: t.emailSubject, emailBody: t.emailBody };
    }
  }
  return null;
}

/**
 * Replaces {{PLACEHOLDER}} tokens in a template string with context values.
 */
function _renderTemplate(template, context) {
  if (!template) return '';

  return template
    .replace(/\{\{SHOW_NAME\}\}/g, context.showName || '')
    .replace(/\{\{TASK\}\}/g, context.task || '')
    .replace(/\{\{RESPONSIBLE_PARTY\}\}/g, context.responsible || '')
    .replace(/\{\{DEADLINE\}\}/g, context.deadline || '')
    .replace(/\{\{DAYS_UNTIL\}\}/g, String(context.daysUntil || 0))
    .replace(/\{\{DAYS_OVERDUE\}\}/g, String(context.daysOverdue || 0))
    .replace(/\{\{GENERAL_RULE\}\}/g, context.generalRule || '')
    .replace(/\{\{SLACK_CHANNEL\}\}/g, context.slackChannel || '')
    .replace(/\{\{HANDBOOK_URL\}\}/g, context.handbookUrl || '')
    .replace(/\{\{RESOURCES_URL\}\}/g, context.resourcesUrl || '')
    .replace(/\{\{MARK_DONE_URL\}\}/g, context.markDoneUrl || '')
    .replace(/\{\{DATE\}\}/g, Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
}

// ─── Recipient Resolution ─────────────────────────────────────────────────────

/**
 * Resolves the email address for a task. All reminders go to the show's
 * shared email address.
 */
function _resolveRecipientEmail(context, config) {
  return context.showEmail || null;
}

// ─── Config Loader ────────────────────────────────────────────────────────────

/**
 * Loads configuration from the ⚙️ Config sheet into a plain object.
 */
function _loadConfig(ss) {
  const sheet = ss.getSheetByName(SHEET_CONFIG);
  const data = sheet ? sheet.getDataRange().getValues() : [];

  // Load secrets from Script Properties (not visible in the spreadsheet)
  const props = PropertiesService.getScriptProperties();

  const config = {
    ss: ss,
    slackWebhookUrl: props.getProperty('SLACK_WEBHOOK_URL') || '',
    slackBotToken: props.getProperty('SLACK_BOT_TOKEN') || '',
    showSupportChannel: props.getProperty('SHOW_SUPPORT_CHANNEL') || '',
    escalationEmail: '',  // legacy — overdue escalation now goes to Slack
    showSupportEmail: props.getProperty('SHOW_SUPPORT_EMAIL') || '',
    webAppUrl: props.getProperty('WEB_APP_URL') || '',
    slackDefaultChannel: '',
    advanceReminderDays: REMINDER_ADVANCE_DAYS,
    urgentReminderDays: REMINDER_URGENT_DAYS,
    overdueEscalationDays: OVERDUE_ESCALATION_DAYS,
    sendEmail: true,
    sendSlack: true,
    handbookUrl: '',
  };

  // Load non-sensitive settings from the sheet
  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    const val = data[i][1];
    switch (key) {
      case 'Slack Default Channel':     config.slackDefaultChannel = val; break;
      case 'Advance Reminder Days':   config.advanceReminderDays = Number(val) || REMINDER_ADVANCE_DAYS; break;
      case 'Urgent Reminder Days':    config.urgentReminderDays = Number(val) || REMINDER_URGENT_DAYS; break;
      case 'Overdue Escalation Days': config.overdueEscalationDays = Number(val) || OVERDUE_ESCALATION_DAYS; break;
      case 'Send Email Reminders':    config.sendEmail = String(val).toUpperCase() !== 'FALSE'; break;
      case 'Send Slack Reminders':    config.sendSlack = String(val).toUpperCase() !== 'FALSE'; break;
      case 'Handbook URL':            config.handbookUrl = val; break;
    }
  }

  return config;
}

// ─── Active Shows ─────────────────────────────────────────────────────────────

/**
 * Returns an array of { name, slackChannel } for shows marked Active = TRUE.
 */
function _getActiveShows(ss) {
  const sheet = ss.getSheetByName(SHEET_SHOW_SETUP);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const nameCol = 0;
  const slackCol = headers.indexOf('Slack Channel');
  const emailCol = headers.indexOf('Show Email');
  const resourcesCol = headers.indexOf('Resources Folder URL');
  const activeCol = headers.indexOf('Active?');

  const shows = [];
  for (let i = 1; i < data.length; i++) {
    const active = String(data[i][activeCol]).toUpperCase();
    if (active === 'TRUE' || active === 'YES') {
      shows.push({
        name: data[i][nameCol],
        slackChannel: slackCol !== -1 ? data[i][slackCol] : '',
        showEmail: emailCol !== -1 ? data[i][emailCol] : '',
        resourcesUrl: resourcesCol !== -1 ? data[i][resourcesCol] : '',
      });
    }
  }
  return shows;
}

// ─── Reminder Summary via Slack ────────────────────────────────────────────────────

/**
 * Sends a reminder summary summary to the Show Support Slack channel.
 */
function _sendDailyDigestSlack(digestItems, config) {
  if (!config.showSupportChannel) return;

  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // Group by show
  const byShow = {};
  for (const item of digestItems) {
    if (!byShow[item.show]) byShow[item.show] = [];
    byShow[item.show].push(item);
  }

  let text = '📋 *Show Support Reminder Summary — ' + today + '*\n\n';

  for (const [show, items] of Object.entries(byShow)) {
    text += '🎭 *' + show + '*\n';
    for (const item of items) {
      const icon = item.action === 'overdue' ? '🚨' : item.action === 'urgent' ? '⚠️' : '📋';
      const status = item.success ? 'sent' : 'FAILED';
      let timing;
      if (item.daysUntil < 0) timing = Math.abs(item.daysUntil) + 'd overdue';
      else if (item.daysUntil === 0) timing = 'TODAY';
      else timing = item.daysUntil + 'd remaining';
      text += '  ' + icon + ' ' + item.task + ' — ' + item.responsible + ' — ' + timing + ' [' + status + ']\n';
    }
    text += '\n';
  }

  const sent = digestItems.filter(i => i.success).length;
  text += '_' + sent + '/' + digestItems.length + ' reminders sent successfully._';

  sendSlack(config, text, config.showSupportChannel);
}

// ─── Date Utilities ───────────────────────────────────────────────────────────

/**
 * Strips the time portion from a Date, returning a new Date at midnight.
 */
function _stripTime(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return d;
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/**
 * Returns the number of days between two dates (positive = future).
 */
function _daysBetween(from, to) {
  const msPerDay = 86400000;
  return Math.round((to.getTime() - from.getTime()) / msPerDay);
}

// ─── Send Log ─────────────────────────────────────────────────────────────────

function _logSend(ss, context, channel, reminderType, success, error) {
  const sheet = ss.getSheetByName(SHEET_SEND_LOG);
  if (!sheet) return;

  sheet.appendRow([
    new Date(),
    context.showName,
    context.task,
    context.responsible,
    channel,
    reminderType,
    success ? 'Sent' : 'Failed',
    error || '',
  ]);
}
