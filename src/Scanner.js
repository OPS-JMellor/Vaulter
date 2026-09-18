// ============================================================
// Scanner.js — Scans new Vault_Data rows against Alerts_Config rules.
// ============================================================

/**
 * Scans all un-scanned rows in Vault_Data and writes matches to Flagged.
 * @returns {number} Number of new flags created
 */
function runScanner() {
  const rules    = loadAlertRules_();
  const newRows  = getUnscannedVaultRows_();
  const flagged  = [];

  for (const row of newRows) {
    const queryText = (row[6] || '').toLowerCase(); // col G: Query Text
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const match = findKeywordMatch_(queryText, rule.keywords);
      if (match) {
        flagged.push(buildFlagRow_(row, rule, match));
        break; // one flag per record (highest-severity rule wins — rules sorted on load)
      }
    }
  }

  if (flagged.length > 0) {
    writeFlaggedRows_(flagged);
  }

  // Clear scanned rows from Vault_Data — it's a staging area, not long-term storage
  if (newRows.length > 0) {
    clearScannedVaultRows_();
  }

  Logger.log(`Scanner: checked ${newRows.length} rows, flagged ${flagged.length}`);
  return flagged.length;
}

// ── Rule loading ────────────────────────────────────────────

function loadAlertRules_() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.ALERTS_CONFIG);
  const data  = sheet.getDataRange().getValues().slice(1); // skip header

  const rules = data
    .filter(r => r[0]) // skip blank rows
    .map(r => ({
      category: r[0],
      keywords: r[1].split(',').map(k => k.trim().toLowerCase()).filter(Boolean),
      severity: r[2],
      enabled:  r[3] === true || r[3] === 'TRUE',
      action:   r[4],
    }));

  // Sort so Critical > High > Medium > Low (first match wins)
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  rules.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  return rules;
}

// ── Row helpers ─────────────────────────────────────────────

/**
 * Returns Vault_Data rows that haven't been scanned yet.
 * "Unscanned" = not already present in Flagged by Export ID, or simply all rows
 * if Flagged is empty. We track scanned state via a hidden col or just re-scan
 * all and deduplicate in writeFlaggedRows_.
 */
function getUnscannedVaultRows_() {
  const ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
  const vaultSheet = ss.getSheetByName(SHEETS.VAULT_DATA);
  if (vaultSheet.getLastRow() <= 1) return [];

  const allRows   = vaultSheet.getRange(2, 1, vaultSheet.getLastRow() - 1, 10).getValues();
  const flagSheet = ss.getSheetByName(SHEETS.FLAGGED);

  // Dedup against col B of Flagged (Request ID — stored in vaultRow[0])
  const scannedIds = flagSheet.getLastRow() > 1
    ? flagSheet.getRange(2, 2, flagSheet.getLastRow() - 1, 1).getValues().flat()
    : [];

  return allRows.filter(r => r[0] && !scannedIds.includes(r[0]));
}

function findKeywordMatch_(text, keywords) {
  const lower = text.toLowerCase();
  for (const kw of keywords) {
    // Multi-word phrases: just substring match (word boundaries don't apply across spaces)
    // Single words: require word boundaries so "meth" doesn't match inside "something"
    if (kw.includes(' ')) {
      if (lower.includes(kw)) return kw;
    } else {
      const re = new RegExp('(?<![a-z0-9])' + kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?![a-z0-9])', 'i');
      if (re.test(text)) return kw;
    }
  }
  return null;
}

function buildFlagRow_(vaultRow, rule, matchedKeyword) {
  return [
    Utilities.getUuid(),   // Flag ID
    vaultRow[0],           // Request ID (for dedup)
    vaultRow[2],           // User Email
    vaultRow[3],           // OU Path
    vaultRow[4],           // Timestamp
    vaultRow[6],           // Prompt Text
    rule.category,         // Matched Category
    matchedKeyword,        // Matched Keyword
    rule.severity,         // Severity
    'FALSE',               // Alert Sent
    '',                    // Alert Sent At
    'FALSE',               // Reviewed
    '',                    // Reviewed By
    '',                    // Notes
  ];
}

function writeFlaggedRows_(rows) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.FLAGGED);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}

function clearScannedVaultRows_() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.VAULT_DATA);
  if (sheet.getLastRow() <= 1) return;
  sheet.deleteRows(2, sheet.getLastRow() - 1);
  Logger.log('Vault_Data cleared after scan.');
}
