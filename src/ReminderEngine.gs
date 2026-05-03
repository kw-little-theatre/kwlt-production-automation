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

  // ── Step 1: Reactivate readthrough tasks if the date was recently filled in ──
  _reactivateReadthroughTasks(ss, activeShows);

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

    // Collect per-show task groups for consolidated reminders (NWF feature)
    // Key: "baseTaskName|action|deadline" → { contexts: [], rows: [], action, ... }
    const perShowGroups = {};

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
      const taskName = taskData[COL.TASK];
      const isOptional = _isOptionalTask(taskName, show.productionType);

      // Optional tasks only get advance reminders (no urgent/overdue)
      // Send-on-date tasks only fire on the exact deadline date
      if (_isSendOnDateTask(taskName, show.productionType)) {
        if (daysUntil !== 0 || status !== STATUS.PENDING) continue;
      }

      let action = _isSendOnDateTask(taskName, show.productionType) ? 'advance' : _determineAction(daysUntil, status, config);

      // Optional tasks: skip urgent and overdue reminders
      if (isOptional && (action === 'urgent' || action === 'overdue')) {
        action = null;
      }

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
          productionType: show.productionType,
          isOptional: isOptional,
          includeReadthroughPicker: _includesReadthroughPicker(taskName, show.productionType),
        };

        // Check if this is a per-show task (contains " — " separator from NWF expansion)
        const perShowSep = taskName.lastIndexOf(' \u2014 ');
        if (perShowSep !== -1 && show.productionType === PRODUCTION_TYPE.NWF) {
          // Group per-show tasks for consolidated Slack reminders
          const baseTask = taskName.substring(0, perShowSep);
          const subShowName = taskName.substring(perShowSep + 3);
          const groupKey = baseTask + '|' + action + '|' + context.deadline;

          if (!perShowGroups[groupKey]) {
            perShowGroups[groupKey] = {
              baseTask: baseTask,
              action: action,
              context: context, // Use first task's context as template
              subShows: [],
              rows: [],
            };
          }
          perShowGroups[groupKey].subShows.push(subShowName);
          perShowGroups[groupKey].rows.push(row);

          // For overdue: skip individual emails (escalation handles it in the group send below)
          // For advance/urgent: send individual emails per sub-task
          if (action !== 'overdue' && (notifyVia === 'email' || notifyVia === 'both') && config.sendEmail) {
            const recipientEmail = _resolveRecipientEmail(context, config);
            if (recipientEmail) {
              const customEmail = _getCustomEmailForTask(context.task, context.productionType);
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
                const emailOk = sendEmailReminder(recipientEmail, subject, body, context);
                _logSend(config.ss, context, 'email', action, emailOk, emailOk ? '' : 'Email send failed');
              }
            }
          }
        } else {
          // Standard (non-per-show) task — send individually as before
          const success = _executeAction(action, context, config);

          // Update status in the sheet if any notification was sent
          if (success) {
            // Check if this task should auto-complete after the first send
            const isAutoComplete = _isAutoCompleteTask(context.task, show.productionType);
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

    // ── Send consolidated Slack messages for grouped per-show tasks ──────
    for (const groupKey of Object.keys(perShowGroups)) {
      const group = perShowGroups[groupKey];
      if (!config.sendSlack) continue;
      if (group.context.notifyVia !== 'slack' && group.context.notifyVia !== 'both') continue;

      let slackResult;
      if (group.action === 'overdue') {
        // Overdue: send a single escalation to Show Support channel (not show channel)
        if (config.showSupportChannel) {
          const overdueText = '🚨 *Overdue — ' + show.name + '*\n' +
            '*' + group.baseTask + '* is overdue (' + group.context.daysOverdue + ' days past deadline ' + group.context.deadline + ').\n' +
            '*Responsible:* ' + group.context.responsible + '\n' +
            '*Pending for:* ' + group.subShows.join(', ');
          slackResult = sendSlack(config, overdueText, config.showSupportChannel);
        }
      } else {
        // Advance/urgent: send consolidated reminder to show channel
        slackResult = sendConsolidatedPerShowReminder(config, group.context, group.action, group.baseTask, group.subShows);
      }

      const ok = slackResult && slackResult.ok;
      _logSend(config.ss, group.context, 'slack', group.action, ok, ok ? '' : (slackResult && slackResult.error || 'Unknown error'));

      // Update status for all rows in the group
      if (ok) {
        const isAutoComplete = _isAutoCompleteTask(group.baseTask, show.productionType);
        const newStatus = isAutoComplete ? STATUS.DONE : _statusAfterAction(group.action);
        for (const r of group.rows) {
          sheet.getRange(r + 1, COL.STATUS + 1).setValue(newStatus);
          sheet.getRange(r + 1, COL.LAST_NOTIFIED + 1).setValue(new Date());
          if (isAutoComplete) {
            sheet.getRange(r + 1, COL.NOTES + 1).setValue('Auto-completed after sending');
          }
        }
      }

      // Add to digest
      if (group.action !== 'overdue') {
        digestItems.push({
          show: show.name,
          task: group.baseTask + ' (' + group.subShows.length + ' shows)',
          responsible: group.context.responsible,
          deadline: group.context.deadline,
          action: group.action,
          daysUntil: group.context.daysUntil,
          success: ok,
        });
      }
    }
  }

  // Send reminder summary to show support Slack channel
  if (digestItems.length > 0 && config.showSupportChannel) {
    _sendDailyDigestSlack(digestItems, config);
  }

  // ── Prompt for missing readthrough dates (after auditions close) ──────
  _promptForReadthroughDate(ss, config, activeShows, today);

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
    let result;
    if (config.pythonServiceUrl) {
      // Route through Python service (Phase 3 hybrid model)
      result = _sendSlackViaPython(config.pythonServiceUrl, context);
    } else {
      // Direct Slack send (fallback)
      result = sendSlackBlockMessageWithButton(config, context, action);
    }
    const ok = result && result.ok;
    _logSend(config.ss, context, 'slack', action, ok, ok ? '' : (result && result.error || 'Unknown error'));
    if (ok) anySuccess = true;
  }

  // Email to show (skip for overdue — escalation goes to Show Support Slack only)
  if (action !== 'overdue' && (context.notifyVia === 'email' || context.notifyVia === 'both') && config.sendEmail) {
    const recipientEmail = _resolveRecipientEmail(context, config);
    if (recipientEmail) {
      // Check if this task has a custom email template in TaskTemplateData
      const customEmail = _getCustomEmailForTask(context.task, context.productionType);
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
        // Add optional task note to email body
        if (context.isOptional) {
          body = 'NOTE: This task is optional — skip it if not applicable to your production.\n\n' + body;
          subject = '[Optional] ' + subject;
        }
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
    // Mark Done button always rendered — it uses Slack Interactivity (action_id), not WEB_APP_URL
    blocks.push({
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '✅ Mark Done', emoji: true },
        style: 'primary',
        action_id: 'mark_done:' + encodeURIComponent(context.showName) + ':' + encodeURIComponent(context.task),
      }],
    });

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
 * Checks if a task has the optional flag set.
 * Optional tasks get softer reminders (advance only, no urgent/overdue)
 * and a Skip button alongside Mark Done.
 * @param {string} taskName
 * @param {string} [productionType] — optional, defaults to Mainstage
 */
function _isOptionalTask(taskName, productionType) {
  const tasks = getTaskTemplateForType(productionType || PRODUCTION_TYPE.MAINSTAGE);
  for (const t of tasks) {
    if (t.optional && (t.task === taskName || taskName.indexOf(t.task) !== -1)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a task has the autoComplete flag set.
 * Auto-complete tasks are marked Done after the first notification is sent
 * (used for informational emails that don't require follow-up).
 * @param {string} taskName
 * @param {string} [productionType] — optional, defaults to Mainstage
 */
function _isAutoCompleteTask(taskName, productionType) {
  const tasks = getTaskTemplateForType(productionType || PRODUCTION_TYPE.MAINSTAGE);
  for (const t of tasks) {
    if (t.autoComplete && (t.task === taskName || taskName.indexOf(t.task) !== -1)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a task has the includeReadthroughPicker flag set.
 * These tasks include an inline date picker for setting readthrough dates.
 */
function _includesReadthroughPicker(taskName, productionType) {
  const tasks = getTaskTemplateForType(productionType || PRODUCTION_TYPE.MAINSTAGE);
  for (const t of tasks) {
    if (t.includeReadthroughPicker && (t.task === taskName || taskName.indexOf(t.task) !== -1)) {
      return true;
    }
  }
  return false;
}

/**
 * Checks if a task has the sendOnDate flag set.
 * Send-on-date tasks bypass the normal advance/urgent reminder schedule
 * and are only sent once on the exact deadline date.
 * @param {string} taskName
 * @param {string} [productionType] — optional, defaults to Mainstage
 */
function _isSendOnDateTask(taskName, productionType) {
  const tasks = getTaskTemplateForType(productionType || PRODUCTION_TYPE.MAINSTAGE);
  for (const t of tasks) {
    if (t.sendOnDate && (t.task === taskName || taskName.indexOf(t.task) !== -1)) {
      return true;
    }
  }
  return false;
}

/**
 * Looks up a task in the TaskTemplateData to see if it has a custom
 * emailSubject/emailBody. Returns { emailSubject, emailBody } or null.
 * @param {string} taskName
 * @param {string} [productionType] — optional, defaults to Mainstage
 */
function _getCustomEmailForTask(taskName, productionType) {
  const tasks = getTaskTemplateForType(productionType || PRODUCTION_TYPE.MAINSTAGE);
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

// ─── Python Service Proxy ─────────────────────────────────────────────────────

/**
 * Sends a Slack reminder via the Python service.
 * Converts the Apps Script context to the Python TaskContext format and
 * POSTs to /reminders/send. Falls back to direct Slack if the service
 * is unreachable.
 *
 * @param {string} serviceUrl — base URL of the Python service
 * @param {Object} context — the reminder context object
 * @returns {{ ok: boolean, error: string }}
 */
function _sendSlackViaPython(serviceUrl, context) {
  const payload = {
    show_name: context.showName,
    task: context.task,
    responsible: context.responsible,
    general_rule: context.generalRule,
    deadline: context.deadline,
    days_until: context.daysUntil,
    days_overdue: context.daysOverdue,
    slack_channel: context.slackChannel,
    show_email: context.showEmail || '',
    resources_url: context.resourcesUrl || '',
    handbook_url: context.handbookUrl || '',
    notify_via: context.notifyVia || 'both',
    mark_done_url: context.markDoneUrl || '',
    production_type: context.productionType || 'Mainstage',
    is_optional: context.isOptional || false,
  };

  try {
    const response = UrlFetchApp.fetch(serviceUrl + '/reminders/send', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });

    const result = JSON.parse(response.getContentText());
    return result;
  } catch (e) {
    Logger.log('Python service error: ' + e.message + '. Falling back to direct Slack.');
    // Return failure — the caller should NOT retry via direct Slack here;
    // the caller can decide to fall back if needed.
    return { ok: false, error: 'Python service unavailable: ' + e.message };
  }
}

/**
 * Sends the daily digest via the Python service.
 * Falls back to direct Slack if the service is unreachable.
 */
function _sendDailyDigestViaPython(serviceUrl, digestItems) {
  const payload = digestItems.map(function(item) {
    return {
      show: item.show,
      task: item.task,
      responsible: item.responsible,
      deadline: item.deadline,
      action: item.action,
      days_until: item.daysUntil,
      success: item.success,
    };
  });

  try {
    const response = UrlFetchApp.fetch(serviceUrl + '/reminders/digest', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    return JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log('Python service digest error: ' + e.message);
    return { ok: false, error: e.message };
  }
}

/**
 * Sends a readthrough date prompt via the Python service.
 */
function _sendReadthroughPromptViaPython(serviceUrl, showName, channel) {
  try {
    const response = UrlFetchApp.fetch(
      serviceUrl + '/reminders/readthrough-prompt?show_name=' + encodeURIComponent(showName) + '&channel=' + encodeURIComponent(channel),
      {
        method: 'post',
        muteHttpExceptions: true,
      }
    );
    return JSON.parse(response.getContentText());
  } catch (e) {
    Logger.log('Python service readthrough prompt error: ' + e.message);
    return { ok: false, error: e.message };
  }
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
    slackBotToken: props.getProperty('SLACK_BOT_TOKEN') || '',
    showSupportChannel: props.getProperty('SHOW_SUPPORT_CHANNEL') || '',
    escalationEmail: '',  // legacy — overdue escalation now goes to Slack
    showSupportEmail: props.getProperty('SHOW_SUPPORT_EMAIL') || '',
    webAppUrl: props.getProperty('WEB_APP_URL') || '',
    membershipEmail: props.getProperty('MEMBERSHIP_EMAIL') || '',
    pythonServiceUrl: props.getProperty('PYTHON_SERVICE_URL') || '',
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
 * Returns an array of { name, productionType, slackChannel, showEmail, resourcesUrl,
 * auditionEnd, readthroughDate, readthroughPromptLastSent }
 * for shows marked Active = TRUE.
 */
function _getActiveShows(ss) {
  const sheet = ss.getSheetByName(SHEET_SHOW_SETUP);
  if (!sheet) return [];

  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const nameCol = 0;
  const typeCol = headers.indexOf('Production Type');
  const slackCol = headers.indexOf('Slack Channel');
  const emailCol = headers.indexOf('Show Email');
  const resourcesCol = headers.indexOf('Resources Folder URL');
  const activeCol = headers.indexOf('Active?');

  // Find anchor date columns (headers may have suffixes like " *", " (auto)", " (opt)")
  const auditionStartCol = headers.findIndex(function(h) { return String(h).indexOf(ANCHOR.AUDITION_START) === 0; });
  const auditionEndCol = headers.findIndex(function(h) { return String(h).indexOf(ANCHOR.AUDITION_END) === 0; });
  const readthroughCol = headers.findIndex(function(h) { return String(h).indexOf(ANCHOR.READTHROUGH) === 0; });
  const promptCol = headers.indexOf('Readthrough Prompt Last Sent');

  const shows = [];
  for (let i = 1; i < data.length; i++) {
    const active = String(data[i][activeCol]).toUpperCase();
    if (active === 'TRUE' || active === 'YES') {
      const auditionStartRaw = auditionStartCol !== -1 ? data[i][auditionStartCol] : '';
      const auditionEndRaw = auditionEndCol !== -1 ? data[i][auditionEndCol] : '';
      const readthrough = readthroughCol !== -1 ? data[i][readthroughCol] : '';
      const promptLast = promptCol !== -1 ? data[i][promptCol] : '';

      // Parse audition end, with auto-derivation fallback (type-aware)
      const rawType = typeCol !== -1 ? String(data[i][typeCol] || '').trim() : '';
      const productionType = PRODUCTION_TYPES_LIST.indexOf(rawType) !== -1 ? rawType : PRODUCTION_TYPE.MAINSTAGE;

      let auditionEnd = auditionEndRaw instanceof Date ? auditionEndRaw : (auditionEndRaw ? new Date(auditionEndRaw) : null);
      if (!auditionEnd || isNaN(auditionEnd.getTime())) {
        const auditionStart = auditionStartRaw instanceof Date ? auditionStartRaw : (auditionStartRaw ? new Date(auditionStartRaw) : null);
        if (auditionStart && !isNaN(auditionStart.getTime())) {
          auditionEnd = new Date(auditionStart);
          const offset = (productionType === PRODUCTION_TYPE.STUDIO_SERIES) ? 0 : 2;
          auditionEnd.setDate(auditionEnd.getDate() + offset);
        }
      }

      shows.push({
        name: data[i][nameCol],
        productionType: productionType,
        slackChannel: slackCol !== -1 ? data[i][slackCol] : '',
        showEmail: emailCol !== -1 ? data[i][emailCol] : '',
        resourcesUrl: resourcesCol !== -1 ? data[i][resourcesCol] : '',
        auditionEnd: auditionEnd,
        readthroughDate: readthrough instanceof Date ? readthrough : (readthrough ? new Date(readthrough) : null),
        readthroughPromptLastSent: promptLast instanceof Date ? promptLast : (promptLast ? new Date(promptLast) : null),
        setupRowIndex: i,  // 0-based data row index (1-based sheet row = i + 1)
      });
    }
  }
  return shows;
}

// ─── Readthrough Date: Reactivation & Prompting ──────────────────────────────

/**
 * Checks each active show for a newly-filled readthrough date. If found,
 * recomputes deadlines for any tasks that were skipped because the
 * readthrough date was previously missing, and reactivates them.
 *
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @param {Object[]} activeShows — from _getActiveShows()
 */
function _reactivateReadthroughTasks(ss, activeShows) {
  for (const show of activeShows) {
    if (!show.readthroughDate || isNaN(show.readthroughDate.getTime())) continue;

    const tabName = SHOW_TAB_PREFIX + show.name;
    const sheet = ss.getSheetByName(tabName);
    if (!sheet) continue;

    const data = sheet.getDataRange().getValues();
    let reactivated = 0;

    for (let row = 1; row < data.length; row++) {
      const status = data[row][COL.STATUS];
      const notes = String(data[row][COL.NOTES] || '');
      const anchorRef = data[row][COL.ANCHOR_REF];

      // Only reactivate tasks that were skipped because readthrough was missing
      if (status === STATUS.SKIPPED &&
          notes.indexOf('Skipped') !== -1 &&
          notes.indexOf(ANCHOR.READTHROUGH) !== -1 &&
          anchorRef === ANCHOR.READTHROUGH) {

        // Recompute the deadline
        const offsetDays = Number(data[row][COL.OFFSET_DAYS]) || 0;
        const newDate = new Date(show.readthroughDate);
        newDate.setDate(newDate.getDate() + offsetDays);

        sheet.getRange(row + 1, COL.COMPUTED_DATE + 1).setValue(newDate);
        sheet.getRange(row + 1, COL.STATUS + 1).setValue(STATUS.PENDING);
        sheet.getRange(row + 1, COL.NOTIFY_VIA + 1).setValue(data[row][COL.NOTIFY_VIA] === 'none' ? 'both' : data[row][COL.NOTIFY_VIA]);
        sheet.getRange(row + 1, COL.NOTES + 1).setValue(
          'Reactivated — readthrough date set to ' +
          Utilities.formatDate(show.readthroughDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
        );
        reactivated++;
      }
    }

    if (reactivated > 0) {
      Logger.log('Reactivated ' + reactivated + ' readthrough task(s) for "' + show.name + '".');

      // Notify the show channel about reactivation
      if (show.slackChannel) {
        const config = _loadConfig(ss);
        sendSlack(config,
          '✅ *Readthrough date set for ' + show.name + '* (' +
          Utilities.formatDate(show.readthroughDate, Session.getScriptTimeZone(), 'yyyy-MM-dd') +
          ')\n' + reactivated + ' dependent task(s) have been activated and will be tracked.',
          show.slackChannel
        );
      }
    }
  }
}

/**
 * For each active show that is missing a readthrough date and past audition
 * end, sends a Slack date picker prompt (if one hasn't been sent in the
 * last 7 days). Records the prompt timestamp in Show Setup.
 *
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @param {Object} config — loaded config
 * @param {Object[]} activeShows — from _getActiveShows()
 * @param {Date} today — today's date (stripped to midnight)
 */
function _promptForReadthroughDate(ss, config, activeShows, today) {
  if (!config.sendSlack) return;

  const setupSheet = ss.getSheetByName(SHEET_SHOW_SETUP);
  if (!setupSheet) return;

  const headers = setupSheet.getDataRange().getValues()[0];
  const promptCol = headers.indexOf('Readthrough Prompt Last Sent');
  // promptCol may be -1 if the column hasn't been added yet — still send prompts,
  // just can't throttle to once per week without it.

  for (const show of activeShows) {
    // Skip if readthrough date is already set
    if (show.readthroughDate && !isNaN(show.readthroughDate.getTime())) continue;

    // Skip if no Slack channel configured
    if (!show.slackChannel) continue;

    // Skip if audition end hasn't passed yet (need at least 1 day after)
    if (!show.auditionEnd || isNaN(show.auditionEnd.getTime())) continue;
    const daysSinceAuditionEnd = _daysBetween(show.auditionEnd, today);
    if (daysSinceAuditionEnd < 1) continue;

    // Skip if we already prompted today
    if (show.readthroughPromptLastSent && !isNaN(show.readthroughPromptLastSent.getTime())) {
      const daysSinceLastPrompt = _daysBetween(show.readthroughPromptLastSent, today);
      if (daysSinceLastPrompt < 1) continue;
    }

    // Send the date picker prompt (via Python service or direct)
    let result;
    const isNWF = show.productionType === PRODUCTION_TYPE.NWF;
    const promptOpts = isNWF ? { isNWF: true, existingDates: [] } : undefined;

    if (config.pythonServiceUrl && !isNWF) {
      result = _sendReadthroughPromptViaPython(config.pythonServiceUrl, show.name, show.slackChannel);
      if (!result || !result.ok) {
        Logger.log('Python readthrough prompt failed, falling back to direct Slack.');
        result = sendReadthroughDatePrompt(config, show.name, show.slackChannel, promptOpts);
      }
    } else {
      result = sendReadthroughDatePrompt(config, show.name, show.slackChannel, promptOpts);
    }
    if (result && result.ok) {
      // Record the prompt timestamp in Show Setup (if tracking column exists)
      if (promptCol !== -1) {
        setupSheet.getRange(show.setupRowIndex + 1, promptCol + 1).setValue(new Date());
      }
      Logger.log('Sent readthrough date prompt for "' + show.name + '" to #' + show.slackChannel);
    } else {
      Logger.log('Failed to send readthrough date prompt for "' + show.name + '": ' + (result && result.error || 'Unknown error'));
    }
  }
}

// ─── Reminder Summary via Slack ────────────────────────────────────────────────────

/**
 * Sends a reminder summary summary to the Show Support Slack channel.
 */
function _sendDailyDigestSlack(digestItems, config) {
  if (!config.showSupportChannel) return;

  // Route through Python service if available
  if (config.pythonServiceUrl) {
    const result = _sendDailyDigestViaPython(config.pythonServiceUrl, digestItems);
    if (result && result.ok) return;
    Logger.log('Python digest failed, falling back to direct Slack.');
  }

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
