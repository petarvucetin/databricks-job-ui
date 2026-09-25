# Spec: Attention screen MVP (mock data)

Date: 2026-09-25. Status: draft for review.

## Goal

Rebuild the Attention screen from the HTML prototype (`prototype/drawer.html`) as the first real screen of the `jobs-console` AppKit app, served from a mock data source, so we can keep iterating on real components instead of the prototype.

## In scope

1. **App shell**: a top bar with the app name "Jobs console" and a data-mode badge ("mock data").
2. **Runs API**: `GET /api/runs` answers from a `RunSource` interface. This plan ships only the mock implementation, chosen by `JOBS_CONSOLE_DATA=mock`, which is also the default.
3. **Mock data**: a deterministic generator ported from the prototype:
   - Seven statuses: failed, retrying, slow, running, queued, snoozed, succeeded.
   - Jobs and pipelines, including continuous pipelines.
   - 91 days of history. Quiet days (10–15 Sep and 21 Sep) contain only succeeded runs.
   - 26 on-track running runs.
   - Fixed "now" (`asOf`) of 22 Sep 2026 08:00 local time.
4. **Filter bar**:
   - Scope switch (Mine / All I can see) with counts.
   - Type, Run as and Error code menus with counts.
   - Search box (job, task, run id, cause, error).
   - Running now toggle with a count.
   - Clear filters, and an "updated … ago" note.
5. **Timeline**:
   - Scale switch: 24h (hour columns), 7d / 14d / 30d (day columns), 90d (week columns). Default 30d.
   - Range presets: all, last 7 days, last 2 days, today. Default last 2 days.
   - Per-column status counts; clicking one filters to that column and status.
   - Clicking a column header selects that column; clicking it again selects all.
   - A draggable window with two handles and a movable bar, snapping to columns.
   - If the window no longer fits the scale, the scale widens. Narrowing the scale trims the window.
6. **Status tiles**: seven tiles with counts and a subtitle each.
   - Clicking a tile toggles that status.
   - Whenever the window or the Running toggle changes, the statuses present in the window are switched on automatically.
7. **Run row (v2)**, following `docs/design/01-landing-attention.md` "Row v2":
   - A type word tag. The full name, with the bundle target prefix dimmed.
   - "run as: <identity>" and a 12-run history strip.
   - Running-only parts: task chain, chain summary and live message.
   - A dashed "parked" box holding the cause pill and failing task.
   - When text, and a stats block: while running, a big ticking NOW plus the average; otherwise took/waiting plus the average.
   - Borders: red failed, amber slow/retrying, blue running on track.
   - Running indicator option C: a bottom progress edge filling as elapsed time approaches the average; past the average, moving amber stripes plus a tick at the average.
   - Sort order: status, then newest first. Show 120 rows, then "N more, show next 120".
8. **Reference labels**: the L key toggles a reference block above the list: one finished and one running row with numbered badges, plus a legend. Off by default; the choice is remembered in localStorage.
9. **Visual identity**: warm paper palette and IBM Plex Sans/Mono, self-hosted. It must not look like Databricks.

## Out of scope (later plans)

- Run details drawer.
- Live back end calling the Jobs and Pipelines APIs as the signed-in user.
- Acknowledge and snooze persistence (Lakebase).
- Deployment, and responsive/mobile layout.

## Data contract

```ts
type RunKind = 'failed' | 'retrying' | 'slow' | 'running' | 'queued' | 'snoozed' | 'succeeded';
type RunType = 'job' | 'pipeline';
interface Cause { label: string; code: string; detail: string }
interface FailedTask { name: string; cause: Cause; secs: number }
interface Run {
  id: number; runId: string; type: RunType; name: string;
  kind: RunKind; cause: Cause;
  startTime: number;      // epoch ms
  durationSec: number;    // elapsed so far (live) or total
  usualSec: number;       // average duration
  ntasks: number; failed: FailedTask[];
  runAs: string; mine: boolean;
  live: boolean;          // still going at asOf
  continuous: boolean;    // continuous pipeline
}
interface RunsResponse { asOf: number; source: 'mock' | 'live'; runs: Run[] }
```

`GET /api/runs?since=<epoch ms>` returns runs with `startTime >= since`, newest first. A missing `since` means everything. A non-numeric `since` returns 400 with `{ error }`.

## Behaviour rules carried over from the prototype

- **Default view**: the 30d scale, a last-2-days window, and the statuses present in that window switched on.
- **Running**: a run counts as running (`live`) if it is on track, retrying, a continuous pipeline, or slow and not yet finished at `asOf`. The Running now toggle keeps only live runs.
- **Scope counts**: runs within the last 30 days that are not succeeded.
- **Time**: day boundaries are local midnight, and the timeline ends at the midnight after `asOf`.

## Success criteria

- `npm run typecheck`, `npm run lint` and `npm test` pass.
- At the default view, the screen matches the prototype's behaviour.
- Verified in a real browser, with screenshots.
