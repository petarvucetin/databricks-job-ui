# Compare runs

Built 2026-09-26 from option B of `mockups/compare-runs.html` (aligned comparison).

## How it opens

- **Click** a run history box: the run drawer for that one run (replaces whatever is open).
- **Ctrl+click** (Cmd+click on a Mac): adds the run to the drawer's stack. With 2+ runs the drawer widens into the comparison. × on a run chip drops it; back to one run shows the run drawer again.
- **Ctrl+Shift+click**: adds the run to a separate browser tab (`/?compare=<ids>`, window name `jobs-console-compare`, reused on every Ctrl+Shift+click). The tab keeps its runs in its URL; the main tab reads that URL back before adding, so × removals in the tab stick. If the tab was closed, the next Ctrl+Shift+click starts a new one.
- Runs are shown oldest first. Only runs of one job are stacked: a run of another job starts a new stack.

## What it shows

1. Header: job name, number of runs, × (drawer only).
2. Run chips: result, start, duration, ×. The empty first cell says how to add runs.
3. Run: every run's total on one scale, with a tick for the job's average.
4. Parameters: every parameter any run used, one row each, with each run's value ("not set" when a run did not have it). No diffing.
5. Tasks: every task from any run in DAG order, all runs on one time scale. A run that did not have a task says "not in this run". The last column says what differs and in which run: added/removed (blue), failed (red), slower than the fastest by more than 1.5× (amber), skipped, running, or same.
6. Root: each run's cause, side by side.

## Later

- **Compare runs of different jobs.** Today a run of another job starts a new stack. Open: should it be allowed, and how do rows line up when tasks share nothing (fall back to option A's separate columns?).
- **Diff parameters.** Highlight changed values and say which run a parameter was added, removed or changed at; compare the job's parameter definitions (e.g. `{{job.start_time.iso_date}}`), not resolved values, so dynamic values don't count as changes. Same for compute and code (commit), which the data doesn't carry yet.
- Per-task definition changes (notebook path, task parameters) as a marker on the task row.
- Clicking a task in the comparison to open its log.
