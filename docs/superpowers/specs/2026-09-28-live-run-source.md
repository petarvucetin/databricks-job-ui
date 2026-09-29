# Live run source (Jobs + Pipelines as the signed-in user)

Goal: `JOBS_CONSOLE_DATA=live` serves `GET /api/runs` and `GET /api/runs/:id/log` from the real workspace, as the signed-in user, with the same `RunsResponse` contract the mock serves. The client does not change beyond what the contract needs.

Locked decisions this implements: #3 (custom Express routes over the SDK, no built-in `jobs()` plugin), #4 + Pipelines note (user authorization, `jobs` + `pipelines` scopes), #5 (one interface, mock and live backends), #14/#15 (jobs and pipelines as peer items, no cross-linking). See `docs/design/00-decisions.md`, including "Jobs API 2.2 constraints" and "Pipelines API 2.0 constraints".

## Auth

- Every request builds its own client. Nothing user-scoped is cached across users.
- Deployed (Databricks Apps): the user's token arrives in `x-forwarded-access-token` and their identity in `x-forwarded-email` / `x-forwarded-user`. Build a `WorkspaceClient` from `@databricks/sdk-experimental` with that token and `DATABRICKS_HOST`.
- Local dev (`NODE_ENV=development`, no forwarded token): fall back to the SDK default auth chain. `.env` already sets `DATABRICKS_CONFIG_PROFILE=jobs-console`, which resolves to petar@station5solutions.com. The user name comes from `currentUser.me()`, cached per process.
- Production without a forwarded token: 401 `{ error }`.
- `databricks.yml`: declare `user_api_scopes: [jobs, pipelines]`. Check the exact scope strings for Azure Databricks Apps against Microsoft Learn ("Configure authorization in a Databricks app") and cite the source in the commit message.

## Interface change

`RunSource` methods get a per-request context. For example, keep `RunSource` and add a `RunSourceProvider` = `(req) => RunSource | { status, error }`. The mock provider ignores the request. `selectRunSource('live')` stops throwing. Keep the handlers (`listRuns.ts`, `taskLog.ts`) thin and tested the same way they are now. The `taskLog` route's id validation and query rules may change to fit pipeline updates (see below). Update both the handler and its tests.

## `GET /api/runs` mapping

Window: `since` if given; otherwise the last **30 days**. Do not page through everything. Hard cap at 2000 runs total, newest first. When the cap is hit, log a warning server-side.

`asOf` = server now. `source` = `'live'`.

### Jobs (`jobs.listRuns`, `expand_tasks: true`, `start_time_from`)

- `id` is the numeric `run_id`. `runId` is the string of `run_id`. `type` is `'job'`. `name` is `run_name` (the job name, which includes the `[dev x] ` prefix).
- `startTime` is `start_time`. `durationSec`:
  - finished runs: `run_duration` (or `end_time - start_time`) / 1000
  - live runs: `(now - start_time)` / 1000
  - queued runs: 0
- `live`: `status.state` in RUNNING, TERMINATING, or a PENDING/BLOCKED/WAITING run that has started.
- `result`: from `status.termination_details` / `state.result_state`: SUCCESS → succeeded, FAILED/TIMEDOUT/INTERNAL_ERROR → failed, CANCELED → cancelled, SUCCESS_WITH_FAILURES → partial. `null` while not finished.
- `usualSec`: mean duration of this `job_id`'s **successful finished** runs inside the fetched window. If there are none, use this run's own duration (or 0).
- `kind`, first rule that matches:
  1. `queued`: `status.state` QUEUED/PENDING/BLOCKED/WAITING and not started.
  2. `retrying`: live and any task has `attempt_number > 0`.
  3. `slow`: live and `durationSec > usualSec * 1.2` with `usualSec > 0`.
  4. `running`: live.
  5. `failed`: result failed or partial.
  6. `slow`: finished succeeded and `durationSec > usualSec * 1.5`. Check how the mock uses 'slow' and keep the same semantics.
  7. `succeeded`: everything else, including cancelled. Match what the mock does with cancelled runs if it has a rule.
- `cause` (`{label, code, detail}`): for failed runs, `code` = `termination_details.code` and `detail` = its `message` (trimmed to one line, ~200 chars), and `label` follows the same vocabulary as the mock causes (see `generateRuns.ts` cause table). Map known codes to the same labels. Unknown codes get a humanised code. For non-failed kinds, use the same cause objects the mock uses for that kind (e.g. running/slow/queued).
- `failed`: tasks with a failed result. `name` = `task_key`, `cause` from the task's termination details, `secs` = the task's duration.
- `ntasks`: the number of distinct `task_key`s.
- `runAs`: the run's run-as identity (`run_as_user_name` if the SDK exposes it, else `creator_user_name`). `mine` = `runAs` equals the current user.
- `continuous`: false. `params`: `job_parameters` resolved (name → value), `{}` if none.

### Pipelines

- `pipelines.listPipelines` (page size 100), then per pipeline, with concurrency ≤ 8:
  - `getPipeline` for `spec.continuous` and the run-as identity
  - `listUpdates` for updates created at or after the window start
- Each update is one `Run` with `type: 'pipeline'`. `runId` is `'upd ' + update_id.slice(0, 8)`, which matches the mock's look.
- `id` must be a number and unique across the response. Derive a stable 53-bit safe integer from `update_id`, so the same update always gets the same id, and keep an in-process map from id to `{ pipelineId, updateId }` for the log route. Update this map on every list call.
- Status: QUEUED/CREATED/WAITING_FOR_RESOURCES are queued. INITIALIZING/RESETTING/SETTING_UP_TABLES/RUNNING/STOPPING are live. COMPLETED is succeeded, FAILED is failed, CANCELED is cancelled.
- Duration: `UpdateInfo` has no end time. Take the end time from the pipeline events (`listPipelineEvents`, filter on `update_progress` events for that update, or whatever the API allows). Keep it to at most one events call per pipeline per request. If the end time can't be found, use `now - creation_time` for live updates and 0 otherwise, and document it.
- Failed updates: take the cause from ERROR-level events for that update (`error.exceptions[0].message`, not the top-level message). Budget the events calls the same way.
- `ntasks` is 1. `failed` has at most one entry, with `name` = the pipeline name or the flow name from the error event.
- `continuous` is `spec.continuous`. `usualSec`, `kind` and `mine` follow the same rules as jobs, keyed by `pipeline_id`. `params` is `{}`.

## `GET /api/runs/:id/log?task=&hint=`

- Job run: `jobs.getRun(run_id)`, then find the task by `task_key`, taking the latest attempt (the highest `attempt_number`). Then `jobs.getRunOutput(task.run_id)`. Build plain text from the parts that exist: `error`, `error_trace`, `logs` (plus a truncation note if `logs_truncated`), `notebook_output.result`, and the SQL/dbt/run-job output summaries. When there is no output, say why in one line (e.g. "task still running", "no output recorded").
- Pipeline update (the id is in the map): the ERROR and WARN events for that update, oldest first, one line each (`timestamp level message`), plus the exception messages.
- An id that is unknown or not accessible returns 404 `{ error }`. A permission-denied error from the SDK returns 403 `{ error }` with the SDK message.

## Errors and robustness

- SDK errors from the list call return 502 `{ error: <message> }`. Auth errors return 401/403. Do not leak tokens in errors or logs.
- A per-request timeout of 12s across all fan-out (the client times out at 15s).
- A small per-user in-memory cache (TTL 20s, keyed by user and window) so that reloads don't re-fan-out. Bound it (for example 50 entries).

## Testing

- Unit tests with vitest for the mapping, as pure functions that take SDK-shaped objects and return `Run`. Fixtures are hand-written from the SDK's `.d.ts` types. Cover every kind rule, `usualSec`, cause mapping, pipeline status mapping, the id hash stability, log text assembly, and the provider's auth branching (token header / dev fallback / prod 401).
- Existing tests keep passing. `npm run typecheck`, `npm run lint` and `npm test` are green.
- Smoke test against the real workspace: `JOBS_CONSOLE_DATA=live npm run dev`, then `curl http://127.0.0.1:8000/api/runs` returns 200 with `source: 'live'`. The workspace currently has 0 jobs, runs and pipelines, so `runs: []` is the expected result.

## Out of scope

Actions (run-now, repair, cancel), continuous-pipeline lag (decision #16), ack/snooze, deploy.
