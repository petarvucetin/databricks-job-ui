import type { Run } from '../../../shared/domain/types';
import { RunRow } from './RunRow';
import './reference.css';

const LEGEND: [string, string, string][] = [
  ['2', 'Type tag', 'Job or Pipeline, as a word.'],
  ['12', 'Run history', "This job's finished runs in the timeline window, oldest to newest: runtime on top, start day/time (e.g. 18/06:00) under it; green succeeded, red failed, grey struck cancelled, split partially succeeded; outlined box is this run."],
  ['3', 'Name', 'Full job or pipeline name; bundle target prefix dimmed.'],
  ['6', 'Task chain', 'One square per task, green ok, red failed, dashed skipped, blue running. Running rows only: the current run.'],
  ['13', 'Run as', 'Pill next to the type tag, above the name: the identity the run executes as.'],
  ['7', 'Chain summary', 'The chain counted.'],
  ['15', 'Task name', 'Hover a square in the chain: its task name appears under the chain.'],
  ['17', 'Run popup', "Click any history box: a popup under it with that run's task boxes; hover a box for its task name. Escape, a click outside, or the box again closes it."],
  ['16', 'Current run', "Last box in a running row's history: tasks done of total, and when it started."],
  ['11', 'Waiting pill', 'Queued only: pill on the top line with the time spent waiting.'],
  ['9', 'Progress bar', 'Running only: band along the bottom, gold for jobs, blue for pipelines, solid, filling toward the average with the current runtime at its end; past the average it stays full with a tick where the average falls.'],
  ['14', 'Average', 'Average duration for this job, next to the Run history title.'],
];

export function ReferenceBlock({ rows, history, nowMs, loadedAt, asOf }: { rows: Run[]; history: Map<string, Run[]>; nowMs: number; loadedAt: number; asOf: number }) {
  const finished = rows.find((r) => !r.live);
  const running = rows.find((r) => r.live);
  if (!finished && !running) return null;
  return (
    <section className="ref" aria-label="Reference rows">
      <div className="ref-t">Reference rows</div>
      {finished && <RunRow run={finished} history={history.get(finished.name)} nowMs={nowMs} loadedAt={loadedAt} asOf={asOf} />}
      {running && <RunRow run={running} history={history.get(running.name)} nowMs={nowMs} loadedAt={loadedAt} asOf={asOf} />}
      <div className="ref-lgd">
        {LEGEND.map(([n, name, text]) => (
          <div key={n}>
            <b>{n}</b>
            <span>{name}</span>
            <span>{text}</span>
          </div>
        ))}
        <span className="ref-k">Border: red failed, amber slow or retrying, blue running on track. Press L to hide.</span>
      </div>
    </section>
  );
}
