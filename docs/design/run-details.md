# Screen: Run details pane — PARKED (resume after landing page)

Status: direction chosen (shape A), not yet inventoried. Return to this after the landing page and job list are done.

## Direction chosen (2026-09-18)

Shape A from `detail-v2.html` + `click-budget-v3.html`: the pane that appears after ONE click on a job row.

Order, top to bottom:

1. **Header** — status pill (incl. attempt N/M), bundle target, bundle/UI-locked, paused; full name with shared prefix greyed; description; creator/run-as, schedule, task count, cluster summary, perf. target; "launched by <parent> ▸ <task key>"; actions (Cancel, Repair, Run now ▾, Resume/Pause, Tasks & config).
2. **Run strip** — last 25 runs as bars, height = total duration; failed attempts inside a run stacked as hatched segments; click a column to select that run.
3. **Tasks × runs matrix** — rows = tasks in DAG order, columns = same 25 runs; cell colour = task result; badge = attempt count; click a cell to change the task of interest.
4. **Drawer, default "At a glance"** —
   - Stats vs own history: total (delta vs last run, × median of last 25), where-the-time-went bar (queue / setup / failed attempts / live), queue+setup, attempts, what's different vs last green (cluster, params, code).
   - Verdict line in plain language (derived from termination codes/types and deltas).
   - Output of the task of interest: notebook → `notebook_output.result`; python script → `logs` tail (+ `logs_truncated`); SQL → `sql_output`; dbt → `dbt_output`. Live refresh while running.
   - Secondary tabs (1 click, in place): Attempts, Exit value / result, Parameters (resolved), Cluster & Spark UI ↗, Compare with last green, Tasks & config.

## Data calls

- On hover-intent (150 ms): `runs/list?job_id&expand_tasks&limit=25` → strip, matrix, medians, deltas.
- On select: `runs/get?run_id&include_history&include_resolved_values` → attempts, termination details, resolved params; `runs/get-output?run_id=<task run id>` for the task of interest.
- Cache 60 s. Task of interest = failing task, else running task, else last task in DAG.

## Open questions to resolve when resumed

- Exact inventory of elements (this file is a direction, not an inventory).
- Which stats matter most to the operator vs author.
- Whether the verdict line is rule-based only, or may call an LLM (ai_query) for the message.
- How the pane behaves for a job with no runs, a job with 100+ tasks, and a for_each task with many iterations.
