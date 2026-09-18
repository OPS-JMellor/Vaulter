// ============================================================
// scanner.js — Scans new vault records against alert rules.
// ============================================================

const { randomUUID } = require('crypto');
const { getAlertRules, getUnscannedVaultRecords, writeFlaggedRecords } = require('./firestore');

/**
 * Scans un-scanned vault records and writes matches to the flagged collection.
 * @returns {Promise<number>} count of new flags
 */
async function runScanner() {
  const [rules, records] = await Promise.all([
    getAlertRules(),
    getUnscannedVaultRecords(),
  ]);

  const flagged = [];

  for (const record of records) {
    const queryText = (record.queryText || '').toLowerCase();
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const match = findKeywordMatch(queryText, rule.keywords || []);
      if (match) {
        flagged.push(buildFlagRecord(record, rule, match));
        break; // highest-severity rule wins; rules are pre-sorted on load
      }
    }
  }

  if (flagged.length > 0) {
    await writeFlaggedRecords(flagged);
  }

  console.log(`Scanner: checked ${records.length} records, flagged ${flagged.length}`);
  return flagged.length;
}

function findKeywordMatch(text, keywords) {
  for (const kw of keywords) {
    if (text.includes(kw)) return kw;
  }
  return null;
}

function buildFlagRecord(record, rule, matchedKeyword) {
  return {
    flagId:          randomUUID(),
    exportId:        record.exportId,
    userEmail:       record.userEmail,
    ouPath:          record.ouPath,
    timestamp:       record.timestamp,
    queryText:       record.queryText,
    category:        rule.category,
    matchedKeyword,
    severity:        rule.severity,
    alertSent:       false,
    alertSentAt:     null,
    reviewed:        false,
    reviewedBy:      '',
    notes:           '',
  };
}

module.exports = { runScanner };
