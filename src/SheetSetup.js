// ============================================================
// SheetSetup.js — Scaffolds all sheets with headers and default data.
// ============================================================

function setupSheets() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  setupVaultDataSheet_(ss);
  setupFlaggedSheet_(ss);
  setupAlertsConfigSheet_(ss);
  setupAppConfigSheet_(ss);
  setupSetupSheet_(ss);
  setupRunLogSheet_(ss);
  setupAIFilteredSheet_(ss);
  setupAccessListSheet_(ss);
  Logger.log('All sheets initialized.');
}

function setupAIFilteredSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEETS.AI_FILTERED);
  setHeaders_(sheet, [
    'Filtered At', 'User Email', 'OU Path', 'Category', 'Matched Keyword',
    'AI Verdict', 'AI Assessment', 'AI Reasoning', 'Prompt Text',
  ]);
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function setHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold')
      .setBackground('#2d3f89')
      .setFontColor('#ffffff');
    sheet.setFrozenRows(1);
  }
}

function setupVaultDataSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEETS.VAULT_DATA);
  setHeaders_(sheet, [
    'Request ID', 'Export ID', 'User Email', 'Grade',
    'Timestamp', 'Conversation Topic', 'Prompt Text', 'Conversation ID', 'Corpus', 'Import Date',
  ]);
}

function setupFlaggedSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEETS.FLAGGED);
  setHeaders_(sheet, [
    'Flag ID', 'Request ID', 'User Email', 'Grade', 'Timestamp',
    'Prompt Text', 'Matched Category', 'Matched Keyword', 'Severity',
    'Alert Sent', 'Alert Sent At', 'Reviewed', 'Reviewed By', 'Notes',
  ]);
}

function setupAlertsConfigSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEETS.ALERTS_CONFIG);
  setHeaders_(sheet, [
    'Category', 'Keywords (comma-separated)', 'Severity', 'Enabled', 'Action',
  ]);

  if (sheet.getLastRow() <= 1) {
    const defaults = [
      ['Self-Harm',       'how to kill myself,i want to kill myself,i want to die,self harm,cutting myself,suicide note,how to commit suicide,end my life', 'Critical', 'TRUE',  'Both'],
      ['Sexual Content',  'pornhub,onlyfans,nude photos,send nudes,naked pictures,explicit video,pornographic',                                             'High',     'TRUE',  'Both'],
      ['Violence',        'how to make a bomb,how to shoot,school shooting,bring a gun,make a weapon,pipe bomb,kill my teacher,kill my classmate',           'High',     'TRUE',  'Email'],
      ['Drugs',           'how to buy cocaine,how to get meth,how to make meth,buy heroin,how to get weed,drug dealer,how to get high on',                  'Medium',   'TRUE',  'Email'],
      ['Harassment',      'i will hurt you,i will kill you,kill yourself,you should die,send me your address',                                              'Medium',   'TRUE',  'Email'],
      ['Cheating',        'write my essay for me,do my homework for me,give me the answers to,write a test for me,complete my assignment',                  'Low',      'TRUE',  'Email'],
    ];
    sheet.getRange(2, 1, defaults.length, 5).setValues(defaults);
  }
}

function setupAppConfigSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEETS.APP_CONFIG);
  setHeaders_(sheet, ['Setting', 'Value', 'Notes']);

  if (sheet.getLastRow() <= 1) {
    sheet.getRange(2, 1, 6, 3).setValues([
      ['Admin Email',       'superadmin@yourdomain.org', 'Super-admin account the service account impersonates (must have Vault + Admin SDK access)'],
      ['Alert Recipients',  'admin@yourdomain.org',      'Comma-separated emails for alert notifications'],
      ['Dashboard Access',  'admin@yourdomain.org',      'Comma-separated emails allowed to view the dashboard'],
      ['From Name',         'Vaulter Alerts',            'Display name used in alert emails'],
      ['Reply-To',          'admin@yourdomain.org',      'Reply-to address in alert emails'],
      ['Alert Cooldown (h)','1',                         'Hours between repeat alerts for the same user'],
    ]);
  }
}

function setupSetupSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEETS.SETUP);
  setHeaders_(sheet, ['Setting', 'Value', 'Notes']);

  if (sheet.getLastRow() <= 1) {
    sheet.getRange(2, 1, 7, 3).setValues([
      ['OUs to Import',       '/Students',         'Comma-separated OU paths, e.g. /Students,/Staff'],
      ['Date Range',          'week',              'Options: day | week | month'],
      ['Import Frequency',    'daily',             'Options: hourly | daily | weekly'],
      ['Import Time (24h)',   '06:00',             'Time of day for daily/weekly imports (HH:MM)'],
      ['Import Day',          'Monday',            'Day of week for weekly imports'],
      ['Status',              'Active',            'Active | Paused'],
      ['Last Run',            '',                  'Auto-populated by scheduler'],
    ]);
  }
}

function setupAccessListSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEETS.ACCESS_LIST);
  setHeaders_(sheet, ['Email', 'Role', 'Added By', 'Added At']);
}

function setupRunLogSheet_(ss) {
  const sheet = getOrCreateSheet_(ss, SHEETS.RUN_LOG);
  setHeaders_(sheet, [
    'Run ID', 'Started At', 'Completed At', 'Status', 'Records Imported',
    'Records Flagged', 'Alerts Sent', 'Error Message',
  ]);
}
