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
  if (action !== 'done' || !showName || !taskText || !token) {
    return _htmlResponse('❌ Invalid Request', 'This link appears to be malformed or expired.', false);
  }

  // Verify token
  const expectedToken = _generateToken(showName, taskText);
  if (token !== expectedToken) {
    return _htmlResponse('❌ Invalid Token', 'This link may have expired or been tampered with.', false);
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
            : '\nNo dependent tasks needed reactivation.';
          _sendSlackResponseUrl(payload.response_url,
            '✅ *Readthrough date for ' + showName + '* set to *' + selectedDate + '* by ' + userName + '.' + reactivatedMsg,
            false);
        } else {
          _sendSlackResponseUrl(payload.response_url,
            '⚠️ Could not set readthrough date: ' + result.message,
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
          _sendSlackResponseUrl(payload.response_url,
            '✅ *' + taskText + '* marked done by ' + userName,
            false);
        } else {
          _sendSlackResponseUrl(payload.response_url,
            '⚠️ Could not mark task done: ' + result.message,
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

      // Set the readthrough date
      sheet.getRange(i + 1, readthroughCol + 1).setValue(parsedDate);

      // Clear the "Readthrough Prompt Last Sent" column (prompt no longer needed)
      const promptCol = headers.indexOf('Readthrough Prompt Last Sent');
      if (promptCol !== -1) {
        sheet.getRange(i + 1, promptCol + 1).setValue('');
      }

      // Immediately reactivate skipped readthrough-dependent tasks
      const reactivated = _reactivateReadthroughTasksForShow(ss, showName, parsedDate);

      Logger.log('Readthrough date for "' + showName + '" set to ' + dateStr + ' via Slack date picker. Reactivated ' + reactivated + ' task(s).');
      return { success: true, message: 'Readthrough date set to ' + dateStr, reactivated: reactivated };
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
  let reactivated = 0;

  for (let row = 1; row < data.length; row++) {
    const status = data[row][COL.STATUS];
    const notes = String(data[row][COL.NOTES] || '');
    const anchorRef = data[row][COL.ANCHOR_REF];

    // Only reactivate tasks that were skipped because readthrough was missing
    if (status !== STATUS.SKIPPED ||
        notes.indexOf('Skipped') === -1 ||
        notes.indexOf(ANCHOR.READTHROUGH) === -1 ||
        anchorRef !== ANCHOR.READTHROUGH) {
      continue;
    }

    // Recompute the deadline
    const offsetDays = Number(data[row][COL.OFFSET_DAYS]) || 0;
    const newDate = new Date(readthroughDate);
    newDate.setDate(newDate.getDate() + offsetDays);

    // Restore the task's original notifyVia (it was set to 'none' when skipped)
    const taskName = data[row][COL.TASK];
    const originalNotifyVia = _lookupOriginalNotifyVia(taskName) || 'both';

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

    if (action) {
      // Find show details for building the reminder context
      const showData = _getActiveShows(ss).find(function(s) { return s.name === showName; });
      if (showData) {
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
        };

        const success = _executeAction(action, context, config);
        if (success) {
          const isAutoComplete = _isAutoCompleteTask(taskName);
          const newStatus = isAutoComplete ? STATUS.DONE : _statusAfterAction(action);
          sheet.getRange(row + 1, COL.STATUS + 1).setValue(newStatus);
          sheet.getRange(row + 1, COL.LAST_NOTIFIED + 1).setValue(new Date());
          if (isAutoComplete) {
            sheet.getRange(row + 1, COL.NOTES + 1).setValue('Auto-completed after sending (reactivated)');
          }
        }
      }
    }
  }

  return reactivated;
}

/**
 * Looks up the original notifyVia value for a task from the template data.
 */
function _lookupOriginalNotifyVia(taskName) {
  const tasks = getTaskTemplateData();
  for (const t of tasks) {
    if (t.task === taskName || taskName.indexOf(t.task) !== -1) {
      return t.notifyVia;
    }
  }
  return null;
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
