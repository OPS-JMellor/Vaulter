// ============================================================
// index.js — Firebase Cloud Function exports.
// All client-facing functions use onCall (Firebase Auth required).
// The pipeline runs on a Cloud Scheduler trigger every hour.
// ============================================================

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onSchedule }         = require('firebase-functions/v2/scheduler');
const { defineSecret }       = require('firebase-functions/params');
const admin                  = require('firebase-admin');

admin.initializeApp();

const { runPipeline, runScheduledPipeline } = require('./src/pipeline');
const { markReviewed, getSummaryStats, getTrendData,
        getRecentFlagged, getRecentRuns, getAppConfig,
        getSetupConfig, setAppConfig, setSetupConfig,
        getAlertRules }                      = require('./src/firestore');
const { getServiceAccountToken }             = require('./src/auth');
const { ADMIN_API, ADMIN_SCOPES, CUSTOMER_ID } = require('./src/config');
const axios                                  = require('axios');

const serviceAccountKey = defineSecret('SERVICE_ACCOUNT_KEY');

const REGION  = 'us-central1';
const FN_OPTS = { region: REGION, secrets: [serviceAccountKey], timeoutSeconds: 540, invoker: 'public' };

// ── Authorization helper ─────────────────────────────────────

async function assertAuthorized(email) {
  if (!email) throw new HttpsError('unauthenticated', 'Sign in required.');
  const config  = await getAppConfig();
  const allowed = (config.dashboardAccess || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (allowed.length > 0 && !allowed.includes(email.toLowerCase())) {
    throw new HttpsError('permission-denied', 'Your account is not authorized.');
  }
}

function getKey(context) {
  const raw = context.secrets
    ? context.secrets[serviceAccountKey.name]
    : process.env[serviceAccountKey.name];
  if (!raw) throw new HttpsError('internal', 'SERVICE_ACCOUNT_KEY secret not configured.');
  return JSON.parse(raw);
}

// ── Dashboard ────────────────────────────────────────────────

exports.getDashboardData = onCall(FN_OPTS, async (request) => {
  await assertAuthorized(request.auth?.token?.email);
  const [summary, trends, flagged, runLog] = await Promise.all([
    getSummaryStats(),
    getTrendData(),
    getRecentFlagged(),
    getRecentRuns(),
  ]);
  return { summary, trends, flagged, runLog };
});

exports.markReviewedFn = onCall(FN_OPTS, async (request) => {
  await assertAuthorized(request.auth?.token?.email);
  const { flagId, notes } = request.data;
  if (!flagId) throw new HttpsError('invalid-argument', 'flagId is required.');
  await markReviewed(flagId, request.auth.token.email, notes || '');
  return { success: true };
});

// ── Settings ─────────────────────────────────────────────────

exports.getSettingsData = onCall(FN_OPTS, async (request) => {
  await assertAuthorized(request.auth?.token?.email);

  const [appConfig, setupConfig] = await Promise.all([
    getAppConfig(),
    getSetupConfig(),
  ]);

  const ous = await getOUList(getKey(request), appConfig.adminEmail);

  return {
    ous,
    selectedOUs:     setupConfig.ous          || [],
    dateRange:       setupConfig.dateRange     || 'week',
    frequency:       setupConfig.frequency     || 'daily',
    importTime:      setupConfig.importTime    || '06:00',
    importDay:       setupConfig.importDay     || 'Monday',
    status:          setupConfig.status        || 'Active',
    adminEmail:      appConfig.adminEmail      || '',
    alertRecipients: appConfig.alertRecipients || '',
    dashboardAccess: appConfig.dashboardAccess || '',
    fromName:        appConfig.fromName        || 'Vaulter Alerts',
    replyTo:         appConfig.replyTo         || '',
    alertCooldown:   appConfig.alertCooldown   || '1',
  };
});

exports.saveSettings = onCall(FN_OPTS, async (request) => {
  await assertAuthorized(request.auth?.token?.email);
  const d = request.data;

  await Promise.all([
    setAppConfig({
      adminEmail:      d.adminEmail      || '',
      alertRecipients: d.alertRecipients || '',
      dashboardAccess: d.dashboardAccess || '',
      fromName:        d.fromName        || 'Vaulter Alerts',
      replyTo:         d.replyTo         || '',
      alertCooldown:   d.alertCooldown   || '1',
    }),
    setSetupConfig({
      ous:        d.selectedOUs || [],
      dateRange:  d.dateRange   || 'week',
      frequency:  d.frequency   || 'daily',
      importTime: d.importTime  || '06:00',
      importDay:  d.importDay   || 'Monday',
      status:     d.status      || 'Active',
    }),
  ]);

  return { success: true };
});

// ── Pipeline ─────────────────────────────────────────────────

exports.runPipelineNow = onCall(FN_OPTS, async (request) => {
  await assertAuthorized(request.auth?.token?.email);
  await runPipeline(getKey(request));
  return { success: true };
});

// ── Scheduled pipeline (every hour) ──────────────────────────
// Schedule logic (daily/weekly/hourly) is handled inside runScheduledPipeline.

exports.scheduledPipeline = onSchedule(
  { schedule: 'every 60 minutes', region: REGION, secrets: [serviceAccountKey], timeoutSeconds: 540 },
  async () => {
    const raw = process.env[serviceAccountKey.name];
    if (!raw) { console.error('SERVICE_ACCOUNT_KEY not set'); return; }
    await runScheduledPipeline(JSON.parse(raw));
  }
);

// ── OU list helper ───────────────────────────────────────────

async function getOUList(key, adminEmail) {
  if (!adminEmail) return [];
  try {
    const token = await getServiceAccountToken(ADMIN_SCOPES, key, adminEmail);
    const res   = await axios.get(
      `${ADMIN_API}/customer/${CUSTOMER_ID}/orgunits?type=all`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    const paths = (res.data.organizationUnits || [])
      .map(ou => ou.orgUnitPath)
      .sort();
    return ['/', ...paths];
  } catch (e) {
    console.error('getOUList error:', e.message);
    return [];
  }
}
