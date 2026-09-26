# Screen 01: Landing — "Is anything broken that I care about?"

Status: density DECIDED 2026-09-20 → "Calm" (see `.superpowers/brainstorm/landing-calm.png`). The full inventory below is the *capability* list; at rest the screen shows only: app name, scope word, refresh age, one summary line, day headers, and one line per item (severity dot · distinguishing name · short cause · time). Everything else appears only after selecting an item, in the run pane. Previous annotated wireframe (`landing-inventory-v2.png`) was rejected as too busy.

CLOSED 2026-09-20. Scope menu, expanded incident group, empty and can't-load states agreed in calm style (`landing-calm-details.png`).

Decisions:
- **Q1 → D.** "Deployed" = every job whose run-as is a service principal (run_as_user_name is a UUID) that the user can see. No owner-tag or bundle matching. Noise accepted; scope menu lets the user narrow later.
- **Q2 → B.** Acknowledge / snooze are **shared with the team**: stored in Lakebase (AppKit `--features lakebase`), keyed by run_id, with who and when. Visible to everyone with access to the app. Adds a Lakebase resource to the app; mock mode keeps it in memory.

REOPENED 2026-09-22 for pipelines (decisions #6, #14–16). Changes to the inventory below, still to be shown visually:
- **F1 type marker:** every item is a Job run or a Pipeline update. At rest this is a single quiet glyph before the name (calm rule), with no "Pipeline - ETL" text column.
- **F1a conditions for pipelines:** FAILED · CANCELED · RETRYING (update `cause = RETRY_ON_FAILURE`) · SLOW (vs median of that pipeline's last updates) · STUCK in WAITING_FOR_RESOURCES / INITIALIZING · LAGGING (continuous only, D8).
- **F1c task at fault → for pipelines, the flow/table at fault** (`origin.flow_name` of the first ERROR event).
- **F1d cause line → for pipelines, `error.exceptions[0].message`** from `GET /pipelines/{id}/events?filter=level='ERROR'`, never the top-level message.
- **F1g launched by:** job → job only. Pipelines are standalone, with no link to or from job runs (decision #15).
- **F1i actions for pipelines:** Start update · Refresh failed tables (`refresh_selection`) · Stop · Full refresh (behind a confirm, it destroys streaming state). There is no "Repair".
- **L1 scope:** Mine / Deployed use pipeline `creator_user_name` / `run_as_user_name` the same way as jobs.
- **New data calls:** R5 `GET /pipelines` (all pages) · R6 `GET /pipelines/{id}` for spec (type, continuous, schedule, bundle), cached · R7 `GET /pipelines/{id}/updates` per pipeline for history · R8 `GET /pipelines/{id}/events` ERROR-filtered for cause, `flow_progress` for lag.
- **Cost warning:** pipelines have no cross-pipeline "recent updates" call, so the feed polls `latest_updates` from R5 and fetches R7/R8 only for pipelines that look unhealthy.
- **D8 Lagging (new signal):** continuous pipeline whose backlog metric rose across the last N `flow_progress` events.

## Purpose

Answer, within five seconds of opening the app: **is anything broken that I care about, and what do I do about it?**
The page is a feed of attention items (runs that need a human) across the jobs in scope, newest first, scrolling back in time without limit.

## Decisions feeding this screen

- Scope presets: **Mine** (creator or run-as is me) while developing; **Deployed** (run as a service principal) once shipped; **All I can see** as the widest.
- Conditions: failed / timed out, retrying now, running slow, queued or blocked too long. All on by default.
- Window: last 24 hours on load, infinite scroll further back.
- Selecting an item opens the run details pane (parked, see `run-details.md`) beside the feed. This screen does not redefine that pane.

## Element inventory

| # | Element | What it shows | Data source (Jobs API 2.2 unless noted) | States |
|---|---------|---------------|------------------------------------------|--------|
| **Shell (shared by all screens)** |||||
| S1 | App name + primary nav | Attention (this screen), Jobs. Other tabs added as screens are designed. | — | active tab |
| S2 | Identity + workspace | who I am, workspace host, data mode badge (mock / live) | `iam.current-user` scope (default), app config | — |
| S3 | Global jump | ⌘K: jump to any job by name token, or paste a run id / job id | `jobs/list` cache; `runs/get` for a pasted run id | empty, results, no match |
| S4 | Refresh control | auto-refresh interval, paused-while-interacting, "last refreshed Ns ago", manual refresh | app state | live, paused, refreshing, error |
| **Scope and filters** |||||
| L1 | Scope switch | Mine · Deployed · All I can see, each with job count | `jobs/list` (all pages, cached): `creator_user_name`, `run_as_user_name` (UUID ⇒ service principal), `settings.tags` | selected, counts loading |
| L2 | Scope rule editor | how "Deployed but mine" is decided (tag key/value, bundle target prefix, run-as principal list); saved per user | app state; `settings.tags`, name prefix, `run_as_user_name` | default, customised |
| L3 | Condition chips | failed/timed out · retrying · slow · queued/blocked, each with count in window; toggle on/off | derived (see D1–D4) | on, off, count pending |
| L4 | Grouping toggle | group same termination code within N minutes into one incident (on by default); "not your code" label for INTERNAL_ERROR / CLOUD_FAILURE types | `status.termination_details.code`, `.type` | on, off |
| L5 | Window indicator | "last 24h · N runs scanned · M need attention · scanning older…" | derived from R1/R2 paging | scanning, complete, capped |
| **Feed** |||||
| F1 | Attention item (row) | see F1a–F1k | `runs/list` (+ `expand_tasks`), `jobs/list` cache | new, acknowledged, snoozed, resolved, selected |
| F1a | Condition pill | FAILED · TIMED OUT · WITH FAILURES · RETRY n/m · SLOW +x% · QUEUED 12m · BLOCKED | `status.state`, `termination_details.code`, `tasks[].attempt_number`, `run_duration` vs baseline, `queue_details.code` | — |
| F1b | Job name | shared prefix greyed, distinguishing tokens bright, target chip ([dev me] / [prod]) | `settings.name` | truncated w/ tooltip |
| F1c | Task at fault | task key of the first failed / retrying / slowest task | `tasks[].status`, `tasks[].attempt_number`, `tasks[].execution_duration` | none (job-level failure) |
| F1d | Cause line | termination code + type + first line of message; or slowness measure ("1h 35m vs 2m 59s last"); or queue reason | `termination_details.code/type/message`, `queue_details.code`, baseline (D3) | message absent |
| F1e | When | relative + absolute start time; end time if terminal | `start_time`, `end_time` | running (no end) |
| F1f | Duration | total so far / final; attempts marker if >1 | `run_duration`, `tasks[].attempt_number` | — |
| F1g | Launched by | parent job + task key when triggered by a run-job task | `trigger`, `trigger_info.run_id` → parent `runs/get` | absent |
| F1h | Downstream impact | "blocks N jobs due before HH:MM" | `settings.tasks[].run_job_task.job_id`, `trigger.table_update` on other jobs (from `jobs/list` cache) | none, computing |
| F1i | Quick actions | Repair failed + dependents · Cancel · Acknowledge · Snooze · Open ↗ | `runs/repair`, `runs/cancel`, app state, `run_page_url` | disabled while running (repair), permission denied |
| F1j | Lifecycle state | new / acknowledged (by whom, when) / snoozed until | app state | — |
| F1k | Selection | selected row opens the run details pane | — | selected |
| F2 | Incident group | header: code × N jobs · time span · "not your code" if platform/cloud type; expands to its items; group-level "Repair all N" | same as F1, grouped by `termination_details.code` within N minutes | collapsed, expanded |
| F3 | Day / time separators | "Today", "Yesterday", "Wed 16 Sep" | `start_time` | — |
| F4 | New-items banner | "3 new since you started reading ↑" (auto-refresh never shifts the list under the cursor) | R1 diff | hidden, visible |
| F5 | Infinite scroll sentinel | loads the next 25 completed runs further back; shows "scanning 17–18 Sep…" | `runs/list` `page_token` | loading, end of history, error |
| F6 | Empty state | "Nothing needs attention in <scope> over <window>. N runs scanned." + link to widen scope / window | — | — |
| F7 | Error state | auth scope missing (`jobs` not granted), API error, partial results with retry | HTTP errors | — |
| F8 | Keyboard | j/k move · enter open · r repair · c cancel · e ack · s snooze · / search · g scope | — | — |

### Row v2 (2026-09-25, prototype `drawer.html`)

Numbers are the row reference labels used in review; the gaps are removed or parked parts.

- **Status** lives in the card border: red failed, amber running. The status dot (1) is removed.
- **Type (2)** is a word tag, JOB or PIPELINE, not an icon.
- **Name (3)** is shown in full and wraps; only the bundle target prefix is dimmed. No truncation.
- **Run as (13)** sits under the name as `run as: <identity>`. **Run history (12)** is next to it.
- **Running-only parts:** task chain (6), chain summary (7) and live message (8) appear only while the run is going (retrying, or slow and unfinished). A separate **Running** filter is still to come.
- **Stats block (11)** replaces the now-vs-usual bars. While running it shows a big **now (9)** plus the average; once finished it shows **took** plus the average.
- **Parked:** cause pill (4) and failing task (5) sit in a dashed "parked" box until we decide where they belong. Revisited 2026-09-26 with three placements (`mockups/failed-row-options.html`: A cause line under the name, B failed pill on the top line, C note beside the failed run box). **Still parked:** a run can fail in many tasks for many different reasons, so a single cause + task on the row does not fit. Come back to it with that in mind.
- **Removed:** context notes (14): same error in N jobs, not your code, blocks N jobs, launched by.
- **Running (added 2026-09-25):** colour means health (blue on track, amber slow or retrying, red failed); being in progress is shown separately, by motion or shape. A new **Running** status covers healthy in-progress runs. The **Running now** toggle in the filter bar shows every in-progress run whatever its health. The NOW number ticks every second. Indicator options A–D are in `running-options.html`; C (progress edge: the bottom border fills as elapsed time approaches the average, then turns to moving amber stripes) is applied for now, pending the user's pick. The pipeline tag moved from blue to purple so blue can mean running.

## Derived signals (client-side)

| # | Signal | Rule | Inputs |
|---|--------|------|--------|
| D1 | Failed / timed out | terminal run with `result_state` in FAILED, TIMEDOUT, SUCCESS_WITH_FAILURES, or lifecycle INTERNAL_ERROR | `runs/list` |
| D2 | Retrying now | active run where any `tasks[].attempt_number ≥ 1`, or lifecycle WAITING_FOR_RETRY | `runs/list?expand_tasks=true` |
| D3 | Running slow | active run where `run_duration` > job `health.rules[RUN_DURATION_SECONDS]`, else > 1.5 × median of that job's last 25 runs; baseline loads lazily per job | `jobs/list` (health), `runs/list?job_id` |
| D4 | Queued / blocked too long | `status.state` QUEUED or BLOCKED for > threshold (default 10 min) | `runs/list?active_only=true` |
| D5 | Not your code | `termination_details.type` in INTERNAL_ERROR, CLOUD_FAILURE | `runs/list` |
| D6 | Incident | ≥ 2 items with same `termination_details.code` starting within 15 min | D1 |
| D7 | Downstream impact | other jobs in cache with a `run_job_task` pointing at this job, or a `table_update` trigger on a table this job writes (writes not knowable from API ⇒ only run-job edges for now) | `jobs/list?expand_tasks=true` |

## Data calls

| # | Call | When | Notes |
|---|------|------|-------|
| R0 | `jobs/list?limit=100&expand_tasks=true` (all pages) | on open, cached 5 min | names, tags, run-as, schedule, health rules, run-job edges. ~7 calls for 700 jobs |
| R1 | `runs/list?active_only=true&expand_tasks=true&limit=25` (all pages) | on open, every refresh | active runs across all jobs; filtered to scope client-side |
| R2 | `runs/list?completed_only=true&start_time_from=now-24h&expand_tasks=true&limit=25` (paged) | on open; further pages on scroll | 25 per page is the API max; a busy workspace may need many pages for 24 h |
| R3 | `runs/list?job_id=X&limit=25` | lazily per job with an active run | baseline for D3; cached 60 s |
| R4 | `runs/get?run_id=<parent>` | when `trigger_info.run_id` present | for F1g |

## Open questions for the user

1. **Deployed-but-mine rule.** Which signal identifies "my" deployed jobs: a tag (`owner=<me>`?), the bundle name, membership of a run-as principal list, or something else in your workspace convention?
2. **Slow threshold.** Health rule first, then 1.5 × median. Is 1.5× right, and should "slow" fire for runs with no baseline?
3. **Queue threshold.** 10 minutes default; adjustable in the scope rule editor?
4. **Acknowledge / snooze.** Per user or shared with the team (needs Lakebase or a table)? Per user is app-local and simplest for the prototype.
5. **Scan cap.** If 24 h means thousands of runs, do we cap the initial scan (e.g. 500 runs) and show "scanning older…" on scroll?
