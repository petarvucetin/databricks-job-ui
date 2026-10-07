# Run history from system tables, and Load with pipelines

Status: approved in chat on 2026-10-07 ("write and implement"). It has two parts:

- **A.** Run history before today comes from Databricks system tables; today stays on the API.
- **B.** The UI changes approved in the mockup (`docs/design/mockups/jobs-etl-tab.html`, served at http://127.0.0.1:8765/ during design):
  - Load stacks jobs and pipelines.
  - Pipelines are credited to the jobs that start them.
  - A Scheduled · Unscheduled filter.
  - A not-on-the-chart list.
  - Keys T, L and D, with hints.

## Goals

1. Longer run history: 90 days by default, configurable up to 365 (today: 30 days, at most 2,000 runs).
2. Faster loading. Everything before today is one set of SQL queries, cached until midnight. Refreshes only ask the API about today.
3. Behaviour stays the same when system tables aren't available: no warehouse, no grant, or not supported. The app silently uses the API as today and says so in the header.

## Decisions

| # | Decision |
|---|----------|
| H1 | **Boundary.** Runs that started **before today** come from system tables. **Today** comes from the API. "Today" is the viewer's local midnight (from the `tzOffset` the client already sends). Guard: the API window is `min(today 00:00, now − 3 h)`, so just after midnight the API still covers the last 3 hours. The overlap is configurable with `JOBS_CONSOLE_API_OVERLAP_HOURS`, default 3. |
| H2 | **Runs crossing the boundary.** Anything still running comes from the API (`active_only`), whenever it started. When a run id is in both sets, the API wins. |
| H3 | **Visibility = decision #4.** History is filtered to the job and pipeline ids in the reading identity's cached item list (`listItems`: `jobs/list` + pipelines). Rows are always filtered to this workspace's `workspace_id`. |
| H4 | **Warehouse.** It is a serverless SQL warehouse, declared as an app resource named `sql-warehouse` with `CAN_USE` permission. The id comes from env `DATABRICKS_WAREHOUSE_ID` (AppKit convention). Locally it is set in `.env` / `run-local.ps1 -Warehouse <id>`. |
| H5 | **Access probe, per reading identity, re-checked every 10 minutes.** `SELECT 1 FROM system.lakeflow.job_run_timeline WHERE workspace_id = :ws LIMIT 1`. Any failure falls back to API-only. The failures are: no warehouse id, permission denied, table not found, warehouse error, timeout, or no workspace id. The reason is kept for the header. `JOBS_CONSOLE_HISTORY=off` forces API-only. |
| H6 | **History cache.** The history result is per reading identity and per local day, keyed by `userKey + cutoff`. It is kept until the cutoff moves (midnight) and is never mixed into the API delta base. A failed history read is served as the API fallback and cached: for 5 minutes when transient, for the rest of the local day when it is no-access or result-too-large. A history read from an incomplete job list is used, flagged `capped`, and re-read within 5 minutes. History reads time out after 25 s; that response is served as the API fallback labelled "history: API · 1 day" and retried in 5 minutes. |
| H7 | **Window and caps.** History reaches back `JOBS_CONSOLE_HISTORY_DAYS` days (default 90, max 365). The API part keeps `maxRuns` (2,000). History has its own cap, `JOBS_CONSOLE_HISTORY_MAX_RUNS` (default 20,000, newest kept). When either cap is hit, the response carries `capped` and the header says so. |
| H8 | **Header.** `/api/mode` and `RunsResponse` carry `history: { source: 'system-tables', days, capped? } \| { source: 'api', days, reason? }`. The shell badge reads `· history: system tables · 90 days`, or `· history: API · 30 days` with the reason in its tooltip. |
| H9 | **Detail unchanged.** The drawer's task output, errors and single-run refresh still use the API, for history runs too, by `run_id`. |
| H10 | **Capture/replay.** SQL goes through new `LiveApi` methods, so it is recorded automatically. Replay matches on statement text + parameters. The cutoff and workspace id are passed as **parameters**, so recorded args match exactly. |

### Mapping system-table rows to runs

`job_run_timeline` and `job_task_run_timeline` slice long runs into hourly rows. Each run is aggregated by `run_id`: MIN(`period_start_time`), MAX(`period_end_time`), and the non-null `result_state` / `termination_code` from the final slice.

- **Result** (`result_state`):
  - SUCCEEDED → `succeeded`
  - FAILED, ERROR, TIMED_OUT → `failed`
  - CANCELLED, SKIPPED, BLOCKED → `cancelled`
  - A run with some failed tasks and a SUCCEEDED final state stays `succeeded`; the timeline has no partial state.
- **Cause:** `failureCause(termination_code, '')`. There is no message text; the drawer fetches it on demand (H9).
- **Name, run-as, mine:** from the cached item for that job id. A run whose job id is not in the item list is dropped (H3).
- **Tasks:** one entry per `task_key` from `job_task_run_timeline` for that run. Retries appear as separate task runs; the latest by start is kept, and `attempt` = count − 1. `deps` come from the latest `system.lakeflow.job_tasks` row per (job_id, task_key) (`depends_on_keys`).
- **`url`:** `jobRunUrl(host, job_id, run_id)`. **`params`:** `{}`.
- **Pipeline updates** (`pipeline_update_timeline`), aggregated by `update_id` the same way:
  - Result: COMPLETED → succeeded, FAILED → failed, CANCELED → cancelled. The exact values are confirmed against the docs during implementation.
  - The id is `pipelineNumber(update_id)`.
  - Name and run-as come from the item.
- History drafts join the API drafts **before** `finalize` (kinds.ts), so `usualSec` and "slow" are computed over the full history.

### Workspace id

Taken from `DATABRICKS_WORKSPACE_ID` if set. Otherwise from the `x-databricks-org-id` response header of `GET /api/2.0/preview/scim/v2/Me` (AppKit's method), cached per process. If neither is available, H5 falls back to the API.

## Part B: UI (from the approved mockup)

| # | Decision |
|---|----------|
| U1 | **Pipelines credited to jobs.** `jobs/list` is read with `expand_tasks: true`. A job with a `pipeline_task` credits that pipeline: the pipeline item gets `startedBy: { jobId, jobName }[]`, and its starts are the starting job's schedule starts. Pipeline durations use the pipeline's typical runtime. The trigger pill reads `⏱ <job's schedule> · by job`, with "Started by the pipeline task of <job>" in the tooltip. Credited pipelines count on the schedule timeline (purple boxes) and in Load. Mock items get the same crediting. |
| U2 | **Load stacks two bands:** jobs (fill `#eadfce`, line `#9c8462`) at the bottom, pipelines (fill `#ddd3f3`, line `#6a4fb0`) on top. A key in the header reads jobs / pipelines. **Continuous pipelines count as running for the whole range.** The tooltip reads `HH:MM · N running: J jobs · P pipelines · M start in the next 5 min`, followed by the top groups. The type filter (All · Jobs · Pipelines) toggles the bands. |
| U3 | **Filter Any trigger · Scheduled · Unscheduled**, with counts, next to the type filter. Scheduled = has fixed start times (its own parsed, unpaused schedule, or credited via U1). Unscheduled = everything else. |
| U4 | **Not-on-the-chart section.** Under the Load list: "Not on the chart · N with no fixed start times (manual, triggered by a file or a table, paused, or a pipeline no scheduled job starts)", followed by those rows with "no start times". Continuous pipelines are listed first in the main list as "running the whole time". The header reads `N continuous on the chart` / `Nothing on the chart` when nothing is scheduled. |
| U5 | **Keys**, active only on the Jobs & ETL tab and ignored while typing: **T** collapses or expands the schedule timeline (collapsed line: `Tue 19:00 to Wed 19:00, 1 day · T expand`); **L** switches to List; **D** switches to Load. The hints show as small key labels on the List · Load switch (`List L · Load D`, tooltips "List (L)" / "Load (D)") and in the timeline title row (`T collapse`). |

## Testing

- **Unit:**
  - row aggregation (hourly slices → one run, final-slice result)
  - result and cause mapping
  - task dedupe with attempts
  - merge (API wins, cutoff boundary, overlap after midnight)
  - cache keyed by cutoff (midnight rollover re-queries)
  - access probe outcomes → API fallback with reasons
  - history cap
- **Live over `fakeApi`:** history + API merged; no warehouse → API only with reason; permission denied → API only.
- **Replay round trip:** a recorded session with SQL replays.
- **UI:** stacked bands and tooltip text; type filter toggles bands; Scheduled · Unscheduled counts; the not-on-the-chart list; T/L/D keys inactive while typing and on the Runs tab; crediting gives a pipeline starts and the `· by job` pill.
- **Done means:**
  - `npm test` and typecheck pass; lint is clean on changed files.
  - `deploy/` is rebuilt and committed, merged to master and pushed.
  - A browser pass on mock data in a **visible** tab.
  - The live system-tables path is verified against the dev workspace once the `jobs-console` login works; until then that remains the stated residual.
