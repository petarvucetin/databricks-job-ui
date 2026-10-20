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
- Several workspaces (dev / stg / prod) in one console: `-Envs` instead of `-Profile` (see [Three environments](#three-environments-dev--stg--prod)).
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

## Three environments (dev / stg / prod)

The client has three workspaces: dev, stg and prod. On a laptop one console serves all three, with a dev · stg · prod switch right after the "Jobs console" title. On Databricks each workspace runs its own `jobs-console` app, labeled with its env and without a switch.

- **dev** has no color. **stg** has an amber edge along the top of the header and an amber label. **prod** has a red edge and a red label.
- The browser tab title names the env: `DEV · Jobs console`, `STG · Jobs console`, `PROD · Jobs console`.
- The env is in the URL (`?env=prod`), so a bookmark opens the same workspace. Switching env reloads the page and keeps the current tab (Jobs & ETL or Runs). Filters, search and the open run start fresh.

### Laptop: one console, three workspaces

Sign in once per machine, one CLI profile per env:

```powershell
databricks auth login --host https://<dev workspace url>  --profile dev
databricks auth login --host https://<stg workspace url>  --profile stg
databricks auth login --host https://<prod workspace url> --profile prod
```

Then run:

```powershell
cd jobs-console
.\run-local.ps1 -Envs 'dev,stg,prod'                                   # http://127.0.0.1:8000, Ctrl+C to stop
.\run-local.ps1 -Envs 'dev=gov-dev,stg=gov-stg,prod=gov'               # name=profile: use profiles with other names
.\run-local.ps1 -Envs 'dev,stg,prod' -Warehouse 'dev=<id>,prod=<id>'   # system-tables run history per env
```

- A bare name uses the CLI profile of the same name; `name=profile` maps an env to another profile. List any subset of the three; the switch shows only those.
- `-Warehouse` takes the same per-env form. An env without a warehouse reads run history from the API.
- `-Envs` and `-Profile` can't be combined. `-Profile <profile>` still runs one workspace with no switch and no label, as before.
- Before starting, the script checks each env's login. For one that fails it prints `databricks auth login --profile <profile>`, and that env shows the same fix in the app while the others work. If no login works, it stops.
- `-Data mock -Envs 'dev,stg,prod'` serves different mock data per env (names start with `dev_`, `stg_`, `prod_`), to check the switch without a workspace. It still needs one working login to start.
- From a Command Prompt tab: `powershell -ExecutionPolicy Bypass -File .\run-local.ps1 -Envs "dev,stg,prod"`.
- Under `npm run dev` (dev machine): put `JOBS_CONSOLE_ENVS=dev,stg,prod` (same form as `-Envs`) in `.env`. `DATABRICKS_HOST` and any other credential variable are dropped at startup, since each env reads its own profile, but AppKit's startup sign-in still needs a working `DATABRICKS_CONFIG_PROFILE` (or the `DEFAULT` profile).

### Deploy: one app per workspace

`deploy.ps1` deploys the prebuilt `deploy/` folder to one env's workspace. It needs only the Databricks CLI (no Node) and a login for the profile named exactly like the env (`dev`, `stg` or `prod`).

```powershell
cd jobs-console
.\deploy.ps1 -Env prod                    # asks you to type "prod" after showing the workspace
.\deploy.ps1 -Env prod -Warehouse <id>    # also turns on system-tables run history
```

It:

1. Checks the `prod` login and shows the workspace host, your identity, whether `jobs-console` already exists there, and the warehouse it will use. You type the env name to continue; nothing is changed before that.
2. Adopts an existing `jobs-console` app that this target doesn't manage yet (`bundle deployment bind`), keeping its service principal, grants and URL. A workspace without one gets a new app.
3. Runs `bundle deploy` and `bundle run app` for the `prod` target, which labels the app "prod".
4. Prints the app URL and the service principal that needs CAN_VIEW (see Grants below).

Options:

- `-Warehouse <id>`: deploy with that SQL warehouse (system-tables run history). The id isn't written to the repo; later deploys keep it.
- No `-Warehouse`: keeps the running app's warehouse, if it has one.
- `-NoWarehouse`: removes the running app's warehouse (run history from the API).
- `-Yes` skips the typed confirmation. `-WhatIf` prints the bind / deploy / run commands without running them.
- From a Command Prompt tab: `powershell -ExecutionPolicy Bypass -File .\deploy.ps1 -Env prod`.

### Plain-CLI fallback

The same deploy without the script. Check first that the profile points at the right workspace, because `databricks.yml` pins no host for these targets: the profile decides where the app goes.

```powershell
cd jobs-console
databricks auth describe --profile prod                                       # host must be the prod workspace
databricks apps get jobs-console --profile prod                               # does the app already exist?
databricks bundle deployment bind app jobs-console -t prod --profile prod     # only if it exists and this target doesn't manage it yet
databricks bundle deploy -t prod --profile prod
databricks bundle run app -t prod --profile prod
```

- Bind once per workspace. `databricks bundle summary -t prod --profile prod` shows whether the target already manages the app.
- Always use the same name for `-t` and `--profile`. `-t prod --profile dev` deploys a "prod"-labeled app into dev.
- **A plain `bundle deploy` removes the app's warehouse** (run history falls back to the API), because the warehouse is supplied only by `deploy.ps1`. Use `deploy.ps1`, or re-add it afterwards with `.\deploy.ps1 -Env prod -Warehouse <id>`.

### Migrating from the `gov` target

The `gov` target is gone; `dev`, `stg` and `prod` replace it. The workspace that `gov` deployed to is one of the three. Log in to it under that env's profile name, then deploy with the matching env:

```powershell
databricks auth login --host https://<workspace url> --profile prod   # the workspace the gov target used
.\deploy.ps1 -Env prod
```

The script finds the existing `jobs-console` app and adopts it, so its service principal, grants and URL stay. It also keeps the app's warehouse. The old `gov` profile can stay for `run-local.ps1 -Profile gov`, or map it with `-Envs 'prod=gov'`.

### Grants

Each workspace's app has its own service principal, so grant in each workspace:

- **CAN_VIEW** on the jobs and pipelines the app should show, for the service principal `deploy.ps1` prints (or `databricks apps get jobs-console --profile <env> -o json`, field `service_principal_client_id`). A group that already has that access works too.
- **CAN_USE** on the SQL warehouse, if the app has one. The `sql-warehouse` app resource grants it on deploy. For system-tables history it also needs the `system.lakeflow` grants in [Run history from system tables](#run-history-from-system-tables).

On the laptop the console reads as you (each env's CLI profile), so it shows what you can see in each workspace.

### First real deploy: check

The first deploy to each workspace confirms how the CLI combines the target's app config with `app.yaml`:

- Open the app: the header shows the env label (`PROD`, with the red edge) and the tab title is `PROD · Jobs console`. No label means the env setting didn't reach the app.
- `databricks bundle summary -t prod --profile prod` shows the app with an id (the target manages it).

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

The `dev`, `stg` and `prod` targets deploy the same `deploy/` folder to the client's GovCloud workspaces, one app per workspace, labeled with the env. They replace the old `gov` target. Use `.\deploy.ps1 -Env <env>`; see [Three environments](#three-environments-dev--stg--prod) for the deploy, the plain-CLI fallback and migrating from `gov`.

These targets pin no host: the CLI does not substitute variables in `workspace.host`, so the workspace comes from the CLI profile named like the env (`databricks auth login --host https://<workspace url> --profile prod`).

Logs: `databricks apps logs jobs-console --profile <env>`, or `<app url>/logz` in the browser (app URL: `databricks apps get jobs-console --profile <env> -o json`, field `url`).

### Run history from system tables

Runs before today come from the `system.lakeflow` tables through a serverless SQL warehouse, so history reaches back months instead of what the Jobs API keeps. Today's runs still come from the API. If the history read fails (no warehouse, no access, too large, too slow), the app falls back to the API automatically and the header says why (`history: API · 30 days`, reason in the tooltip).

It is opt-in, so existing deploys keep working. To enable it:

- **On Databricks Apps:** in `databricks.yml` uncomment the `sql-warehouse` resource and put a real warehouse id in it; in `app.yaml` uncomment the `DATABRICKS_WAREHOUSE_ID` / `valueFrom: sql-warehouse` entry. Uncomment both together: the env line without the resource breaks the deploy. Then `npm run package`, commit `deploy/`, `databricks bundle deploy` and `databricks bundle run app`. This is for the `default` target only.
- **dev / stg / prod targets:** `.\deploy.ps1 -Env <env> -Warehouse <id>`. Nothing to uncomment; later deploys keep the warehouse (see [Deploy: one app per workspace](#deploy-one-app-per-workspace)).
- **Locally:** `.\run-local.ps1 -Profile <profile> -Warehouse <id>`, with several envs `-Warehouse 'dev=<id>,prod=<id>'`, or set `DATABRICKS_WAREHOUSE_ID` in `.env` for dev mode.

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
