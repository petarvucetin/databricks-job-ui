# Jobs & ETL tab: browse job and pipeline definitions, with schedule and load views

Status: approved in the browser mockup on 2026-10-06 ("write and implement"). The mockup is the prototype for this screen and gets ported 1:1. The reference copy is `docs/design/mockups/jobs-etl-tab.html`, served during design at http://127.0.0.1:8765/.

## Goal

Today the app has one screen, one row per job built from runs. This change adds a second screen that browses the **definitions**: every job and pipeline the user can see, including ones that haven't run lately. It answers "what exists, how is it triggered, when will it start, and how busy is the schedule". The current screen becomes the **Runs** tab, unchanged.

## Decisions (from the mockup review)

| # | Decision |
|---|----------|
| J1 | Two tabs in the shell header: **Jobs & ETL · Runs**. The app still opens on Runs. The tab lives in the URL (`?tab=jobs`, `?tab=runs`). `?compare=` is unchanged and has no tabs. |
| J2 | Runs is today's screen with nothing removed or restyled. **The Runs timeline component is unchanged.** |
| J3 | Jobs & ETL rows are one line: type tag (JOB / PIPELINE), full name with the bundle prefix dimmed and the name cut at the **start** when too long (the suffix is the distinguishing part), the **trigger pill**, then the last run (✓ ✕ – or running Nm) and how long ago. |
| J4 | The detail pane is **closed on load and opens only when a row is clicked**. A click on the same row, ✕ or Esc closes it. Nothing is selected automatically. |
| J5 | Schedule timeline card "Scheduled starts by hour / day": the next 24 h by hour, or the next 7 days by day. Each column has two boxes with counts, **job starts** and **pipeline starts**, styled like the Runs timeline. Handles, presets (next 24h / next 6 hours / next hour; next 7 days / tomorrow / today), a click on a column head, and a click on a box all narrow it. When narrowed, the list keeps only items with a start inside the window, and each row's right side shows those start times instead of the last run. The footer counts the items without a schedule, and a "clear schedule filter ✕" link appears when narrowed. |
| J6 | The list header has a **List · Load** switch. There is no Gantt. |
| J7 | **Load view:** a single curve of scheduled jobs expected to be running at once, computed from each schedule plus a typical runtime. It has a **y-axis with the number of jobs** in round steps (0/5/10/15, …, 0/1k/2k/3k). A crosshair tooltip shows the time, the number running, the starts in the next sample, and the top 5 groups. Drag across the chart to select a range; the list under it then shows the jobs running in that range, with their run times. The list renders at most 200 rows, then "+N more". It has to work at 10,000 jobs. |
| J8 | The detail pane shows: type tag, name, description, "open in Databricks ↗"; Run as, Creator, Trigger (+ "next Wed 02:00, in 9h 44m"), Bundle, Tags, ID; **Recent runs** (the Run-history boxes, from the runs already loaded); Tasks (jobs) or Pipeline facts (kind, mode, target, compute); **See runs →**. |
| J9 | **See runs →** switches to Runs with its search set to the item's name. A click on a recent-run box switches to Runs and opens that run's drawer. |
| J10 | Filter bar: search (name tokens or ID, all tokens must match, any order), type `All · Jobs · Pipelines` with counts, scope `Mine · Deployed · All` with counts (decision #11 rules), a Tags menu (`key:value`), and Sort (Name · Last run · Recently failed · Next start). |
| J11 | The List view renders at most 300 rows, then "+N more — narrow with search, type, scope, tags or the schedule window". |

Not in scope (shown in the mockup, then rejected or mockup-only): the heat strip replacing the timeline boxes, the Density candidates A/C/D, the Gantt, and the 10,000-job synthetic data switch. Also out: favorites, run-now/edit actions, a column chooser, and job → pipeline crediting (see Pipelines below).

## Data

### Shared types (`shared/domain/types.ts`)

```ts
export type TriggerKind = 'schedule' | 'periodic' | 'file_arrival' | 'table_update' | 'continuous' | 'manual';

export interface Schedule {
  /** Quartz cron as the Jobs API returns it (settings.schedule.quartz_cron_expression). */
  cron: string;
  /** settings.schedule.timezone_id, e.g. "UTC", "America/Los_Angeles". */
  tz: string;
  paused: boolean;
}

export interface Item {
  type: 'job' | 'pipeline';
  /** job_id as a string, or pipeline_id. */
  id: string;
  /** Full name including the bundle target prefix. */
  name: string;
  description?: string;
  creator?: string;
  /** Who it runs as: settings.run_as.service_principal_name ?? .user_name ?? creator (jobs); run_as_user_name ?? creator (pipelines). */
  runAs?: string;
  /** Runs as a service principal (decision #11 "Deployed"). */
  deployed: boolean;
  /** Created or runs as the signed-in user (decision #11 "Mine"). */
  mine: boolean;
  tags: Record<string, string>;
  trigger: TriggerKind;
  /** Present when trigger = 'schedule'. */
  schedule?: Schedule;
  /** Present when trigger = 'periodic': trigger.periodic {interval, unit}. */
  periodic?: { interval: number; unit: 'HOURS' | 'DAYS' | 'WEEKS' };
  /** Trigger paused (schedule, periodic, file arrival, table update or continuous). */
  paused: boolean;
  /** settings.deployment.kind === 'BUNDLE' (jobs) / spec.deployment.kind (pipelines). */
  bundle: boolean;
  /** Item page in the workspace; absent in mock data. */
  url?: string;
}

export interface ItemsResponse {
  asOf: number;
  source: DataSource;
  items: Item[];
  /** The list was cut short (time budget or page cap): it shows what was read. */
  partial?: { reason: string };
}

export interface ItemDetail {
  item: Item;
  /** Jobs: tasks from jobs/get, dependencies first. */
  tasks?: { key: string; type: string; dependsOn: string[] }[];
  /** Pipelines: from pipelines/{id} spec. */
  pipeline?: { kind: 'ETL' | 'Ingestion'; continuous: boolean; target?: string; serverless: boolean; channel?: string };
}
```

### Endpoints

- `GET /api/items` → `ItemsResponse`. Live: `jobs/list` (all pages, `limit: 100`, no `expand_tasks`) plus the pipeline list the source already reads (`/api/2.0/pipelines`, `max_results: 100`) plus `pipelines/{id}` specs, which are already fetched for runs and cached. Results are cached per user for 5 minutes. A full read of ~10k jobs is ~100 pages, so items get their own time budget (separate from the runs budget). Running out returns `partial` with what was read, not a 502.
- `GET /api/items/:type/:id` → `ItemDetail`. Jobs: `jobs/get`. Pipelines: `pipelines/{id}`. Fetched when a row is selected.
- Errors follow the existing handler pattern (`orSourceError`): 401/403 pass through, 404 for an unknown id, everything else 502.

### Modes

- **Live:** new `LiveApi` methods `listJobs` and `getJob`. That means edits in `api.ts` (`createSdkApi`), `fakeApi.ts`, the replay `METHODS` list, and the replay provider's hand-written `RunSource` wrapper. Recording needs no change; it wraps every `LiveApi` method.
- **Replay:** served from the capture. `sweep.ts` also reads the items, so GovCloud captures carry definitions.
- **Mock:** items derived from the distinct job and pipeline names in `generateRuns` output. Schedules, tags, creator and run-as are derived from a name hash in a separate module, with no new draws inside the generator (its draw order is fixed). Mock runs have no `jobId`, so mock runs match items by name. The mock spread includes daily, hourly, every-N-hours, every-15-minutes and weekly schedules, paused ones, a periodic trigger, a file-arrival trigger, and unscheduled jobs.

### Field facts (from `@databricks/sdk-experimental` types)

- `jobs/list` items are `BaseJob {job_id, creator_user_name, settings, created_time}`. There is **no `run_as_user_name`** (only `jobs/get` returns it), so run-as comes from `settings.run_as` (`service_principal_name` | `user_name`), falling back to the creator.
- `settings.schedule` is `{quartz_cron_expression, timezone_id, pause_status}`; `settings.trigger` is `{file_arrival | table_update | periodic {interval, unit: HOURS|DAYS|WEEKS}, pause_status}`; `settings.continuous` is `{pause_status}`; `settings.deployment` is `{kind, metadata_file_path}`; `settings.tags` is a string map.
- Trigger precedence: continuous → schedule → periodic → file_arrival → table_update → manual.

### Pipelines

Pipelines have no schedule of their own. A "scheduled pipeline" is a job with a `pipeline_task`, and crediting it to the pipeline would need `expand_tasks` on the full job list. v1 does not do that. Pipelines show a `continuous` or `triggered` pill and **add no starts to the schedule timeline or the Load curve**. The purple "pipeline starts" boxes therefore stay empty in live data. Mock data follows the same rule.

## Schedules on the client

`shared/domain/cron.ts` evaluates Quartz cron in the job's time zone:

- Fields: seconds, minutes, hours, day-of-month, month, day-of-week, and optional year. Supported syntax: `*`, `?`, numbers, lists, ranges, steps (`a/b`, `*/b`, `a-b/c`), `JAN-DEC`, and `SUN-SAT` (Quartz day-of-week: 1 = Sunday).
- `L`, `W`, `#` and anything else make the expression **unparsed**. Such an item shows its raw cron in the pill, is left off the timeline and the Load curve, and is counted in the timeline footer ("N schedules not understood").
- Evaluation works day by day over the horizon, not minute by minute. Each local day in `timezone_id` that matches day-of-month / month / day-of-week produces its hour × minute combinations, which are turned into epoch ms through `Intl.DateTimeFormat` offsets (DST-correct). Starts are cached per item for a fixed horizon (yesterday through +10 days) and sliced by binary search, which keeps 10k items fast.
- The trigger pill text comes from the cron's shape: `daily 02:00`, `hourly · :45`, `every 6h · 04:15`, `every 15m`, `Sun 03:00`, otherwise `cron <expr>`. Times show in the viewer's local time; the timezone is in the pill's tooltip. Paused schedules show `paused`. Other triggers: `every 4h (periodic)`, `file arrival`, `table update`, `continuous`, `manual`. Pipelines show `continuous` or `triggered`.
- Periodic, file-arrival, table-update and paused triggers have no fixed start times and stay off the timeline and the Load curve.

## Load computation

- Runs in range = each scheduled item's starts in [from − 24 h, to), each lasting the item's **typical runtime**. Typical runtime is `Run.usualSec` from the newest loaded run of that job (matched by `jobId` in live and replay, by name in mock). With no run loaded it defaults to 10 minutes, and the tooltip marks it as an estimate.
- Sorted start and end arrays give `running(t) = #starts ≤ t − #ends ≤ t`. Sampled every 5 minutes on the hour scale and every 30 minutes on the day scale. The range follows the schedule timeline's window.
- Y ticks: a nice step (1/2/5 × 10ⁿ) for max/4, labelled `fmtN` (1.2k).
- Tooltip group: the bundle target prefix (`[dev name]`), else the `project` tag, else `prod / no prefix`.

## Client structure

- `App`: reads `?tab`, owns the runs data (`useRuns` + refresh lifted out of `AttentionPage`), and passes it to both tabs. Switching tabs keeps each tab's state; the inactive tab stays mounted but hidden.
- `Shell`: renders the tabs.
- Runs: `AttentionPage` takes the shared runs and an optional `focus {query?, runId?}`. A focus change remounts it with that initial search and opens that run's drawer.
- Jobs & ETL: `useItems` (fetch `/api/items`, refreshed with the runs interval), `model/items.ts` (filter / scope / tags / search / sort / pill / last run / typical), `model/schedule.ts` (buckets, window, counts), `model/load.ts` (curve, ticks, selection list), and components `ItemsFilterBar`, `ScheduleTimeline`, `ItemList`, `LoadView`, `ItemPane`. CSS is ported from the mockup, reusing `filterbar.css`, `timeline.css` and `runrow.css` classes where they match.
- Item detail: fetched on selection, cached per id for the session.

## States

- Loading: skeleton rows.
- Empty: "No job or pipeline matches", then the filters in words and **Clear filters**.
- Can't load: the error message plus **Try again**. A 403 names the missing scope.
- `partial`: a quiet line under the list header ("Read N of more jobs before the time limit").
- Detail loading or error is shown inside the pane only.

## Testing

- Unit (vitest): `cron.ts` (fields, steps, names, ?, DST day in America/Los_Angeles, unparsed cases); schedule bucket counts and window filtering; load curve (running counts, ticks, selection list); items filters, pill text, last-run matching.
- Server: `listItems`/`getItem` handlers over mock, live (`fakeApi` with `listJobs`/`getJob`, paging, partial on budget), and a replay round-trip.
- Client (RTL): tabs switch and keep the URL; the pane opens only on click; See runs → sets the Runs search; the narrowed timeline filters rows.
- Done means `npm test`, `npm run typecheck` and `npm run lint` pass, `npm run package` has run with `deploy/` committed, the commit is pushed, and the dev server URL is handed to the user.
