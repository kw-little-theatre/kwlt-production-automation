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
    .addItem('📋 Generate Show Task Tabs', 'showCreateShowDialog')
    .addItem('🔄 Refresh Season Overview', 'refreshSeasonOverview')
    .addSeparator()
    .addItem('▶️ Run Reminders Now (test)', 'runDailyReminders')
    .addItem('🧪 Test All Message Types', 'testAllMessageTypes')
    .addItem('⏰ Install Daily Trigger', 'installDailyTrigger')
    .addItem('🛑 Remove All Triggers', 'removeAllTriggers')
    .addSeparator()
    .addItem('🔐 Manage Secrets', 'manageSecrets')
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
  _createTaskTemplateSheetMainstage(ss);
  _createTaskTemplateSheetStudio(ss);
  _createTaskTemplateSheetNWF(ss);
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
    '1. Configure secrets: Menu → 🎭 KWLT Automation → 🔐 Manage Secrets\n' +
    '2. Configure settings in the ⚙️ Config sheet\n' +
    '3. Add show details in the 🎭 Show Setup sheet\n' +
    '4. Generate timelines: Menu → 🎭 KWLT Automation → 📋 Generate Show Task Tabs\n' +
    '5. Install the daily trigger via the menu',
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
    ['Slack Default Channel', '', 'Default channel for test messages and shows without a channel (e.g., #show-reminders)'],
    ['Advance Reminder Days', REMINDER_ADVANCE_DAYS, 'Days before deadline for the first "heads up" reminder'],
    ['Urgent Reminder Days', REMINDER_URGENT_DAYS, 'Days before deadline for the urgent reminder'],
    ['Overdue Escalation Days', OVERDUE_ESCALATION_DAYS, 'Days past deadline before escalation email is sent'],
    ['Send Email Reminders', 'TRUE', 'Set to FALSE to disable email reminders (Slack only)'],
    ['Send Slack Reminders', 'TRUE', 'Set to FALSE to disable Slack reminders (email only)'],
    ['Handbook URL', '', 'Link to the KWLT Production Handbook (included in reminder messages)'],
    ['', '', ''],
    ['⚠️ SENSITIVE SETTINGS', '', 'Tokens, emails, and URLs are stored securely via Menu → 🔐 Manage Secrets'],
    ['', '', 'They are NOT visible in this sheet. Only editors with script access can view/change them.'],
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
    'Production Type',
    'Slack Channel',
    'Show Email',
    'Resources Folder URL',
    // Required anchor dates
    ANCHOR.AUDITION_START + ' *',
    ANCHOR.BUILD_POSSESSION + ' *',
    ANCHOR.OPENING_NIGHT + ' *',
    ANCHOR.CLOSING_NIGHT + ' *',
    // Auto-derived (leave blank to auto-compute, or enter to override)
    ANCHOR.AUDITION_END + ' (auto)',
    ANCHOR.TECH_WEEKEND_START + ' (auto)',
    ANCHOR.TECH_WEEKEND_END + ' (auto)',
    // Optional (tasks skipped if blank)
    ANCHOR.READTHROUGH + ' (opt)',
    // NWF-specific
    'Show Names (NWF)',
    'Readthrough Dates (NWF)',
    // Status & tracking
    'Timeline Created?',
    'Active?',
    'Readthrough Prompt Last Sent',
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#d1fae5');
  sheet.setFrozenRows(1);

  // Color-code date header groups
  // Required = green (cols 6-9)
  sheet.getRange(1, 6, 1, 4).setBackground('#bbf7d0');
  // Auto-derived = light blue (cols 10-12)
  sheet.getRange(1, 10, 1, 3).setBackground('#bfdbfe');
  // Optional = light gray (col 13)
  sheet.getRange(1, 13, 1, 1).setBackground('#e5e7eb');
  // NWF-specific = light orange (cols 14-15)
  sheet.getRange(1, 14, 1, 2).setBackground('#fed7aa');

  // Format date columns (6-13)
  for (let i = 6; i <= 13; i++) {
    sheet.setColumnWidth(i, 160);
  }
  sheet.setColumnWidth(1, 200); // Show Name
  sheet.setColumnWidth(2, 140); // Production Type
  sheet.setColumnWidth(3, 180); // Slack Channel
  sheet.setColumnWidth(14, 250); // Show Names (NWF)
  sheet.setColumnWidth(15, 200); // Readthrough Dates (NWF)

  // Add data validation for Production Type column (col 2)
  const typeRule = SpreadsheetApp.newDataValidation()
    .requireValueInList(PRODUCTION_TYPES_LIST)
    .setAllowInvalid(false)
    .setHelpText('Select the production type')
    .build();
  sheet.getRange(2, 2, 19, 1).setDataValidation(typeRule);
  // Default to Mainstage
  sheet.getRange(2, 2, 19, 1).setValue('');

  // Add data validation for date columns (cols 6-13)
  const dateRule = SpreadsheetApp.newDataValidation()
    .requireDate()
    .setAllowInvalid(false)
    .setHelpText('Enter a date (YYYY-MM-DD)')
    .build();

  for (let col = 6; col <= 13; col++) {
    sheet.getRange(2, col, 19, 1).setDataValidation(dateRule);
    sheet.getRange(2, col, 19, 1).setNumberFormat('yyyy-mm-dd');
  }

  return sheet;
}

// ─── Task Template Sheets ─────────────────────────────────────────────────────

function _createTaskTemplateSheet(ss) {
  // Legacy: create all new sheets instead
  _createTaskTemplateSheetMainstage(ss);
  _createTaskTemplateSheetStudio(ss);
  _createTaskTemplateSheetNWF(ss);
}

function _createTaskTemplateSheetMainstage(ss) {
  let sheet = ss.getSheetByName(SHEET_TASK_TEMPLATE_MAINSTAGE);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_TASK_TEMPLATE_MAINSTAGE);
  sheet.setTabColor('#d97706');
  _populateTaskTemplateSheet(sheet, getTaskTemplateData());
  return sheet;
}

function _createTaskTemplateSheetStudio(ss) {
  let sheet = ss.getSheetByName(SHEET_TASK_TEMPLATE_STUDIO);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_TASK_TEMPLATE_STUDIO);
  sheet.setTabColor('#7c3aed');
  _populateTaskTemplateSheet(sheet, getStudioSeriesTaskTemplateData());
  return sheet;
}

function _createTaskTemplateSheetNWF(ss) {
  let sheet = ss.getSheetByName(SHEET_TASK_TEMPLATE_NWF);
  if (sheet) return sheet;

  sheet = ss.insertSheet(SHEET_TASK_TEMPLATE_NWF);
  sheet.setTabColor('#ea580c');
  _populateTaskTemplateSheet(sheet, getNWFTaskTemplateData());
  return sheet;
}

function _populateTaskTemplateSheet(sheet, tasks) {
  const headers = [
    'Task', 'Responsible Party', 'General Rule', 'Anchor Reference',
    'Offset (days)', 'Notify Via', 'Recurring?', 'Phase',
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#fef3c7');
  sheet.setFrozenRows(1);

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
      '📋 Upcoming: {{TASK}}',
      '👋 Hey {{RESPONSIBLE_PARTY}},\n\nFriendly reminder for *{{SHOW_NAME}}*: *{{TASK}}* is due in {{DAYS_UNTIL}} days ({{DEADLINE}}).\n\n📌 Timing: {{GENERAL_RULE}}\n📖 Handbook: {{HANDBOOK_URL}}\n\n✅ Done? Click here to mark it complete: {{MARK_DONE_URL}}\n\nQuestions? Post in {{SLACK_CHANNEL}} or reach out to your Show Support rep.',
    ],
    [
      'Urgent Reminder',
      'slack',
      '🚨 Due tomorrow: {{TASK}}',
      '🚨 *Urgent — {{SHOW_NAME}}*\n\n{{RESPONSIBLE_PARTY}}, *{{TASK}}* is due *tomorrow* ({{DEADLINE}}).\n\n📌 {{GENERAL_RULE}}\n\n✅ Done? Click here to mark it complete: {{MARK_DONE_URL}}\n\nPlease complete this or let your Show Support rep know if you need help.',
    ],
    [
      'Advance Reminder (Email)',
      'email',
      '[KWLT] Upcoming: {{TASK}} -- {{SHOW_NAME}}',
      'Hello,\n\nThis is a reminder that the following task for {{SHOW_NAME}} is due in {{DAYS_UNTIL}} days:\n\n- Task: {{TASK}}\n- Deadline: {{DEADLINE}}\n- Timing: {{GENERAL_RULE}}\n\nHandbook: {{HANDBOOK_URL}}\n\nDone? Mark this task complete:\n{{MARK_DONE_URL}}\n\nIf you have questions, please reach out to your Show Support Committee representative.\n\n-- KWLT Show Support',
    ],
    [
      'Urgent Reminder (Email)',
      'email',
      '[KWLT] Due TOMORROW: {{TASK}} -- {{SHOW_NAME}}',
      'Hello,\n\nThis is an urgent reminder that the following task for {{SHOW_NAME}} is due TOMORROW:\n\n- Task: {{TASK}}\n- Deadline: {{DEADLINE}}\n- Timing: {{GENERAL_RULE}}\n\nDone? Mark this task complete:\n{{MARK_DONE_URL}}\n\nPlease complete this task or reach out to your Show Support Committee representative if you need assistance.\n\n-- KWLT Show Support',
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
    'Show', 'Type', 'Task', 'Responsible', 'Deadline', 'Status',
    'Days Until/Since', 'Phase',
  ];

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#fee2e2');
  sheet.setFrozenRows(1);

  sheet.setColumnWidth(1, 180);
  sheet.setColumnWidth(2, 120);
  sheet.setColumnWidth(3, 400);
  sheet.setColumnWidth(4, 200);
  sheet.setColumnWidth(5, 120);
  sheet.setColumnWidth(6, 180);
  sheet.setColumnWidth(7, 120);
  sheet.setColumnWidth(8, 130);

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
    ['1. Configure secrets: Menu → 🎭 KWLT Automation → 🔐 Manage Secrets (Slack token, Web App URL, etc.)'],
    ['2. Configure settings in ⚙️ Config (default channel, handbook URL, reminder timing).'],
    ['3. Install the daily trigger: Menu → 🎭 KWLT Automation → Install Daily Trigger.'],
    [''],
    ['FOR EACH NEW SHOW'],
    ['1. Go to 🎭 Show Setup and fill in a new row: show name, Slack channel, show email, resources URL, and dates.'],
    ['2. Menu → 🎭 KWLT Automation → 📋 Generate Show Task Tabs.'],
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
    ['READTHROUGH DATE PROMPT'],
    ['If a show\'s readthrough date is left blank, the system will prompt the show\'s Slack channel'],
    ['with a date picker 1 day after auditions end. The prompt repeats weekly until the date is set.'],
    ['When a date is chosen, dependent tasks are automatically reactivated on the next daily run.'],
    ['Requires: Slack app Interactivity enabled → Request URL = your Apps Script web app URL.'],
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
