// ============================================================
// Scheduler.js — Orchestrates import → scan → alert pipeline.
// Also manages time-driven triggers.
// ============================================================

/**
 * Runs when the spreadsheet is opened — adds the Vaulter menu.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🛡 Vaulter')
    .addItem('Open Dashboard', 'openDashboard_')
    .addSeparator()
    .addItem('Run Import Now', 'runPipelineNow')
    .addItem('Check Pending Exports', 'processPendingExports')
    .addSeparator()
    .addItem('Install / Update Trigger', 'installTrigger')
    .addToUi();
}

function openDashboard_() {
  const url  = 'https://script.google.com/a/macros/orono.k12.mn.us/s/AKfycbxaCRFkpPoycya--futcU-eZEQhUNACLgtxQmlUUFLy5uJPxSUAtCSR5CzJvKLgjyNKhA/exec';
  const html = HtmlService.createHtmlOutput(
    `<p style="font-family:sans-serif;margin:12px 0;">Opening Vaulter Dashboard…</p>
     <a href="${url}" target="_blank" style="font-family:sans-serif;">Click here if it didn't open automatically</a>
     <script>window.open('${url}', '_blank'); setTimeout(() => google.script.host.close(), 1000);</script>`
  ).setTitle('Vaulter Dashboard').setWidth(320).setHeight(80);
  SpreadsheetApp.getUi().showModalDialog(html, 'Opening Dashboard…');
}

/**
 * Main pipeline function. Called by the time-driven trigger.
 * Logs the run to Run_Log regardless of success/failure.
 */
function runPipeline() {
  const runId    = Utilities.getUuid();
  const startedAt = new Date();
  let imported = 0, flagged = 0, alerted = 0, error = '';

  try {
    const config = getSetupConfig_();
    if (config.status === 'Paused') {
      Logger.log('Pipeline is paused. Skipping run.');
      return;
    }

    Logger.log(`Pipeline run started: ${runId}`);
    const importResult = runVaultImport();
    imported = importResult.imported;

    // Scanning happens inside processPendingExports when exports complete.
    // Run alerts here in case any previously flagged items are still unalerted.
    alerted = runAlerts();

    Logger.log(`Pipeline complete — exports queued: ${imported}, alerted: ${alerted}`);
  } catch (e) {
    error = e.message || String(e);
    Logger.log('Pipeline error: ' + error);
  }

  logRun_({
    runId,
    startedAt,
    completedAt: new Date(),
    status:      error ? 'ERROR' : 'SUCCESS',
    imported,
    flagged,
    alerted,
    error,
  });
}

// ── Trigger management ───────────────────────────────────────

/**
 * Creates or replaces the pipeline trigger based on Setup sheet config.
 * Run this manually any time the schedule changes.
 */
function installTrigger() {
  deletePipelineTriggers_();

  const config = getSetupConfig_();

  switch (config.frequency) {
    case 'hourly':
      ScriptApp.newTrigger('runPipeline')
        .timeBased().everyHours(1).create();
      Logger.log('Hourly trigger installed.');
      break;

    case 'weekly': {
      const [hour] = parseTime_(config.importTime);
      const dayMap = {
        Sunday: ScriptApp.WeekDay.SUNDAY,
        Monday: ScriptApp.WeekDay.MONDAY,
        Tuesday: ScriptApp.WeekDay.TUESDAY,
        Wednesday: ScriptApp.WeekDay.WEDNESDAY,
        Thursday: ScriptApp.WeekDay.THURSDAY,
        Friday: ScriptApp.WeekDay.FRIDAY,
        Saturday: ScriptApp.WeekDay.SATURDAY,
      };
      const day = dayMap[config.importDay] || ScriptApp.WeekDay.MONDAY;
      ScriptApp.newTrigger('runPipeline')
        .timeBased().onWeekDay(day).atHour(hour).create();
      Logger.log(`Weekly trigger installed: ${config.importDay} at ${hour}:00`);
      break;
    }

    case 'daily':
    default: {
      const [hour] = parseTime_(config.importTime);
      ScriptApp.newTrigger('runPipeline')
        .timeBased().everyDays(1).atHour(hour).create();
      Logger.log(`Daily trigger installed at ${hour}:00`);
      break;
    }
  }
}

function deletePipelineTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'runPipeline')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function parseTime_(timeStr) {
  // timeStr format: "06:00"
  const parts = (timeStr || '06:00').split(':');
  return [parseInt(parts[0], 10), parseInt(parts[1] || '0', 10)];
}

// ── Run log ──────────────────────────────────────────────────

function logRun_({ runId, startedAt, completedAt, status, imported, flagged, alerted, error }) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.RUN_LOG);
  sheet.appendRow([
    runId,
    startedAt.toISOString(),
    completedAt.toISOString(),
    status,
    imported,
    flagged,
    alerted,
    error,
  ]);
}

// Extend getSetupConfig_ to also return status, importTime, importDay
// (override the version in VaultImport.js with a fuller read)
function getSetupConfig_() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.SETUP);
  const data  = sheet.getDataRange().getValues();

  const config = {};
  for (let i = 1; i < data.length; i++) {
    const [setting, value] = data[i];
    const v = String(value || '').trim();
    switch (setting) {
      case 'OUs to Import':    config.ous        = v.split(',').map(s => s.trim()); break;
      case 'Date Range':       config.dateRange   = v.toLowerCase();                break;
      case 'Import Frequency': config.frequency   = v.toLowerCase();                break;
      case 'Import Time (24h)':config.importTime  = v;                              break;
      case 'Import Day':       config.importDay   = v;                              break;
      case 'Status':           config.status      = v;                              break;
    }
  }
  return config;
}
