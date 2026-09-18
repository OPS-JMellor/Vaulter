// ============================================================
// VaultImport.js — Pulls Gemini activity exports from Google Vault.
// Uses ScriptApp.getOAuthToken() — no service account needed.
//
// Two-phase design to avoid Apps Script's 6-minute timeout:
//   Phase 1 (runVaultImport): create exports, store IDs, return immediately.
//   Phase 2 (processPendingExports): poll for completion, import data.
//   A 5-minute trigger is installed automatically while exports are pending.
// ============================================================

/**
 * Phase 1 — called by the scheduler.
 * Creates Vault exports for each configured OU and stores them as pending.
 * Returns immediately; actual data import happens in processPendingExports().
 */
function runVaultImport() {
  const config = getSetupConfig_();
  const ous    = config.ous.filter(Boolean);
  const since  = getDateRangeStart_(config.dateRange);
  const runId  = Utilities.getUuid();

  if (ous.length === 0) {
    Logger.log('No OUs configured — skipping import.');
    updateLastRun_();
    return { imported: 0, runId };
  }

  const matterId = getOrCreateVaulterMatter_();
  const pending  = [];

  for (const ouPath of ous) {
    Logger.log(`Importing for OU: ${ouPath} since ${since.toISOString()}`);
    const ouId = getOUId_(ouPath);
    if (!ouId) {
      Logger.log(`Could not resolve OU ID for path: ${ouPath}`);
      continue;
    }
    const exportId = createExport_(matterId, ouId, since);
    if (exportId) {
      pending.push({ matterId, exportId, ouPath, runId });
    }
  }

  if (pending.length > 0) {
    storePendingExports_(pending);
    installExportCheckerTrigger_();
    Logger.log(`${pending.length} export(s) queued. Will process when complete.`);
  }

  updateLastRun_();
  return { imported: 0, runId };
}

/**
 * Phase 2 — called by the 5-minute export-checker trigger.
 * Checks each pending export; imports completed ones.
 */
function processPendingExports() {
  // Prevent concurrent runs — if another instance is already processing, bail out.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    Logger.log('processPendingExports: another instance is already running — skipping this trigger.');
    return;
  }

  try {

  const props   = PropertiesService.getScriptProperties();
  const pending = JSON.parse(props.getProperty('PENDING_EXPORTS') || '[]');

  if (pending.length === 0) {
    deleteExportCheckerTriggers_();
    return;
  }

  const remaining = [];
  let totalImported = 0;

  for (const item of pending) {
    try {
      const exp = vaultGet_(`${VAULT_API}/matters/${item.matterId}/exports/${item.exportId}`);
      Logger.log(`Export ${item.exportId} status: ${exp.status}`);

      if (exp.status === 'COMPLETED') {
        const { scanned, flagged } = parseAndScanExport_(exp, item.ouPath);
        totalImported += scanned;
        Logger.log(`Processed export for ${item.ouPath}: ${scanned} turn(s) scanned, ${flagged} flagged`);
      } else if (exp.status === 'FAILED') {
        Logger.log(`Export failed for ${item.ouPath}: ${item.exportId}`);
      } else {
        remaining.push(item); // still IN_PROGRESS
      }
    } catch (e) {
      Logger.log(`Error checking export ${item.exportId}: ${e.message}`);
      if (e.message && e.message.includes('(404)')) {
        Logger.log(`Export ${item.exportId} not found — removing from queue.`);
      } else {
        remaining.push(item); // retry next cycle
      }
    }
  }

  props.setProperty('PENDING_EXPORTS', JSON.stringify(remaining));

  if (remaining.length === 0) {
    deleteExportCheckerTriggers_();
    Logger.log(`All exports processed. Total scanned: ${totalImported}`);
    try { runAlerts(); } catch (e) { Logger.log('Alerts error: ' + e.message); }
  } else {
    Logger.log(`${remaining.length} export(s) still pending — will check again in 5 min.`);
  }

  } finally {
    lock.releaseLock();
  }
}

// ── Parse + scan in memory ───────────────────────────────────

/**
 * Downloads, parses, and scans an export in memory.
 * Only flagged turns are written to the Flagged sheet — nothing goes to Vault_Data.
 */
function parseAndScanExport_(exportData, ouPath) {
  const turns   = parseExportRecords_(exportData, ouPath);
  const rules   = loadAlertRules_();
  const flagged = [];
  const apiKey  = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');

  // Load existing Request IDs from Flagged sheet to avoid duplicates
  const ss          = SpreadsheetApp.openById(SPREADSHEET_ID);
  const flagSheet   = ss.getSheetByName(SHEETS.FLAGGED);
  const existingIds = flagSheet.getLastRow() > 1
    ? flagSheet.getRange(2, 2, flagSheet.getLastRow() - 1, 1).getValues().flat()
    : [];

  let aiFiltered = 0;
  const filtered = []; // rows for AI_Filtered sheet

  for (const turn of turns) {
    if (existingIds.includes(turn[0])) continue;
    const promptText = (turn[6] || '').toLowerCase();
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const match = findKeywordMatch_(promptText, rule.keywords);
      if (!match) continue;

      // If AI key is available, verify before flagging
      let aiNote = '';
      if (apiKey) {
        try {
          const result = callGeminiReview_(apiKey, turn[6], match, rule.category);
          if (result.severity === 'Likely False Positive') {
            Logger.log(`AI filtered false positive: "${match}" in "${turn[6].substring(0, 60)}"`);
            filtered.push([
              new Date(),        // Filtered At
              turn[2],           // User Email
              turn[3],           // OU Path
              rule.category,     // Category
              match,             // Matched Keyword
              result.severity,   // AI Verdict
              result.assessment, // AI Assessment
              result.reasoning,  // AI Reasoning
              turn[6],           // Prompt Text
            ]);
            aiFiltered++;
            break; // skip this turn
          }
          aiNote = `AI (${result.severity}): ${result.assessment} — ${result.reasoning}`;
        } catch (e) {
          Logger.log(`AI review error during import (flagging anyway): ${e.message}`);
          // Fail safe — flag without AI note
        }
      }

      flagged.push([
        Utilities.getUuid(), // Flag ID
        turn[0],             // Request ID
        turn[2],             // User Email
        turn[3],             // OU Path
        turn[4],             // Timestamp
        turn[6],             // Prompt Text
        rule.category,       // Matched Category
        match,               // Matched Keyword
        rule.severity,       // Severity
        'FALSE',             // Alert Sent
        '',                  // Alert Sent At
        'FALSE',             // Reviewed
        '',                  // Reviewed By
        aiNote,              // Notes — pre-filled with AI assessment if available
      ]);
      break; // one flag per turn
    }
  }

  if (flagged.length > 0) {
    flagSheet.getRange(flagSheet.getLastRow() + 1, 1, flagged.length, flagged[0].length)
      .setValues(flagged);
  }

  if (filtered.length > 0) {
    const filterSheet = ss.getSheetByName(SHEETS.AI_FILTERED)
      || ss.insertSheet(SHEETS.AI_FILTERED);
    // Ensure headers exist
    if (filterSheet.getLastRow() === 0) {
      filterSheet.appendRow(['Filtered At','User Email','OU Path','Category','Matched Keyword','AI Verdict','AI Assessment','AI Reasoning','Prompt Text']);
    }
    filterSheet.getRange(filterSheet.getLastRow() + 1, 1, filtered.length, filtered[0].length)
      .setValues(filtered);
  }

  Logger.log(`parseAndScanExport_: ${turns.length} turns scanned, ${aiFiltered} filtered by AI, ${flagged.length} flagged`);
  return { scanned: turns.length, flagged: flagged.length };
}

// ── Pending export storage ───────────────────────────────────

/**
 * Utility — run manually from the Apps Script editor to clear the pending export queue.
 */
function clearPendingExports() {
  PropertiesService.getScriptProperties().deleteProperty('PENDING_EXPORTS');
  deleteExportCheckerTriggers_();
  Logger.log('Pending export queue cleared.');
}

/**
 * Utility — lists all exports in the Vaulter matter, imports any COMPLETED ones
 * that haven't already been imported (checked against Vault_Data sheet).
 * Run manually from the Apps Script editor.
 */
function importCompletedExports() {
  const matterId = getOrCreateVaulterMatter_();
  const ss       = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet    = ss.getSheetByName(SHEETS.VAULT_DATA);
  const existing = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat()
    : [];

  let pageToken = null;
  let totalImported = 0;

  do {
    const url = `${VAULT_API}/matters/${matterId}/exports?pageSize=50${pageToken ? '&pageToken=' + pageToken : ''}`;
    const res  = vaultGet_(url);
    const exports = res.exports || [];
    pageToken = res.nextPageToken || null;

    Logger.log(`Found ${exports.length} export(s) on this page.`);

    for (const exp of exports) {
      Logger.log(`Export ${exp.id} — status: ${exp.status}, name: ${exp.name}`);
      if (exp.status !== 'COMPLETED') continue;
      if (existing.includes(exp.id)) {
        Logger.log(`Already imported: ${exp.id}`);
        continue;
      }

      // Infer OU path from export name if possible, else use unknown
      const rawOuId = (exp.query && exp.query.orgUnitInfo)
        ? exp.query.orgUnitInfo.orgUnitId : null;
      const ouPath = rawOuId ? resolveOUPath_(rawOuId) : 'unknown';

      const { scanned, flagged } = parseAndScanExport_(exp, ouPath);
      totalImported += scanned;
      Logger.log(`${exp.id}: ${scanned} turn(s) scanned, ${flagged} flagged`);
    }
  } while (pageToken);

  Logger.log(`importCompletedExports done. Total imported: ${totalImported}`);
}

function storePendingExports_(newExports) {
  const props    = PropertiesService.getScriptProperties();
  const existing = JSON.parse(props.getProperty('PENDING_EXPORTS') || '[]');
  props.setProperty('PENDING_EXPORTS', JSON.stringify([...existing, ...newExports]));
}

function installExportCheckerTrigger_() {
  const already = ScriptApp.getProjectTriggers()
    .some(t => t.getHandlerFunction() === 'processPendingExports');
  if (!already) {
    ScriptApp.newTrigger('processPendingExports').timeBased().everyMinutes(5).create();
    Logger.log('Export checker trigger installed (every 5 min).');
  }
}

function deleteExportCheckerTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processPendingExports')
    .forEach(t => ScriptApp.deleteTrigger(t));
  Logger.log('Export checker trigger removed.');
}

// ── Date range ───────────────────────────────────────────────

function getDateRangeStart_(range) {
  const now = new Date();
  switch (range) {
    case 'day':   return new Date(now - 24 * 60 * 60 * 1000);
    case 'week':  return new Date(now - 7  * 24 * 60 * 60 * 1000);
    case 'month': return new Date(now - 30 * 24 * 60 * 60 * 1000);
    default:      return new Date(now - 7  * 24 * 60 * 60 * 1000);
  }
}

// ── Vault API ────────────────────────────────────────────────

function getOrCreateVaulterMatter_() {
  const props    = PropertiesService.getScriptProperties();
  const cachedId = props.getProperty('VAULT_MATTER_ID');

  if (cachedId) {
    try {
      const matter = vaultGet_(`${VAULT_API}/matters/${cachedId}`);
      if (matter && matter.state === 'OPEN') return cachedId;
    } catch (_) {}
  }

  const matter = vaultPost_(`${VAULT_API}/matters`, {
    name:        'Vaulter — Gemini Activity Imports',
    description: 'Auto-created by Vaulter for Gemini activity exports.',
  });

  props.setProperty('VAULT_MATTER_ID', matter.matterId);
  return matter.matterId;
}

function createExport_(matterId, ouId, since) {
  const until = new Date();
  const query = {
    corpus:        GEMINI_CORPUS,
    dataScope:     'ALL_DATA',
    timeZone:      'America/Chicago',
    startTime:     since.toISOString(),
    endTime:       until.toISOString(),
    geminiOptions: {},
  };

  if (ouId && ouId !== 'root') {
    query.searchMethod = 'ORG_UNIT';
    query.orgUnitInfo  = { orgUnitId: ouId };
  } else {
    query.searchMethod = 'ENTIRE_ORG';
  }

  const body = {
    name:  `Vaulter Export ${Utilities.formatDate(until, 'UTC', 'yyyy-MM-dd HH:mm')}`,
    query,
    exportOptions: {
      geminiOptions: { exportFormat: 'XML' },
    },
  };

  Logger.log(`Creating export with body: ${JSON.stringify(body)}`);
  try {
    const result = vaultPost_(`${VAULT_API}/matters/${matterId}/exports`, body);
    if (!result || !result.id) {
      Logger.log('Export creation failed: no ID returned.');
      return null;
    }
    Logger.log(`Export created: ${result.id}`);
    return result.id;
  } catch (e) {
    Logger.log(`Export creation error: ${e.message}`);
    return null;
  }
}

function parseExportRecords_(exportData, ouPath) {
  const records   = [];
  const importNow = new Date().toISOString();
  const token     = getToken_();

  const files = (exportData.cloudStorageSink && exportData.cloudStorageSink.files) || [];
  Logger.log(`Export ${exportData.id} has ${files.length} file(s) to download.`);

  for (const file of files) {
    if (!file.bucketName || !file.objectName) continue;

    // Only process the .zip — skip errors.xml and result-counts.csv
    if (!file.objectName.endsWith('.zip')) continue;

    const url = `https://storage.googleapis.com/${file.bucketName}/${file.objectName}`;
    const res = UrlFetchApp.fetch(url, {
      headers: { Authorization: 'Bearer ' + token },
      muteHttpExceptions: true,
    });

    if (res.getResponseCode() !== 200) {
      Logger.log(`Failed to download zip: ${file.objectName}`);
      continue;
    }

    Logger.log(`Downloaded zip: ${file.objectName}`);

    let xmlFiles;
    try {
      xmlFiles = Utilities.unzip(res.getBlob());
    } catch (e) {
      Logger.log(`Failed to unzip ${file.objectName}: ${e.message}`);
      continue;
    }

    Logger.log(`Unzipped ${xmlFiles.length} file(s)`);

    for (const xmlBlob of xmlFiles) {
      if (!xmlBlob.getName().endsWith('.xml')) continue;
      try {
        const parsed = parseGeminiXml_(xmlBlob.getDataAsString('utf-8'), exportData.id, ouPath, importNow);
        records.push(...parsed);
      } catch (e) {
        Logger.log(`Failed to parse XML ${xmlBlob.getName()}: ${e.message}`);
      }
    }
  }

  Logger.log(`parseExportRecords_: ${records.length} turn(s) parsed from export ${exportData.id}`);
  return records;
}

/**
 * Parses a single user's Gemini XML file into one row per conversation turn.
 * Row format: [RequestId, ExportId, UserEmail, OUPath, Timestamp, ConversationTopic, PromptText, ConversationId, Corpus, ImportedAt]
 */
function parseGeminiXml_(xmlString, exportId, ouPath, importNow) {
  const records = [];
  const doc     = XmlService.parse(xmlString);
  const root    = doc.getRootElement();

  const userEmail = getXmlText_(root, ['User', 'Email']) || 'unknown';

  const conversations = root.getChild('Conversations');
  if (!conversations) return records;

  for (const conv of conversations.getChildren('Conversation')) {
    const convId    = getXmlText_(conv, ['ConversationId']) || '';
    const convTopic = getXmlText_(conv, ['ConversationTopic']) || '';

    const turns = conv.getChild('ConversationTurns');
    if (!turns) continue;

    for (const turn of turns.getChildren('ConversationTurn')) {
      const requestId  = getXmlText_(turn, ['RequestId']) || '';
      const timestamp  = getXmlText_(turn, ['Timestamp']) || '';
      const promptText = getXmlText_(turn, ['Prompt', 'Text']) || '';

      records.push([
        requestId,   // A — unique ID for dedup
        exportId,    // B
        userEmail,   // C
        ouPath,      // D
        timestamp,   // E
        convTopic,   // F
        promptText,  // G
        convId,      // H
        GEMINI_CORPUS, // I
        importNow,   // J
      ]);
    }
  }

  return records;
}

/**
 * Navigates an XML element by a path of child tag names and returns the text content.
 */
function getXmlText_(element, path) {
  let current = element;
  for (const tag of path) {
    current = current.getChild(tag);
    if (!current) return null;
  }
  return current.getText();
}

// ── OU helpers ───────────────────────────────────────────────


/**
 * Resolves an OU ID (e.g. "id:00gjdgxs3r8n7jh") back to its path (e.g. "/Students").
 * Falls back to the raw ID if the lookup fails.
 */
function resolveOUPath_(ouId) {
  try {
    const res  = UrlFetchApp.fetch(
      `${ADMIN_API}/customer/${CUSTOMER_ID}/orgunits?type=all`,
      authFetchOptions_()
    );
    if (res.getResponseCode() !== 200) return ouId;
    const data = JSON.parse(res.getContentText());
    for (const ou of (data.organizationUnits || [])) {
      if (ou.orgUnitId === ouId) return ou.orgUnitPath;
    }
  } catch (e) {
    Logger.log('resolveOUPath_ error: ' + e.message);
  }
  return ouId;
}

/**
 * Resolves an OU path (e.g. "/Students") to its OU ID.
 */
function getOUId_(ouPath) {
  if (ouPath === '/') return 'root';
  try {
    const url = `${ADMIN_API}/customer/${CUSTOMER_ID}/orgunits/${encodeURIComponent(ouPath.replace(/^\//, ''))}`;
    const res  = UrlFetchApp.fetch(url, authFetchOptions_());
    const code = res.getResponseCode();
    if (code !== 200) {
      Logger.log(`getOUId_ HTTP ${code} for ${ouPath}: ${res.getContentText()}`);
      return null;
    }
    const data = JSON.parse(res.getContentText());
    return data.orgUnitId || null;
  } catch (e) {
    Logger.log(`getOUId_ error for ${ouPath}: ${e.message}`);
    return null;
  }
}

// ── Sheet helpers ────────────────────────────────────────────

function appendVaultData_(records) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.VAULT_DATA);
  const existing = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues().flat()
    : [];

  const newRecords = records.filter(r => !existing.includes(r[0]));
  if (newRecords.length > 0) {
    sheet.getRange(sheet.getLastRow() + 1, 1, newRecords.length, newRecords[0].length)
      .setValues(newRecords);
  }
  return newRecords.length;
}

function updateLastRun_() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.SETUP);
  const data  = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === 'Last Run') {
      sheet.getRange(i + 1, 2).setValue(new Date().toISOString());
      return;
    }
  }
}

// ── Vault API fetch wrappers ─────────────────────────────────

function vaultGet_(url) {
  const res = UrlFetchApp.fetch(url, authFetchOptions_());
  if (res.getResponseCode() !== 200) {
    throw new Error(`Vault GET failed (${res.getResponseCode()}): ${res.getContentText()}`);
  }
  return JSON.parse(res.getContentText());
}

function vaultPost_(url, body) {
  const res = UrlFetchApp.fetch(url, authFetchOptions_({
    method:      'post',
    contentType: 'application/json',
    payload:     JSON.stringify(body),
  }));
  if (res.getResponseCode() < 200 || res.getResponseCode() >= 300) {
    throw new Error(`Vault POST failed (${res.getResponseCode()}): ${res.getContentText()}`);
  }
  return JSON.parse(res.getContentText());
}
