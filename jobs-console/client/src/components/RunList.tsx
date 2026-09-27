import type { Run } from '../../../shared/domain/types';
import type { Action } from '../model/viewState';
import { PAGE } from '../model/viewState';
import { RunRow, type OpenHow } from './RunRow';

export function RunList({ rows, history, cap, nowMs, loadedAt, asOf, selected, onSelect, openRuns, onOpenRun, dispatch, compact }: {
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
}) {
  if (!rows.length) return <div className="rl"><p className="rl-empty">Nothing matches these filters.</p></div>;
  return (
    <div className="rl">
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
