import type { Run } from '../../../shared/domain/types';
import type { Action } from '../model/viewState';
import { PAGE } from '../model/viewState';
import { RunRow } from './RunRow';

export function RunList({ rows, cap, nowMs, loadedAt, asOf, selected, onSelect, dispatch }: {
  rows: Run[];
  cap: number;
  nowMs: number;
  loadedAt: number;
  asOf: number;
  selected: number | null;
  onSelect: (id: number) => void;
  dispatch: (a: Action) => void;
}) {
  if (!rows.length) return <div className="rl"><p className="rl-empty">Nothing matches these filters.</p></div>;
  return (
    <div className="rl">
      {rows.slice(0, cap).map((r) => (
        <RunRow key={r.id} run={r} nowMs={nowMs} loadedAt={loadedAt} asOf={asOf} selected={selected === r.id} onSelect={onSelect} />
      ))}
      {rows.length > cap && (
        <button type="button" className="rl-more" onClick={() => dispatch({ type: 'more' })}>
          {rows.length - cap} more, show next {PAGE}
        </button>
      )}
    </div>
  );
}
