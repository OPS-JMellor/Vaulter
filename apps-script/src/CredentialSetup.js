// ============================================================
// CredentialSetup.js — One-time setup functions.
// Run these manually from the Apps Script editor, never scheduled.
// ============================================================

/**
 * ONE-TIME: Paste the contents of credentials.json into the `key` variable
 * below, run this function once from the editor, then DELETE the pasted key.
 * The key is stored encrypted in Script Properties — never in source code.
 */
function storeCredentials() {
  const key = {
    // PASTE YOUR credentials.json CONTENT HERE, then run, then delete it.
    // Example structure (do not commit real values):
    // "type": "service_account",
    // "project_id": "vaulter-491416",
    // "private_key_id": "...",
    // "private_key": "-----BEGIN PRIVATE KEY-----\n...",
    // "client_email": "vaulter-service@vaulter-491416.iam.gserviceaccount.com",
    // ...
  };

  if (!key.private_key) {
    throw new Error('Paste your credentials.json content into the key object above before running.');
  }

  PropertiesService.getScriptProperties().setProperty(
    'SERVICE_ACCOUNT_KEY',
    JSON.stringify(key)
  );

  Logger.log('Credentials stored successfully. Remove the pasted key from this function now.');
}

/**
 * Verifies credentials are stored (does not expose the key).
 */
function verifyCredentials() {
  const stored = PropertiesService.getScriptProperties().getProperty('SERVICE_ACCOUNT_KEY');
  if (!stored) {
    Logger.log('No credentials found. Run storeCredentials() first.');
    return;
  }
  const parsed = JSON.parse(stored);
  Logger.log('Credentials present for: ' + parsed.client_email);
}

/**
 * ONE-TIME: Initialize all sheets with correct headers and default config rows.
 * Safe to re-run — skips sheets that already exist.
 */
function runFirstTimeSetup() {
  verifyCredentials();
  setupSheets();
  Logger.log('First-time setup complete.');
}
