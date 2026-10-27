// ============================================================
// Config.js — Central constants.
//
// Nothing district-specific lives here. The Sheet is the one this
// script is bound to, the Workspace customer is whoever runs it, and
// per-install values (Gemini key, optional overrides) are Script
// Properties: Project Settings → Script properties.
//   GEMINI_API_KEY   optional, enables AI triage
//   SPREADSHEET_ID   optional, use a Sheet other than the bound one
//   DASHBOARD_URL    optional, the deployed web app URL for the Sheet menu
// ============================================================

const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID')
  || (SpreadsheetApp.getActiveSpreadsheet() && SpreadsheetApp.getActiveSpreadsheet().getId());

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

// Admin SDK alias for "the customer of the signed-in admin".
const CUSTOMER_ID = 'my_customer';

const VAULT_API  = 'https://vault.googleapis.com/v1';
const ADMIN_API  = 'https://admin.googleapis.com/admin/directory/v1';

// Vault corpus for Gemini for Google Workspace activity.
// Verify against: https://developers.google.com/vault/reference/rest/v1/matters.exports#CorpusQuery
const GEMINI_CORPUS = 'GEMINI';

// How long (ms) to wait between export status polls
const EXPORT_POLL_INTERVAL_MS = 10000;
const EXPORT_POLL_MAX_ATTEMPTS = 30;
