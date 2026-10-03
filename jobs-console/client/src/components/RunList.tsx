import type { Run } from '../../../shared/domain/types';
import type { Action } from '../model/viewState';
import type { RowSort } from '../model/filters';
import { PAGE } from '../model/viewState';
import { RunRow, type OpenHow } from './RunRow';

export function RunList({ rows, history, cap, nowMs, loadedAt, asOf, selected, onSelect, openRuns, onOpenRun, dispatch, compact, sort = 'status', onSort }: {
  rows: Run[];
  history: Map<string, Run[]>;
  cap: number;
  nowMs: number;
  loadedAt: number;
  asOf: number;
  selected: number | null;
  onSelect: (id: number) => void;
  openRuns: readonly number[];
  onOpenRun: (runId: number, rowId: number, how: OpenHow) => void;
  dispatch: (a: Action) => void;
  compact?: boolean;
  sort?: RowSort;
  onSort?: (s: RowSort) => void;
}) {
  if (!rows.length) return <div className="rl"><p className="rl-empty">Nothing matches these filters.</p></div>;
  const byName = sort === 'name-asc' || sort === 'name-desc';
  return (
    <div className="rl">
      {onSort && (
        <div className="rl-head">
          <span className="rl-n">{rows.length} {rows.length === 1 ? 'job' : 'jobs'}</span>
          <span className="rl-sort-t">Sort</span>
          <span className="rl-sort">
            <button type="button" className={sort === 'status' ? 'on' : ''} onClick={() => onSort('status')}>Status</button>
            <button
              type="button"
              className={byName ? 'on' : ''}
              title="Job name, ignoring the [dev …] prefix; click again to reverse"
              onClick={() => onSort(sort === 'name-asc' ? 'name-desc' : 'name-asc')}
            >
              Name {sort === 'name-desc' ? 'Z–A' : 'A–Z'}
            </button>
            <button type="button" className={sort === 'runtime' ? 'on' : ''} title="Longest runtime first; runs still going stay on top" onClick={() => onSort('runtime')}>
              Longest first
            </button>
          </span>
        </div>
      )}
      {rows.slice(0, cap).map((r) => (
        <RunRow key={r.id} run={r} history={history.get(r.name)} nowMs={nowMs} loadedAt={loadedAt} asOf={asOf} selected={selected === r.id} onSelect={onSelect} openRuns={openRuns} onOpenRun={onOpenRun} compact={compact} />
      ))}
      {rows.length > cap && (
        <button type="button" className="rl-more" onClick={() => dispatch({ type: 'more' })}>
          {rows.length - cap} more, show next {PAGE}
        </button>
      )}
    </div>
  );
}
