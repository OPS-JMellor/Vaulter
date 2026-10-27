# Vaulter

Vaulter watches what students ask Gemini and tells a counselor when something needs a human.
It pulls Gemini activity from Google Vault, scans each prompt against keyword rules, asks Gemini
whether a match is a real concern, emails the flagged ones, and gives reviewers a dashboard to
work the queue. Built by Orono Public Schools (MN) technology in Google Apps Script on top of a
Google Sheet, with no servers to run.

**Site and live demo:** https://ops-jmellor.github.io/Vaulter · **Setup guide:** [docs/setup.html](https://ops-jmellor.github.io/Vaulter/setup.html)

**Pipeline:** Vault export → parse → keyword rules → Gemini triage → email digest → dashboard review

---

## Which folder is which

| Folder | Status | What it is |
|---|---|---|
| [`apps-script/`](apps-script/) | **Live** | Google Apps Script + Sheets. This is what runs in production. |
| [`docs/`](docs/) | Site | GitHub Pages: landing page, setup guide and the dashboard running on sample data. |
| [`firebase/`](firebase/) | Dormant | An incomplete port to Firebase, abandoned Mar 2026. Not deployed, not maintained. |

## apps-script/ — the live project

```bash
cd apps-script
cp .clasp.json.example .clasp.json   # then paste your script ID into it
npm install
clasp login
clasp pull      # fetch what's live
clasp push      # send local changes to the script's HEAD
clasp open      # open in the Apps Script editor
```

> **Always `clasp pull` before you start.** The script can be edited directly in
> the browser, so the live version may be ahead of what's on disk. Pushing a
> stale checkout silently overwrites it.

### Source layout

| File | Role |
|---|---|
| `Config.js` | Sheet names, API bases, corpus. Nothing district-specific |
| `Auth.js` | OAuth token of the account the script runs as |
| `VaultImport.js` | Vault matter + export creation, async polling, XML parsing, inline scan |
| `Scanner.js` | Keyword matching against alert rules |
| `Alerts.js` | Email digest composition and send |
| `Scheduler.js` | Pipeline entry point, trigger installation, Sheet menu |
| `SheetSetup.js` | Sheet scaffolding and default alert rules |
| `WebApp.js` | Dashboard backend, access control, AI review |
| `index.html` | Dashboard UI: flag queue with detail pane, bulk review page, AI filtered log, access and settings. One page, no framework |
| `Demo.html` | Sample data and a stand-in for `google.script.run`, used by demo mode and the docs site |

### Setup from scratch

The full walkthrough with troubleshooting is at [docs/setup.html](https://ops-jmellor.github.io/Vaulter/setup.html). The short version:

1. **Prerequisites.** Google Workspace for Education with Gemini on for students and Vault licenses
   for them. A super-admin with Vault privileges; the whole thing runs as that account. Optionally a
   Gemini API key from Google AI Studio.
2. **Sheet and script.** Create a Google Sheet, open Extensions → Apps Script, turn on "Show
   appsscript.json" in Project Settings, and copy every file from `apps-script/src` in with the same
   names (or `clasp push`). The manifest carries the OAuth scopes.
3. **Tabs.** Run `setupSheets` from the editor and approve the permissions. Eight tabs appear with
   headers and default rules.
4. **Configure.** In the Sheet: `Setup` (OUs to import, date range, schedule, status), `App_Config`
   (alert recipients, from name, reply-to), `Alerts_Config` (keywords per category), `Access_List`
   (who can open the dashboard, Admin or Viewer). In Script properties: `GEMINI_API_KEY`.
5. **Publish.** Deploy → New deployment → Web app, execute as Me, access: anyone in your domain.
   Open the URL. Put it in the `DASHBOARD_URL` script property so the Sheet's Vaulter menu finds it.
6. **Schedule and run.** Run `installTrigger` once, then click Run import now. The first run creates
   a Vault matter, queues an export per OU, and a five-minute checker trigger collects the exports
   when Vault finishes them.

Later code changes: Deploy → Manage deployments → edit → New version keeps the same URL. With
clasp: `clasp push`, then `clasp deploy -i <deployment id> -d "<note>"`. A bare `clasp deploy`
makes a new deployment with a new URL.

### Script properties

| Property | Required | What it does |
|---|---|---|
| `GEMINI_API_KEY` | no | Enables AI triage at import and in the dashboard. Without it, matches are flagged without a verdict |
| `SPREADSHEET_ID` | no | Use a Sheet other than the one the script is bound to |
| `DASHBOARD_URL` | no | The deployed web app URL, for the Sheet's Vaulter menu |
| `VAULT_MATTER_ID`, `PENDING_EXPORTS` | set by the script | The Vault matter it created and exports still in flight |

### Notable mechanics

- **Async exports.** Vault exports routinely outlast Apps Script's 6-minute
  execution limit, so `VaultImport.js` stores pending exports and installs a
  checker trigger (`installExportCheckerTrigger_`) that collects them on a later
  invocation rather than blocking.
- **Inline AI triage.** `parseAndScanExport_` asks Gemini about each keyword match during import.
  Likely false positives go to the `AI_Filtered` tab instead of `Flagged`; everything else is
  flagged with the verdict in its notes. `reviewFlagWithAI` re-asks from the dashboard;
  `suggestAlertCriteria` proposes new keyword rules.
- **Role-based access.** The dashboard access list is managed in-sheet via
  `getAccessList` / `addAccessUser` / `updateAccessRole`, and from the dashboard's Access page.
- **Dashboard design.** Built from a Claude Design canvas (Oct 2026): Lexend, navy header with a
  readout strip, three "box" panels (7-day stats, 14-day activity, two-pane flag queue), one
  status-chip system (Unreviewed, AI Needs Review, AI Genuine Concern, AI Cleared, Reviewed),
  square severity chips, a timeline per flag, a bulk review page instead of a modal, dark mode and
  a phone layout. Colours and spacing are CSS variables at the top of `index.html`; dividers inside
  panels, no boxes in boxes. The page computes the stats and trend from the flags it loads (newest
  300) so the server only ships rows plus a pipeline readout.
- **Demo mode.** The "Demo" toggle in the dashboard header (or `?demo=1` on the web app URL) swaps
  every server call for the in-browser sample data in `Demo.html`: fictional students, canned AI
  verdicts, a simulated import. Nothing in demo mode reads or writes the sheets, calls Vault or
  Gemini, or sends email. The choice is remembered per browser; "Reset sample data" restores the
  starting set. Still gated by `isAuthorized_`. The same mechanism powers the public demo on the
  docs site: `node docs/build-demo.js` regenerates `docs/demo/index.html` from the dashboard source.

### Privacy

- Everything runs in the district's own Google Workspace: the script, the Sheet that holds flags,
  the alert email. No outside server.
- Only prompts that match a rule are kept. The rest are read in memory and discarded; the
  `Vault_Data` staging tab is cleared after every scan.
- AI triage sends the matched prompt text to Google's Gemini API and keeps only the verdict.
- Vault is read with the credentials of the admin who deploys the script, through the scopes in
  `appsscript.json`. No service account, no key file.
- Student identity is masked in the dashboard until a reviewer clicks Reveal.

Nothing in this repo is secret. Per-install values (Sheet, API key, URLs) live in Script
Properties; `.clasp.json` is ignored so your script ID stays on your machine.

## docs/ — the site

GitHub Pages serves `docs/` from `main`. `index.html` is the landing page, `setup.html` the setup
guide, and `demo/index.html` the dashboard running entirely in the browser on sample data. After a
dashboard change, run `node docs/build-demo.js` and commit the result.

## firebase/ — dormant port

A partial rewrite onto Firebase Hosting + Cloud Functions + Firestore, started
and abandoned in March 2026. Kept for reference only; config values are placeholders.

**It is behind the Apps Script version, not ahead of it.** Known gaps if you ever resume:

- `vaultImport.js` `parseExportRecords` is a stub that discards the export contents. The working
  parser exists only in `apps-script/src/VaultImport.js`.
- `assertAuthorized` in `functions/index.js` fails **open** when `config.dashboardAccess` is empty.
- No seeder for the `alertRules` collection and no rule-management UI.
- Dedupe in `appendVaultData` keys on `exportId`, shared by every record in an export.
- `shouldRunNow` compares `getUTCHours()` against a local-time setting.

## History

| Date | Event |
|---|---|
| Mar 26 2026 | Apps Script project begun |
| Mar 30 2026 | Firebase port started, then abandoned |
| Apr 16 2026 | Pipeline, inline AI triage and access control complete |
| Sep 18 2026 | First commit, verified against the deployed script via `clasp pull` |
| Oct 19 2026 | Demo mode; dashboard redesigned from a Claude Design canvas |
| Oct 27 2026 | Repo made public; district identifiers moved to Script Properties; docs site |
