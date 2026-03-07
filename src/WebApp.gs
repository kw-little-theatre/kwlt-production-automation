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

      if (actionId && actionId.startsWith('mark_done:')) {
        // action_id format: "mark_done:ShowName:TaskText"
        const parts = actionId.substring('mark_done:'.length);
        const separatorIdx = parts.indexOf(':');
        const showName = decodeURIComponent(parts.substring(0, separatorIdx));
        const taskText = decodeURIComponent(parts.substring(separatorIdx + 1));

        const result = _markTaskDone(showName, taskText);
        const userName = payload.user ? payload.user.name : 'Someone';

        if (result.success) {
          // Respond with an updated message
          return ContentService
            .createTextOutput(JSON.stringify({
              response_type: 'in_channel',
              replace_original: false,
              text: '✅ *' + taskText + '* marked done by ' + userName + ' at ' + new Date().toLocaleString(),
            }))
            .setMimeType(ContentService.MimeType.JSON);
        } else {
          return ContentService
            .createTextOutput(JSON.stringify({
              response_type: 'ephemeral',
              text: '⚠️ Could not mark task done: ' + result.message,
            }))
            .setMimeType(ContentService.MimeType.JSON);
        }
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
