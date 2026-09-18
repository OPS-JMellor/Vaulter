// ============================================================
// pipeline.js — Orchestrates import → scan → alert.
// ============================================================

const { randomUUID } = require('crypto');
const { runVaultImport } = require('./vaultImport');
const { runScanner }     = require('./scanner');
const { runAlerts }      = require('./alerts');
const { appendRunLog, getSetupConfig } = require('./firestore');

/**
 * Runs the full pipeline. Logs the run to Firestore regardless of outcome.
 * @param {object} key — parsed service account JSON
 */
async function runPipeline(key) {
  const runId     = randomUUID();
  const startedAt = new Date().toISOString();
  let imported = 0, flagged = 0, alerted = 0, error = '';

  try {
    const config = await getSetupConfig();
    if (config.status === 'Paused') {
      console.log('Pipeline is paused. Skipping run.');
      return;
    }

    console.log(`Pipeline run started: ${runId}`);
    ({ imported } = await runVaultImport(key));
    flagged  = await runScanner();
    alerted  = await runAlerts(key);
    console.log(`Pipeline complete — imported: ${imported}, flagged: ${flagged}, alerted: ${alerted}`);
  } catch (e) {
    error = e.message || String(e);
    console.error('Pipeline error:', error);
  }

  await appendRunLog({
    runId,
    startedAt,
    completedAt: new Date().toISOString(),
    status:      error ? 'ERROR' : 'SUCCESS',
    imported,
    flagged,
    alerted,
    error,
  });
}

/**
 * Called by the hourly Cloud Scheduler trigger.
 * Checks Firestore config to decide whether to actually run based on schedule.
 */
async function runScheduledPipeline(key) {
  const config = await getSetupConfig();
  if (!shouldRunNow(config)) {
    console.log('Scheduled check: not time to run yet.');
    return;
  }
  await runPipeline(key);
}

function shouldRunNow(config) {
  if (config.status === 'Paused') return false;

  const freq = (config.frequency || 'daily').toLowerCase();
  if (freq === 'hourly') return true;

  const now        = new Date();
  const currentH   = now.getUTCHours();
  const [targetH]  = (config.importTime || '06:00').split(':').map(Number);

  if (freq === 'daily') {
    return currentH === targetH;
  }

  if (freq === 'weekly') {
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const currentDay = days[now.getUTCDay()];
    return currentDay === config.importDay && currentH === targetH;
  }

  return false;
}

module.exports = { runPipeline, runScheduledPipeline };
