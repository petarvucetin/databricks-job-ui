import type { Run } from '../../../shared/domain/types';
import { RunRow } from './RunRow';
import './reference.css';

const LEGEND: [string, string, string][] = [
  ['2', 'Type tag', 'Job or Pipeline, as a word.'],
  ['8', 'Live message', 'Running only: what the run is doing or waiting on right now.'],
  ['3', 'Name', 'Full job or pipeline name; bundle target prefix dimmed.'],
  ['9', 'Now / took', 'Big elapsed time while running; plain duration once finished.'],
  ['13', 'Run as', 'Identity the run executes as, next to the name.'],
  ['10', 'When', 'Failed, started, finished or queued since, with the timestamp.'],
  ['12', 'Run history', 'Last 12 runs, oldest to newest: red failed, amber slow or retried.'],
  ['11', 'Stats block', 'Now (running) or took, against the average duration.'],
  ['6', 'Task chain', 'Running only: one square per task, green ok, red failed, dashed skipped, blue running.'],
  ['4', 'Cause pill', 'Parked, to be reconsidered.'],
  ['7', 'Chain summary', 'Running only: the chain counted.'],
  ['5', 'Failing task / flow', 'Parked, to be reconsidered.'],
];

export function ReferenceBlock({ rows, nowMs, loadedAt, asOf }: { rows: Run[]; nowMs: number; loadedAt: number; asOf: number }) {
  const finished = rows.find((r) => !r.live);
  const running = rows.find((r) => r.live);
  if (!finished && !running) return null;
  return (
    <section className="ref" aria-label="Reference rows">
      <div className="ref-t">Reference rows</div>
      {finished && <RunRow run={finished} nowMs={nowMs} loadedAt={loadedAt} asOf={asOf} />}
      {running && <RunRow run={running} nowMs={nowMs} loadedAt={loadedAt} asOf={asOf} />}
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
