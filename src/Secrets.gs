/**
 * KWLT Production Automation — Secrets Management
 *
 * Stores sensitive configuration (tokens, emails, URLs) in Google Apps Script's
 * PropertiesService, which is NOT visible in the spreadsheet. Only users with
 * script editor access can view or change these values.
 *
 * Secrets are managed via the menu: 🎭 KWLT Automation → 🔐 Manage Secrets
 */

// ─── Secret Definitions ───────────────────────────────────────────────────────

const SECRETS = [
  {
    key: 'SLACK_BOT_TOKEN',
    label: 'Slack Bot Token',
    description: 'Bot User OAuth Token (starts with xoxb-)',
    sensitive: true,  // mask when displaying current value
  },
  {
    key: 'SHOW_SUPPORT_CHANNEL',
    label: 'Show Support Channel',
    description: 'Slack channel for digest and escalation alerts (e.g., #comm-show-support-private)',
    sensitive: false,
  },
  {
    key: 'SHOW_SUPPORT_EMAIL',
    label: 'Show Support Email',
    description: 'Receives the reminder summary (e.g., show-support@kwlt.org) — optional if using Slack',
    sensitive: false,
  },
  {
    key: 'WEB_APP_URL',
    label: 'Web App URL',
    description: 'Deployed web app URL for Mark Done links',
    sensitive: false,
  },
];

// ─── Manage Secrets Menu ──────────────────────────────────────────────────────

function manageSecrets() {
  const ui = SpreadsheetApp.getUi();
  const props = PropertiesService.getScriptProperties();

  // Build status summary
  const lines = SECRETS.map(function(s) {
    const val = props.getProperty(s.key) || '';
    let display;
    if (!val) {
      display = '(not set)';
    } else if (s.sensitive) {
      display = val.substring(0, 8) + '...' + val.substring(val.length - 4);
    } else {
      display = val;
    }
    return '• ' + s.label + ': ' + display;
  });

  const response = ui.prompt(
    '🔐 Manage Secrets',
    'Current values (stored securely, not visible in the spreadsheet):\n\n' +
    lines.join('\n') +
    '\n\n' +
    'To update a secret, type its number:\n' +
    SECRETS.map(function(s, i) { return '  ' + (i + 1) + '. ' + s.label; }).join('\n') +
    '\n\nOr type CLEAR ALL to remove all secrets.',
    ui.ButtonSet.OK_CANCEL
  );

  if (response.getSelectedButton() !== ui.Button.OK) return;

  const input = response.getResponseText().trim();

  if (input.toUpperCase() === 'CLEAR ALL') {
    const confirm = ui.alert('Confirm', 'Remove ALL stored secrets? This cannot be undone.', ui.ButtonSet.YES_NO);
    if (confirm === ui.Button.YES) {
      SECRETS.forEach(function(s) { props.deleteProperty(s.key); });
      ui.alert('✅ Done', 'All secrets cleared.', ui.ButtonSet.OK);
    }
    return;
  }

  const idx = parseInt(input) - 1;
  if (isNaN(idx) || idx < 0 || idx >= SECRETS.length) {
    ui.alert('Invalid selection. Please enter a number 1-' + SECRETS.length + '.', ui.ButtonSet.OK);
    return;
  }

  const secret = SECRETS[idx];
  const current = props.getProperty(secret.key) || '';
  const currentDisplay = current
    ? (secret.sensitive ? current.substring(0, 8) + '...' : current)
    : '(not set)';

  const valueResponse = ui.prompt(
    'Set: ' + secret.label,
    secret.description + '\n\nCurrent value: ' + currentDisplay + '\n\nEnter the new value (or leave blank to clear):',
    ui.ButtonSet.OK_CANCEL
  );

  if (valueResponse.getSelectedButton() !== ui.Button.OK) return;

  const newVal = valueResponse.getResponseText().trim();
  if (newVal) {
    props.setProperty(secret.key, newVal);
    ui.alert('✅ Saved', secret.label + ' has been updated.', ui.ButtonSet.OK);
  } else {
    props.deleteProperty(secret.key);
    ui.alert('✅ Cleared', secret.label + ' has been removed.', ui.ButtonSet.OK);
  }
}

/**
 * Migrates secrets from the Config sheet to Script Properties.
 * Run once if upgrading from the old sheet-based config.
 */
function migrateSecretsFromSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_CONFIG);
  if (!sheet) return;

  const props = PropertiesService.getScriptProperties();
  const data = sheet.getDataRange().getValues();

  const migrationMap = {
    'Slack Bot Token': 'SLACK_BOT_TOKEN',
    'Show Support Email': 'SHOW_SUPPORT_EMAIL',
    'Web App URL': 'WEB_APP_URL',
  };

  let migrated = 0;
  for (let i = 1; i < data.length; i++) {
    const key = data[i][0];
    const val = data[i][1];
    if (migrationMap[key] && val) {
      props.setProperty(migrationMap[key], String(val));
      // Clear the value from the sheet
      sheet.getRange(i + 1, 2).setValue('');
      migrated++;
    }
  }

  if (migrated > 0) {
    SpreadsheetApp.getUi().alert(
      '✅ Migration Complete',
      'Moved ' + migrated + ' secret(s) from the Config sheet to secure storage.\n\n' +
      'The values have been cleared from the sheet. You can manage them via:\n' +
      'Menu → 🎭 KWLT Automation → 🔐 Manage Secrets',
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } else {
    SpreadsheetApp.getUi().alert('No secrets found in the Config sheet to migrate.', SpreadsheetApp.getUi().ButtonSet.OK);
  }
}
