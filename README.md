# Vaulter

Monitors Gemini activity across the Orono Google Workspace domain via Google
Vault exports, scans prompts against configurable keyword rules, and emails
alert digests to counselors and administrators.

**Pipeline:** Vault API → export → parse → keyword scan → email digest

---

## Which folder is which

| Folder | Status | What it is |
|---|---|---|
| [`apps-script/`](apps-script/) | **Live** | Google Apps Script + Sheets. This is what runs in production. |
| [`firebase/`](firebase/) | Dormant | An incomplete port to Firebase, abandoned Mar 30 2026. Not deployed, not maintained. |

Everything currently in use is in `apps-script/`. Treat `firebase/` as an
archived experiment — see [Firebase port](#firebase-port-dormant) before
reviving it.

## apps-script/ — the live project

Bound to script ID `1cTcy4gCdsqLvrzVIYzfSFI7u3dDeSezbcAwSbTYayd5Cd3E51nWj1s6L`.

```bash
cd apps-script
npm install
clasp pull      # fetch what's live
clasp push      # deploy local changes
clasp open      # open in the Apps Script editor
```

> **Always `clasp pull` before you start.** The script can be edited directly in
> the browser, so the live version may be ahead of what's on disk. Pushing a
> stale checkout silently overwrites production.

### Source layout

| File | Role |
|---|---|
| `Config.js` | Constants, customer ID, corpus settings |
| `Auth.js` | Service account JWT / token exchange |
| `CredentialSetup.js` | One-time paste of the service account key into Script Properties |
| `VaultImport.js` | Vault matter + export creation, async polling, XML parsing |
| `Scanner.js` | Keyword matching against alert rules |
| `Alerts.js` | Email digest composition and send |
| `Scheduler.js` | Trigger installation and schedule logic |
| `SheetSetup.js` | Sheet scaffolding and default alert rules |
| `WebApp.js` | Dashboard backend, access control, AI review |
| `index.html` | Dashboard UI: flag queue with detail pane, bulk review page, AI filtered log, access and settings. One page, no framework |
| `Demo.html` | Sample data and a stand-in for `google.script.run`, used by demo mode |

### Notable mechanics

- **Async exports.** Vault exports routinely outlast Apps Script's 6-minute
  execution limit, so `VaultImport.js` stores pending exports and installs a
  checker trigger (`installExportCheckerTrigger_`) that collects them on a later
  invocation rather than blocking.
- **AI-assisted review.** `callGeminiReview_` triages flagged prompts;
  `suggestAlertCriteria` proposes new keyword rules.
- **Role-based access.** The dashboard access list is managed in-sheet via
  `getAccessList` / `addAccessUser` / `updateAccessRole`.
- **Dashboard design.** Built from the Claude Design canvas at
  https://claude.ai/artifact/553fY9zStYZD2waHeRuwNW (Oct 2026): Lexend plus IBM Plex Mono, navy header
  with a mono readout strip, three "box" panels (7-day stats, 14-day activity, two-pane flag queue),
  one status-chip system (Unreviewed, AI Needs Review, AI Genuine Concern, AI Cleared, Reviewed),
  square severity chips, a timeline per flag, a bulk review page instead of a modal, dark mode and a
  phone layout. Colours and spacing are CSS variables at the top of `index.html`; dividers inside
  panels, no boxes in boxes. The page computes the stats and trend from the flags it loads
  (newest 300) so the server only ships rows plus a pipeline readout.
- **Demo mode.** The "Demo" toggle in the dashboard header (or `?demo=1` on the web app
  URL) swaps every server call for the in-browser sample data in `Demo.html`: fictional students
  on a `demo.orono.k12.mn.us` domain, canned AI verdicts, a simulated import. Nothing in demo
  mode reads or writes the sheets, calls Vault or Gemini, or sends email. The choice is remembered
  per browser; "Reset sample data" restores the starting set. Still gated by `isAuthorized_`.

### Credentials

The service account key lives in Script Properties, set once via
`CredentialSetup.js`. It is **not** in this repo and must never be committed —
`.gitignore` covers `credentials.json`, `service-account*.json` and `*.json.key`.

## firebase/ — dormant port

A partial rewrite onto Firebase Hosting + Cloud Functions + Firestore, started
and abandoned in March 2026. Kept for reference only.

**It is behind the Apps Script version, not ahead of it.** It was branched
before the parser and AI review were written. Known gaps if you ever resume:

- `vaultImport.js` `parseExportRecords` is a stub — it downloads the export and
  discards the contents, writing a `'(raw export — parser pending)'` placeholder.
  The working parser exists only in `apps-script/src/VaultImport.js`.
- `assertAuthorized` in `functions/index.js` fails **open**: if
  `config.dashboardAccess` is empty, any signed-in Google account gets full
  dashboard access. Must be fixed before any deploy.
- No seeder for the `alertRules` collection, and no rule-management UI. The
  default rules exist only in `apps-script/src/SheetSetup.js`.
- Dedupe in `appendVaultData` keys on `exportId`, which is shared by every
  record in an export — so only one record per export would ever be written.
- `shouldRunNow` compares `getUTCHours()` against a local-time setting, firing
  5–6 hours off.

`public/index.html` contains the Firebase web API key. That is not a secret —
Firebase web keys identify the project and security is enforced by Auth plus
Firestore rules — but note it is in the repo if this ever goes public.

---

## History

Reconstructed on 2026-09-18; the project had no version control before that.

| Date | Event |
|---|---|
| Mar 26 2026 | Apps Script project begun |
| Mar 30 2026 | Firebase port started, then abandoned |
| Apr 16 2026 | Last development — this is what runs today |
| Sep 18 2026 | Live code committed for the first time, verified against the deployed script via `clasp pull` |

A superseded Mar 30 snapshot also exists at `H:\My Drive\Vaulter` and at
`Documents\Scripts\_Vaulter-stale-mar30`. Both predate the parser, the async
export pipeline, the AI review and the access control, and **both share this
project's script ID** — a `clasp push` from either would overwrite production
with the March code. They are kept only as archives; do not work from them.
