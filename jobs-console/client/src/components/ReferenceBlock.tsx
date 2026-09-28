import type { Run } from '../../../shared/domain/types';
import { RunRow, type OpenHow } from './RunRow';
import './reference.css';

const LEGEND: [string, string, string][] = [
  ['2', 'Type tag', 'Job or Pipeline, as a word.'],
  ['12', 'Run history', "Hidden until you click the Run history title (▸, with how many runs); click again to hide. This job's finished runs in the timeline window, oldest to newest: runtime on top, start day/time (e.g. 18/06:00) under it; green succeeded, red failed, grey struck cancelled, split partially succeeded; outlined boxes are the runs open in the drawer."],
  ['3', 'Name', 'Job or pipeline name, without the bundle target prefix.'],
  ['19', 'Target', 'Pill under the name for development deployments: the bundle target and whose it is, e.g. dev john smith. Prod has none.'],
  ['13', 'Run as', 'Pill between the type tag and the name: the identity the run executes as.'],
  ['17', 'Run drawer', "Click any history box: the run drawer slides in for that run. Job, Run (this vs last vs usual), Tasks (timeline with dependencies, or grid; failures grouped by cause), Root, and Task with its log. Escape, the dimmed page, or × closes it. Ctrl+click adds runs to compare here; Ctrl+Shift+click adds them to a comparison tab."],
  ['18', 'Compare runs', "Two or more runs of one job side by side: totals, parameters, every task on one time scale with what differs and in which run, and each run's cause. × on a run drops it; a run of another job starts a new comparison."],
  ['16', 'Current run', "Last box in a running row's history: tasks done of total, and when it started."],
  ['11', 'Waiting pill', 'Queued only: pill on the top line with the time spent waiting.'],
  ['9', 'Runtime', 'Running only: a turning spinner and the current runtime. Green while under the average; amber past it, with how far over.'],
  ['14', 'Average', 'Average duration for this job, next to the Run history title.'],
];

export function ReferenceBlock({ rows, history, nowMs, loadedAt, asOf, openRuns, onOpenRun }: { rows: Run[]; history: Map<string, Run[]>; nowMs: number; loadedAt: number; asOf: number; openRuns?: readonly number[]; onOpenRun?: (runId: number, rowId: number, how: OpenHow) => void }) {
  const finished = rows.find((r) => !r.live);
  const running = rows.find((r) => r.live);
  if (!finished && !running) return null;
  return (
    <section className="ref" aria-label="Reference rows">
      <div className="ref-t">Reference rows</div>
      {finished && <RunRow run={finished} history={history.get(finished.name)} nowMs={nowMs} loadedAt={loadedAt} asOf={asOf} openRuns={openRuns} onOpenRun={onOpenRun} />}
      {running && <RunRow run={running} history={history.get(running.name)} nowMs={nowMs} loadedAt={loadedAt} asOf={asOf} openRuns={openRuns} onOpenRun={onOpenRun} historyOpen />}
      <div className="ref-lgd">
        {LEGEND.map(([n, name, text]) => (
          <div key={n}>
            <b>{n}</b>
            <span>{name}</span>
            <span>{text}</span>
          </div>
        ))}
        <span className="ref-k">Keys: L hides these labels, T collapses the timeline, C collapses rows to names.</span>
      </div>
    </section>
  );
}
