import type { Run, RunKind } from '../../../shared/domain/types';
import { KIND_TITLES, tileSubtitle } from '../model/filters';
import type { Action } from '../model/viewState';
import './tiles.css';

const TONE: Record<RunKind, string> = { failed: 'red', retrying: 'amber', slow: 'amber', running: 'blue', queued: '', snoozed: '', succeeded: 'green' };

/** Tiles grouped by where the run is: still going, waiting to start, or finished. */
const GROUPS: { title: string; kinds: RunKind[] }[] = [
  { title: 'Running now', kinds: ['running', 'slow', 'retrying'] },
  { title: 'Waiting', kinds: ['queued'] },
  { title: 'Finished', kinds: ['failed', 'succeeded', 'snoozed'] },
];

export function StatusTiles({ tiles, statuses, asOf, dispatch }: {
  tiles: Record<RunKind, Run[]>;
  statuses: RunKind[];
  asOf: number;
  dispatch: (a: Action) => void;
}) {
  return (
    <div className="tiles">
      {GROUPS.map((g) => (
        <section key={g.title} className="tile-grp" style={{ flexGrow: g.kinds.length, gridTemplateColumns: `repeat(${g.kinds.length}, 1fr)` }} aria-label={g.title}>
          <span className="tile-grp-t">{g.title}</span>
          {g.kinds.map((k) => {
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
        </section>
      ))}
    </div>
  );
}
