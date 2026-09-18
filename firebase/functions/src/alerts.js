// ============================================================
// alerts.js — Sends email digests for un-alerted flagged content.
// Uses the Gmail API via service account DWD.
// ============================================================

const axios = require('axios');
const { getServiceAccountToken } = require('./auth');
const { getPendingAlertRecords, markAlertsAsSent, getAppConfig } = require('./firestore');
const { GMAIL_API, GMAIL_SCOPES } = require('./config');

const SEVERITY_ORDER  = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const SEVERITY_COLORS = {
  Critical: '#ad2122',
  High:     '#7a1718',
  Medium:   '#c13435',
  Low:      '#4356a0',
};

/**
 * Sends a digest email for all un-alerted flagged records.
 * @param {object} key — parsed service account JSON
 * @returns {Promise<number>} count of alerts sent
 */
async function runAlerts(key) {
  const pending = await getPendingAlertRecords();
  if (pending.length === 0) {
    console.log('Alerts: nothing to send.');
    return 0;
  }

  const config     = await getAppConfig();
  const recipients = (config.alertRecipients || '')
    .split(',').map(e => e.trim()).filter(Boolean);

  if (recipients.length === 0) {
    console.log('Alerts: no recipients configured.');
    return 0;
  }

  const dateStr  = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric',
  });
  const subject  = `[Vaulter] ${pending.length} flagged prompt${pending.length > 1 ? 's' : ''} — ${dateStr}`;
  const textBody = buildPlainText(pending);
  const htmlBody = buildHtmlBody(pending);

  await sendGmailMessage({
    to:       recipients.join(','),
    from:     `${config.fromName || 'Vaulter Alerts'} <${config.adminEmail}>`,
    replyTo:  config.replyTo || '',
    subject,
    textBody,
    htmlBody,
    key,
    adminEmail: config.adminEmail,
  });

  await markAlertsAsSent(pending.map(r => r.id));
  console.log(`Alerts: sent digest to ${recipients.join(', ')} with ${pending.length} items.`);
  return pending.length;
}

// ── Gmail API ────────────────────────────────────────────────

async function sendGmailMessage({ to, from, replyTo, subject, textBody, htmlBody, key, adminEmail }) {
  const token    = await getServiceAccountToken(GMAIL_SCOPES, key, adminEmail);
  const boundary = `vaulter_${Date.now()}`;

  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    textBody,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    '',
    htmlBody,
    '',
    `--${boundary}--`,
  ].filter(l => l !== null).join('\r\n');

  const raw = Buffer.from(lines).toString('base64url');

  await axios.post(
    `${GMAIL_API}/users/me/messages/send`,
    { raw },
    { headers: { Authorization: `Bearer ${token}` } }
  );
}

// ── Email builders ───────────────────────────────────────────

function sorted(records) {
  return [...records].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9)
  );
}

function buildPlainText(records) {
  let text = `Vaulter detected ${records.length} flagged prompt(s) requiring review.\n\n`;
  sorted(records).forEach(r => {
    text += `---\n`;
    text += `Severity: ${r.severity}\n`;
    text += `Category: ${r.category}\n`;
    text += `User:     ${r.userEmail}\n`;
    text += `OU:       ${r.ouPath}\n`;
    text += `Time:     ${r.timestamp}\n`;
    text += `Keyword:  ${r.matchedKeyword}\n`;
    text += `Query:    ${r.queryText}\n\n`;
  });
  return text;
}

function buildHtmlBody(records) {
  const rowsHtml = sorted(records).map(r => {
    const color = SEVERITY_COLORS[r.severity] || '#333';
    return `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">
          <strong style="color:${color}">${esc(r.severity)}</strong>
        </td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${esc(r.category)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${esc(r.userEmail)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${esc(r.ouPath)}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${esc(String(r.timestamp).substring(0, 16))}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-style:italic;">${esc((r.queryText || '').substring(0, 120))}…</td>
      </tr>`;
  }).join('');

  return `
    <div style="font-family:'Lexend',sans-serif;max-width:900px;margin:auto;">
      <div style="background:#2d3f89;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;font-size:18px;">Vaulter Alert</h2>
        <p style="margin:4px 0 0;opacity:.8;font-size:13px;">
          ${records.length} flagged prompt${records.length > 1 ? 's' : ''} detected
        </p>
      </div>
      <div style="padding:20px 24px;background:#f3f3f3;border-radius:0 0 8px 8px;">
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <thead>
            <tr style="background:#eaecf5;">
              <th style="padding:10px 8px;text-align:left;color:#1d2a5d;font-size:12px;">Severity</th>
              <th style="padding:10px 8px;text-align:left;color:#1d2a5d;font-size:12px;">Category</th>
              <th style="padding:10px 8px;text-align:left;color:#1d2a5d;font-size:12px;">User</th>
              <th style="padding:10px 8px;text-align:left;color:#1d2a5d;font-size:12px;">OU</th>
              <th style="padding:10px 8px;text-align:left;color:#1d2a5d;font-size:12px;">Time</th>
              <th style="padding:10px 8px;text-align:left;color:#1d2a5d;font-size:12px;">Query (preview)</th>
            </tr>
          </thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        <p style="color:#666;font-size:13px;margin-top:16px;">
          Log into the Vaulter dashboard to review and mark items as resolved.
        </p>
      </div>
    </div>`;
}

function esc(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

module.exports = { runAlerts };
