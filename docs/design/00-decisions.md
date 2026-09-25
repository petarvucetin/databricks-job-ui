# Jobs console — decisions log

Working notes for the Databricks Jobs UI revamp. One entry per decision, newest at the bottom. Screens are worked one at a time; each gets its own file in this folder with an element inventory.

## Locked decisions (as of 2026-09-18)

| # | Decision | Notes |
|---|----------|-------|
| 1 | End product: clickable prototype | React app with realistic mock data; live mode later |
| 2 | Personas: operator, author, admin in one product | Visibility follows the signed-in user |
| 3 | Stack: AppKit (Databricks App) from day one | Custom Express routes over the Databricks SDK; the built-in `jobs()` plugin is NOT used (it is scoped to declared job IDs) |
| 4 | Auth: user authorization with the `jobs` scope | App sees exactly what the user sees in the native UI |
| 5 | Data layer: one interface, two backends (mock, live) | Mock responses shaped exactly like Jobs API 2.2 |
| 6 | ~~Scope: jobs only~~ → **Jobs and pipelines** (reversed 2026-09-22) | Pipelines (Lakeflow Declarative, formerly DLT) join the console as their own item type, so the UI must tell an ETL pipeline apart from a job. See "Pipelines API constraints" below |
| 7 | Visual identity: NOT a Databricks look-alike | Mockups so far are structure only, not styling |
| 8 | Design principle: click budget | Run status, comparison to history, and task output must be visible 1 click after selecting a job; hover = 0 clicks |
| 9 | Process: screen by screen, element inventory per screen | Landing page first; run details parked (see `run-details.md`) |
| 10 | Visual density: calm | One line per list item at rest; details only after selection. Annotated/chip-heavy layouts rejected (2026-09-20) |
| 11 | Landing = Attention feed, scope Mine / Deployed / All | Deployed = run-as is a service principal, no further matching (Q1 → D) |
| 12 | Acknowledge / snooze shared with team | Lakebase store keyed by run_id (Q2 → B); in-memory in mock mode |
| 13 | UI design is discussed visually only | Wireframes/mockups in the browser + screenshot; text for decisions and questions only |
| 14 | Two item types: **Job** and **Pipeline** (2026-09-22) | Follows the native "Jobs & Pipelines → Runs" list, which interleaves job runs and pipeline updates as peer rows with a Type column (Job / Pipeline - ETL). Ingestion (Lakeflow Connect) pipelines count as Pipeline, and the kind is a detail shown only after selection |
| 15 | Pipelines are standalone items, with no job ↔ pipeline linking | A pipeline update is its own item whatever triggered it. The feed doesn't cross-reference job runs and pipeline updates (no "launched by" between them). Job → job "launched by" (F1g) is unchanged |
| 16 | Continuous pipelines are flagged on failure AND on lag | Lag comes from `flow_progress` event metrics (`backlog_bytes/records/files/seconds`). Units depend on the source (Kafka: bytes+records; Auto Loader/Delta: bytes+files; Kinesis: bytes+seconds), so "lagging" = backlog rising over the last N progress events, not a fixed threshold. **To verify in live mode:** whether `flow_progress` events come back from the events API or only from the event-log table / `system.lakeflow` (METRICS level isn't filterable in the API) |

## Pain points being attacked (user-stated)

1. Finding the error takes 4+ clicks
2. No cross-job "what's broken" view
3. Jobs list gives no health at a glance
4. Task/DAG editor is cramped
5. Seeing task outputs / result messages from a run

## Jobs API 2.2 constraints that shape every screen

- `jobs/list`: max 100 per page, only server-side filter is exact name match. Load all, filter client-side.
- `runs/list`: max 25 per page; filters: job_id, active_only / completed_only, run_type, start_time window. No filter by result state or creator. `expand_tasks` returns per-task state and durations (first 100 tasks).
- `runs/get`: full run; `include_history` for repair history / attempts; `include_resolved_values` for parameters.
- `runs/get-output`: per TASK run only. Returns `error`, `error_trace`, `logs` + `logs_truncated`, `notebook_output`, `sql_output`, `dbt_output`, `run_job_output`, etc.
- Actions: `run-now` (with `only`, `job_parameters`, `queue`, `performance_target`), `runs/repair` (`rerun_tasks` | `rerun_all_failed_tasks`, `rerun_dependent_tasks`, `latest_repair_id`), `runs/cancel`, `runs/cancel-all`, `jobs/update` (partial).
- Status model: `status.state` (BLOCKED, PENDING, QUEUED, RUNNING, TERMINATING, TERMINATED, WAITING), `termination_details.code/type/message`, `queue_details.code`.
- NOT in Jobs API (deep-link to native UI or other APIs): cost per run (system tables), cluster metrics, Spark UI, driver logs UI, run events, lineage (UC), permissions (Permissions API).

## Pipelines API 2.0 constraints (added 2026-09-22)

Source: Databricks REST reference, https://docs.databricks.com/api/workspace/pipelines (list, get, listupdates, listpipelineevents, startupdate).

- **Auth scope:** pipelines endpoints need the `pipelines` scope. Decision #4 (`jobs` only) must widen to `jobs` + `pipelines`.
- **Vocabulary:** a pipeline "run" is an **update** (`update_id`), not a run. Update states: QUEUED, CREATED, WAITING_FOR_RESOURCES, INITIALIZING, RESETTING, SETTING_UP_TABLES, RUNNING, STOPPING, COMPLETED, FAILED, CANCELED. Pipeline states (separate): IDLE, DEPLOYING, STARTING, RUNNING, STOPPING, RECOVERING, FAILED, RESETTING, DELETED.
- `GET /pipelines` (list): max 100 per page (default 25). Filter: `name LIKE '%x%'` or `notebook='<path>'`, no composites. Returns `pipeline_id`, `name`, `state`, `creator_user_name`, `run_as_user_name`, `latest_updates[]` (newest first). `health` is deprecated. **No type, no tags, no schedule in the list**, which need `GET /pipelines/{id}` → `spec`.
- **ETL vs ingestion:** `spec.ingestion_definition` present ⇒ Lakeflow Connect ingestion pipeline; absent ⇒ ETL pipeline. `spec.continuous` ⇒ always-on (no discrete runs). `spec.deployment.kind = BUNDLE` ⇒ bundle-deployed.
- `GET /pipelines/{id}/updates`: paged history per pipeline; each update has `cause` (API_CALL, JOB_TASK, USER_ACTION, RETRY_ON_FAILURE, SCHEMA_CHANGE, SERVICE_UPGRADE, INFRASTRUCTURE_MAINTENANCE), `full_refresh`, `refresh_selection`, `validate_only`. `cause = JOB_TASK` ⇒ triggered by a job's `pipeline_task`, which is the join point with Jobs.
- **No cross-pipeline "recent updates" call** (unlike `runs/list`). A feed needs `latest_updates` from the list, then per-pipeline `listupdates` for more history.
- **Errors:** `GET /pipelines/{id}/events`, filter `level='ERROR' AND timestamp > '…'`, up to 1000 per page. The real cause is in `error.exceptions[0].message`; the top-level `message` only says "Update X is FAILED". Events can be truncated (`truncation.truncated_fields`).
- **Actions:** `POST /pipelines/{id}/updates` (start; `full_refresh`, `refresh_selection`, `full_refresh_selection`, `reset_checkpoint_selection`, `validate_only`), `POST /pipelines/{id}/stop`. There is no "repair". Full refresh can destroy streaming state, so it needs an explicit confirm.
- **Retries:** a failed update with retry-on-failure spawns a new update (`cause = RETRY_ON_FAILURE`), so the pipeline `state` can read RUNNING after a real failure. Status must come from the update, not the pipeline.

## Observations from the user's workspace screenshots (`../../screenshots/`)

- Names: `[dev <user>] aiges_ingest_sap_backfill_sys_bic_ngc_dwh_edw_<distinguishing suffix>_dev`. Native UI truncates the suffix, which is the only distinguishing part.
- Tags in use: owner username, `dev`, project (`aiges`), deploy date.
- A parent job "Run All Owned Jobs Sequentially (Backfill Last)" launches children via run-job tasks; "Launched" column shows `tNN_<jobid>`.
- Tasks retry: one task on attempt 3 after two failed attempts (spot reclaims). Native timeline shows attempts as hatched segments.
- Native job page already has a "Run total duration" bar chart with task squares per run (embryo of the matrix).
- Description field is used and meaningful ("History walk for <table>").
- Jobs are bundle-connected ("Connected to Declarative Automation Bundles").
- Workspace region: us-gov-west-1.

## Brainstorm artifacts

Mockups live in `.superpowers/brainstorm/<session>/content/` and screenshots in `.superpowers/brainstorm/*.png`:

- `mindsets.html` — four mental models: timeline, inbox, map, story
- `list-pruning.html` — 700 near-identical names: prefix collapse, token search, derived facets, hover card
- `detail-v2.html` — list grouped by bundle target + right pane (header, strip, matrix, drawer)
- `click-budget-v3.html` — "at a glance" pane: stats vs history, verdict, output tail; click budget table
