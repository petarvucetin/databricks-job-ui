import type { Filters } from '../model/filters';
import type { Action, MenuKey } from '../model/viewState';
import { FilterMenu } from './FilterMenu';
import './filterbar.css';

type Option = { value: string; label: string; count: number };
const MENU_LABELS: Record<MenuKey, string> = { types: 'Type', runAs: 'Run as', codes: 'Error code' };

export function FilterBar({ filters, scopeCounts, menus, liveCount, updatedText, dispatch }: {
  filters: Filters;
  scopeCounts: { mine: number; all: number };
  menus: Record<MenuKey, Option[]>;
  liveCount: number;
  updatedText: string;
  dispatch: (a: Action) => void;
}) {
  return (
    <div className="fbar">
      <span className="fbar-t">Showing</span>
      <span className="seg">
        <button type="button" className={filters.scope === 'mine' ? 'on' : ''} onClick={() => dispatch({ type: 'scope', scope: 'mine' })}>
          Mine<i>{scopeCounts.mine}</i>
        </button>
        <button type="button" className={filters.scope === 'all' ? 'on' : ''} onClick={() => dispatch({ type: 'scope', scope: 'all' })}>
          All I can see<i>{scopeCounts.all}</i>
        </button>
      </span>
      <span className="vr" />
      {(Object.keys(MENU_LABELS) as MenuKey[]).map((key) => (
        <FilterMenu
          key={key}
          label={MENU_LABELS[key]}
          options={menus[key]}
          selected={filters[key]}
          onToggle={(value) => dispatch({ type: 'toggleMenu', key, value })}
          onClear={() => dispatch({ type: 'clearMenu', key })}
        />
      ))}
      <button type="button" className={`tgl${filters.live ? ' on' : ''}`} aria-pressed={filters.live} onClick={() => dispatch({ type: 'toggleLive' })}>
        <i />Running now<em>{liveCount}</em>
      </button>
      <span className="search">
        <span aria-hidden="true">⌕</span>
        <input value={filters.query} placeholder="search job, task, run id, cause, error" onChange={(e) => dispatch({ type: 'query', query: e.target.value })} />
      </span>
      <button type="button" className="clear" onClick={() => dispatch({ type: 'clear' })}>clear filters</button>
      <span className="meta">{updatedText}</span>
    </div>
  );
}
