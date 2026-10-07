# jobs-console

A Databricks App powered by [AppKit](https://developers.databricks.com/docs/appkit/v0/), featuring React, TypeScript, and Tailwind CSS.

**Enabled plugins:**
- **Server** -- Express HTTP server with static file serving and Vite dev mode

## Prerequisites

- Node.js v22+ and npm
- Databricks CLI (for deployment)
- Access to a Databricks workspace

## Databricks Authentication

### Local Development

For local development, configure your environment variables by creating a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and set the environment variables you need:

```env
DATABRICKS_HOST=https://your-workspace.cloud.databricks.com
DATABRICKS_APP_PORT=8000
# ... other environment variables, depending on the plugins you use
```

### CLI Authentication

The Databricks CLI requires authentication to deploy and manage apps. Configure authentication using one of these methods:

#### OAuth U2M

Interactive browser-based authentication with short-lived tokens:

```bash
databricks auth login --host https://your-workspace.cloud.databricks.com
```

This will open your browser to complete authentication. The CLI saves credentials to `~/.databrickscfg`.

#### Configuration Profiles

Use multiple profiles for different workspaces:

```ini
[DEFAULT]
host = https://dev-workspace.cloud.databricks.com

[production]
host = https://prod-workspace.cloud.databricks.com
client_id = prod-client-id
client_secret = prod-client-secret
```

Deploy using a specific profile:

```bash
databricks bundle deploy --profile production
```

**Note:** Personal Access Tokens (PATs) are legacy authentication. OAuth is strongly recommended for better security.

## Run locally

### Without npm install (any machine, e.g. GovCloud)

You need Node.js 22 or later and the Databricks CLI. This runs the prebuilt app in `deploy/`, which comes with `git pull`.

```powershell
databricks auth login --host https://<workspace-url> --profile gov   # once per machine
cd jobs-console
.\run-local.ps1 -Profile gov                                        # http://127.0.0.1:8000, Ctrl+C to stop
```

- It reads Databricks as you (the CLI profile), so you see every job and pipeline you can see in the workspace UI.
- Options: `-Port 8001` and `-Data mock`.
- The Capture menu (download, and the 90-day sweep) works locally too.

If you'd rather not use the script, this does the same by hand:

```powershell
cd jobs-console\deploy
$env:NODE_ENV='production'; $env:JOBS_CONSOLE_DATA='live'; $env:JOBS_CONSOLE_AUTH='app'
$env:DATABRICKS_CONFIG_PROFILE='gov'; $env:DATABRICKS_APP_PORT='8000'; $env:FLASK_RUN_HOST='127.0.0.1'
node server.mjs
```

The same in Command Prompt:

```bat
cd jobs-console\deploy
set NODE_ENV=production
set JOBS_CONSOLE_DATA=live
set JOBS_CONSOLE_AUTH=app
set DATABRICKS_CONFIG_PROFILE=gov
set DATABRICKS_APP_PORT=8000
set FLASK_RUN_HOST=127.0.0.1
node server.mjs
```

Run it from inside `deploy\`, because the server serves the page from `public\` under the current folder.

From a Command Prompt tab, or if PowerShell refuses to run the script ("running scripts is disabled"), use `powershell -ExecutionPolicy Bypass -File .\run-local.ps1 -Profile gov`.

### Dev mode from Windows Terminal (changing code; needs npm registry access)

A Windows Terminal tab runs either **Command Prompt** or **PowerShell**. The prompt tells you which: `C:\...>` is Command Prompt, and `PS C:\...>` is PowerShell. The steps are the same in both; only the syntax for setting variables differs.

**1. One-time setup per machine: sign in to the workspace**

```
databricks auth login --host https://<workspace-url> --profile gov
```

The npm scripts work the same in Command Prompt, PowerShell and Git Bash, so no shell setting is needed.

**2. Create `.env`** in the folder that has `package.json`, with the profile you logged in with:

```
DATABRICKS_CONFIG_PROFILE=gov
DATABRICKS_APP_PORT=8000
DATABRICKS_APP_NAME=jobs-console
FLASK_RUN_HOST=127.0.0.1
```

`FLASK_RUN_HOST=127.0.0.1` makes the server listen on this machine only. Without it the server listens on `0.0.0.0` and prints `http://0.0.0.0:8000`. That isn't a browsable address, and corporate web filters block it ("Web Page Blocked"). Always open **http://127.0.0.1:8000**. `.env` is gitignored, so each machine needs its own.

**3. Install and run.** Open http://127.0.0.1:8000, and press Ctrl+C to stop.

Command Prompt:

```bat
cd C:\path\to\jobs-console
npm install
rem mock data:
npm run dev
rem live data from the workspace in .env:
set JOBS_CONSOLE_DATA=live
npm run dev
```

PowerShell:

```powershell
cd C:\path\to\jobs-console
npm install
npm run dev                                  # mock data
$env:JOBS_CONSOLE_DATA='live'; npm run dev   # live data from the workspace in .env
```

- `set` and `$env:` last only for that tab. Open a new tab, or run `set JOBS_CONSOLE_DATA=` or `Remove-Item Env:JOBS_CONSOLE_DATA`, to go back to mock data.
- `npm test` runs the unit and component tests.

- Data source: `JOBS_CONSOLE_DATA=mock` (default) or `live`. Live mode reads the Jobs and Pipelines APIs: in local dev as the `DATABRICKS_CONFIG_PROFILE` from `.env`, and when deployed as the app's service principal (`JOBS_CONSOLE_AUTH=app`; see Deployment). Run it locally with `$env:JOBS_CONSOLE_DATA='live'; npm run dev` (PowerShell) or `JOBS_CONSOLE_DATA=live npm run dev` (Git Bash); on Databricks Apps add `env: [{ name: JOBS_CONSOLE_DATA, value: live }]` to `app.yaml`. Limits, with defaults: `JOBS_CONSOLE_WINDOW_DAYS` (30), `JOBS_CONSOLE_MAX_RUNS` (2000), `JOBS_CONSOLE_TIMEOUT_MS` (12000), `JOBS_CONSOLE_CONCURRENCY` (8). Hitting the cap or the timeout returns what was collected and logs a warning.
- Incremental refresh (live): the server keeps a per-user snapshot of the last full load, and other `/api/runs` calls only fetch what can have changed since (active runs, runs started since, runs that just finished, pipelines whose latest update changed or is live) and merge it in. A full load happens on first load, when the window changes, when the snapshot is older than `JOBS_CONSOLE_FULL_REFRESH_MS` (900000 = 15 min), when a delta step fails (diagnostic `delta-fallback`), and on the filter bar's ↻ (`/api/runs?full=1`). `JOBS_CONSOLE_INCREMENTAL=0` makes every call a full load. Each response carries `refresh: { mode, calls, ms }`.
- Replay: `JOBS_CONSOLE_DATA=replay` with `JOBS_CONSOLE_REPLAY=<capture .json.gz>` serves a capture from a live workspace back, frozen at the moment it was taken (badge: "replay"). Shortcut: `npm run replay -- <file> [session id]`. `JOBS_CONSOLE_REPLAY_SESSION=<id>` picks a session; default is the newest sweep, else the newest `/api/runs` session. A delta session is replayed over the full load (and deltas) recorded before it. `npm run capture:summary -- <file>` prints sessions, top diagnostics, errors and client errors: run it first when a file comes back.
- Press `L` in the app to show the numbered reference rows used in design reviews.
- The npm scripts work in any shell: environment variables are set through `scripts/with-env.mjs`, not `NAME=value` syntax (which fails in Command Prompt with "'NODE_ENV' is not recognized"). Never add a project `.npmrc`: the bundle uploads it, and a Windows-only setting there breaks `npm install` on the Linux Databricks Apps runtime.

## Code Quality

There are a few commands to help you with code quality:

```bash
# Type checking
npm run typecheck

# Linting
npm run lint
npm run lint:fix

# Formatting
npm run format
npm run format:fix
```

## Deployment

The app deploys from `deploy/`, a prebuilt, self-contained folder that is committed to git:

- `server.mjs` and its chunks: the server with every dependency bundled in.
- `public/`: the built client.
- `app.yaml`: runs `node server.mjs` with `NODE_ENV=production`.

`deploy/` has no `package.json` on purpose. Databricks Apps then logs "No dependencies file found. Skipping installation." and runs no `npm install` on the platform. That install fails where the app can't reach the npm registry (GovCloud: `npm error Exit handler never called!`).

The deploying machine needs only git and the Databricks CLI, not Node.

```powershell
cd jobs-console
databricks bundle deploy --profile <profile>   # uploads files; creates and starts the app the first time
databricks bundle run app --profile <profile>  # deploys the uploaded source to the app: needed for every update
```

`bundle deploy` alone does not redeploy an existing app. Always follow it with `bundle run app`.

After changing code or `app.yaml`, rebuild `deploy/` on a dev machine and commit it:

```powershell
npm run package
git add deploy app.yaml
```

### Auth: the app reads as its service principal

Databricks Apps user authorization has no `jobs` or `pipelines` scope. Declaring `jobs` fails with `400 INVALID_PARAMETER_VALUE: The specified scope jobs is not a valid scope` ([supported scopes](https://learn.microsoft.com/en-us/azure/databricks/dev-tools/databricks-apps/auth#supported-scopes)). So `app.yaml` sets `JOBS_CONSOLE_AUTH=app`, and the app reads Jobs and Pipelines as its own service principal. The viewer's `x-forwarded-email` still decides "Mine". The badge says "live data · as app".

The service principal sees only the jobs and pipelines it has **CAN_VIEW** on. Find its ID with `databricks apps get jobs-console -o json` (`service_principal_client_id`). Grant it CAN_VIEW on the jobs and pipelines, or add it to a group that already has that access.

### Another workspace (e.g. AWS GovCloud)

The `gov` target deploys the same app to the workspace of the `gov` CLI profile. The CLI does not substitute variables in `workspace.host`, so the host comes from the profile, and `--var gov_host=<url>` is informational only.

```powershell
$url = 'https://dbc-xxxxxxxx-xxxx.cloud.databricks.us'
databricks auth login --host $url --profile gov
databricks bundle deploy -t gov --profile gov
databricks bundle run app -t gov --profile gov
```

Logs: `databricks apps logs jobs-console --profile gov`, or `<app url>/logz` in the browser (app URL: `databricks apps get jobs-console --profile gov -o json`, field `url`).

### Run history from system tables

Runs before today come from the `system.lakeflow` tables through a serverless SQL warehouse, so history reaches back months instead of what the Jobs API keeps. Today's runs still come from the API. If the history read fails (no warehouse, no access, too large, too slow), the app falls back to the API automatically and the header says why (`history: API · 30 days`, reason in the tooltip).

It is opt-in, so existing deploys keep working. To enable it:

- **On Databricks Apps:** in `databricks.yml` uncomment the `sql-warehouse` resource and put a real warehouse id in it; in `app.yaml` uncomment the `DATABRICKS_WAREHOUSE_ID` / `valueFrom: sql-warehouse` entry. Uncomment both together: the env line without the resource breaks the deploy. Then `npm run package`, commit `deploy/`, `databricks bundle deploy` and `databricks bundle run app`.
- **Locally:** `.\run-local.ps1 -Profile <profile> -Warehouse <id>`, or set `DATABRICKS_WAREHOUSE_ID` in `.env` for dev mode.

| Variable | Meaning | Default |
| --- | --- | --- |
| `JOBS_CONSOLE_HISTORY` | `off` turns system-table history off (API only) | on |
| `JOBS_CONSOLE_HISTORY_DAYS` | How far back history reads | 90 (max 365) |
| `JOBS_CONSOLE_HISTORY_MAX_RUNS` | Cap on history runs, newest kept | 20000 |
| `JOBS_CONSOLE_API_OVERLAP_HOURS` | Hours the API part overlaps the history part | 3 |
| `DATABRICKS_WORKSPACE_ID` | Workspace id for the queries | fetched from the API |

The identity that reads (the app's service principal; your CLI profile locally) needs:

```sql
GRANT USE CATALOG ON CATALOG system TO `<principal>`;
GRANT USE SCHEMA ON SCHEMA system.lakeflow TO `<principal>`;
GRANT SELECT ON TABLE system.lakeflow.job_run_timeline TO `<principal>`;
GRANT SELECT ON TABLE system.lakeflow.job_task_run_timeline TO `<principal>`;
GRANT SELECT ON TABLE system.lakeflow.job_tasks TO `<principal>`;
GRANT SELECT ON TABLE system.lakeflow.pipeline_update_timeline TO `<principal>`;
```

plus **CAN USE** on the warehouse (the bundle resource grants it to the app's service principal).

### Bringing problems home: the Capture menu

In live mode the top bar has a quiet **Capture** menu next to the badge:

- **Download capture**: the last 20 requests (`JOBS_CONSOLE_CAPTURE_SESSIONS`, bounded by `JOBS_CONSOLE_CAPTURE_MB`, default 200), each with every API call and response, the diagnostics (unknown states and codes, skipped pipelines, cap and timeout hits, page counts), server errors and browser errors. Only your own requests; no tokens or headers.
- **Sweep 90 days + download**: first reads everything you can see in the last 90 days (no run cap; stops at `JOBS_CONSOLE_SWEEP_TIMEOUT_MS`, default 240000) plus the output of every failed task (up to `JOBS_CONSOLE_SWEEP_MAX_OUTPUTS`, default 300), then downloads. If the page times out first, the sweep still finishes on the server; use **Download capture** afterwards.

The file is `jobs-console-capture-<host>-<yyyymmdd-hhmm>.json.gz` in your Downloads folder. It is not redacted. Carry it back to the dev machine, then:

```powershell
npm run capture:summary -- $HOME\Downloads\jobs-console-capture-....json.gz
npm run replay -- $HOME\Downloads\jobs-console-capture-....json.gz   # http://localhost:8000, badge "replay"
```

Direct URLs: `/api/diag/capture`, `/api/diag/sweep?days=N` (1 to 180). They exist in live mode only.

## Project Structure

```
* client/          # React frontend
  * src/           # Source code
  * public/        # Static assets
* server/          # Express backend
  * server.ts      # Server entry point
  * routes/        # Routes
* shared/          # Shared types
* databricks.yml   # Bundle configuration
* app.yaml         # App configuration
* .env.example     # Environment variables example
```

## Tech Stack

- **Backend**: Node.js, Express
- **Frontend**: React.js, TypeScript, Vite, Tailwind CSS, React Router
- **UI Components**: Radix UI, shadcn/ui
- **Databricks**: AppKit SDK
