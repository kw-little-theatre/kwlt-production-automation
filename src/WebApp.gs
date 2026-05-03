/**
 * KWLT Production Automation — Web App (Mark Done)
 *
 * Deploys as a Google Apps Script web app to handle:
 *   1. "Mark Done" links from emails — GET requests
 *   2. Slack interactive button callbacks — POST requests
 *
 * Deployment: In Apps Script editor → Deploy → New deployment →
 *   Type: Web app → Execute as: Me → Access: Anyone with link
 *   Copy the URL and paste it into ⚙️ Config → Web App URL
 */

// ─── GET Handler (Email "Mark Done" Links) ────────────────────────────────────

/**
 * Handles GET requests from "Mark Done" links in emails and Slack messages.
 * URL format: ?action=done&show=ShowName&task=TaskText&token=abc12345
 */
function doGet(e) {
  const params = e.parameter || {};
  const action = params.action;
  const showName = params.show;
  const taskText = params.task;
  const token = params.token;

  // Validate
  if ((action !== 'done' && action !== 'skip') || !showName || !taskText || !token) {
    return _htmlResponse('❌ Invalid Request', 'This link appears to be malformed or expired.', false);
  }

  // Verify token
  const expectedToken = _generateToken(showName, taskText);
  if (token !== expectedToken) {
    return _htmlResponse('❌ Invalid Token', 'This link may have expired or been tampered with.', false);
  }

  if (action === 'skip') {
    const result = _skipTask(showName, taskText);
    if (result.success) {
      return _htmlResponse(
        '⏭️ Task Skipped',
        '<strong>' + _escapeHtml(taskText) + '</strong><br><br>' +
        'Show: ' + _escapeHtml(showName) + '<br>' +
        'Skipped at: ' + new Date().toLocaleString() + '<br><br>' +
        'No further reminders will be sent for this task.<br>You can close this tab.',
        true
      );
    } else {
      return _htmlResponse('⚠️ Could Not Skip', result.message, false);
    }
  }

  // Find and update the task
  const result = _markTaskDone(showName, taskText);

  if (result.success) {
    return _htmlResponse(
      '✅ Task Marked Done',
      '<strong>' + _escapeHtml(taskText) + '</strong><br><br>' +
      'Show: ' + _escapeHtml(showName) + '<br>' +
      'Marked done at: ' + new Date().toLocaleString() + '<br><br>' +
      'You can close this tab.',
      true
    );
  } else {
    return _htmlResponse('⚠️ Could Not Update', result.message, false);
  }
}

// ─── POST Handler (Slack Interactive Buttons) ─────────────────────────────────

/**
 * Handles POST requests from Slack interactive components (buttons).
 * Slack sends a URL-encoded payload with a JSON body.
 */
function doPost(e) {
  try {
    // Slack sends interactive payloads as application/x-www-form-urlencoded
    // with a "payload" parameter containing JSON
    const payload = JSON.parse(e.parameter.payload);

    if (payload.type === 'block_actions') {
      const action = payload.actions[0];
      const actionId = action.action_id;

      // ── Readthrough date picker interaction ──────────────────────────
      if (actionId && actionId.startsWith('readthrough_date:')) {
        const showName = decodeURIComponent(actionId.substring('readthrough_date:'.length));
        const selectedDate = action.selected_date; // "YYYY-MM-DD"
        const userName = payload.user ? '<@' + payload.user.id + '>' : 'Someone';

        if (!selectedDate) {
          _sendSlackResponseUrl(payload.response_url, '⚠️ No date selected. Please try again.', true);
          return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
        }

        Logger.log('Readthrough date picker: show=' + showName + ', date=' + selectedDate + ', user=' + userName);
        const result = _setReadthroughDate(showName, selectedDate);
        Logger.log('Readthrough date update result: ' + JSON.stringify(result));

        if (result.success) {
          const reactivatedMsg = result.reactivated > 0
            ? '\n' + result.reactivated + ' dependent task(s) reactivated — reminders scheduled.'
            : '';
          const changeMsg = result.wasChange ? ' (changed)' : '';

          // Send confirmation with a "Change Date" button to the channel
          const config = _loadConfig(SpreadsheetApp.getActiveSpreadsheet());
          const channel = payload.channel ? payload.channel.id : '';
          if (channel && config.slackBotToken) {
            _sendReadthroughConfirmation(config, channel, showName, selectedDate, userName, reactivatedMsg + changeMsg);
          } else {
            _sendSlackResponseUrl(payload.response_url,
              '✅ *Readthrough date for ' + showName + '* set to *' + selectedDate + '* by ' + userName + '.' +
              reactivatedMsg + '\nMembership Director and Show Support have been notified.',
              false);
          }
        } else {
          _sendSlackResponseUrl(payload.response_url,
            '⚠️ Could not set readthrough date: ' + result.message,
            true);
        }

        return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
      }

      // ── Change readthrough date button ────────────────────────────────
      if (actionId && actionId.startsWith('change_readthrough_date:')) {
        const showName = decodeURIComponent(actionId.substring('change_readthrough_date:'.length));
        const config = _loadConfig(SpreadsheetApp.getActiveSpreadsheet());
        const channel = payload.channel ? payload.channel.id : '';

        if (channel && config.slackBotToken) {
          sendReadthroughDatePrompt(config, showName, channel);
          _sendSlackResponseUrl(payload.response_url,
            '📅 Date picker posted above — select the new readthrough date.',
            true);
        }

        return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
      }

      // ── Mark Done (per-show dropdown) interaction ──────────────────
      if (actionId && actionId.startsWith('mark_done_per_show:')) {
        // action_id format: "mark_done_per_show:ShowName:BaseTask"
        // selected_option.value = individual show name
        const parts = actionId.substring('mark_done_per_show:'.length);
        const separatorIdx = parts.indexOf(':');
        const showName = decodeURIComponent(parts.substring(0, separatorIdx));
        const baseTask = decodeURIComponent(parts.substring(separatorIdx + 1));
        const subShowName = action.selected_option ? action.selected_option.value : '';

        if (!subShowName) {
          _sendSlackResponseUrl(payload.response_url, '⚠️ No show selected. Please try again.', true);
          return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
        }

        // The full task name in the spreadsheet is "BaseTask — SubShowName"
        const fullTaskName = baseTask + ' \u2014 ' + subShowName;
        const result = _markTaskDone(showName, fullTaskName);
        const userName = payload.user ? '<@' + payload.user.id + '>' : 'Someone';

        if (result.success) {
          // Send confirmation with undo to the channel
          const config = _loadConfig(SpreadsheetApp.getActiveSpreadsheet());
          const channel = payload.channel ? payload.channel.id : '';
          if (channel && config.slackBotToken) {
            _sendMarkDoneConfirmation(config, channel, showName, fullTaskName, userName);
          } else {
            _sendSlackResponseUrl(payload.response_url,
              '✅ *' + baseTask + '* marked done for *' + subShowName + '* by ' + userName,
              false);
          }
        } else {
          _sendSlackResponseUrl(payload.response_url,
            '⚠️ Could not mark task done: ' + result.message,
            true);
        }

        return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
      }

      // ── Mark Done button interaction ─────────────────────────────────
      if (actionId && actionId.startsWith('mark_done:')) {
        // action_id format: "mark_done:ShowName:TaskText"
        const parts = actionId.substring('mark_done:'.length);
        const separatorIdx = parts.indexOf(':');
        const showName = decodeURIComponent(parts.substring(0, separatorIdx));
        const taskText = decodeURIComponent(parts.substring(separatorIdx + 1));

        const result = _markTaskDone(showName, taskText);
        const userName = payload.user ? '<@' + payload.user.id + '>' : 'Someone';

        if (result.success) {
          // Send confirmation with an Undo button to the channel
          const config = _loadConfig(SpreadsheetApp.getActiveSpreadsheet());
          const channel = payload.channel ? payload.channel.id : '';
          if (channel && config.slackBotToken) {
            _sendMarkDoneConfirmation(config, channel, showName, taskText, userName);
          } else {
            _sendSlackResponseUrl(payload.response_url,
              '✅ *' + taskText + '* marked done by ' + userName,
              false);
          }
        } else {
          _sendSlackResponseUrl(payload.response_url,
            '⚠️ Could not mark task done: ' + result.message,
            true);
        }

        return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
      }

      // ── Mark Undone (undo) button interaction ────────────────────────
      if (actionId && actionId.startsWith('mark_undone:')) {
        const parts = actionId.substring('mark_undone:'.length);
        const separatorIdx = parts.indexOf(':');
        const showName = decodeURIComponent(parts.substring(0, separatorIdx));
        const taskText = decodeURIComponent(parts.substring(separatorIdx + 1));

        const result = _markTaskUndone(showName, taskText);
        const userName = payload.user ? '<@' + payload.user.id + '>' : 'Someone';

        if (result.success) {
          _sendSlackResponseUrl(payload.response_url,
            '↩️ *' + taskText + '* marked undone by ' + userName + ' — reminders will resume.',
            false);
        } else {
          _sendSlackResponseUrl(payload.response_url,
            '⚠️ Could not undo: ' + result.message,
            true);
        }

        return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
      }

      // ── Skip task button interaction ─────────────────────────────────
      if (actionId && actionId.startsWith('skip_task:')) {
        const parts = actionId.substring('skip_task:'.length);
        const separatorIdx = parts.indexOf(':');
        const showName = decodeURIComponent(parts.substring(0, separatorIdx));
        const taskText = decodeURIComponent(parts.substring(separatorIdx + 1));

        const result = _skipTask(showName, taskText);
        const userName = payload.user ? '<@' + payload.user.id + '>' : 'Someone';

        if (result.success) {
          _sendSlackResponseUrl(payload.response_url,
            '⏭️ *' + taskText + '* skipped by ' + userName + ' — no further reminders will be sent.',
            false);

          // Notify Show Support channel
          const config = _loadConfig(SpreadsheetApp.getActiveSpreadsheet());
          if (config.showSupportChannel) {
            sendSlack(config,
              '⏭️ *Optional task skipped — ' + showName + '*\n' +
              '*' + taskText + '* was skipped by ' + userName + '.',
              config.showSupportChannel);
          }
        } else {
          _sendSlackResponseUrl(payload.response_url,
            '⚠️ Could not skip: ' + result.message,
            true);
        }

        return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({ text: 'OK' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    return ContentService
      .createTextOutput(JSON.stringify({ text: 'Error: ' + err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// ─── Task Update Logic ────────────────────────────────────────────────────────

/**
 * Finds a task in a show's timeline tab and marks it Done.
 * @param {string} showName — the show name (matches Show Setup)
 * @param {string} taskText — the task description (partial match OK)
 * @returns {{ success: boolean, message: string }}
 */
function _markTaskDone(showName, taskText) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = SHOW_TAB_PREFIX + showName;
  const sheet = ss.getSheetByName(tabName);

  if (!sheet) {
    return { success: false, message: 'Show tab "' + tabName + '" not found.' };
  }

  const data = sheet.getDataRange().getValues();

  for (let row = 1; row < data.length; row++) {
    const currentTask = String(data[row][COL.TASK]);
    const currentStatus = data[row][COL.STATUS];

    // Match by exact task text or by contained text (for truncated URLs)
    if (currentTask === taskText || currentTask.indexOf(taskText) !== -1 || taskText.indexOf(currentTask) !== -1) {
      if (currentStatus === STATUS.DONE) {
        return { success: true, message: 'Task was already marked done.' };
      }

      sheet.getRange(row + 1, COL.STATUS + 1).setValue(STATUS.DONE);
      sheet.getRange(row + 1, COL.LAST_NOTIFIED + 1).setValue(new Date());
      sheet.getRange(row + 1, COL.NOTES + 1).setValue(
        (data[row][COL.NOTES] ? data[row][COL.NOTES] + '\n' : '') +
        'Marked done via link at ' + new Date().toLocaleString()
      );

      // Log it
      _logSend(ss, { showName: showName, task: currentTask, responsible: data[row][COL.RESPONSIBLE] },
        'web app', 'mark-done', true);

      return { success: true, message: 'Task marked as done.' };
    }
  }

  return { success: false, message: 'Task "' + taskText + '" not found in the ' + showName + ' timeline.' };
}

/**
 * Finds a task in a show's timeline tab and reverts it from Done to Pending.
 * @param {string} showName — the show name (matches Show Setup)
 * @param {string} taskText — the task description (partial match OK)
 * @returns {{ success: boolean, message: string }}
 */
function _markTaskUndone(showName, taskText) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = SHOW_TAB_PREFIX + showName;
  const sheet = ss.getSheetByName(tabName);

  if (!sheet) {
    return { success: false, message: 'Show tab "' + tabName + '" not found.' };
  }

  const data = sheet.getDataRange().getValues();

  for (let row = 1; row < data.length; row++) {
    const currentTask = String(data[row][COL.TASK]);
    const currentStatus = data[row][COL.STATUS];

    if (currentTask === taskText || currentTask.indexOf(taskText) !== -1 || taskText.indexOf(currentTask) !== -1) {
      if (currentStatus !== STATUS.DONE) {
        return { success: true, message: 'Task is not currently marked done (status: ' + currentStatus + ').' };
      }

      sheet.getRange(row + 1, COL.STATUS + 1).setValue(STATUS.PENDING);
      sheet.getRange(row + 1, COL.NOTES + 1).setValue(
        (data[row][COL.NOTES] ? data[row][COL.NOTES] + '\n' : '') +
        'Undone via Slack at ' + new Date().toLocaleString()
      );

      _logSend(ss, { showName: showName, task: currentTask, responsible: data[row][COL.RESPONSIBLE] },
        'web app', 'mark-undone', true);

      return { success: true, message: 'Task reverted to Pending.' };
    }
  }

  return { success: false, message: 'Task "' + taskText + '" not found in the ' + showName + ' timeline.' };
}

/**
 * Finds a task in a show's timeline tab and marks it Skipped.
 * Used for optional tasks that a production team decides not to do.
 * @param {string} showName — the show name (matches Show Setup)
 * @param {string} taskText — the task description (partial match OK)
 * @returns {{ success: boolean, message: string }}
 */
function _skipTask(showName, taskText) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = SHOW_TAB_PREFIX + showName;
  const sheet = ss.getSheetByName(tabName);

  if (!sheet) {
    return { success: false, message: 'Show tab "' + tabName + '" not found.' };
  }

  const data = sheet.getDataRange().getValues();

  for (let row = 1; row < data.length; row++) {
    const currentTask = String(data[row][COL.TASK]);
    const currentStatus = data[row][COL.STATUS];

    if (currentTask === taskText || currentTask.indexOf(taskText) !== -1 || taskText.indexOf(currentTask) !== -1) {
      if (currentStatus === STATUS.SKIPPED) {
        return { success: true, message: 'Task was already skipped.' };
      }

      sheet.getRange(row + 1, COL.STATUS + 1).setValue(STATUS.SKIPPED);
      sheet.getRange(row + 1, COL.LAST_NOTIFIED + 1).setValue(new Date());
      sheet.getRange(row + 1, COL.NOTES + 1).setValue(
        (data[row][COL.NOTES] ? data[row][COL.NOTES] + '\n' : '') +
        'Skipped via Slack at ' + new Date().toLocaleString()
      );

      _logSend(ss, { showName: showName, task: currentTask, responsible: data[row][COL.RESPONSIBLE] },
        'web app', 'skip-task', true);

      return { success: true, message: 'Task skipped.' };
    }
  }

  return { success: false, message: 'Task "' + taskText + '" not found in the ' + showName + ' timeline.' };
}

/**
 * Sends a "marked done" confirmation with an Undo button to a Slack channel.
 */
function _sendMarkDoneConfirmation(config, channel, showName, taskText, userName) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '✅ *' + taskText + '* marked done by ' + userName,
      },
    },
    {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '↩️ Undo', emoji: true },
        action_id: 'mark_undone:' + encodeURIComponent(showName) + ':' + encodeURIComponent(taskText),
      }],
    },
  ];

  sendSlack(config, '', channel, {
    attachments: [{ color: '#059669', fallback: '✅ ' + taskText + ' marked done by ' + userName, blocks: blocks }],
  });
}

/**
 * Sends a readthrough date confirmation with a "Change Date" button.
 */
function _sendReadthroughConfirmation(config, channel, showName, dateStr, userName, extraMsg) {
  const blocks = [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '✅ *Readthrough date for ' + showName + '* set to *' + dateStr + '* by ' + userName + '.' +
          (extraMsg || '') +
          '\nMembership Director and Show Support have been notified.',
      },
    },
    {
      type: 'actions',
      elements: [{
        type: 'button',
        text: { type: 'plain_text', text: '📅 Change Date', emoji: true },
        action_id: 'change_readthrough_date:' + encodeURIComponent(showName),
      }],
    },
  ];

  sendSlack(config, '', channel, {
    attachments: [{ color: '#6d28d9', fallback: '✅ Readthrough date for ' + showName + ' set to ' + dateStr, blocks: blocks }],
  });
}

// ─── Readthrough Date Update ──────────────────────────────────────────────────

/**
 * Sets the readthrough date for a show in the Show Setup sheet.
 * Called when a user picks a date from the Slack date picker.
 *
 * @param {string} showName — the show name (must match Show Setup)
 * @param {string} dateStr — date string in YYYY-MM-DD format
 * @returns {{ success: boolean, message: string }}
 */
function _setReadthroughDate(showName, dateStr) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_SHOW_SETUP);
  if (!sheet) {
    return { success: false, message: 'Show Setup sheet not found.' };
  }

  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  // Find the Readthrough Date column (header contains "Readthrough Date")
  const readthroughCol = headers.findIndex(function(h) {
    return String(h).indexOf(ANCHOR.READTHROUGH) === 0;
  });
  if (readthroughCol === -1) {
    return { success: false, message: 'Readthrough Date column not found in Show Setup.' };
  }

  // Find the show row
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === showName) {
      const parsedDate = new Date(dateStr + 'T00:00:00');
      if (isNaN(parsedDate.getTime())) {
        return { success: false, message: 'Invalid date: ' + dateStr };
      }

      // Check if there was a previous date (change vs first-set)
      const previousValue = data[i][readthroughCol];
      const hadPreviousDate = previousValue instanceof Date ||
        (previousValue && !isNaN(new Date(previousValue).getTime()));
      const previousDateStr = hadPreviousDate
        ? Utilities.formatDate(
            previousValue instanceof Date ? previousValue : new Date(previousValue),
            Session.getScriptTimeZone(), 'yyyy-MM-dd')
        : null;

      // Skip if the date didn't actually change
      if (previousDateStr === dateStr) {
        return { success: true, message: 'Date unchanged.', reactivated: 0, wasChange: false };
      }

      // Set the readthrough date
      sheet.getRange(i + 1, readthroughCol + 1).setValue(parsedDate);

      // Clear the "Readthrough Prompt Last Sent" column (prompt no longer needed)
      const promptCol = headers.indexOf('Readthrough Prompt Last Sent');
      if (promptCol !== -1) {
        sheet.getRange(i + 1, promptCol + 1).setValue('');
      }

      // Immediately reactivate skipped readthrough-dependent tasks
      const reactivated = _reactivateReadthroughTasksForShow(ss, showName, parsedDate);

      // Send appropriate notifications (first-set vs change)
      if (hadPreviousDate && previousDateStr) {
        _notifyReadthroughDateChanged(ss, showName, previousDateStr, dateStr);
      } else {
        _notifyReadthroughDateSet(ss, showName, dateStr);
      }

      Logger.log('Readthrough date for "' + showName + '" set to ' + dateStr + ' via Slack date picker.' +
        (hadPreviousDate ? ' (changed from ' + previousDateStr + ')' : '') +
        ' Reactivated ' + reactivated + ' task(s).');
      return { success: true, message: 'Readthrough date set to ' + dateStr, reactivated: reactivated, wasChange: hadPreviousDate };
    }
  }

  return { success: false, message: 'Show "' + showName + '" not found in Show Setup.' };
}

/**
 * Reactivates readthrough-dependent tasks for a single show immediately
 * after the readthrough date is set. Recomputes deadlines and sets status
 * back to Pending. Also runs any reminders that are already due.
 *
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @param {string} showName
 * @param {Date} readthroughDate
 * @returns {number} — number of tasks reactivated
 */
function _reactivateReadthroughTasksForShow(ss, showName, readthroughDate) {
  const tabName = SHOW_TAB_PREFIX + showName;
  const sheet = ss.getSheetByName(tabName);
  if (!sheet) return 0;

  const data = sheet.getDataRange().getValues();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const config = _loadConfig(ss);
  const showData = _getActiveShows(ss).find(function(s) { return s.name === showName; });
  const productionType = showData ? showData.productionType : PRODUCTION_TYPE.MAINSTAGE;
  let reactivated = 0;

  for (let row = 1; row < data.length; row++) {
    const status = data[row][COL.STATUS];
    const notes = String(data[row][COL.NOTES] || '');
    const anchorRef = data[row][COL.ANCHOR_REF];

    // Match tasks anchored to Readthrough that are either:
    //   - Skipped because the date was missing (first time setting)
    //   - Already reactivated from a previous pick (re-pick / correction)
    const isSkippedReadthrough = status === STATUS.SKIPPED &&
        notes.indexOf('Skipped') !== -1 &&
        notes.indexOf(ANCHOR.READTHROUGH) !== -1 &&
        anchorRef === ANCHOR.READTHROUGH;

    const isPreviouslyReactivated = anchorRef === ANCHOR.READTHROUGH &&
        notes.indexOf('Reactivated') !== -1 &&
        (status === STATUS.PENDING || status === STATUS.ADVANCE_SENT || status === STATUS.URGENT_SENT);

    if (!isSkippedReadthrough && !isPreviouslyReactivated) {
      continue;
    }

    // Recompute the deadline
    const offsetDays = Number(data[row][COL.OFFSET_DAYS]) || 0;
    const newDate = new Date(readthroughDate);
    newDate.setDate(newDate.getDate() + offsetDays);

    // Restore the task's original notifyVia (it was set to 'none' when skipped)
    const taskName = data[row][COL.TASK];
    const originalNotifyVia = _lookupOriginalNotifyVia(taskName, productionType) || 'both';

    sheet.getRange(row + 1, COL.COMPUTED_DATE + 1).setValue(newDate);
    sheet.getRange(row + 1, COL.STATUS + 1).setValue(STATUS.PENDING);
    sheet.getRange(row + 1, COL.NOTIFY_VIA + 1).setValue(originalNotifyVia);
    sheet.getRange(row + 1, COL.NOTES + 1).setValue(
      'Reactivated — readthrough date set to ' +
      Utilities.formatDate(readthroughDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
    );
    reactivated++;

    // Check if this task already needs a reminder right now
    newDate.setHours(0, 0, 0, 0);
    const daysUntil = Math.round((newDate.getTime() - today.getTime()) / 86400000);
    const action = _determineAction(daysUntil, STATUS.PENDING, config);

    if (action && showData) {
      const context = {
        showName: showName,
        task: taskName,
        responsible: data[row][COL.RESPONSIBLE],
        generalRule: data[row][COL.GENERAL_RULE],
        deadline: Utilities.formatDate(newDate, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        daysUntil: daysUntil,
        daysOverdue: daysUntil < 0 ? Math.abs(daysUntil) : 0,
        slackChannel: showData.slackChannel,
        showEmail: showData.showEmail,
        resourcesUrl: showData.resourcesUrl,
        handbookUrl: config.handbookUrl,
        notifyVia: originalNotifyVia,
        markDoneUrl: buildMarkDoneUrl(config.webAppUrl, showName, taskName),
        productionType: productionType,
      };

      const success = _executeAction(action, context, config);
      if (success) {
        const isAutoComplete = _isAutoCompleteTask(taskName, productionType);
        const newStatus = isAutoComplete ? STATUS.DONE : _statusAfterAction(action);
        sheet.getRange(row + 1, COL.STATUS + 1).setValue(newStatus);
        sheet.getRange(row + 1, COL.LAST_NOTIFIED + 1).setValue(new Date());
        if (isAutoComplete) {
          sheet.getRange(row + 1, COL.NOTES + 1).setValue('Auto-completed after sending (reactivated)');
        }
      }
    }
  }

  return reactivated;
}

/**
 * Looks up the original notifyVia value for a task from the template data.
 * @param {string} taskName
 * @param {string} [productionType] — optional, defaults to Mainstage
 */
function _lookupOriginalNotifyVia(taskName, productionType) {
  const tasks = getTaskTemplateForType(productionType || PRODUCTION_TYPE.MAINSTAGE);
  for (const t of tasks) {
    if (t.task === taskName || taskName.indexOf(t.task) !== -1) {
      return t.notifyVia;
    }
  }
  return null;
}

// ─── Readthrough Date Notifications ───────────────────────────────────────────

/**
 * Sends notifications when a readthrough date is set:
 *   1. Email to the Membership Director (CC: show email) with RSVP info
 *   2. Slack FYI to the Show Support channel
 *
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @param {string} showName
 * @param {string} dateStr — YYYY-MM-DD
 */
function _notifyReadthroughDateSet(ss, showName, dateStr) {
  const config = _loadConfig(ss);

  // Look up the show's email for CC
  const showData = _getActiveShows(ss).find(function(s) { return s.name === showName; });
  const showEmail = showData ? showData.showEmail : '';

  // ── Email to Membership Director (CC: show email) ─────────────────────
  if (config.membershipEmail) {
    const subject = '[KWLT] Readthrough Date Set -- ' + showName;
    const body = 'Hello,\n\n' +
      'The readthrough date for ' + showName + ' has been set to ' + dateStr + '.\n\n' +
      'As Membership Director, you are invited to attend. Please RSVP with the production team' +
      (showEmail ? ' (' + showEmail + ')' : '') + ' to confirm your attendance.\n\n' +
      'If you have any questions, please reach out to the Show Support Committee.\n\n' +
      '-- KWLT Show Support';

    try {
      GmailApp.sendEmail(config.membershipEmail, _stripEmoji(subject), body, {
        name: 'KWLT Show Support',
        cc: showEmail || undefined,
        noReply: false,
      });
      Logger.log('Readthrough notification email sent to ' + config.membershipEmail + (showEmail ? ' (CC: ' + showEmail + ')' : ''));
    } catch (e) {
      Logger.log('Failed to send readthrough notification email: ' + e.message);
    }
  } else {
    Logger.log('No Membership Email configured — skipping readthrough email notification.');
  }

  // ── Slack FYI to Show Support channel ─────────────────────────────────
  if (config.showSupportChannel) {
    const slackMsg = '📅 *Readthrough date set for ' + showName + '*: *' + dateStr + '*\n' +
      'The Show Support liaison is invited to attend — please RSVP with the production team.' +
      (showEmail ? ' (' + showEmail + ')' : '');
    sendSlack(config, slackMsg, config.showSupportChannel);
  }
}

// ─── Slack Response URL Helper ────────────────────────────────────────────────

/**
 * Posts a follow-up message to Slack via the response_url from an
 * interaction payload. This is the reliable way to give users feedback
 * after a block_actions interaction (datepicker, button, etc.).
 *
 * @param {string} responseUrl — the response_url from the Slack payload
 * @param {string} text — message text (Slack mrkdwn)
 * @param {boolean} ephemeral — if true, only the interacting user sees it
 */
function _sendSlackResponseUrl(responseUrl, text, ephemeral) {
  if (!responseUrl) {
    Logger.log('No response_url provided — cannot send feedback to Slack.');
    return;
  }

  try {
    UrlFetchApp.fetch(responseUrl, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        response_type: ephemeral ? 'ephemeral' : 'in_channel',
        replace_original: false,
        text: text,
      }),
      muteHttpExceptions: true,
    });
  } catch (e) {
    Logger.log('Failed to send Slack response_url message: ' + e.message);
  }
}

// ─── Token Generation ─────────────────────────────────────────────────────────

/**
 * Generates a simple verification token for a show+task combination.
 * Uses the spreadsheet ID as a secret salt.
 */
function _generateToken(showName, taskText) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const secret = ss.getId(); // Spreadsheet ID as the salt
  const raw = secret + '|' + showName + '|' + taskText;
  const digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);

  // Convert to hex string, take first 12 chars
  return digest.map(function(byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('').substring(0, 12);
}

/**
 * Builds a "Mark Done" URL for a specific task.
 * @param {string} webAppUrl — the deployed web app URL from Config
 * @param {string} showName — show name
 * @param {string} taskText — task description
 * @returns {string} — full URL with query parameters
 */
function buildMarkDoneUrl(webAppUrl, showName, taskText) {
  if (!webAppUrl) return '';

  const token = _generateToken(showName, taskText);
  return webAppUrl +
    '?action=done' +
    '&show=' + encodeURIComponent(showName) +
    '&task=' + encodeURIComponent(taskText) +
    '&token=' + token;
}

// ─── HTML Response Builder ────────────────────────────────────────────────────

function _htmlResponse(title, body, success) {
  const color = success ? '#059669' : '#dc2626';
  const bgColor = success ? '#d1fae5' : '#fee2e2';

  const html = '<!DOCTYPE html><html><head>' +
    '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + title + ' — KWLT</title>' +
    '<style>' +
    'body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; ' +
    'display: flex; justify-content: center; align-items: center; min-height: 100vh; ' +
    'margin: 0; background: #f9fafb; }' +
    '.card { background: white; border-radius: 12px; padding: 40px; max-width: 480px; ' +
    'box-shadow: 0 4px 6px rgba(0,0,0,0.07); text-align: center; }' +
    '.icon { font-size: 48px; margin-bottom: 16px; }' +
    'h1 { color: ' + color + '; margin: 0 0 16px 0; font-size: 24px; }' +
    'p { color: #374151; line-height: 1.6; margin: 0; }' +
    '.badge { display: inline-block; background: ' + bgColor + '; color: ' + color + '; ' +
    'padding: 4px 12px; border-radius: 20px; font-size: 13px; margin-top: 16px; }' +
    '</style></head><body><div class="card">' +
    '<div class="icon">' + (success ? '🎭' : '⚠️') + '</div>' +
    '<h1>' + title + '</h1>' +
    '<p>' + body + '</p>' +
    '<div class="badge">KWLT Production Automation</div>' +
    '</div></body></html>';

  return ContentService.createTextOutput(html)
    .setMimeType(ContentService.MimeType.HTML);
}

function _escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Show Setup onEdit Handler ────────────────────────────────────────────────

/**
 * Installable onEdit trigger handler. Detects when the Readthrough Date
 * column is changed in the Show Setup sheet (for an existing date — not
 * first entry) and fires notifications + recomputes dependent tasks.
 *
 * Installed via: Menu → Install Daily Trigger (also installs this).
 *
 * @param {Object} e — the edit event object
 */
function onShowSetupEdit(e) {
  if (!e || !e.range) return;

  const sheet = e.range.getSheet();
  if (sheet.getName() !== SHEET_SHOW_SETUP) return;

  const ss = sheet.getParent();
  const headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];

  // Find the Readthrough Date column
  const readthroughCol = headers.findIndex(function(h) {
    return String(h).indexOf(ANCHOR.READTHROUGH) === 0;
  });
  if (readthroughCol === -1) return;

  // Check if the edited cell is in the Readthrough Date column
  const editedCol = e.range.getColumn() - 1; // 0-based
  if (editedCol !== readthroughCol) return;

  // Only act on changes to an existing date (not first entry)
  const oldValue = e.oldValue;
  if (!oldValue) return; // First entry — the date picker flow handles notifications

  const newValue = e.range.getValue();
  if (!newValue) return; // Date was cleared — nothing to do

  // Parse the new date
  const newDate = newValue instanceof Date ? newValue : new Date(newValue);
  if (isNaN(newDate.getTime())) return;

  // Parse the old date for the notification message
  const oldDate = new Date(oldValue);
  const oldDateStr = !isNaN(oldDate.getTime())
    ? Utilities.formatDate(oldDate, Session.getScriptTimeZone(), 'yyyy-MM-dd')
    : oldValue;
  const newDateStr = Utilities.formatDate(newDate, Session.getScriptTimeZone(), 'yyyy-MM-dd');

  // If the date didn't actually change, skip
  if (oldDateStr === newDateStr) return;

  // Get the show name from column A of the edited row
  const editedRow = e.range.getRow();
  const showName = sheet.getRange(editedRow, 1).getValue();
  if (!showName) return;

  Logger.log('Readthrough date changed for "' + showName + '": ' + oldDateStr + ' → ' + newDateStr);

  // Recompute dependent task deadlines
  const reactivated = _reactivateReadthroughTasksForShow(ss, showName, newDate);

  // Send change notifications
  _notifyReadthroughDateChanged(ss, showName, oldDateStr, newDateStr);

  Logger.log('Readthrough date change processed for "' + showName + '". ' + reactivated + ' task(s) updated.');
}

/**
 * Sends notifications when a readthrough date is CHANGED (not first set):
 *   1. Email to Membership Director (CC: show email) about the date change
 *   2. Slack FYI to Show Support channel
 *   3. Slack notice to the show's own channel
 *
 * @param {SpreadsheetApp.Spreadsheet} ss
 * @param {string} showName
 * @param {string} oldDateStr — previous date (YYYY-MM-DD)
 * @param {string} newDateStr — new date (YYYY-MM-DD)
 */
function _notifyReadthroughDateChanged(ss, showName, oldDateStr, newDateStr) {
  const config = _loadConfig(ss);
  const showData = _getActiveShows(ss).find(function(s) { return s.name === showName; });
  const showEmail = showData ? showData.showEmail : '';

  // ── Email to Membership Director ──────────────────────────────────────
  if (config.membershipEmail) {
    const subject = '[KWLT] Readthrough Date Changed -- ' + showName;
    const body = 'Hello,\n\n' +
      'The readthrough date for ' + showName + ' has changed:\n\n' +
      '  Previous date: ' + oldDateStr + '\n' +
      '  New date: ' + newDateStr + '\n\n' +
      'Please update your RSVP with the production team' +
      (showEmail ? ' (' + showEmail + ')' : '') + '.\n\n' +
      '-- KWLT Show Support';

    try {
      GmailApp.sendEmail(config.membershipEmail, _stripEmoji(subject), body, {
        name: 'KWLT Show Support',
        cc: showEmail || undefined,
        noReply: false,
      });
      Logger.log('Readthrough date change email sent to ' + config.membershipEmail);
    } catch (e) {
      Logger.log('Failed to send readthrough date change email: ' + e.message);
    }
  }

  // ── Slack FYI to Show Support channel ─────────────────────────────────
  if (config.showSupportChannel) {
    sendSlack(config,
      '📅 *Readthrough date changed for ' + showName + '*\n' +
      '~' + oldDateStr + '~ → *' + newDateStr + '*\n' +
      'The Show Support liaison is invited to attend — please update your RSVP with the production team.' +
      (showEmail ? ' (' + showEmail + ')' : ''),
      config.showSupportChannel);
  }

  // ── Slack notice to the show's channel ────────────────────────────────
  if (showData && showData.slackChannel) {
    sendSlack(config,
      '📅 *Readthrough date updated for ' + showName + '*\n' +
      '~' + oldDateStr + '~ → *' + newDateStr + '*\n' +
      'Dependent task deadlines have been adjusted.',
      showData.slackChannel);
  }
}
