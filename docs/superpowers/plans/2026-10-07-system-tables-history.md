# System-tables history + Load with pipelines: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run history before today comes from Databricks system tables, queried through a SQL warehouse and cached until midnight. Today stays on the API, with an automatic fallback to API-only. Part B ships the approved UI changes: stacked jobs/pipelines Load, pipelines credited to the jobs that start them, a Scheduled · Unscheduled filter, a not-on-the-chart list, and the T/L/D keys.

**Architecture:**
- New `LiveApi` methods for the Statement Execution API and the workspace id. They are recorded and replayed like every other call.
- A `server/data/systables/` module covers SQL running, the access probe, queries, and mapping rows to `Draft`.
- `liveRunSource` merges history drafts with the API drafts before `finalize`. History lives in its own per-user, per-day cache, outside the delta base.
- The UI reads a new `history` field.
- Part B extends items (crediting) and the Jobs & ETL client models and components.

**Tech stack:** TypeScript, Express via AppKit 0.57, `@databricks/sdk-experimental` 0.17 (`statementExecution`), React 19, vitest + @testing-library/react.

**Spec:** `docs/superpowers/specs/2026-10-07-system-tables-history.md` (binding).
**Mockup (UI source of truth for Part B):** `docs/design/mockups/jobs-etl-tab.html`. It was updated in the 2026-10-07 session with stacked Load, the sched filter, the not-on-the-chart list and the keys. If the committed copy is older, use `.superpowers/brainstorm/jobs-etl-tab/index.html`.

## Global Constraints

- **Where:** work in `D:\AI\projects\databricks-UI\jobs-console`, on branch `system-tables-history`.
- **Line endings:** CRLF files are edited with the Edit tool, never `sed -i`. Keep each file's existing line endings.
- **Commits:** pathspec only. `git add <new files>` first, then `git commit -m "..." -- <paths>`. Every message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01WzA2wK2v4bKetURLkeyhEG`.
- **Checks:** `npm test` and `npm run typecheck` pass at the end of every task. ESLint must be clean on changed files. 7 pre-existing lint errors are allowed in `client/appVersion.ts` and `RuntimeTile.test.tsx`; some warnings exist in `CompareView.tsx`, `RunDrawer.tsx` and `RunRow.tsx`.
- **No new npm dependencies.**
- **Env vars, verbatim:**

  | Variable | Meaning | Default |
  |---|---|---|
  | `DATABRICKS_WAREHOUSE_ID` | SQL warehouse to query | none: history off |
  | `DATABRICKS_WORKSPACE_ID` | workspace id | read from the SCIM `Me` header |
  | `JOBS_CONSOLE_HISTORY` | `off` forces API-only | on |
  | `JOBS_CONSOLE_HISTORY_DAYS` | how far history reaches | 90, max 365 |
  | `JOBS_CONSOLE_HISTORY_MAX_RUNS` | history run cap | 20000 |
  | `JOBS_CONSOLE_API_OVERLAP_HOURS` | API overlap before the cutoff | 3 |

- **Cutoff:** `apiFrom = min(local midnight of the viewer, now − overlapHours)`. History covers `[now − historyDays·24h, apiFrom)`. The API covers `[apiFrom, now]` plus `active_only`.
- **Header copy, verbatim:** `history: system tables · 90 days` / `history: API · 30 days`. A hit cap appends ` · capped`.
- **Mock mode:** there is no history source, and `history` is absent from `/api/mode` and `RunsResponse`.
- **Runs screen:** it must not change visually, except the badge text.

## Review Focus

1. **Midnight rollover.** A request at 00:05 must use a new cutoff, re-query history, and lose no runs from yesterday 21:05–24:00. They come from the API overlap. Test in Task 3.
2. **A long run sliced into hourly rows** becomes one run with the final slice's result. A run whose final slice falls after the cutoff is excluded from history; the API covers it. Test in Task 2.
3. **Permission denied, or no warehouse.** The app uses API-only, labelled with the reason, and never shows a 502. Test in Tasks 2 and 3.
4. **History rows for job ids outside the reading identity's items are dropped** (visibility, decision #4). Test in Task 2.
5. **Replay of a session that ran SQL** answers the same rows, with parameters matched exactly. Test in Task 3.

---

### Task 1: Statement Execution + workspace id in `LiveApi`, config, types

**Files:**
- Modify: `server/data/live/api.ts`, `server/data/live/fakeApi.ts`, `server/data/capture/replayApi.ts`, `server/data/live/limits.ts`, `shared/domain/types.ts`
- Create: `server/data/systables/config.ts` + `config.test.ts`

**Interfaces produced:**
- `LiveApi.executeStatement(req: sql.ExecuteStatementRequest): Promise<sql.StatementResponse>`, via `client.statementExecution.executeStatement`
- `LiveApi.getStatement(req: { statement_id: string }): Promise<sql.StatementResponse>`
- `LiveApi.getStatementChunk(req: { statement_id: string; chunk_index: number }): Promise<sql.ResultData>`
- `LiveApi.workspaceId(): Promise<string>`: `GET /api/2.0/preview/scim/v2/Me` with `responseHeaders: ['x-databricks-org-id']` (see `node_modules/@databricks/appkit/dist/context/service-context.js` ~108–120 for AppKit's exact call). Returns `''` when absent. It *is* recorded (unlike `host`).
- `FakeData` additions:
  - `sql?: (statement: string, params: Record<string, string>) => string[][] | Error` (answers `executeStatement` inline, with `status.state SUCCEEDED`)
  - `workspaceId?: string`
- `replayApi` `METHODS` += `'executeStatement', 'getStatement', 'getStatementChunk', 'workspaceId'`; `IDENTITY` += `statement_id`, `chunk_index`.
- `LiveLimits` additions: `historyDays` (90), `historyMaxRuns` (20000), `apiOverlapHours` (3), with env keys as in Global Constraints. `readLimits` must clamp `historyDays` to at most 365.
- `systables/config.ts`: `readHistoryConfig(env): { warehouseId?: string; workspaceId?: string; enabled: boolean }`. `enabled` is false when `JOBS_CONSOLE_HISTORY=off` or there is no warehouse id.
- `shared/domain/types.ts`:
  ```ts
  export type HistoryInfo =
    | { source: 'system-tables'; days: number; capped?: boolean }
    | { source: 'api'; days: number; reason?: string; capped?: boolean };
  ```
  Add `history?: HistoryInfo` to `DataMode` and to `RunsResponse`.

- [ ] Write tests:
  - `config.test.ts`: env parsing, the `off` switch, the 365 clamp.
  - Extend `limits.test.ts` for the new defaults.
  - A fakeApi `executeStatement` round trip in a small test.
- [ ] Implement, run `npm test` and typecheck, then commit: "LiveApi: Statement Execution + workspace id (recorded/replayed); history config and limits; HistoryInfo type".

### Task 2: `systables` module (SQL runner, access probe, queries, mapping)

**Files (all create):** `server/data/systables/sql.ts`, `probe.ts`, `queries.ts`, `mapHistory.ts`, and a test file for each.

**Interfaces:**
- **`sql.ts`:** `runSql(api: LiveApi, warehouseId: string, statement: string, params: Record<string, string>, dl: Deadline): Promise<Record<string, string | null>[] | typeof TIMEOUT>`
  - Request: `executeStatement({ warehouse_id, statement, parameters: Object.entries(params).map(([name, value]) => ({ name, value })), wait_timeout: '30s', on_wait_timeout: 'CONTINUE', disposition: 'INLINE', format: 'JSON_ARRAY' })`.
  - While PENDING or RUNNING, poll `getStatement` every 1 s within the deadline.
  - FAILED or CANCELED throws an `Error` with `status.error.message` and `.code = status.error.error_code`.
  - Collect `result.data_array`, then `getStatementChunk` for each `next_chunk_index`.
  - Zip rows with `manifest.schema.columns[].name`.
- **`probe.ts`:** `createHistoryProbe({ api, config, clock }): { check(userKey): Promise<{ ok: true; workspaceId: string } | { ok: false; reason: string }> }`
  - Caches per `userKey` for 10 minutes.
  - Reasons, verbatim:
    - `history off`
    - `no SQL warehouse configured`
    - `no workspace id`
    - `no access to system.lakeflow (PERMISSION_DENIED)` (and `TABLE_OR_VIEW_NOT_FOUND`, etc., built from the error code)
    - `warehouse error: <message>`
    - `timed out`
  - Probe statement: `SELECT 1 AS ok FROM system.lakeflow.job_run_timeline WHERE workspace_id = :ws LIMIT 1`.
- **`queries.ts`:** SQL text constants using parameters `:ws`, `:from_ts`, `:to_ts` (ISO strings):
  - `JOB_RUNS_SQL`: from `job_run_timeline`, aggregated per `(job_id, run_id)`. `MIN(period_start_time) start`, `MAX(period_end_time) end`, `MAX_BY(result_state, period_end_time) result_state`, `MAX_BY(termination_code, period_end_time) termination_code`, `MAX(run_type) run_type`. Filtered `WHERE workspace_id = :ws AND period_start_time >= :from_ts - INTERVAL 1 DAY` (catches slices of runs that started in range), `HAVING MIN(period_start_time) >= :from_ts AND MIN(period_start_time) < :to_ts AND MAX_BY(result_state, period_end_time) IS NOT NULL`, ordered by start desc, `LIMIT :max_runs`.
  - `TASK_RUNS_SQL`: from `job_task_run_timeline`, aggregated per `(job_id, job_run_id, run_id, task_key)` in the same way, for the same window. Check the real column naming in the spec's linked docs: the parent run id column is `job_run_id`.
  - `TASK_DEPS_SQL`: latest `job_tasks` row per `(job_id, task_key)` where `delete_time IS NULL`, with `depends_on_keys`.
  - `PIPELINE_UPDATES_SQL`: from `pipeline_update_timeline`, aggregated per `(pipeline_id, update_id)`, same pattern.
- **`mapHistory.ts`:** `historyDrafts(rows: { runs; tasks; deps; updates }, items: Item[], host: string, me: string): Draft[]`, implementing the spec's "Mapping system-table rows to runs":
  - Drop rows whose `job_id` / `pipeline_id` is not among the items.
  - Result mapping per the spec table.
  - `failureCause(code, '')`.
  - Tasks deduped by `task_key`, latest kept, `attempt = count − 1`, `deps` resolved to indexes.
  - `url` from `jobRunUrl`; `pipelineNumber(update_id)` for pipeline ids.
  - Read `server/data/live/kinds.ts`, `jobs.ts` and `pipelines.ts` for the `Draft` shape and reuse their helpers. Don't fake SDK objects.

- [ ] Write tests first:
  - `sql.test.ts`: inline result, polling then success, chunks, FAILED → error code, deadline → `TIMEOUT`.
  - `probe.test.ts`: every reason above; the 10-minute cache; ok.
  - `mapHistory.test.ts`:
    - hourly slices → one run with the final-slice result
    - the result mapping table
    - a dropped row for an unknown job id
    - task dedupe with attempts and deps
    - pipeline update mapping
  - A `queries.test.ts` that asserts each SQL contains the `:ws` filter and the parameters it needs. This is a smoke test, not a SQL engine.
- [ ] Implement until green, then commit: "systables: SQL runner, access probe, history queries, rows → drafts".

### Task 3: Merge history into the live run source; `/api/mode` history; sweep; replay

**Files:**
- Modify: `server/data/live/liveRunSource.ts`, `server/data/live/liveProvider.ts`, `server/data/capture/replayProvider.ts`, `server/data/capture/sweep.ts`, `server/server.ts`, `server/data/runSource.ts`, `client/src/hooks/useRuns.ts` (only if `tzOffset` isn't already sent; it is)
- Tests: `server/data/live/history.test.ts` (new), `server/data/capture/replay.test.ts` (extend)

**Behaviour:**
- **Cutoff:** `cutoffs(now, tzOffsetMin, limits) → { apiFrom, historyFrom }` in a pure helper (`server/data/systables/cutoff.ts` + test). `apiFrom = min(localMidnight(now, tzOffsetMin), now − apiOverlapHours·h)`; `historyFrom = now − historyDays·24h`.
- **When the probe is ok:**
  - The API collect window becomes `from = apiFrom` (delta logic unchanged, but its base `since` key includes `apiFrom`'s day).
  - History comes from `state.history: Map<string, { cutoff: number; drafts: Draft[]; capped: boolean }>`, keyed by `userKey`. It is re-queried when the cached `cutoff !== apiFrom`'s day start (midnight rollover). It needs the items list (`listItems()`, already cached 5 min) and runs the 4 queries concurrently within a deadline of `limits.itemsTimeoutMs`.
  - In `mapCollected`, history drafts whose id is not among the API drafts join them **before** `finalize`.
  - The API slice keeps `maxRuns`. History is capped at `historyMaxRuns` (the query `LIMIT`); `capped` is true when the row count equals the limit.
  - The response carries `history: { source: 'system-tables', days: historyDays, capped? }`.
- **When the probe fails, or a history read fails or times out:** behave exactly as today (`windowDays` 30) and attach `history: { source: 'api', days: windowDays, reason, capped? }`. Do not cache the failure beyond the probe's 10 minutes.
- **The response cache key** includes `tzOffsetMin`.
- **Pipeline refs:** history pipeline updates are added to `state.pipelineRefs` so the drawer's refresh and log work for them.
- **`/api/mode`** adds `history` from the probe for the requesting identity (live). It is absent in mock mode. In replay mode, use the recorded session's response.
- **Sweep:** also reads history, so captures carry the SQL.
- **The replay wrapper** forwards unchanged. Add a replay round-trip test that records `listRuns` with history over `fakeApi({ sql, workspaceId, ... })` and replays the same run ids.

- [ ] Write tests first (`history.test.ts` over `fakeApi`):
  1. History + API merged, API wins on the same id; runs from both sides of the cutoff are present.
  2. At 00:05 local, the API covers from 21:05 the previous day (overlap) and history from before that. A cached history from the previous day is re-queried.
  3. No warehouse → `history.source === 'api'`, reason `no SQL warehouse configured`, and runs identical to today's behaviour.
  4. SQL error `PERMISSION_DENIED` → api, with that reason, never an error response.
  5. History cap → `capped: true`.
  6. `usualSec` uses history runs (a slow run is detected against 60 days of history).
- [ ] Implement until green, then commit: "Run history before today from system tables (cached until midnight), today from the API; automatic API fallback with reason; /api/mode history; sweep + replay".

### Task 4: Header label

**Files:** modify `client/src/components/Shell.tsx`, `client/src/components/shell.css`, `client/src/components/Shell.test.tsx`.

- [ ] Write a test, then implement. `badgeText` appends ` · history: system tables · 90 days` / ` · history: API · 30 days`, plus ` · capped` when set. The badge tooltip shows the reason for API mode. Nothing changes in mock mode. Commit: "Header shows where run history comes from".

### Task 5: Pipelines credited to the jobs that start them (server)

**Files:**
- Modify: `shared/domain/types.ts` (`Item.startedBy?: { jobId: string; jobName: string }[]`), `server/data/live/items.ts`, `server/data/live/items.test.ts`, `server/data/mock/mockItems.ts`, `server/data/mock/mockItems.test.ts`

- [ ] Write tests first:
  - `listJobs` is called with `expand_tasks: true`.
  - A job with `pipeline_task: { pipeline_id: 'p1' }` gives item `p1` `startedBy: [{ jobId, jobName }]`.
  - Several jobs → all are listed.
  - Unknown pipeline ids are ignored.
  - Mock: some triggered (non-continuous) pipelines get a `startedBy` pointing at a scheduled mock job, deterministically.
- [ ] Implement, then commit: "Items: pipelines know which jobs start them (expand_tasks)".

### Task 6: Client: credited starts, Scheduled filter, pill, keys and timeline collapse

**Files:**
- Modify: `client/src/model/items.ts` (+test), `shared/domain/cron.ts` (`triggerPill` for a credited pipeline) (+test), `client/src/model/schedule.ts` if needed, `client/src/components/ItemsFilterBar.tsx`, `client/src/components/ScheduleTimeline.tsx`, `client/src/components/ItemList.tsx`, `client/src/pages/JobsPage.tsx` (+test), `client/src/pages/jobs.css`

**Behaviour (spec U1, U3, U5; port the markup and CSS from the mockup):**
- **Starts:** `startsOf(pipelineItem)` = the union of `startsOf(job)` for each job in `startedBy` that the item list contains (sorted, deduped). It needs an id → item lookup, built once per items array. `isOnTimeline` is true for such pipelines.
- **Pill:** `pillOf(credited pipeline)` = `{ text: '<first job pill text> · by job', cls: 'sched', title: 'Started by the pipeline task of <jobName>[, …]' }`.
- **Filter:** `ItemFilters.trigger: 'any' | 'sched' | 'unsched'`. The segment is `Any trigger · Scheduled · Unscheduled`, with counts (mockup `#schedSeg`). Scheduled means `isOnTimeline(item)` is true.
- **Keys:** T, L and D via a document keydown handler that is active only when `JobsPage` is active and the target is not an input/select/textarea (no Ctrl/Meta/Alt).
  - T toggles `tlCollapsed`. The collapsed `ScheduleTimeline` renders the mockup's `.tl-min` line with day names: `Tue 19:00 to Wed 19:00, 1 day`, a `· schedule filter on` suffix when narrowed, and `<kbd>T</kbd> expand`.
  - L sets view list; D sets view load.
  - Key hints: `<kbd>L</kbd>` / `<kbd>D</kbd>` on the switch buttons (titles "List (L)" / "Load (D)"), and `<kbd>T</kbd> collapse` in the timeline title row. Port the `kbd` CSS, scoped under `.jobs`.
- [ ] Write tests first (model + page): credited starts; pill text; Scheduled · Unscheduled counts and filtering; T collapses and expands; L/D switch views; keys ignored in the search input and when the tab is inactive.
- [ ] Implement, then commit: "Jobs & ETL: pipelines on the schedule via their jobs, Scheduled · Unscheduled filter, T/L/D keys with hints".

### Task 7: Client: stacked Load and the not-on-the-chart list

**Files:** modify `client/src/model/load.ts` (+test), `client/src/components/LoadView.tsx` (+test), `client/src/pages/jobs.css`.

**Behaviour (spec U2, U4; port from the mockup's `renderLoad`):**
- **Runs:** `loadRuns` includes credited pipeline starts, using the pipeline's typical runtime. Continuous pipelines (`trigger === 'continuous'`, not paused) add one run spanning `[from − 24h, to + 24h]`, flagged `always`.
- **Curve:** `loadCurve` returns `running`, `runningJobs`, `runningPipelines` and `startsIn`.
- **Chart:** jobs polygon with fill `#eadfce` and line `#9c8462`; pipelines band stacked on top (polygon between the jobs line and the total line), fill `#ddd3f3`, line `#6a4fb0`. Each band renders only when non-zero. Header key `jobs` / `pipelines`. The header text follows the mockup, including `continuous ones (N) run the whole time`.
- **Tooltip:** `HH:MM · N running: J jobs · P pipelines · M start in the next 5 min`, then the groups.
- **List:**
  - Continuous pipelines are listed first, with "running the whole time".
  - The "Not on the chart · N with no fixed start times (manual, triggered by a file or a table, paused, or a pipeline no scheduled job starts)" section lists the remaining items with "no start times" (cap 200 + note).
  - Header `N continuous on the chart` / `Nothing on the chart` when nothing is scheduled.
- [ ] Write tests first: two bands and tooltip text; type filter Pipelines → only the pipeline band; continuous counted across the range; the not-on-the-chart section lists unscheduled items; the Unscheduled filter shows the continuous pipeline on the chart and the rest in the section.
- [ ] Implement, then commit: "Load: jobs and pipelines stacked, continuous pipelines count, items not on the chart are listed".

### Task 8: Config, package, verify, merge

**Files:** modify `databricks.yml` (app `resources: [{ name: sql-warehouse, sql_warehouse: { id: ${var.warehouse_id}, permission: CAN_USE } }]` with a `warehouse_id` variable; check the bundle schema with `databricks bundle validate` if auth allows, otherwise follow the AppKit docs in `node_modules/@databricks/appkit/docs/configuration.md`), `app.yaml` (env `DATABRICKS_WAREHOUSE_ID` `valueFrom: sql-warehouse`), `run-local.ps1` (optional `-Warehouse` param → `$env:DATABRICKS_WAREHOUSE_ID`), `README.md` (one short section: enabling history, the grants needed: `USE CATALOG system`, `USE SCHEMA system.lakeflow`, `SELECT` on the four tables, `CAN USE` on the warehouse), and `deploy/`.

- [ ] `npm test`, typecheck and lint on changed files.
- [ ] `npm run package`, then commit `deploy/` ("deploy: rebuild (system-tables history, stacked Load)").
- [ ] Browser pass on mock data in a **visible** tab (bring it to front; a hidden tab pauses rendering). Check the Jobs & ETL changes (U1–U5) and the Runs badge.
- [ ] Merge to master (fast-forward) and push. Report that the live system-tables path still needs a pass against the dev workspace once the `jobs-console` login is refreshed.
