// ============================================================
// vaultImport.js — Pulls Gemini activity exports from Google Vault.
// ============================================================

const { randomUUID } = require('crypto');
const axios = require('axios');
const { getServiceAccountToken } = require('./auth');
const {
  appendVaultData, getSetupConfig,
  getCachedVaultMatterId, cacheVaultMatterId, setSetupConfig,
} = require('./firestore');
const {
  VAULT_API, ADMIN_API, VAULT_SCOPES, ADMIN_SCOPES,
  GEMINI_CORPUS, EXPORT_POLL_MAX_ATTEMPTS, EXPORT_POLL_INTERVAL_MS, CUSTOMER_ID,
} = require('./config');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Main entry point called by the pipeline.
 * @param {object} key    — parsed service account JSON
 * @returns {Promise<{imported: number}>}
 */
async function runVaultImport(key) {
  const config = await getSetupConfig();
  const ous    = (config.ous || []).filter(Boolean);
  const since  = getDateRangeStart(config.dateRange);

  let totalImported = 0;

  for (const ou of ous) {
    console.log(`Importing for OU: ${ou} since ${since.toISOString()}`);
    const records = await fetchVaultRecordsForOU(key, config.adminEmail, ou, since);
    if (records.length > 0) {
      const written = await appendVaultData(records);
      totalImported += written;
    }
  }

  await setSetupConfig({ lastRun: new Date().toISOString() });
  return { imported: totalImported };
}

function getDateRangeStart(range) {
  const now = Date.now();
  switch (range) {
    case 'day':   return new Date(now - 24 * 60 * 60 * 1000);
    case 'month': return new Date(now - 30 * 24 * 60 * 60 * 1000);
    case 'week':
    default:      return new Date(now - 7 * 24 * 60 * 60 * 1000);
  }
}

// ── Vault API ───────────────────────────────────────────────

async function fetchVaultRecordsForOU(key, adminEmail, ouPath, since) {
  let token;
  try {
    token = await getServiceAccountToken(VAULT_SCOPES, key, adminEmail);
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`VAULT token error: ${detail}`);
    throw err;
  }
  const matterId = await getOrCreateVaulterMatter(token);
  const users    = await getUsersInOU(key, adminEmail, ouPath);

  if (users.length === 0) {
    console.log(`No users found in OU: ${ouPath}`);
    return [];
  }

  const exportId   = await createExport(token, matterId, users, since);
  const exportData = await waitForExport(token, matterId, exportId);

  if (!exportData) {
    console.log(`Export timed out or failed for OU: ${ouPath}`);
    return [];
  }

  return parseExportRecords(exportData, ouPath, key, adminEmail);
}

async function getOrCreateVaulterMatter(token) {
  const cachedId = await getCachedVaultMatterId();

  if (cachedId) {
    try {
      const matter = await vaultGet(`${VAULT_API}/matters/${cachedId}`, token);
      if (matter.state === 'OPEN') return cachedId;
    } catch (_) { /* matter gone, create a new one */ }
  }

  const matter = await vaultPost(`${VAULT_API}/matters`, token, {
    name:        'Vaulter — Gemini Activity Imports',
    description: 'Auto-created by Vaulter for Gemini activity exports.',
  });

  await cacheVaultMatterId(matter.matterId);
  return matter.matterId;
}

async function createExport(token, matterId, users, since) {
  const until = new Date();
  const name  = `Vaulter Export ${until.toISOString().substring(0, 16).replace('T', ' ')}`;

  const body = {
    name,
    query: {
      corpus:       GEMINI_CORPUS,
      dataScope:    'ALL_DATA',
      searchMethod: 'ACCOUNT',
      accountInfo:  { emails: users },
      startTime:    since.toISOString(),
      endTime:      until.toISOString(),
    },
    exportOptions: {
      mailOptions: {
        exportFormat:               'MBOX',
        showConfidentialModeContent: false,
      },
    },
  };

  const result = await vaultPost(`${VAULT_API}/matters/${matterId}/exports`, token, body);
  console.log(`Export created: ${result.id}`);
  return result.id;
}

async function waitForExport(token, matterId, exportId) {
  for (let i = 0; i < EXPORT_POLL_MAX_ATTEMPTS; i++) {
    const exp = await vaultGet(`${VAULT_API}/matters/${matterId}/exports/${exportId}`, token);
    console.log(`Export status: ${exp.status} (attempt ${i + 1})`);

    if (exp.status === 'COMPLETED') return exp;
    if (exp.status === 'FAILED')    return null;

    await sleep(EXPORT_POLL_INTERVAL_MS);
  }
  return null;
}

/**
 * Parses a completed Vault export into structured records.
 * TODO: Parse actual MBOX/JSON content once Gemini corpus format is confirmed.
 */
async function parseExportRecords(exportData, ouPath, key, adminEmail) {
  const records   = [];
  const importNow = new Date().toISOString();
  const token     = await getServiceAccountToken(VAULT_SCOPES, key, adminEmail);

  for (const file of (exportData.cloudStorageFiles || [])) {
    if (!file.bucketName || !file.objectName) continue;

    const url = `https://storage.googleapis.com/${file.bucketName}/${file.objectName}`;
    try {
      const res = await axios.get(url, {
        headers:      { Authorization: `Bearer ${token}` },
        responseType: 'text',
      });
      console.log(`Downloaded export file: ${file.objectName} (${res.data.length} bytes)`);

      // TODO: Replace with real MBOX/JSON parser once Gemini corpus format is confirmed.
      records.push({
        exportId:        exportData.id,
        matterId:        exportData.matterId,
        matterName:      exportData.name,
        userEmail:       'unknown@user',
        ouPath,
        timestamp:       new Date().toISOString(),
        queryText:       '(raw export — parser pending)',
        responsePreview: '',
        corpus:          GEMINI_CORPUS,
        importDate:      importNow,
      });
    } catch (err) {
      console.error(`Failed to download export file ${file.objectName}: ${err.message}`);
    }
  }

  return records;
}

// ── Admin SDK — users in OU ──────────────────────────────────

async function getUsersInOU(key, adminEmail, ouPath) {
  const token = await getServiceAccountToken(ADMIN_SCOPES, key, adminEmail);
  const users = [];
  let pageToken = null;

  do {
    const url = `${ADMIN_API}/users?customer=${CUSTOMER_ID}` +
      `&query=${encodeURIComponent(`orgUnitPath=${ouPath}`)}&maxResults=500` +
      (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : '');

    const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    (res.data.users || []).forEach(u => users.push(u.primaryEmail));
    pageToken = res.data.nextPageToken || null;
  } while (pageToken);

  console.log(`Found ${users.length} users in OU: ${ouPath}`);
  return users;
}

// ── Vault HTTP wrappers ──────────────────────────────────────

async function vaultGet(url, token) {
  try {
    const res = await axios.get(url, { headers: { Authorization: `Bearer ${token}` } });
    return res.data;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`Vault GET ${url} failed (${err.response?.status}): ${detail}`);
    throw err;
  }
}

async function vaultPost(url, token, body) {
  try {
    const res = await axios.post(url, body, {
      headers: {
        Authorization:  `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    return res.data;
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`Vault POST ${url} failed (${err.response?.status}): ${detail}`);
    throw err;
  }
}

module.exports = { runVaultImport };
