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

  const digestItems = [];  // Collect items for the daily digest email

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
          handbookUrl: config.handbookUrl,
          notifyVia: notifyVia,
          markDoneUrl: buildMarkDoneUrl(config.webAppUrl, show.name, taskData[COL.TASK]),
        };

        const success = _executeAction(action, context, config);

        if (success) {
          // Update status in the sheet
          const newStatus = _statusAfterAction(action);
          sheet.getRange(row + 1, COL.STATUS + 1).setValue(newStatus);
          sheet.getRange(row + 1, COL.LAST_NOTIFIED + 1).setValue(new Date());
        }

        // Add to digest
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

  // Send daily digest to show support
  if (digestItems.length > 0 && config.showSupportEmail) {
    _sendDailyDigest(digestItems, config);
  }

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

  // Slack
  if ((context.notifyVia === 'slack' || context.notifyVia === 'both') && config.sendSlack) {
    // Try rich block message with "Mark Done" button first, fall back to plain text
    if (config.webAppUrl) {
      const ok = sendSlackBlockMessageWithButton(config.slackWebhookUrl, context, action);
      _logSend(config.ss, context, 'slack', action, ok);
      if (ok) anySuccess = true;
    } else {
      const slackTemplate = _getTemplate(config.ss, _slackTemplateName(action));
      if (slackTemplate) {
        const message = _renderTemplate(slackTemplate, context);
        const ok = sendSlackMessage(config.slackWebhookUrl, message, context.slackChannel);
        _logSend(config.ss, context, 'slack', action, ok);
        if (ok) anySuccess = true;
      }
    }
  }

  // Email — send as HTML when a Mark Done URL is available
  if ((context.notifyVia === 'email' || context.notifyVia === 'both') && config.sendEmail) {
    const emailTemplate = _getTemplate(config.ss, _emailTemplateName(action));
    if (emailTemplate) {
      const recipientEmail = _resolveRecipientEmail(context, config);
      if (recipientEmail) {
        const subject = _renderTemplate(emailTemplate.subject, context);
        const body = _renderTemplate(emailTemplate.body, context);
        const ok = context.markDoneUrl
          ? sendHtmlEmailReminder(recipientEmail, subject, body, context.markDoneUrl)
          : sendEmailReminder(recipientEmail, subject, body);
        _logSend(config.ss, context, 'email', action, ok);
        if (ok) anySuccess = true;
      }
    }
  }

  // Overdue escalation always goes to the escalation email
  if (action === 'overdue' && config.escalationEmail) {
    const escTemplate = _getTemplate(config.ss, 'Overdue Escalation');
    if (escTemplate) {
      const subject = _renderTemplate(escTemplate.subject, context);
      const body = _renderTemplate(escTemplate.body, context);
      const ok = sendEmailReminder(config.escalationEmail, subject, body);
      _logSend(config.ss, context, 'email (escalation)', action, ok);
      if (ok) anySuccess = true;
    }
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
    .replace(/\{\{MARK_DONE_URL\}\}/g, context.markDoneUrl || '')
    .replace(/\{\{DATE\}\}/g, Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'));
}

// ─── Recipient Resolution ─────────────────────────────────────────────────────

/**
 * Resolves the email address for a task's responsible party by looking up
 * the show's contact info in the Show Setup sheet.
 */
function _resolveRecipientEmail(context, config) {
  const setupSheet = config.ss.getSheetByName(SHEET_SHOW_SETUP);
  if (!setupSheet) return config.showSupportEmail; // fallback

  const data = setupSheet.getDataRange().getValues();
  const headers = data[0];

  let showRow = null;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === context.showName) {
      showRow = data[i];
      break;
    }
  }
  if (!showRow) return config.showSupportEmail;

  // Map responsible party to email column
  const responsible = (context.responsible || '').toLowerCase();
  const emailMap = {
    'director': 'Director Email',
    'stage manager': 'Stage Manager Email',
    'stage manager and director': 'Stage Manager Email',
    'stage manager & technical director': 'Stage Manager Email',
    'technical director': 'Technical Director Email',
    'producer': 'Producer Email',
    'music director': 'Music Director Email',
    'production team': 'Stage Manager Email',  // SM is the hub
    'director and stage manager': 'Director Email',
  };

  const emailCol = emailMap[responsible];
  if (emailCol) {
    const colIdx = headers.indexOf(emailCol);
    if (colIdx !== -1 && showRow[colIdx]) {
      return showRow[colIdx];
    }
  }

  // Fallback to show support email
  return config.showSupportEmail;
}

// ─── Config Loader ────────────────────────────────────────────────────────────

/**
 * Loads configuration from the ⚙️ Config sheet into a plain object.
 */
function _loadConfig(ss) {
  const sheet = ss.getSheetByName(SHEET_CONFIG);
  const data = sheet ? sheet.getDataRange().getValues() : [];

  const config = {
    ss: ss,
    slackWebhookUrl: '',
    escalationEmail: '',
    showSupportEmail: '',
    advanceReminderDays: REMINDER_ADVANCE_DAYS,
    urgentReminderDays: REMINDER_URGENT_DAYS,
    overdueEscalationDays: OVERDUE_ESCALATION_DAYS,
    sendEmail: true,
    sendSlack: true,
    handbookUrl: '',
    webAppUrl: '',
  };

  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    const val = data[i][1];
    switch (key) {
      case 'Slack Webhook URL':       config.slackWebhookUrl = val; break;
      case 'Escalation Email':        config.escalationEmail = val; break;
      case 'Show Support Email':      config.showSupportEmail = val; break;
      case 'Advance Reminder Days':   config.advanceReminderDays = Number(val) || REMINDER_ADVANCE_DAYS; break;
      case 'Urgent Reminder Days':    config.urgentReminderDays = Number(val) || REMINDER_URGENT_DAYS; break;
      case 'Overdue Escalation Days': config.overdueEscalationDays = Number(val) || OVERDUE_ESCALATION_DAYS; break;
      case 'Send Email Reminders':    config.sendEmail = String(val).toUpperCase() !== 'FALSE'; break;
      case 'Send Slack Reminders':    config.sendSlack = String(val).toUpperCase() !== 'FALSE'; break;
      case 'Handbook URL':            config.handbookUrl = val; break;
      case 'Web App URL':             config.webAppUrl = val; break;
      case 'Slack Interactivity URL': break; // informational only — same as Web App URL
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
  const activeCol = headers.indexOf('Active?');

  const shows = [];
  for (let i = 1; i < data.length; i++) {
    const active = String(data[i][activeCol]).toUpperCase();
    if (active === 'TRUE' || active === 'YES') {
      shows.push({
        name: data[i][nameCol],
        slackChannel: slackCol !== -1 ? data[i][slackCol] : '',
      });
    }
  }
  return shows;
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
