# Incremental refresh

Why: auto refresh (every 30s to 5 min) currently re-reads the whole window on every `/api/runs` call. That's up to about 80 runs/list pages, plus getPipeline, listUpdates and events for every pipeline. Finished runs don't change, so on a large workspace almost all of that work is wasted. Approved by the user on 2026-09-29.

## Behaviour

The server keeps a **base snapshot per user**: the collected SDK objects (job runs by run_id, pipeline info, updates and events by pipeline), not only the mapped `Run[]`, so re-mapping stays exact.

- **Full load** happens when:
  - there is no base for the user, or the base is older than `JOBS_CONSOLE_FULL_REFRESH_MS` (default 15 min);
  - the window changed;
  - the client asks for one with `?full=1`. The ↻ refresh-now button in the filter bar sends `full=1`, because it means "I want everything fresh". Timer refreshes don't.

  A full load does exactly what happens today, and its result becomes the new base.
- **Delta refresh** (every other `/api/runs` call) fetches only what can have changed since the base's last `asOf` (call it `since`, less a safety margin of 2 minutes for clock skew and late-reported starts):
  1. **Jobs, active runs:** runs/list with `active_only=true` and `expand_tasks=true`, all pages.
  2. **Jobs, new runs:** runs/list with `start_time_from = since - margin` and `expand_tasks=true`, all pages. These are runs that started after the last refresh, including ones that already finished.
  3. **Jobs, runs that just finished:** runs that were live in the base but are in neither list 1 nor list 2 get `jobs.getRun` each, with concurrency ≤ `JOBS_CONSOLE_CONCURRENCY`. A 404 means the run was deleted, so drop it.
  4. **Pipelines:** one paginated `listPipelines` pass. Its `latest_updates[]` gives each pipeline's newest update IDs and states. Re-read (getPipeline only if the pipeline is new; listUpdates since the window start; events, 250 per page, as in collect.ts) **only** pipelines where either:
     - the latest update's id or state differs from the base, or
     - the base has a live (not finished) update.

     Pipelines missing from the list are dropped.
  5. **Merge** into the base by run_id / update_id, drop anything now older than the window start, then re-map everything with the existing pure mappers. `usualSec`, kinds and the history averages then stay consistent across the whole set. The merged set becomes the new base, with `asOf` = now.
- The `JOBS_CONSOLE_MAX_RUNS` cap still applies to the merged set, keeping the newest.
- If a delta step fails, fall back to a full load. Record a diagnostic `delta-fallback` with the reason. If the full load also fails, return the error as today. A failed delta must never serve a half-merged base.
- The existing 20s response cache stays in front, keyed by user and window.
- **Delta off switch:** `JOBS_CONSOLE_INCREMENTAL=0` disables deltas (every call is a full load).

## Single-run refresh (from the drawer work)

`GET /api/runs/:id` already updates the cached list entry. With a base snapshot it must update the base (SDK objects) too, so the next delta doesn't overwrite a newer single-run fetch with older data. Compare by the run's state or end time, or keep whichever was fetched later.

## Observability

- Each `/api/runs` response includes `refresh: { mode: 'full' | 'delta', calls: <number of LiveApi calls>, ms }`. Add it to the RunsResponse type as optional; the client ignores it except in tests.
- **Diagnostics** (the existing trace sink): `delta` notes with counts. How many active runs, new runs, just-finished runs fetched via getRun, deleted runs, pipelines re-read out of the total, and runs dropped because they aged out of the window.
- **Capture/replay:** the recorder records delta calls as normal sessions. Replay must reproduce a delta, so the replay provider has to keep a per-user base between replayed requests the same way. Add a test that records a full load and then a delta against fakeApi with changing data, and checks that replay serves identical responses for both.

## Testing

- The pure merge function, which is easiest to test: base + delta results → new base, covering:
  - a new run
  - a live run still running
  - a live run that finished (getRun)
  - a deleted run
  - a run aging out of the window
  - a pipeline with a new update
  - an unchanged pipeline that isn't re-read
  - a pipeline removed
- The call-count test: with fakeApi, a delta on an unchanged workspace of 500 finished runs and 20 idle pipelines makes a constant number of calls, independent of history size. Concretely: active list (1 page), new runs (1 page) and the pipelines list (1 page).
- Fallback to a full load on a delta failure; `?full=1`; the full reload after `JOBS_CONSOLE_FULL_REFRESH_MS`; `JOBS_CONSOLE_INCREMENTAL=0`.
- Client: the filter bar's ↻ sends `full=1`; timer refreshes don't.
- All existing tests pass. `npm run typecheck`, `npm run lint` (0 errors), `npm test`, and `npm run package` (commit deploy/).

## Out of scope

Server push (SSE/websocket), cross-user sharing of snapshots.
