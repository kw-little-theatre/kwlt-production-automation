/**
 * KWLT Production Automation — Sheet Setup & Initialization
 *
 * Creates all required sheets in a new spreadsheet and populates them
 * with headers, formatting, and default data. Run once via the custom menu
 * or manually from the Script Editor.
 */

// ─── Custom Menu ──────────────────────────────────────────────────────────────

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🎭 KWLT Automation')
    .addItem('➕ Create New Show', 'showCreateShowDialog')
    .addItem('🔄 Refresh Season Overview', 'refreshSeasonOverview')
    .addSeparator()
    .addItem('▶️ Run Reminders Now (test)', 'runDailyReminders')
    .addItem('🧪 Test All Message Types', 'testAllMessageTypes')
    .addItem('⏰ Install Daily Trigger', 'installDailyTrigger')
    .addItem('🛑 Remove All Triggers', 'removeAllTriggers')
    .addSeparator()
    .addItem('🏗️ Initial Setup (run once)', 'initialSetup')
    .addToUi();
}

// ─── Initial Setup ────────────────────────────────────────────────────────────

/**
 * Creates all structural sheets. Safe to run multiple times — it skips sheets
 * that already exist.
 */
function initialSetup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();

  _createConfigSheet(ss);
  _createShowSetupSheet(ss);
  _createTaskTemplateSheet(ss);
  _createMessageTemplatesSheet(ss);
  _createSeasonOverviewSheet(ss);
  _createSendLogSheet(ss);
  _createReadmeSheet(ss);

  // Delete the default "Sheet1" if it exists and is empty
  const sheet1 = ss.getSheetByName('Sheet1');
  if (sheet1 && sheet1.getLastRow() === 0) {
    ss.deleteSheet(sheet1);
  }

  ui.alert(
    '✅ Setup Complete',
    'All sheets have been created.\n\n' +
    'Next steps:\n' +
    '1. Fill in your Slack webhook URL in the ⚙️ Config sheet\n' +
    '2. Add show details in the 🎭 Show Setup sheet\n' +
    '3. Use the menu: KWLT Automation → Create New Show\n' +
    '4. Install the daily trigger via the menu',
    ui.ButtonSet.OK
  );
}

// ─── Config Sheet ─────────────────────────────────────────────────────────────

function _createConfigSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_CONFIG);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_CONFIG);
  sheet.setTabColor('#6d28d9');

  const data = [
    ['Setting', 'Value', 'Description'],
    ['Slack Webhook URL', '', 'Incoming webhook URL for the #show-reminders channel (or per-show channel)'],
    ['Escalation Email', '', 'Email address for overdue task escalations (e.g., executive-producer@kwlt.org)'],
    ['Show Support Email', '', 'Show Support Committee member\'s email (receives daily digest)'],
    ['Advance Reminder Days', REMINDER_ADVANCE_DAYS, 'Days before deadline for the first "heads up" reminder'],
    ['Urgent Reminder Days', REMINDER_URGENT_DAYS, 'Days before deadline for the urgent reminder'],
    ['Overdue Escalation Days', OVERDUE_ESCALATION_DAYS, 'Days past deadline before escalation email is sent'],
    ['Send Email Reminders', 'TRUE', 'Set to FALSE to disable email reminders (Slack only)'],
    ['Send Slack Reminders', 'TRUE', 'Set to FALSE to disable Slack reminders (email only)'],
    ['Handbook URL', '', 'Link to the KWLT Production Handbook (included in reminder messages)'],
    ['Web App URL', '', 'Deployed web app URL for "Mark Done" links (Deploy → New deployment → Web app)'],
    ['Slack Interactivity URL', '', 'Same as Web App URL — paste into Slack app Interactivity settings for button callbacks'],
  ];

  sheet.getRange(1, 1, data.length, 3).setValues(data);
  sheet.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#ede9fe');
  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 400);
  sheet.setColumnWidth(3, 500);
  sheet.setFrozenRows(1);

  return sheet;
}

// ─── Show Setup Sheet ─────────────────────────────────────────────────────────

function _createShowSetupSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_SHOW_SETUP);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_SHOW_SETUP);
  sheet.setTabColor('#059669');

  const headers = [
    'Show Name',
    'Slack Channel',
    // Anchor dates
    ANCHOR.SEASON_ANNOUNCEMENT,
    ANCHOR.ORIENTATION,
    ANCHOR.AUDITION_START,
    ANCHOR.AUDITION_END,
    ANCHOR.READTHROUGH,
    ANCHOR.BUILD_POSSESSION,
    ANCHOR.TECH_WEEKEND_START,
    ANCHOR.TECH_WEEKEND_END,
    ANCHOR.OPENING_NIGHT,
    ANCHOR.CLOSING_NIGHT,
    // Production team contacts
    'Director Name',
    'Director Email',
    'Stage Manager Name',
    'Stage Manager Email',
    'Technical Director Name',
    'Technical Director Email',
    'Producer Name',
    'Producer Email',
    'Music Director Name',
    'Music Director Email',
    // Status
    'Timeline Created?',
    'Active?',
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d1fae5');
  sheet.setFrozenRows(1);

  // Format date columns
  for (let i = 3; i <= 12; i++) {
    sheet.setColumnWidth(i, 130);
  }
  sheet.setColumnWidth(1, 200); // Show Name
  sheet.setColumnWidth(2, 180); // Slack Channel

  // Add data validation for date columns
  const dateRule = SpreadsheetApp.newDataValidation()
    .requireDate()
    .setAllowInvalid(false)
    .setHelpText('Enter a date (YYYY-MM-DD)')
    .build();

  // Apply to rows 2-20 (plenty of room for shows)
  for (let col = 3; col <= 12; col++) {
    sheet.getRange(2, col, 19, 1).setDataValidation(dateRule);
    sheet.getRange(2, col, 19, 1).setNumberFormat('yyyy-mm-dd');
  }

  return sheet;
}

// ─── Task Template Sheet ──────────────────────────────────────────────────────

function _createTaskTemplateSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_TASK_TEMPLATE);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_TASK_TEMPLATE);
  sheet.setTabColor('#d97706');

  const headers = [
    'Task', 'Responsible Party', 'General Rule', 'Anchor Reference',
    'Offset (days)', 'Notify Via', 'Recurring?', 'Phase',
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#fef3c7');
  sheet.setFrozenRows(1);

  // Populate from template data
  const tasks = getTaskTemplateData();
  const rows = tasks.map(t => [
    t.task,
    t.responsible,
    t.generalRule,
    t.anchorRef,
    t.offsetDays,
    t.notifyVia,
    t.recurring ? 'Yes' : 'No',
    t.phase,
  ]);

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  }

  sheet.setColumnWidth(1, 450);
  sheet.setColumnWidth(2, 200);
  sheet.setColumnWidth(3, 250);
  sheet.setColumnWidth(4, 180);

  return sheet;
}

// ─── Message Templates Sheet ──────────────────────────────────────────────────

function _createMessageTemplatesSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_MSG_TEMPLATES);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_MSG_TEMPLATES);
  sheet.setTabColor('#2563eb');

  const headers = ['Template Name', 'Channel', 'Subject / Header', 'Body'];

  const templates = [
    [
      'Advance Reminder',
      'slack',
      '📋 Upcoming deadline for {{SHOW_NAME}}',
      '👋 Hey {{RESPONSIBLE_PARTY}},\n\nFriendly reminder: *{{TASK}}* is due in {{DAYS_UNTIL}} days ({{DEADLINE}}).\n\n📌 Timing: {{GENERAL_RULE}}\n📖 Handbook: {{HANDBOOK_URL}}\n\n✅ Done? Click here to mark it complete: {{MARK_DONE_URL}}\n\nQuestions? Post in {{SLACK_CHANNEL}} or reach out to your Show Support rep.',
    ],
    [
      'Urgent Reminder',
      'slack',
      '🚨 Tomorrow\'s deadline for {{SHOW_NAME}}',
      '🚨 *Urgent — {{SHOW_NAME}}*\n\n{{RESPONSIBLE_PARTY}}, *{{TASK}}* is due *tomorrow* ({{DEADLINE}}).\n\n📌 {{GENERAL_RULE}}\n\n✅ Done? Click here to mark it complete: {{MARK_DONE_URL}}\n\nPlease complete this or let your Show Support rep know if you need help.',
    ],
    [
      'Overdue Escalation',
      'email',
      '[KWLT] ⚠️ Overdue task for {{SHOW_NAME}}',
      'Hi,\n\nThe following task for {{SHOW_NAME}} is now {{DAYS_OVERDUE}} days overdue:\n\n• Task: {{TASK}}\n• Responsible: {{RESPONSIBLE_PARTY}}\n• Original Deadline: {{DEADLINE}}\n• Timing Rule: {{GENERAL_RULE}}\n\nPlease follow up with the production team.\n\n— KWLT Show Support Automation',
    ],
    [
      'Advance Reminder (Email)',
      'email',
      '[KWLT] Upcoming deadline: {{TASK}} — {{SHOW_NAME}}',
      'Hi {{RESPONSIBLE_PARTY}},\n\nThis is a reminder that the following task for {{SHOW_NAME}} is due in {{DAYS_UNTIL}} days:\n\n• Task: {{TASK}}\n• Deadline: {{DEADLINE}}\n• Timing: {{GENERAL_RULE}}\n\nHandbook: {{HANDBOOK_URL}}\n\n✅ Done? Mark this task complete:\n{{MARK_DONE_URL}}\n\nIf you have questions, please reach out to your Show Support Committee representative.\n\n— KWLT Show Support Automation',
    ],
    [
      'Urgent Reminder (Email)',
      'email',
      '[KWLT] 🚨 Due TOMORROW: {{TASK}} — {{SHOW_NAME}}',
      'Hi {{RESPONSIBLE_PARTY}},\n\nThis is an urgent reminder that the following task for {{SHOW_NAME}} is due TOMORROW:\n\n• Task: {{TASK}}\n• Deadline: {{DEADLINE}}\n• Timing: {{GENERAL_RULE}}\n\n✅ Done? Mark this task complete:\n{{MARK_DONE_URL}}\n\nPlease complete this task or reach out to your Show Support Committee representative if you need assistance.\n\n— KWLT Show Support Automation',
    ],
    [
      'Daily Digest',
      'email',
      '[KWLT] Daily Show Support Digest — {{DATE}}',
      'Hi Show Support,\n\nHere\'s your daily digest across all active shows:\n\n{{DIGEST_CONTENT}}\n\n— KWLT Show Support Automation',
    ],
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#dbeafe');
  sheet.getRange(2, 1, templates.length, headers.length).setValues(templates);
  sheet.setFrozenRows(1);

  sheet.setColumnWidth(1, 200);
  sheet.setColumnWidth(2, 80);
  sheet.setColumnWidth(3, 350);
  sheet.setColumnWidth(4, 600);

  // Wrap text in body column
  sheet.getRange(2, 4, templates.length, 1).setWrap(true);

  return sheet;
}

// ─── Season Overview Sheet ────────────────────────────────────────────────────

function _createSeasonOverviewSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_SEASON_OVERVIEW);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_SEASON_OVERVIEW);
  sheet.setTabColor('#dc2626');

  const headers = [
    'Show', 'Task', 'Responsible', 'Deadline', 'Status',
    'Days Until/Since', 'Phase',
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#fee2e2');
  sheet.setFrozenRows(1);

  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 400);
  sheet.setColumnWidth(3, 200);
  sheet.setColumnWidth(4, 120);
  sheet.setColumnWidth(5, 180);
  sheet.setColumnWidth(6, 120);
  sheet.setColumnWidth(7, 130);

  // Add note at top
  sheet.getRange(2, 1).setValue('Run "Refresh Season Overview" from the 🎭 KWLT Automation menu to populate this sheet.');
  sheet.getRange(2, 1).setFontStyle('italic').setFontColor('#9ca3af');

  return sheet;
}

// ─── Send Log Sheet ───────────────────────────────────────────────────────────

function _createSendLogSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_SEND_LOG);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_SEND_LOG);
  sheet.setTabColor('#6b7280');

  const headers = [
    'Timestamp', 'Show', 'Task', 'Responsible', 'Channel',
    'Reminder Type', 'Status', 'Error (if any)',
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#f3f4f6');
  sheet.setFrozenRows(1);

  sheet.setColumnWidth(1, 170);
  sheet.setColumnWidth(2, 150);
  sheet.setColumnWidth(3, 350);
  sheet.setColumnWidth(4, 150);
  sheet.setColumnWidth(7, 120);
  sheet.setColumnWidth(8, 300);

  return sheet;
}

// ─── README Sheet ─────────────────────────────────────────────────────────────

function _createReadmeSheet(ss) {
  let sheet = ss.getSheetByName(SHEET_README);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_README);
  sheet.setTabColor('#111827');

  const readme = [
    ['🎭 KWLT Production Automation — Quick Start Guide'],
    [''],
    ['HOW IT WORKS'],
    ['This spreadsheet automatically sends Slack messages and/or emails to your production teams'],
    ['reminding them of upcoming deadlines from the KWLT Runbook. A script runs daily at 9 AM,'],
    ['checks each active show\'s timeline against today\'s date, and fires reminders.'],
    [''],
    ['SETUP (one-time)'],
    ['1. Go to ⚙️ Config and enter your Slack Webhook URL and email addresses.'],
    ['2. Install the daily trigger: Menu → 🎭 KWLT Automation → Install Daily Trigger.'],
    [''],
    ['FOR EACH NEW SHOW'],
    ['1. Go to 🎭 Show Setup and fill in a new row: show name, anchor dates, and production team contacts.'],
    ['2. Menu → 🎭 KWLT Automation → Create New Show. Select the show name when prompted.'],
    ['3. A new tab (🎬 ShowName) will be created with the full timeline and computed deadlines.'],
    ['4. Review the dates — adjust any that need tweaking in the Computed Date column.'],
    ['5. Set Active? to TRUE in Show Setup when you\'re ready for reminders to go out.'],
    [''],
    ['MANAGING AN ACTIVE SHOW'],
    ['• Mark tasks "Done" — click the ✅ link in a reminder, or change Status in the spreadsheet.'],
    ['• You can also mark tasks "Skipped" in the Status column to stop reminders.'],
    ['• Edit the Computed Date column to manually override deadlines.'],
    ['• Change Notify Via to "slack", "email", or "both" per task.'],
    ['• Add notes in the Notes column for your own tracking.'],
    [''],
    ['EDITING REMINDER MESSAGES'],
    ['Go to ✉️ Message Templates. Edit the Body column text. Use these placeholders:'],
    ['  {{SHOW_NAME}}  {{TASK}}  {{RESPONSIBLE_PARTY}}  {{DEADLINE}}'],
    ['  {{DAYS_UNTIL}}  {{DAYS_OVERDUE}}  {{GENERAL_RULE}}  {{SLACK_CHANNEL}}  {{HANDBOOK_URL}}  {{MARK_DONE_URL}}'],
    [''],
    ['SEASON OVERVIEW'],
    ['Menu → 🎭 KWLT Automation → Refresh Season Overview to see upcoming deadlines across ALL shows.'],
    [''],
    ['TROUBLESHOOTING'],
    ['• Check 📨 Send Log for a history of all sent messages and any errors.'],
    ['• If reminders stop, check if the trigger is still installed (Menu → Install Daily Trigger).'],
    ['• Reminders won\'t send for tasks marked "Done", "Skipped", or shows with Active? = FALSE.'],
  ];

  sheet.getRange(1, 1, readme.length, 1).setValues(readme);
  sheet.getRange(1, 1).setFontSize(16).setFontWeight('bold');
  sheet.getRange(3, 1).setFontWeight('bold');
  sheet.getRange(8, 1).setFontWeight('bold');
  sheet.getRange(12, 1).setFontWeight('bold');
  sheet.getRange(19, 1).setFontWeight('bold');
  sheet.getRange(25, 1).setFontWeight('bold');
  sheet.getRange(29, 1).setFontWeight('bold');
  sheet.getRange(32, 1).setFontWeight('bold');
  sheet.setColumnWidth(1, 1000);

  return sheet;
}
