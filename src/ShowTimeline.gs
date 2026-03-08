/**
 * KWLT Production Automation — Show Timeline Builder
 *
 * Creates per-show timeline tabs by combining task templates with
 * anchor dates from the Show Setup sheet. Handles date computation,
 * recurring tasks, and conditional formatting.
 */

// ─── Create Show Dialog ───────────────────────────────────────────────────────

function showCreateShowDialog() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const setupSheet = ss.getSheetByName(SHEET_SHOW_SETUP);
  if (!setupSheet) {
    ui.alert('Error', 'Please run Initial Setup first.', ui.ButtonSet.OK);
    return;
  }

  const data = setupSheet.getDataRange().getValues();
  const shows = [];
  for (let i = 1; i < data.length; i++) {
    const showName = data[i][0];
    const timelineCreated = data[i][data[0].indexOf('Timeline Created?')];
    if (showName && !timelineCreated) {
      shows.push(showName);
    }
  }

  if (shows.length === 0) {
    ui.alert(
      'No Shows Available',
      'Either all shows already have timelines, or no shows have been entered in the 🎭 Show Setup sheet.\n\n' +
      'Add a new row in Show Setup with dates, then try again.',
      ui.ButtonSet.OK
    );
    return;
  }

  // Confirm before creating
  const showList = shows.map(function(s, i) { return '• ' + s; }).join('\n');
  const confirm = ui.alert(
    'Create Timelines',
    'This will create timeline tabs for ' + shows.length + ' show(s):\n\n' + showList + '\n\nProceed?',
    ui.ButtonSet.YES_NO
  );

  if (confirm !== ui.Button.YES) return;

  const results = [];
  for (const showName of shows) {
    try {
      createShowTimeline(showName);
      results.push('✅ ' + showName);
    } catch (e) {
      results.push('❌ ' + showName + ': ' + e.message);
    }
  }

  ui.alert('Done', results.join('\n'), ui.ButtonSet.OK);
}

// ─── Create Show Timeline ─────────────────────────────────────────────────────

/**
 * Main entry point for creating a show's timeline tab.
 * @param {string} showName — the name from the Show Setup sheet.
 */
function createShowTimeline(showName) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tabName = SHOW_TAB_PREFIX + showName;

  // Don't duplicate
  if (ss.getSheetByName(tabName)) {
    return 'Tab "' + tabName + '" already exists.';
  }

  // Get anchor dates for this show
  const anchors = _getAnchorDates(ss, showName);
  if (!anchors) {
    throw new Error('Could not find show "' + showName + '" in Show Setup, or dates are missing. Please fill in the anchor dates and try again.');
  }

  // Check we have the minimum required anchors (4 dates)
  // Other dates are either auto-derived or optional.
  const keyAnchors = [ANCHOR.AUDITION_START, ANCHOR.BUILD_POSSESSION, ANCHOR.OPENING_NIGHT, ANCHOR.CLOSING_NIGHT];
  const missing = keyAnchors.filter(a => !anchors[a]);
  if (missing.length > 0) {
    throw new Error('Missing required dates: ' + missing.join(', ') + '. Please fill these in on the Show Setup sheet.\n\nNote: Audition End and Tech Weekend Start/End are auto-computed if left blank. Readthrough is optional.');
  }

  // Create the sheet
  const sheet = ss.insertSheet(tabName);
  sheet.setTabColor('#059669');

  // Headers
  const headers = [
    'Task', 'Responsible', 'Timing Rule', 'Anchor Reference',
    'Offset (days)', 'Computed Deadline', 'Status', 'Notify Via',
    'Last Notified', 'Notes',
  ];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d1fae5');
  sheet.setFrozenRows(1);

  // Build task rows
  const tasks = getTaskTemplateData();
  const rows = [];

  for (const task of tasks) {
    if (task.recurring) {
      // Check if the anchor exists before expanding
      if (!anchors[task.anchorRef]) {
        rows.push([
          task.task + ' (weekly)',
          task.responsible,
          task.generalRule,
          task.anchorRef,
          task.offsetDays,
          '',
          STATUS.SKIPPED,
          'none',
          '',
          'Skipped — ' + task.anchorRef + ' date not set',
        ]);
      } else {
        const weeklyRows = _expandRecurringTask(task, anchors);
        rows.push(...weeklyRows);
      }
    } else {
      const computedDate = _computeDate(anchors, task.anchorRef, task.offsetDays);
      // If anchor is missing, skip the task gracefully
      if (computedDate === '') {
        rows.push([
          task.task,
          task.responsible,
          task.generalRule,
          task.anchorRef,
          task.offsetDays,
          '',
          STATUS.SKIPPED,
          'none',
          '',
          'Skipped — ' + task.anchorRef + ' date not set',
        ]);
      } else {
        rows.push([
          task.task,
          task.responsible,
          task.generalRule,
          task.anchorRef,
          task.offsetDays,
          computedDate,
          STATUS.PENDING,
          task.notifyVia,
          '',
          '',
        ]);
      }
    }
  }

  // Sort by computed date
  rows.sort((a, b) => {
    const dateA = a[COL.COMPUTED_DATE];
    const dateB = b[COL.COMPUTED_DATE];
    if (!dateA) return 1;
    if (!dateB) return -1;
    return new Date(dateA) - new Date(dateB);
  });

  // Write rows
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, SHOW_TIMELINE_COLS).setValues(rows);
  }

  // Format date column
  sheet.getRange(2, COL.COMPUTED_DATE + 1, rows.length, 1).setNumberFormat('yyyy-mm-dd');

  // Status dropdown validation
  const statusRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(Object.values(STATUS))
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, COL.STATUS + 1, rows.length, 1).setDataValidation(statusRule);

  // Notify Via dropdown
  const notifyRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(['slack', 'email', 'both', 'none'])
    .setAllowInvalid(false)
    .build();
  sheet.getRange(2, COL.NOTIFY_VIA + 1, rows.length, 1).setDataValidation(notifyRule);

  // Column widths
  sheet.setColumnWidth(1, 450);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 250);
  sheet.setColumnWidth(4, 180);
  sheet.setColumnWidth(5, 90);
  sheet.setColumnWidth(6, 130);
  sheet.setColumnWidth(7, 190);
  sheet.setColumnWidth(8, 90);
  sheet.setColumnWidth(9, 150);
  sheet.setColumnWidth(10, 250);

  // Apply conditional formatting
  _applyTimelineConditionalFormatting(sheet, rows.length);

  // Mark as created in Show Setup
  _markTimelineCreated(ss, showName);

  return '✅ Timeline for "' + showName + '" created with ' + rows.length + ' tasks. Review dates in the "' + tabName + '" tab, then set Active? = TRUE.';
}

// ─── Anchor Date Retrieval ────────────────────────────────────────────────────

/**
 * Reads anchor dates for a show from the Show Setup sheet.
 * Returns a map of { anchorLabel: Date } or null if not found.
 */
function _getAnchorDates(ss, showName) {
  const sheet = ss.getSheetByName(SHEET_SHOW_SETUP);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];

  let showRow = null;
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === showName) {
      showRow = data[i];
      break;
    }
  }
  if (!showRow) return null;

  const anchors = {};
  for (const key of Object.values(ANCHOR)) {
    // Headers may have suffixes like " *", " (auto)", " (opt)" — match by startsWith
    const colIdx = headers.findIndex(function(h) {
      return String(h).indexOf(key) === 0;
    });
    if (colIdx === -1) continue;
    const val = showRow[colIdx];
    if (val instanceof Date) {
      anchors[key] = val;
    } else if (val) {
      const parsed = new Date(val);
      if (!isNaN(parsed)) anchors[key] = parsed;
    }
  }

  // ── Auto-derive missing dates from the ones we have ──────────────────

  // Audition End = Audition Start + 2 days (3-day audition weekend)
  if (!anchors[ANCHOR.AUDITION_END] && anchors[ANCHOR.AUDITION_START]) {
    const d = new Date(anchors[ANCHOR.AUDITION_START]);
    d.setDate(d.getDate() + 2);
    anchors[ANCHOR.AUDITION_END] = d;
  }

  // Tech Weekend Start = Opening Night - 6 days (always the Saturday before Friday opening)
  if (!anchors[ANCHOR.TECH_WEEKEND_START] && anchors[ANCHOR.OPENING_NIGHT]) {
    const d = new Date(anchors[ANCHOR.OPENING_NIGHT]);
    d.setDate(d.getDate() - 6);
    anchors[ANCHOR.TECH_WEEKEND_START] = d;
  }

  // Tech Weekend End = Tech Weekend Start + 1 day
  if (!anchors[ANCHOR.TECH_WEEKEND_END] && anchors[ANCHOR.TECH_WEEKEND_START]) {
    const d = new Date(anchors[ANCHOR.TECH_WEEKEND_START]);
    d.setDate(d.getDate() + 1);
    anchors[ANCHOR.TECH_WEEKEND_END] = d;
  }

  return anchors;
}

// ─── Date Computation ─────────────────────────────────────────────────────────

/**
 * Computes a deadline date from an anchor + offset.
 * @param {Object} anchors — map of anchor label → Date
 * @param {string} anchorRef — which anchor to use
 * @param {number} offsetDays — days to add (negative = before)
 * @returns {Date|string} — the computed date, or '' if anchor not found
 */
function _computeDate(anchors, anchorRef, offsetDays) {
  const base = anchors[anchorRef];
  if (!base) return '';
  const d = new Date(base);
  d.setDate(d.getDate() + offsetDays);
  return d;
}

// ─── Recurring Task Expansion ─────────────────────────────────────────────────

/**
 * Expands a recurring task into weekly rows between its start and end anchors.
 */
function _expandRecurringTask(task, anchors) {
  const startDate = _computeDate(anchors, task.anchorRef, task.offsetDays);
  const endAnchor = task.recurringEndAnchor || task.anchorRef;
  const endOffset = task.recurringEndOffset || 0;
  const endDate = _computeDate(anchors, endAnchor, endOffset);

  if (!startDate || !endDate || !(startDate instanceof Date) || !(endDate instanceof Date)) {
    // Can't compute range — add a single placeholder row
    return [[
      task.task + ' (weekly)',
      task.responsible,
      task.generalRule,
      task.anchorRef,
      task.offsetDays,
      startDate || '',
      STATUS.PENDING,
      task.notifyVia,
      '',
      'Recurring — could not compute full range',
    ]];
  }

  const rows = [];
  const current = new Date(startDate);
  let weekNum = 1;

  while (current <= endDate) {
    rows.push([
      task.task + ' (week ' + weekNum + ')',
      task.responsible,
      task.generalRule,
      task.anchorRef,
      task.offsetDays + ((weekNum - 1) * 7),
      new Date(current),
      STATUS.PENDING,
      task.notifyVia,
      '',
      'Recurring weekly',
    ]);
    current.setDate(current.getDate() + 7);
    weekNum++;
  }

  return rows;
}

// ─── Conditional Formatting ───────────────────────────────────────────────────

function _applyTimelineConditionalFormatting(sheet, numRows) {
  if (numRows === 0) return;

  const statusRange = sheet.getRange(2, COL.STATUS + 1, numRows, 1);

  // Done = green
  const doneRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(STATUS.DONE)
    .setBackground('#d1fae5')
    .setRanges([statusRange])
    .build();

  // Overdue = red
  const overdueRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(STATUS.OVERDUE)
    .setBackground('#fee2e2')
    .setFontColor('#991b1b')
    .setRanges([statusRange])
    .build();

  // Urgent sent = orange
  const urgentRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(STATUS.URGENT_SENT)
    .setBackground('#ffedd5')
    .setFontColor('#9a3412')
    .setRanges([statusRange])
    .build();

  // Advance sent = yellow
  const advanceRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(STATUS.ADVANCE_SENT)
    .setBackground('#fef9c3')
    .setRanges([statusRange])
    .build();

  // Skipped = gray
  const skippedRule = SpreadsheetApp.newConditionalFormatRule()
    .whenTextEqualTo(STATUS.SKIPPED)
    .setBackground('#f3f4f6')
    .setFontColor('#9ca3af')
    .setRanges([statusRange])
    .build();

  const rules = sheet.getConditionalFormatRules();
  rules.push(doneRule, overdueRule, urgentRule, advanceRule, skippedRule);
  sheet.setConditionalFormatRules(rules);
}

// ─── Mark Timeline Created ────────────────────────────────────────────────────

function _markTimelineCreated(ss, showName) {
  const sheet = ss.getSheetByName(SHEET_SHOW_SETUP);
  const data = sheet.getDataRange().getValues();
  const headers = data[0];
  const createdCol = headers.indexOf('Timeline Created?');
  const activeCol = headers.indexOf('Active?');

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === showName) {
      if (createdCol !== -1) sheet.getRange(i + 1, createdCol + 1).setValue('TRUE');
      if (activeCol !== -1) sheet.getRange(i + 1, activeCol + 1).setValue('FALSE'); // user activates manually
      break;
    }
  }
}
