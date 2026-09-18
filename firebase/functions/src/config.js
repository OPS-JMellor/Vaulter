// ============================================================
// config.js — Central constants for the Firebase migration.
// ============================================================

const COLLECTIONS = {
  VAULT_DATA:  'vaultData',
  FLAGGED:     'flagged',
  RUN_LOG:     'runLog',
  ALERT_RULES: 'alertRules',
};

// Firestore document paths for config
const CONFIG_PATHS = {
  APP:   'config/app',
  SETUP: 'config/setup',
};

const VAULT_API     = 'https://vault.googleapis.com/v1';
const ADMIN_API     = 'https://admin.googleapis.com/admin/directory/v1';
const TOKEN_URL     = 'https://oauth2.googleapis.com/token';
const GMAIL_API     = 'https://gmail.googleapis.com/gmail/v1';
const CUSTOMER_ID   = 'C027lkte3';

const VAULT_SCOPES = [
  'https://www.googleapis.com/auth/ediscovery',
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
  'https://www.googleapis.com/auth/devstorage.read_only',
];

const ADMIN_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.orgunit.readonly',
  'https://www.googleapis.com/auth/admin.directory.user.readonly',
];

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
];

// Vault corpus for Gemini for Google Workspace activity.
// TODO: update if Google adds a dedicated GEMINI corpus.
const GEMINI_CORPUS = 'MAIL';

const EXPORT_POLL_MAX_ATTEMPTS = 20;
const EXPORT_POLL_INTERVAL_MS  = 15_000;

module.exports = {
  COLLECTIONS, CONFIG_PATHS,
  VAULT_API, ADMIN_API, TOKEN_URL, GMAIL_API, CUSTOMER_ID,
  VAULT_SCOPES, ADMIN_SCOPES, GMAIL_SCOPES,
  GEMINI_CORPUS, EXPORT_POLL_MAX_ATTEMPTS, EXPORT_POLL_INTERVAL_MS,
};
