import { RUN_KINDS, type Run, type RunKind } from '../../../shared/domain/types';
import { KIND_TITLES, tileSubtitle } from '../model/filters';
import type { Action } from '../model/viewState';
import './tiles.css';

const TONE: Record<RunKind, string> = { failed: 'red', retrying: 'amber', slow: 'amber', running: 'blue', queued: '', snoozed: '', succeeded: 'green' };

export function StatusTiles({ tiles, statuses, asOf, dispatch }: {
  tiles: Record<RunKind, Run[]>;
  statuses: RunKind[];
  asOf: number;
  dispatch: (a: Action) => void;
}) {
  return (
    <div className="tiles">
      {RUN_KINDS.map((k) => {
        const on = statuses.includes(k);
        const dim = statuses.length > 0 && !on;
        return (
          <button key={k} type="button" className={`tile ${TONE[k]}${on ? ' on' : ''}${dim ? ' dim' : ''}`} aria-pressed={on} onClick={() => dispatch({ type: 'toggleStatus', kind: k })}>
            <b>{tiles[k].length}</b>
            <span>{KIND_TITLES[k]}</span>
            <span className="sub">{tileSubtitle(k, tiles[k], asOf)}</span>
          </button>
        );
      })}
    </div>
  );
}
