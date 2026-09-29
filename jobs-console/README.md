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

## Getting started

```powershell
cd jobs-console
npm install
npm run dev        # http://localhost:8000, mock data
npm test           # unit + component tests
```

- Data source: `JOBS_CONSOLE_DATA=mock` (default) or `live`. Live mode reads the Jobs and Pipelines APIs as the signed-in user (deployed: the forwarded user token, scopes `jobs` + `pipelines`; local dev: the `DATABRICKS_CONFIG_PROFILE` from `.env`). Run it locally with `$env:JOBS_CONSOLE_DATA='live'; npm run dev` (PowerShell) or `JOBS_CONSOLE_DATA=live npm run dev` (Git Bash); on Databricks Apps add `env: [{ name: JOBS_CONSOLE_DATA, value: live }]` to `app.yaml`. Limits, with defaults: `JOBS_CONSOLE_WINDOW_DAYS` (30), `JOBS_CONSOLE_MAX_RUNS` (2000), `JOBS_CONSOLE_TIMEOUT_MS` (12000), `JOBS_CONSOLE_CONCURRENCY` (8). Hitting the cap or the timeout returns what was collected and logs a warning.
- Replay: `JOBS_CONSOLE_DATA=replay` with `JOBS_CONSOLE_REPLAY=<capture .json.gz>` serves a capture from a live workspace back, frozen at the moment it was taken (badge: "replay"). Shortcut: `npm run replay -- <file> [session id]`. `JOBS_CONSOLE_REPLAY_SESSION=<id>` picks a session; default is the newest sweep, else the newest `/api/runs` session. `npm run capture:summary -- <file>` prints sessions, top diagnostics, errors and client errors: run it first when a file comes back.
- Press `L` in the app to show the numbered reference rows used in design reviews.
- npm scripts run through Git Bash (`.npmrc` `script-shell`), so the POSIX-style scripts work on Windows.

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

## Deployment with Databricks Asset Bundles

### 1. Configure Bundle

Update `databricks.yml` with your workspace settings:

```yaml
targets:
  default:
    workspace:
      host: https://your-workspace.cloud.databricks.com
```

Make sure to replace all placeholder values in `databricks.yml` with your actual resource IDs.

### 2. Deploy

Deploy and start the app with a single command:

```bash
databricks apps deploy
```

`databricks apps deploy` validates the project, deploys it, starts the app, and prints its URL.

### Deploy to Production

1. Configure the production target in `databricks.yml`
2. Deploy to production:

```bash
databricks apps deploy -t prod
```

> **Restarting a stopped app:** apps stop after a period of inactivity. To start one again without redeploying, run `databricks apps start <APP_NAME>`.

## Deploy to another workspace (e.g. AWS GovCloud)

The `gov` target in `databricks.yml` deploys the same app, with the same `user_api_scopes`, to the workspace of the `gov` CLI profile. The CLI does not substitute variables in `workspace.host`, so the host comes from the profile; `--var gov_host=<url>` is accepted but informational.

```powershell
$url = 'https://dbc-xxxxxxxx-xxxx.cloud.databricks.us'
databricks auth login --host $url --profile gov
databricks bundle deploy -t gov --var gov_host=$url --profile gov
databricks bundle run app -t gov --profile gov
```

`app.yaml` sets `JOBS_CONSOLE_DATA=live`. If per-user authorization is not enabled on that workspace, switch to the app's service principal by uncommenting in `app.yaml`:

```yaml
  - name: JOBS_CONSOLE_AUTH
    value: app
```

then deploy again. The app then shows only what the service principal was granted (Can View on the jobs and pipelines), and the badge says "live data · as app".

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
