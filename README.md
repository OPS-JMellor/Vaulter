# Vaulter

Vaulter watches what students ask Gemini and tells a counselor when something needs a human.
It pulls Gemini activity from Google Vault, scans each prompt against keyword rules, asks Gemini
whether a match is a real concern, emails the flagged ones, and gives reviewers a dashboard to
work the queue. It is a Google Apps Script bound to a Google Sheet: nothing to host, nothing to buy.

Built by the technology department at Orono Public Schools, Minnesota.

**Site:** https://orono-public-schools.github.io/Vaulter ·
**Live demo:** [the dashboard on sample data](https://orono-public-schools.github.io/Vaulter/demo/) ·
**Setup walkthrough:** [five stages, about an afternoon](https://orono-public-schools.github.io/Vaulter/setup.html)

## How it works

Vault export → parse prompts → keyword rules → Gemini triage → email digest → dashboard review

A scheduled run asks Vault for the Gemini activity since the last run, waits for the export, reads
each prompt in memory and keeps only the ones that match a keyword rule. Each match goes to Gemini
for triage: likely false positives land in a log, everything else is written to the `Flagged` tab,
emailed to the counselors and waits in the dashboard queue. Students are masked in the dashboard
until a reviewer clicks Reveal.

## What you need

- Google Workspace for Education with Gemini on for students and Vault licenses for them.
- A super-admin with Vault privileges. The script runs as that account; there is no service account
  or Cloud project to set up.
- Optionally a Gemini API key from Google AI Studio. Without it, matches are flagged without an AI
  verdict.

## Setting it up

Follow the [setup walkthrough](https://orono-public-schools.github.io/Vaulter/setup.html). In short:

Using an AI coding agent such as Claude Code or Gemini CLI? The walkthrough's first stage has a
prompt to paste that lets the agent clone, create the Sheet with clasp, push the code and hand you
the steps only a person can do.

1. Create a Google Sheet, open Extensions → Apps Script, turn on "Show appsscript.json" in Project
   Settings, and add every file from `apps-script/src` with the same name (or push with clasp).
2. Run `setupSheets` from the editor and approve the permissions. Eight tabs appear with defaults.
3. Fill in `Setup` (OUs to import, schedule), `App_Config` (alert recipients), `Alerts_Config`
   (keywords) and `Access_List` (who can open the dashboard). Add `GEMINI_API_KEY` as a script property.
4. Deploy → New deployment → Web app, execute as Me, access: anyone in your domain. Put the URL in
   the `DASHBOARD_URL` script property.
5. Run `installTrigger` once, then press Run import now in the dashboard.

Later code changes: Deploy → Manage deployments → edit → New version keeps the same URL.
With clasp: `clasp push`, then `clasp deploy -i <deployment id> -d "<note>"`.

### Script properties

| Property | Required | What it does |
|---|---|---|
| `GEMINI_API_KEY` | no | Enables AI triage at import and in the dashboard |
| `DASHBOARD_URL` | no | The deployed web app URL, for the Sheet's Vaulter menu |
| `SPREADSHEET_ID` | no | Use a Sheet other than the one the script is bound to |
| `VAULT_MATTER_ID`, `PENDING_EXPORTS` | set by the script | The Vault matter it created and exports in flight |

## Repository layout

| Path | What it is |
|---|---|
| `apps-script/src/` | The script. `Config.js` constants, `VaultImport.js` export and scan, `Scanner.js` rules, `Alerts.js` email, `Scheduler.js` triggers and the Sheet menu, `SheetSetup.js` tab scaffolding, `WebApp.js` dashboard backend, `index.html` dashboard UI, `Demo.html` sample data for demo mode |
| `apps-script/.clasp.json.example` | Copy to `.clasp.json` with your script ID to use clasp |
| `docs/` | The site: landing page, setup walkthrough, and the dashboard running on sample data. `node docs/build-demo.js` regenerates the demo from the dashboard source |

Nothing in this repo is specific to one district. Per-install values live in Script Properties and
the Sheet; `.clasp.json` is ignored so your script ID stays on your machine.

## Working on it

```bash
cd apps-script
cp .clasp.json.example .clasp.json   # paste your script ID
npm install && clasp login
clasp pull      # fetch what's live; the script can also be edited in the browser
clasp push      # send local changes to the script's HEAD
```

The dashboard is one HTML page with no framework. Colours and spacing are CSS variables at the top
of `index.html`. Demo mode (the Demo toggle, or `?demo=1`) answers every server call from
`Demo.html` without touching the sheets, Vault, Gemini or email; the public demo is the same page
built statically. After a dashboard change, run `node docs/build-demo.js` and commit the result.

## Privacy

- Everything runs in the district's own Google Workspace: the script, the Sheet that holds flags,
  the alert email. No outside server.
- Only prompts that match a rule are kept. The rest are read in memory and discarded; the
  `Vault_Data` staging tab is cleared after every scan.
- AI triage sends the matched prompt text to Google's Gemini API and keeps only the verdict.
- Vault is read with the credentials of the admin who deploys the script, through the scopes in
  `appsscript.json`.

## Limits

Keyword rules are blunt and need tending. The AI verdict is triage, not a decision. Runs are
scheduled, not real time, because Vault exports take minutes to hours. It sees Gemini prompts only.
Apps Script's six-minute execution cap is why exports are collected by a checker trigger.

## License

MIT. See [LICENSE](LICENSE).

## Contact

Joel Mellor, Technology, Orono Public Schools · joel.mellor@orono.k12.mn.us
