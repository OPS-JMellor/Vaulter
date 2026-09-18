// ============================================================
// Config.js — Central constants. Update ADMIN_EMAIL before first run.
// ============================================================

const SPREADSHEET_ID = '1xUea7zwKsn4HsLq02irfQE2d6-RsvXGZ5aJSWhXvfgQ';

const SHEETS = {
  VAULT_DATA:    'Vault_Data',
  ALERTS_CONFIG: 'Alerts_Config',
  APP_CONFIG:    'App_Config',
  SETUP:         'Setup',
  FLAGGED:       'Flagged',
  RUN_LOG:       'Run_Log',
  AI_FILTERED:   'AI_Filtered',
  ACCESS_LIST:   'Access_List',
};

const SERVICE_ACCOUNT_EMAIL = 'gemini-vault@gemini-vault-491818.iam.gserviceaccount.com';

const CUSTOMER_ID = 'C027lkte3';

const VAULT_API  = 'https://vault.googleapis.com/v1';
const ADMIN_API  = 'https://admin.googleapis.com/admin/directory/v1';
const TOKEN_URL  = 'https://oauth2.googleapis.com/token';

const VAULT_SCOPES = [
  'https://www.googleapis.com/auth/ediscovery.readonly',
  'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
];

// Vault corpus for Gemini for Google Workspace activity.
// Verify against: https://developers.google.com/vault/reference/rest/v1/matters.exports#CorpusQuery
const GEMINI_CORPUS = 'GEMINI';

// How long (ms) to wait between export status polls
const EXPORT_POLL_INTERVAL_MS = 10000;
const EXPORT_POLL_MAX_ATTEMPTS = 30;
