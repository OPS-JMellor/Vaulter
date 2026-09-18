// ============================================================
// Alerts.js — Sends email digests for un-alerted flagged content.
// ============================================================

/**
 * Reads un-alerted rows from Flagged sheet, groups by severity,
 * and sends a digest email to configured recipients.
 * @returns {number} Number of alerts sent
 */
function runAlerts() {
  const pendingRows = getPendingAlertRows_();
  if (pendingRows.length === 0) {
    Logger.log('Alerts: nothing to send.');
    return 0;
  }

  const config     = getAppConfig_();
  const recipients = config['Alert Recipients']
    .split(',').map(e => e.trim()).filter(Boolean);

  if (recipients.length === 0) {
    Logger.log('Alerts: no recipients configured in App_Config.');
    return 0;
  }

  const subject = `[Vaulter] ${pendingRows.length} flagged prompt${pendingRows.length > 1 ? 's' : ''} — ${Utilities.formatDate(new Date(), 'America/Chicago', 'MMM d, yyyy')}`;
  const body    = buildEmailBody_(pendingRows, config);

  GmailApp.sendEmail(recipients.join(','), subject, body, {
    htmlBody: buildEmailHtml_(pendingRows, config),
    name:     config['From Name'] || 'Vaulter Alerts',
    replyTo:  config['Reply-To']  || '',
  });

  markAlertsAsSent_(pendingRows);
  Logger.log(`Alerts: sent digest to ${recipients.join(', ')} with ${pendingRows.length} items.`);
  return pendingRows.length;
}

// ── Config ──────────────────────────────────────────────────

function getAppConfig_() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.APP_CONFIG);
  const data  = sheet.getDataRange().getValues().slice(1);
  const config = {};
  data.forEach(r => { if (r[0]) config[r[0]] = r[1]; });
  return config;
}

// ── Pending rows ─────────────────────────────────────────────

function getPendingAlertRows_() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.FLAGGED);
  if (sheet.getLastRow() <= 1) return [];

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 14).getValues();
  return data
    .map((r, i) => ({ row: r, sheetRow: i + 2 }))
    .filter(({ row }) => row[9] === 'FALSE' || row[9] === false); // col J: Alert Sent
}

function markAlertsAsSent_(rows) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.FLAGGED);
  const now   = new Date().toISOString();
  rows.forEach(({ sheetRow }) => {
    sheet.getRange(sheetRow, 10).setValue('TRUE'); // Alert Sent
    sheet.getRange(sheetRow, 11).setValue(now);    // Alert Sent At
  });
}

// ── Email builders ───────────────────────────────────────────

const SEVERITY_ORDER = { Critical: 0, High: 1, Medium: 2, Low: 3 };
const SEVERITY_COLORS = {
  Critical: '#cc0000',
  High:     '#e65c00',
  Medium:   '#e6a817',
  Low:      '#2a7ae2',
};

function buildEmailBody_(rows, config) {
  let text = `Vaulter detected ${rows.length} flagged prompt(s) requiring review.\n\n`;
  rows
    .sort((a, b) => (SEVERITY_ORDER[a.row[8]] ?? 9) - (SEVERITY_ORDER[b.row[8]] ?? 9))
    .forEach(({ row }) => {
      text += `---\n`;
      text += `Severity:  ${row[8]}\n`;
      text += `Category:  ${row[6]}\n`;
      text += `User:      ${row[2]}\n`;
      text += `OU:        ${row[3]}\n`;
      text += `Time:      ${row[4]}\n`;
      text += `Keyword:   ${row[7]}\n`;
      text += `Query:     ${row[5]}\n\n`;
    });
  return text;
}

function buildEmailHtml_(rows, config) {
  const sorted = [...rows].sort(
    (a, b) => (SEVERITY_ORDER[a.row[8]] ?? 9) - (SEVERITY_ORDER[b.row[8]] ?? 9)
  );

  const rowsHtml = sorted.map(({ row }) => {
    const color = SEVERITY_COLORS[row[8]] || '#333';
    return `
      <tr>
        <td style="padding:8px;border-bottom:1px solid #eee;">
          <strong style="color:${color}">${row[8]}</strong>
        </td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${row[6]}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${row[2]}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${row[3]}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;">${row[4]}</td>
        <td style="padding:8px;border-bottom:1px solid #eee;font-style:italic;">${(row[5] || '').substring(0, 120)}…</td>
      </tr>`;
  }).join('');

  return `
    <div style="font-family:sans-serif;max-width:900px;margin:auto;">
      <div style="background:#1a73e8;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h2 style="margin:0;">Vaulter Alert</h2>
        <p style="margin:4px 0 0;">${rows.length} flagged prompt${rows.length > 1 ? 's' : ''} detected</p>
      </div>
      <div style="padding:20px 24px;background:#f8f9fa;border-radius:0 0 8px 8px;">
        <table style="width:100%;border-collapse:collapse;background:#fff;border-radius:6px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
          <thead>
            <tr style="background:#f1f3f4;">
              <th style="padding:10px 8px;text-align:left;">Severity</th>
              <th style="padding:10px 8px;text-align:left;">Category</th>
              <th style="padding:10px 8px;text-align:left;">User</th>
              <th style="padding:10px 8px;text-align:left;">OU</th>
              <th style="padding:10px 8px;text-align:left;">Time</th>
              <th style="padding:10px 8px;text-align:left;">Query (preview)</th>
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
