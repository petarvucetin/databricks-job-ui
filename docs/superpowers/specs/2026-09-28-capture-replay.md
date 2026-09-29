# Capture and replay (bring the real workspace home)

Builds on `2026-09-28-live-run-source.md`, where every SDK call goes through the `LiveApi` seam.

Why: the app is deployed to a large AWS GovCloud workspace (us-gov-west-1) that can't be reached from the dev machine. Everything that goes wrong there has to be captured in one file, carried back, and reproduced here exactly. The user chose: download a file, no redaction.

## 1. Recorder (always on in live mode)

- `RecordingApi` wraps `LiveApi`. For each call it records `{ seq, method, args, startedAt, ms, ok, result | error: { name, message, statusCode, errorCode, stack } }`. It never records tokens or request headers.
- Records are grouped per app request into a **session**: `{ id, route, query, user, authMode, startedAt, ms, now (the asOf used), calls[], diagnostics[], responseSummary: { status, runCount, byKind, byType } }`.
- A ring buffer keeps the last `JOBS_CONSOLE_CAPTURE_SESSIONS` sessions (default 20) and is bounded by an approximate byte size, `JOBS_CONSOLE_CAPTURE_MB` (default 200). The oldest sessions go first.
- **Diagnostics** are structured notes that the mapping code emits instead of failing silently:
  - unknown termination code or state
  - missing expected field
  - run or update skipped (with the reason)
  - the cap or the timeout hit (with counts)
  - page counts per API
  - an events call skipped because of the budget
  - a pipeline end time that couldn't be found

  Each note is `{ level: 'info'|'warn'|'error', code, message, ref? }`. The pure mappers receive a `diag(note)` sink, so they stay testable.
- Server errors (a 5xx in any route) and unhandled rejections go into the current session, or into a `process` pseudo-session.

## 2. Client errors

- `ErrorBoundary` and `window.onerror`/`unhandledrejection` POST `{ message, stack, url, userAgent, at }` to `/api/diag/client-error`, rate-limited on the client (max 20 per page load). They are stored in the capture.

## 3. Download

- `GET /api/diag/capture` returns a gzipped JSON file with `Content-Disposition: attachment; filename="jobs-console-capture-<host>-<yyyymmdd-hhmm>.json.gz"`.
- File shape:
  - `{ format: 'jobs-console-capture', version: 1, createdAt, app: { version, gitSha if available, node }, config: { every JOBS_CONSOLE_* env value, DATABRICKS_HOST, authMode } }`
  - `workspace: { host, user }`
  - `sessions[]`, `clientErrors[]`, `process[]`
- **Sweep** ("collect as much as possible"): `GET /api/diag/sweep?days=N` (default 90, max 180) runs a fresh wide collection through the recorder:
  - all job runs in the window, with no run cap, stopping only at `JOBS_CONSOLE_SWEEP_TIMEOUT_MS` (default 240000)
  - all pipelines, with their updates and events
  - `getRun` + `getRunOutput` for every failed task, up to `JOBS_CONSOLE_SWEEP_MAX_OUTPUTS` (default 300)

  It then returns the same gzipped capture file, with the sweep as its newest session. It returns partial data plus a diagnostic if it hits the timeout. It's user-scoped like everything else.
- Everything under `/api/diag` works only in live mode (404 in mock mode). Everything the capture contains, the user can already see in the native UI.
- UI: in live mode the shell top bar has a quiet "Capture" menu next to the data-mode badge, with two items: "Download capture" and "Sweep 90 days + download". The sweep item shows a busy state while it runs. Follow the calm UI rule: text links, no big buttons. Mock mode shows nothing.

## 4. Replay (on the dev machine)

- `JOBS_CONSOLE_DATA=replay` with `JOBS_CONSOLE_REPLAY=<path to .json.gz>`.
- `ReplayApi` implements `LiveApi` by answering each call from the recorded calls. It matches on method and a canonicalised `args` (stable key order). If there's no exact match, it falls back to the nearest same-method call (for example, the same `listJobRuns` page token), and records a diagnostic. It replays recorded errors as thrown SDK-like errors, so the error paths reproduce.
- The live source takes an injectable clock. In replay mode, the clock is the `now` of the session being replayed, so kinds, `live` and durations come out exactly as they did there. By default the newest sweep is replayed, else the newest `/api/runs` session. `JOBS_CONSOLE_REPLAY_SESSION=<id>` chooses a specific one.
- `source` in the response is `'live'` with a `replay: true` flag, or a new `'replay'` value. Pick one, keep the data-mode badge honest (it says "replay"), and update the shared types and tests.
- `npm run replay -- <file>` is a convenience script that starts dev mode on a capture.
- A tiny CLI, `npm run capture:summary -- <file>`, prints:
  - sessions, with timings and run counts by kind/type
  - the top diagnostics by code
  - errors, with their counts
  - client errors

  That's the first thing to run when a file comes back.

## 5. Auth fallback for GovCloud

- It isn't confirmed that per-user authorization is enabled on the target workspace. Add `JOBS_CONSOLE_AUTH=user|app` (default `user`). `app` uses the app's service principal through the SDK default chain, which on Databricks Apps is `DATABRICKS_CLIENT_ID`/`SECRET`. The capture's `authMode` records the mode, and the badge shows "as app" in that mode, because the app then only sees what the SP was granted.
- `databricks.yml` gets a `gov` target with its host as a variable (`--var gov_host=...`) and the same `user_api_scopes`. README gets a "Deploy to another workspace" section with PowerShell commands:
  - `databricks auth login --host <url> --profile gov`
  - `databricks bundle deploy -t gov --var gov_host=<url> --profile gov`
  - `databricks bundle run app -t gov --profile gov`
  - how to switch to `JOBS_CONSOLE_AUTH=app` in `app.yaml` env
  - where the Capture menu is and how to bring the file back

  `app.yaml` sets `JOBS_CONSOLE_DATA=live`.

## Testing

- Recorder: unit tests for the ring buffer bounds, error recording, and token/header exclusion.
- Replay: a round-trip test that records a fake LiveApi, serialises the capture, gunzips and replays it, and checks the `RunsResponse` is identical. Also cover the mismatch fallback and replaying a recorded error.
- Diagnostics: the mappers emit the expected codes for unknown states and codes.
- Summary CLI: a snapshot test on a small fixture capture.
- `npm run typecheck`, `npm run lint` and `npm test` are green.
- Smoke test: live mode against the `jobs-console` profile (empty workspace). Sweep downloads a valid .json.gz. Replay of that file serves the same response. Also check in a real browser (127.0.0.1:8000) with a screenshot of the Capture menu in live mode, and its absence in mock mode.
