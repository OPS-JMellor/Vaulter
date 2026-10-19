// ============================================================
// WebApp.js — Apps Script web app entry point.
// Serves the dashboard and handles API requests from the frontend.
// ============================================================

function doGet(e) {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) {
    return HtmlService.createHtmlOutput(
      '<h2 style="font-family:sans-serif;color:#cc0000;">Access Denied</h2>' +
      '<p style="font-family:sans-serif;">Your account is not authorized to view this dashboard.</p>'
    ).setTitle('Vaulter — Access Denied');
  }

  const tpl = HtmlService.createTemplateFromFile('index');
  tpl.userEmail = userEmail;
  tpl.userRole  = getUserRole_(userEmail);
  // ?demo=1 opens the dashboard in demo mode (sample data, see Demo.html); ?demo=0 forces live.
  tpl.demoParam = String((e && e.parameter && e.parameter.demo) || '');

  return tpl
    .evaluate()
    .setTitle('Vaulter Dashboard')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ── Authorization ────────────────────────────────────────────

function isAuthorized_(email) {
  if (!email) return false;
  const lc = email.toLowerCase();
  // Check Access_List sheet
  try {
    const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
    const sheet = ss.getSheetByName(SHEETS.ACCESS_LIST);
    if (sheet && sheet.getLastRow() > 1) {
      const emails = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
        .getValues().map(r => String(r[0]).trim().toLowerCase());
      if (emails.includes(lc)) return true;
    }
  } catch (e) {
    Logger.log('isAuthorized_ Access_List error: ' + e.message);
  }
  // Fallback: check legacy Dashboard Access in App_Config
  const config = getAppConfig_();
  const allowed = (config['Dashboard Access'] || '')
    .split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  return allowed.includes(lc);
}

/** Role from the Access_List sheet ('Admin' | 'Viewer'), or '' if only the legacy list allowed them. */
function getUserRole_(email) {
  try {
    const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEETS.ACCESS_LIST);
    if (!sheet || sheet.getLastRow() <= 1) return '';
    const lc  = String(email || '').trim().toLowerCase();
    const row = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues()
      .find(r => String(r[0]).trim().toLowerCase() === lc);
    return row ? String(row[1] || 'Viewer') : '';
  } catch (e) {
    return '';
  }
}

// ── Client-callable API functions ────────────────────────────
// These are called via google.script.run from the frontend.

/**
 * Returns the current pending export status for the dashboard banner.
 */
function getPendingExportStatus() {
  const props   = PropertiesService.getScriptProperties();
  const pending = JSON.parse(props.getProperty('PENDING_EXPORTS') || '[]');
  return { count: pending.length };
}

/**
 * Everything the dashboard needs in one call: the newest flags, totals over
 * every row, the recent run log and the pipeline readout. Cached for 60 s;
 * writes call invalidateDashCache_().
 */
function getDashboardData() {
  const cache  = CacheService.getScriptCache();
  const cached = cache.get('VAULTER_DASH');
  if (cached) return JSON.parse(cached);

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const flags = readFlags_(ss);
  const data  = {
    totals: {
      all:        flags.length,
      unreviewed: flags.filter(f => f.reviewed !== 'TRUE').length,
    },
    flags:    flags.slice(0, 300),
    runLog:   getRecentRuns_(ss),
    pipeline: getPipelineStatus_(ss),
  };
  try { cache.put('VAULTER_DASH', JSON.stringify(data), 60); } catch (e) {}
  return data;
}

/** Every Flagged row as an object, newest first. */
function readFlags_(ss) {
  const sheet = ss.getSheetByName(SHEETS.FLAGGED);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 14).getValues()
    .filter(r => r[0])
    .map(r => ({
      flagId:         r[0],
      exportId:       r[1],
      userEmail:      r[2],
      ouPath:         r[3], // stores grade (e.g. "Grade 09")
      timestamp:      cellString_(r[4]),
      queryText:      r[5],
      category:       r[6],
      matchedKeyword: r[7],
      severity:       r[8],
      alertSent:      isTrue_(r[9]) ? 'TRUE' : 'FALSE',
      alertSentAt:    cellString_(r[10]),
      reviewed:       isTrue_(r[11]) ? 'TRUE' : 'FALSE',
      reviewedBy:     r[12] || '',
      notes:          r[13] || '',
    }))
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
}

function isTrue_(v) { return v === true || v === 'TRUE'; }

/** Sheet cells may come back as Date objects; the client wants strings. */
function cellString_(v) {
  if (v instanceof Date) return v.toISOString();
  return v == null ? '' : String(v);
}

/** Readout strip: schedule, last run, rule count, exports in flight. */
function getPipelineStatus_(ss) {
  const setup = getSetupConfig_();
  const rules = ss.getSheetByName(SHEETS.ALERTS_CONFIG);
  const ruleCount = rules && rules.getLastRow() > 1
    ? rules.getRange(2, 1, rules.getLastRow() - 1, 4).getValues().filter(r => r[0] && isTrue_(r[3])).length
    : 0;
  const runs = getRecentRuns_(ss);
  let pending = 0;
  try { pending = JSON.parse(PropertiesService.getScriptProperties().getProperty('PENDING_EXPORTS') || '[]').length; } catch (e) {}
  return {
    status:         setup.status || 'Active',
    frequency:      setup.frequency || 'daily',
    importTime:     normalizeTime_(setup.importTime || '06:00'),
    importDay:      setup.importDay || 'Monday',
    nextRun:        describeNextRun_(setup, new Date(), Session.getScriptTimeZone()),
    lastRun:        runs[0] || null,
    ruleCount,
    pendingExports: pending,
  };
}

function describeNextRun_(setup, now, tz) {
  if ((setup.status || '') === 'Paused') return 'Paused';
  const freq = (setup.frequency || 'daily').toLowerCase();
  if (freq === 'hourly') return 'Within the hour';
  const time  = normalizeTime_(setup.importTime || '06:00');
  const nowHM = Utilities.formatDate(now, tz, 'HH:mm');
  if (freq === 'weekly') {
    const today = Utilities.formatDate(now, tz, 'EEEE');
    const day   = setup.importDay || 'Monday';
    return (today === day && nowHM < time) ? `Today ${time}` : `${day} ${time}`;
  }
  return (nowHM < time ? 'Today ' : 'Tomorrow ') + time;
}

function getTrendData_() {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.VAULT_DATA);
  if (sheet.getLastRow() <= 1) return { byDay: [], byOU: [], byUser: [] };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 10).getValues();

  // Records by day (col F = Timestamp)
  const dayMap = {};
  rows.forEach(r => {
    const d = r[5] ? r[5].toString().substring(0, 10) : 'Unknown';
    dayMap[d] = (dayMap[d] || 0) + 1;
  });
  const byDay = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, count]) => ({ date, count }));

  // Records by OU (col E)
  const ouMap = {};
  rows.forEach(r => {
    const ou = r[4] || 'Unknown';
    ouMap[ou] = (ouMap[ou] || 0) + 1;
  });
  const byOU = Object.entries(ouMap)
    .sort(([, a], [, b]) => b - a)
    .map(([ou, count]) => ({ ou, count }));

  // Top users by volume (col D)
  const userMap = {};
  rows.forEach(r => {
    const u = r[3] || 'Unknown';
    userMap[u] = (userMap[u] || 0) + 1;
  });
  const byUser = Object.entries(userMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 20)
    .map(([user, count]) => ({ user, count }));

  return { byDay, byOU, byUser };
}

function getRecentRuns_(ss) {
  ss = ss || SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.RUN_LOG);
  if (sheet.getLastRow() <= 1) return [];

  const startRow = Math.max(2, sheet.getLastRow() - 9);
  return sheet.getRange(startRow, 1, sheet.getLastRow() - startRow + 1, 8).getValues()
    .filter(r => r[0])
    .reverse()
    .map(r => ({
      runId:      r[0],
      startedAt:  cellString_(r[1]),
      completedAt:cellString_(r[2]),
      status:     r[3],
      imported:   r[4],
      flagged:    r[5],
      alerted:    r[6],
      error:      r[7],
    }));
}

/**
 * Marks a flagged item as reviewed.
 * Called from the dashboard by an authorized user.
 */
function getFilteredLog() {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.AI_FILTERED);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 9).getValues()
    .filter(r => r[0])
    .sort((a, b) => new Date(b[0]) - new Date(a[0])) // newest first
    .slice(0, 200)
    .map(r => ({
      filteredAt:  r[0] ? String(r[0]).substring(0, 19).replace('T', ' ') : '',
      userEmail:   r[1],
      ouPath:      r[2],
      category:    r[3],
      keyword:     r[4],
      verdict:     r[5],
      assessment:  r[6],
      reasoning:   r[7],
      promptText:  r[8],
    }));
}

function clearFilteredLog() {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.AI_FILTERED);
  if (sheet && sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  return { success: true };
}

function invalidateDashCache_() {
  try { CacheService.getScriptCache().remove('VAULTER_DASH'); } catch (e) {}
}

function markReviewed(flagId, notes) {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.FLAGGED);
  const data  = sheet.getDataRange().getValues();

  for (let i = 1; i < data.length; i++) {
    if (data[i][0] === flagId) {
      sheet.getRange(i + 1, 12).setValue('TRUE');      // Reviewed
      sheet.getRange(i + 1, 13).setValue(userEmail);   // Reviewed By
      sheet.getRange(i + 1, 14).setValue(notes || ''); // Notes
      invalidateDashCache_();
      return { success: true };
    }
  }
  return { success: false, error: 'Flag ID not found' };
}

/** Returns unreviewed flagged items for client-driven bulk AI review. */
function getUnreviewedFlags() {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.FLAGGED);
  if (sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 14).getValues()
    .filter(r => r[0] && !isTrue_(r[11]))
    .map(r => ({
      flagId:         r[0],
      userEmail:      r[2],
      ouPath:         r[3],
      timestamp:      cellString_(r[4]),
      promptText:     r[5],
      category:       r[6],
      matchedKeyword: r[7],
      severity:       r[8],
      alertSent:      isTrue_(r[9]) ? 'TRUE' : 'FALSE',
      alertSentAt:    cellString_(r[10]),
      notes:          r[13] || '',
    }));
}

/** Applies an AI review result to a single flagged row. */
function applyAIReview(flagId, severity, assessment, reasoning) {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.FLAGGED);
  const rows  = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    if (rows[i][0] !== flagId) continue;
    const note = `AI (${severity}): ${assessment} — ${reasoning}`;
    if (severity === 'Likely False Positive') {
      sheet.getRange(i + 1, 12).setValue('TRUE');
      sheet.getRange(i + 1, 13).setValue('AI Auto-Review');
    }
    sheet.getRange(i + 1, 14).setValue(note);
    invalidateDashCache_();
    return { success: true };
  }
  return { success: false };
}

/**
 * Clears all data rows from the Vault_Data sheet.
 * Used to purge legacy records from before in-memory scanning was introduced.
 */
function clearVaultData() {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.VAULT_DATA);
  if (sheet && sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  return { success: true };
}

function clearAllFlagged() {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.FLAGGED);
  if (sheet.getLastRow() > 1) sheet.deleteRows(2, sheet.getLastRow() - 1);
  invalidateDashCache_();
  return { success: true };
}

function reviewFlagWithAI(flagId, promptText, matchedKeyword, category) {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in Script Properties.');
  return { flagId, ...callGeminiReview_(apiKey, promptText, matchedKeyword, category) };
}

function callGeminiReview_(apiKey, promptText, matchedKeyword, category) {
  const systemPrompt = `You are a school safety analyst reviewing flagged student AI prompts at a K-12 school.
Assess whether the flagged query is a genuine safety concern or a false positive.
Consider: academic/educational intent = likely false positive. Specific personal operational detail = concern.
Keep assessment to one short sentence. Keep reasoning to 1-2 short sentences max.
Respond ONLY with valid JSON: {"severity":"Genuine Concern"|"Likely False Positive"|"Needs Review","assessment":"one sentence verdict","reasoning":"1-2 short sentences"}`;

  // Truncate long prompts to avoid overrunning the token budget
  const truncated = promptText.length > 600 ? promptText.substring(0, 600) + '…' : promptText;

  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: `Prompt: "${truncated}"\nMatched keyword: "${matchedKeyword}"\nCategory: "${category}"` }] }],
    generationConfig: { temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json' },
  };

  const res = UrlFetchApp.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true }
  );

  if (res.getResponseCode() !== 200) throw new Error(`Gemini API error ${res.getResponseCode()}: ${res.getContentText()}`);
  const raw = JSON.parse(res.getContentText())?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Empty response from Gemini.');
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Truncated or malformed JSON — return a safe needs-review default
    Logger.log('Gemini JSON parse failed: ' + e.message + ' raw: ' + raw.substring(0, 200));
    return { severity: 'Needs Review', assessment: 'AI response could not be parsed.', reasoning: 'The prompt may be too long or the AI response was truncated. Review manually.' };
  }
}

/**
 * Calls Gemini to suggest K-12 safety alert keyword categories.
 * Returns array of {category, keywords, severity, action} objects.
 */
function suggestAlertCriteria() {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('GEMINI_API_KEY not set in Script Properties.');

  const systemPrompt = `You are a K-12 school safety expert helping configure an AI monitoring system for student Gemini AI usage.
Generate a comprehensive list of alert categories and keywords for flagging potentially harmful student prompts.
Focus on real safety concerns: self-harm, violence/threats, sexual content, drugs/substances, harassment/bullying, cheating/academic dishonesty, radicalization, weapons.
Use specific multi-word phrases (not single short words) to minimize false positives. Think like a school counselor or administrator.
Respond ONLY with a valid JSON array: [{"category":"Category Name","keywords":"phrase1,phrase2,phrase3","severity":"Critical|High|Medium|Low","action":"Both|Email|Sheet"}]
Include 8-10 categories with 6-10 specific keywords/phrases each.`;

  const payload = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ role: 'user', parts: [{ text: 'Generate K-12 student safety monitoring criteria for a Minnesota school district. Cover all major safety concern categories.' }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 2048, responseMimeType: 'application/json' },
  };

  const res = UrlFetchApp.fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`,
    { method: 'post', contentType: 'application/json', payload: JSON.stringify(payload), muteHttpExceptions: true }
  );

  if (res.getResponseCode() !== 200) throw new Error(`Gemini API error ${res.getResponseCode()}: ${res.getContentText()}`);
  const raw = JSON.parse(res.getContentText())?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Empty response from Gemini.');
  return JSON.parse(raw);
}

/**
 * Appends selected AI-suggested criteria rows to the Alerts_Config sheet.
 */
function applyAlertCriteria(categories) {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');
  if (!categories || !categories.length) return { success: true, added: 0 };
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.ALERTS_CONFIG);
  const rows  = categories.map(c => [c.category, c.keywords, c.severity, 'TRUE', c.action || 'Email']);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, 5).setValues(rows);
  return { success: true, added: rows.length };
}

// ── Settings ─────────────────────────────────────────────────

/**
 * Returns all current settings + OU list for the Settings tab.
 */
function getSettingsData() {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');

  const appConfig   = getAppConfig_();
  const setupConfig = getSetupConfig_();
  const ous         = getOUList_();

  return {
    ous,
    selectedOUs:    (setupConfig.ous || []).filter(Boolean),
    dateRange:      setupConfig.dateRange  || 'week',
    frequency:      setupConfig.frequency  || 'daily',
    importTime:     normalizeTime_(setupConfig.importTime || '06:00'),
    importDay:      setupConfig.importDay  || 'Monday',
    status:         setupConfig.status     || 'Active',
    adminEmail:     appConfig['Admin Email']        || '',
    alertRecipients:appConfig['Alert Recipients']   || '',
    dashboardAccess:appConfig['Dashboard Access']   || '',
    fromName:       appConfig['From Name']           || 'Vaulter Alerts',
    replyTo:        appConfig['Reply-To']            || '',
    alertCooldown:  appConfig['Alert Cooldown (h)'] || '1',
  };
}

/**
 * Saves settings from the Settings tab back to the sheets.
 */
function saveSettings(data) {
  if (!data) throw new Error('No settings data received. Please try again.');
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

  // Write App_Config
  const appSheet = ss.getSheetByName(SHEETS.APP_CONFIG);
  const appData  = appSheet.getDataRange().getValues();
  const appMap   = {
    'Admin Email':        data.adminEmail || '',
    'Alert Recipients':   data.alertRecipients || '',
    'Dashboard Access':   data.dashboardAccess || '',
    'From Name':          data.fromName || '',
    'Reply-To':           data.replyTo || '',
    'Alert Cooldown (h)': data.alertCooldown || '',
  };
  for (let i = 1; i < appData.length; i++) {
    if (appMap.hasOwnProperty(appData[i][0])) {
      appSheet.getRange(i + 1, 2).setValue(appMap[appData[i][0]]);
    }
  }

  // Write Setup
  const setupSheet = ss.getSheetByName(SHEETS.SETUP);
  const setupData  = setupSheet.getDataRange().getValues();
  const setupMap   = {
    'OUs to Import':       (data.selectedOUs || []).join(','),
    'Date Range':          data.dateRange,
    'Import Frequency':    data.frequency,
    'Import Time (24h)':   data.importTime,
    'Import Day':          data.importDay,
    'Status':              data.status,
  };
  for (let i = 1; i < setupData.length; i++) {
    if (setupMap.hasOwnProperty(setupData[i][0])) {
      setupSheet.getRange(i + 1, 2).setValue(setupMap[setupData[i][0]]);
    }
  }

  // Reinstall trigger if schedule changed
  installTrigger();
  invalidateDashCache_();

  return { success: true };
}

// ── Access Management ────────────────────────────────────────

function getAccessList() {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.ACCESS_LIST);
  if (!sheet || sheet.getLastRow() <= 1) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues()
    .filter(r => r[0])
    .map(r => ({
      email:   String(r[0]).trim(),
      role:    r[1] || 'Viewer',
      addedBy: r[2] || '',
      addedAt: r[3] ? String(r[3]).substring(0, 19).replace('T', ' ') : '',
    }));
}

function addAccessUser(email, role) {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');
  if (!email || !email.includes('@')) throw new Error('Invalid email address');

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.ACCESS_LIST);

  // Check for duplicate
  if (sheet.getLastRow() > 1) {
    const existing = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1)
      .getValues().map(r => String(r[0]).trim().toLowerCase());
    if (existing.includes(email.trim().toLowerCase())) {
      return { success: false, error: 'User already has access' };
    }
  }

  sheet.appendRow([email.trim(), role || 'Viewer', userEmail, new Date()]);
  return { success: true };
}

function removeAccessUser(email) {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.ACCESS_LIST);
  if (sheet.getLastRow() <= 1) return { success: false, error: 'User not found' };

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === email.trim().toLowerCase()) {
      sheet.deleteRow(i + 2);
      return { success: true };
    }
  }
  return { success: false, error: 'User not found' };
}

function updateAccessRole(email, newRole) {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');

  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SHEETS.ACCESS_LIST);
  if (sheet.getLastRow() <= 1) return { success: false, error: 'User not found' };

  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim().toLowerCase() === email.trim().toLowerCase()) {
      sheet.getRange(i + 2, 2).setValue(newRole);
      return { success: true };
    }
  }
  return { success: false, error: 'User not found' };
}

/**
 * Fetches all OUs from the Admin SDK.
 */
function getOUList_() {
  try {
    const res  = UrlFetchApp.fetch(
      `${ADMIN_API}/customer/${CUSTOMER_ID}/orgunits?type=all`,
      authFetchOptions_()
    );

    const code = res.getResponseCode();
    if (code !== 200) {
      Logger.log(`getOUList_ HTTP ${code}: ${res.getContentText()}`);
      return [{ path: '/', name: '/ (All Users)', depth: 0 }];
    }

    const data = JSON.parse(res.getContentText());
    const ous  = (data.organizationUnits || [])
      .map(ou => ({ path: ou.orgUnitPath, name: ou.name }))
      .sort((a, b) => a.path.localeCompare(b.path));

    Logger.log(`getOUList_ fetched ${ous.length} OUs`);

    return [{ path: '/', name: '/ (All Users)', depth: 0 }, ...ous.map(ou => ({
      path:  ou.path,
      name:  ou.name,
      depth: (ou.path.match(/\//g) || []).length - 1,
    }))];
  } catch (e) {
    Logger.log('getOUList_ error: ' + e.message);
    return [{ path: '/', name: '/ (All Users)', depth: 0 }];
  }
}

/**
 * Runs the full import → scan → alert pipeline immediately.
 * Called from the dashboard "Run Now" button.
 */
function runPipelineNow() {
  const userEmail = Session.getActiveUser().getEmail();
  if (!isAuthorized_(userEmail)) throw new Error('Unauthorized');
  runPipeline();
  return { success: true };
}

// Required for HtmlService.createTemplateFromFile
function include_(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Normalises an importTime value to HH:MM (required by <input type="time">).
 * Handles Date objects (when the Sheet cell is time-formatted) and plain strings.
 */
function normalizeTime_(val) {
  if (!val) return '06:00';
  if (val instanceof Date) {
    const h = String(val.getHours()).padStart(2, '0');
    const m = String(val.getMinutes()).padStart(2, '0');
    return `${h}:${m}`;
  }
  const s = String(val).trim();
  // Already HH:MM or H:MM
  if (/^\d{1,2}:\d{2}$/.test(s)) {
    const [h, m] = s.split(':');
    return `${h.padStart(2, '0')}:${m}`;
  }
  return '06:00';
}
