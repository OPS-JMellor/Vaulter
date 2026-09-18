// ============================================================
// auth.js — Service account JWT auth for Vault + Admin SDK.
// Key is stored in Firebase Secret Manager as SERVICE_ACCOUNT_KEY.
// ============================================================

const jwt   = require('jsonwebtoken');
const axios = require('axios');
const { TOKEN_URL } = require('./config');

/**
 * Returns a short-lived Bearer token for the given scopes,
 * impersonating adminEmail via domain-wide delegation.
 *
 * @param {string[]} scopes
 * @param {object}   key         — parsed service account JSON
 * @param {string}   adminEmail  — super-admin to impersonate
 * @returns {Promise<string>} access token
 */
async function getServiceAccountToken(scopes, key, adminEmail) {
  const now = Math.floor(Date.now() / 1000);

  const claim = {
    iss:   key.client_email,
    sub:   adminEmail,
    scope: scopes.join(' '),
    aud:   TOKEN_URL,
    iat:   now,
    exp:   now + 3600,
  };

  const signedJwt = jwt.sign(claim, key.private_key, { algorithm: 'RS256' });

  let res;
  try {
    res = await axios.post(
      TOKEN_URL,
      new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion:  signedJwt,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
  } catch (err) {
    const detail = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    console.error(`Token exchange failed (${err.response?.status}): ${detail}`);
    throw err;
  }

  return res.data.access_token;
}

module.exports = { getServiceAccountToken };
