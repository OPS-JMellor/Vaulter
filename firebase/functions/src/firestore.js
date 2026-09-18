// ============================================================
// firestore.js — Firestore helpers replacing Google Sheets I/O.
// ============================================================

const admin = require('firebase-admin');
const { COLLECTIONS, CONFIG_PATHS } = require('./config');

const db = () => admin.firestore();

// ── Config ───────────────────────────────────────────────────

async function getAppConfig() {
  const snap = await db().doc(CONFIG_PATHS.APP).get();
  return snap.exists ? snap.data() : {};
}

async function getSetupConfig() {
  const snap = await db().doc(CONFIG_PATHS.SETUP).get();
  return snap.exists ? snap.data() : {};
}

async function setAppConfig(data) {
  await db().doc(CONFIG_PATHS.APP).set(data, { merge: true });
}

async function setSetupConfig(data) {
  await db().doc(CONFIG_PATHS.SETUP).set(data, { merge: true });
}

// ── Alert rules ──────────────────────────────────────────────

async function getAlertRules() {
  const snap = await db().collection(COLLECTIONS.ALERT_RULES).get();
  const rules = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  rules.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  return rules;
}

// ── Vault data ───────────────────────────────────────────────

/**
 * Appends new vault records, deduplicating by exportId.
 * @param {object[]} records
 * @returns {number} count actually written
 */
async function appendVaultData(records) {
  if (records.length === 0) return 0;

  // Fetch existing exportIds in batch
  const existingSnap = await db().collection(COLLECTIONS.VAULT_DATA)
    .select('exportId').get();
  const existing = new Set(existingSnap.docs.map(d => d.data().exportId));

  const newRecords = records.filter(r => !existing.has(r.exportId));
  if (newRecords.length === 0) return 0;

  const batch = db().batch();
  for (const record of newRecords) {
    const ref = db().collection(COLLECTIONS.VAULT_DATA).doc();
    batch.set(ref, record);
  }
  await batch.commit();
  return newRecords.length;
}

/**
 * Returns vault records whose exportId has not yet been flagged.
 */
async function getUnscannedVaultRecords() {
  const [vaultSnap, flaggedSnap] = await Promise.all([
    db().collection(COLLECTIONS.VAULT_DATA).get(),
    db().collection(COLLECTIONS.FLAGGED).select('exportId').get(),
  ]);

  const flaggedIds = new Set(flaggedSnap.docs.map(d => d.data().exportId));
  return vaultSnap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => !flaggedIds.has(r.exportId));
}

// ── Flagged ──────────────────────────────────────────────────

async function writeFlaggedRecords(records) {
  if (records.length === 0) return;
  const batch = db().batch();
  for (const record of records) {
    const ref = db().collection(COLLECTIONS.FLAGGED).doc(record.flagId);
    batch.set(ref, record);
  }
  await batch.commit();
}

async function getPendingAlertRecords() {
  const snap = await db().collection(COLLECTIONS.FLAGGED)
    .where('alertSent', '==', false)
    .get();
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

async function markAlertsAsSent(ids) {
  if (ids.length === 0) return;
  const now = new Date().toISOString();
  const batch = db().batch();
  for (const id of ids) {
    batch.update(db().collection(COLLECTIONS.FLAGGED).doc(id), {
      alertSent:   true,
      alertSentAt: now,
    });
  }
  await batch.commit();
}

async function markReviewed(flagId, reviewedBy, notes) {
  await db().collection(COLLECTIONS.FLAGGED).doc(flagId).update({
    reviewed:   true,
    reviewedBy,
    notes:      notes || '',
  });
}

// ── Run log ──────────────────────────────────────────────────

async function appendRunLog(entry) {
  await db().collection(COLLECTIONS.RUN_LOG).doc(entry.runId).set(entry);
}

async function getRecentRuns(limit = 10) {
  const snap = await db().collection(COLLECTIONS.RUN_LOG)
    .orderBy('startedAt', 'desc')
    .limit(limit)
    .get();
  return snap.docs.map(d => d.data());
}

// ── Dashboard data ───────────────────────────────────────────

async function getSummaryStats() {
  const [vaultSnap, flaggedSnap, lastRunSnap] = await Promise.all([
    db().collection(COLLECTIONS.VAULT_DATA).count().get(),
    db().collection(COLLECTIONS.FLAGGED).get(),
    db().collection(COLLECTIONS.RUN_LOG).orderBy('startedAt', 'desc').limit(1).get(),
  ]);

  const totalRecords   = vaultSnap.data().count;
  const flaggedDocs    = flaggedSnap.docs.map(d => d.data());
  const totalFlagged   = flaggedDocs.length;
  const unreviewedCount = flaggedDocs.filter(f => !f.reviewed).length;
  const lastRun = lastRunSnap.empty
    ? 'Never'
    : lastRunSnap.docs[0].data().startedAt;

  return { totalRecords, totalFlagged, unreviewedCount, lastRun };
}

async function getTrendData() {
  const snap = await db().collection(COLLECTIONS.VAULT_DATA).get();
  if (snap.empty) return { byDay: [], byOU: [] };

  const dayMap = {}, ouMap = {};
  snap.docs.forEach(d => {
    const r = d.data();
    const day = (r.timestamp || '').toString().substring(0, 10) || 'Unknown';
    dayMap[day] = (dayMap[day] || 0) + 1;
    const ou = r.ouPath || 'Unknown';
    ouMap[ou] = (ouMap[ou] || 0) + 1;
  });

  const byDay = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  const byOU = Object.entries(ouMap)
    .sort(([, a], [, b]) => b - a)
    .map(([ou, count]) => ({ ou, count }));

  return { byDay, byOU };
}

async function getRecentFlagged(limit = 50) {
  const snap = await db().collection(COLLECTIONS.FLAGGED)
    .orderBy('timestamp', 'desc')
    .limit(limit)
    .get();

  const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  docs.sort((a, b) => (order[a.severity] ?? 9) - (order[b.severity] ?? 9));
  return docs;
}

// ── OU list ──────────────────────────────────────────────────

async function getCachedVaultMatterId() {
  const setup = await getSetupConfig();
  return setup.vaultMatterId || null;
}

async function cacheVaultMatterId(matterId) {
  await setSetupConfig({ vaultMatterId: matterId });
}

module.exports = {
  getAppConfig, getSetupConfig, setAppConfig, setSetupConfig,
  getAlertRules,
  appendVaultData, getUnscannedVaultRecords,
  writeFlaggedRecords, getPendingAlertRecords, markAlertsAsSent, markReviewed,
  appendRunLog, getRecentRuns,
  getSummaryStats, getTrendData, getRecentFlagged,
  getCachedVaultMatterId, cacheVaultMatterId,
};
