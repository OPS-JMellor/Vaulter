// ============================================================
// Auth.js — Returns the OAuth token for the executing user.
// The web app runs as USER_DEPLOYING (super-admin), so
// ScriptApp.getOAuthToken() has Vault + Admin SDK access directly.
// ============================================================

/**
 * Returns fetch options with Authorization header pre-filled.
 * Uses the script executor's OAuth token — no service account needed.
 * @param {Object} [extra] Additional fetch options to merge
 */
function authFetchOptions_(extra) {
  const token = ScriptApp.getOAuthToken();
  return Object.assign({
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  }, extra || {});
}

/**
 * Returns just the Bearer token string.
 */
function getToken_() {
  return ScriptApp.getOAuthToken();
}

/**
 * Reads the admin email from App_Config (kept for reference, not used for auth).
 */
function getAdminEmail_() {
  const config = getAppConfig_();
  const email  = config['Admin Email'];
  if (!email) throw new Error('Admin Email not set in App_Config sheet.');
  return email;
}
