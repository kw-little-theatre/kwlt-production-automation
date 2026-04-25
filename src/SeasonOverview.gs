/**
 * KWLT Production Automation — Season Overview & Triggers
 *
 * Aggregates upcoming deadlines across all active shows into a single
 * sorted view, and manages the daily trigger installation.
 */

// ─── Season Overview ──────────────────────────────────────────────────────────

/**
 * Rebuilds the Season Overview sheet by reading all active show tabs
 * and collecting upcoming/overdue tasks into a single sorted view.
 */
function refreshSeasonOverview() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_SEASON_OVERVIEW);
  if (!sheet) {
    SpreadsheetApp.getUi().alert('Error', 'Season Overview sheet not found. Run Initial Setup first.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  const today = _stripTime(new Date());
  const activeShows = _getActiveShows(ss);
  const allTasks = [];

  for (const show of activeShows) {
    const tabName = SHOW_TAB_PREFIX + show.name;
    const showSheet = ss.getSheetByName(tabName);
    if (!showSheet) continue;

    const data = showSheet.getDataRange().getValues();
    for (let row = 1; row < data.length; row++) {
      const status = data[row][COL.STATUS];
      if (status === STATUS.DONE || status === STATUS.SKIPPED) continue;

      const deadline = _stripTime(data[row][COL.COMPUTED_DATE]);
      if (!deadline || !(deadline instanceof Date) || isNaN(deadline.getTime())) continue;

      const daysUntil = _daysBetween(today, deadline);

      // Show tasks within the next 30 days, or any overdue
      if (daysUntil <= 30) {
        allTasks.push([
          show.name,
          show.productionType || PRODUCTION_TYPE.MAINSTAGE,
          data[row][COL.TASK],
          data[row][COL.RESPONSIBLE],
          deadline,
          status,
          daysUntil,
          data[row][COL.GENERAL_RULE] || '',  // Use general rule as phase info
        ]);
      }
    }
  }

  // Sort: overdue first (most negative), then by deadline
  allTasks.sort((a, b) => a[6] - b[6]);

  // Clear existing data (keep header)
  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 8).clear();
  }

  if (allTasks.length === 0) {
    sheet.getRange(2, 1).setValue('No upcoming tasks in the next 30 days. All clear! 🎉');
    sheet.getRange(2, 1).setFontStyle('italic').setFontColor('#059669');
    SpreadsheetApp.getUi().alert('✅ Updated', 'No upcoming tasks in the next 30 days.', SpreadsheetApp.getUi().ButtonSet.OK);
    return;
  }

  // Write data
  sheet.getRange(2, 1, allTasks.length, 8).setValues(allTasks);

  // Format
  sheet.getRange(2, 5, allTasks.length, 1).setNumberFormat('yyyy-mm-dd');

  // Conditional formatting on "Days Until/Since" column (col 7)
  const daysRange = sheet.getRange(2, 7, allTasks.length, 1);

  const overdueFormat = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberLessThan(0)
    .setBackground('#fee2e2')
    .setFontColor('#991b1b')
    .setRanges([daysRange])
    .build();

  const todayFormat = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberEqualTo(0)
    .setBackground('#fef3c7')
    .setFontColor('#92400e')
    .setRanges([daysRange])
    .build();

  const soonFormat = SpreadsheetApp.newConditionalFormatRule()
    .whenNumberBetween(1, 3)
    .setBackground('#ffedd5')
    .setFontColor('#9a3412')
    .setRanges([daysRange])
    .build();

  const rules = sheet.getConditionalFormatRules();
  // Remove old rules for this range
  const newRules = rules.filter(r => {
    const ranges = r.getRanges();
    return !ranges.some(rng => rng.getColumn() === 7);
  });
  newRules.push(overdueFormat, todayFormat, soonFormat);
  sheet.setConditionalFormatRules(newRules);

  // Add summary note
  const overdue = allTasks.filter(t => t[6] < 0).length;
  const dueThisWeek = allTasks.filter(t => t[6] >= 0 && t[6] <= 7).length;

  SpreadsheetApp.getUi().alert(
    '📅 Season Overview Updated',
    'Showing ' + allTasks.length + ' upcoming tasks across ' + activeShows.length + ' active shows.\n\n' +
    '🚨 Overdue: ' + overdue + '\n' +
    '⚠️ Due this week: ' + dueThisWeek,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Silent version of refreshSeasonOverview for use in the daily trigger.
 * Same logic, no UI alerts.
 */
function _refreshSeasonOverviewSilent(ss) {
  const sheet = ss.getSheetByName(SHEET_SEASON_OVERVIEW);
  if (!sheet) return;

  const today = _stripTime(new Date());
  const activeShows = _getActiveShows(ss);
  const allTasks = [];

  for (const show of activeShows) {
    const tabName = SHOW_TAB_PREFIX + show.name;
    const showSheet = ss.getSheetByName(tabName);
    if (!showSheet) continue;

    const data = showSheet.getDataRange().getValues();
    for (let row = 1; row < data.length; row++) {
      const status = data[row][COL.STATUS];
      if (status === STATUS.DONE || status === STATUS.SKIPPED) continue;

      const deadline = _stripTime(data[row][COL.COMPUTED_DATE]);
      if (!deadline || !(deadline instanceof Date) || isNaN(deadline.getTime())) continue;

      const daysUntil = _daysBetween(today, deadline);

      if (daysUntil <= 30) {
        allTasks.push([
          show.name,
          show.productionType || PRODUCTION_TYPE.MAINSTAGE,
          data[row][COL.TASK],
          data[row][COL.RESPONSIBLE],
          deadline,
          status,
          daysUntil,
          data[row][COL.GENERAL_RULE] || '',
        ]);
      }
    }
  }

  allTasks.sort((a, b) => a[6] - b[6]);

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 8).clear();
  }

  if (allTasks.length === 0) {
    sheet.getRange(2, 1).setValue('No upcoming tasks in the next 30 days. All clear! 🎉');
    sheet.getRange(2, 1).setFontStyle('italic').setFontColor('#059669');
    return;
  }

  sheet.getRange(2, 1, allTasks.length, 8).setValues(allTasks);
  sheet.getRange(2, 5, allTasks.length, 1).setNumberFormat('yyyy-mm-dd');

  Logger.log('Season Overview refreshed: ' + allTasks.length + ' tasks across ' + activeShows.length + ' shows.');
}

// ─── Trigger Management ───────────────────────────────────────────────────────

/**
 * Installs a daily time-driven trigger that runs runDailyReminders()
 * at the configured hour (default: 9 AM).
 */
function installDailyTrigger() {
  // Remove any existing triggers first to prevent duplicates
  const existing = ScriptApp.getProjectTriggers();
  for (const trigger of existing) {
    if (trigger.getHandlerFunction() === 'runDailyReminders' ||
        trigger.getHandlerFunction() === 'onShowSetupEdit') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  ScriptApp.newTrigger('runDailyReminders')
    .timeBased()
    .everyDays(1)
    .atHour(TRIGGER_HOUR)
    .create();

  // Installable onEdit trigger for Show Setup date changes
  // (simple onEdit can't call UrlFetchApp/GmailApp)
  ScriptApp.newTrigger('onShowSetupEdit')
    .forSpreadsheet(SpreadsheetApp.getActiveSpreadsheet())
    .onEdit()
    .create();

  SpreadsheetApp.getUi().alert(
    '⏰ Triggers Installed',
    'Daily reminders will run at approximately ' + TRIGGER_HOUR + ':00 each day.\n' +
    'Show Setup date changes will be detected automatically.\n\n' +
    'You can test reminders now: Menu → 🎭 KWLT Automation → Run Reminders Now.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * Removes all triggers associated with this script.
 */
function removeAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }

  SpreadsheetApp.getUi().alert(
    '🛑 Triggers Removed',
    'All ' + triggers.length + ' trigger(s) have been removed.\n\n' +
    'Automated reminders will no longer run until you re-install the trigger.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
