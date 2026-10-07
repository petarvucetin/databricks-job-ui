import { useEffect, useMemo, useRef, useState } from 'react';
import type { Item } from '../../../shared/domain/types';
import { scopeCounts, tagCounts, triggerCounts, typeCounts, type ItemFilters } from '../model/items';
import './filterbar.css';

/** The Jobs & ETL filter bar: search, type, trigger (Scheduled = has fixed start times), scope, Tags menu and Sort. Counts are over all items. */
export function ItemsFilterBar({ items, filters, onChange }: { items: Item[]; filters: ItemFilters; onChange: (f: ItemFilters) => void }) {
  const tc = useMemo(() => typeCounts(items), [items]);
  const trc = useMemo(() => triggerCounts(items), [items]);
  const sc = useMemo(() => scopeCounts(items), [items]);
  const tags = useMemo(() => tagCounts(items), [items]);
  const set = (p: Partial<ItemFilters>) => onChange({ ...filters, ...p });
  const types: [ItemFilters['type'], string, number][] = [['all', 'All', tc.all], ['job', 'Jobs', tc.job], ['pipeline', 'Pipelines', tc.pipeline]];
  const triggers: [ItemFilters['trigger'], string, number][] = [['any', 'Any trigger', trc.any], ['sched', 'Scheduled', trc.sched], ['unsched', 'Unscheduled', trc.unsched]];
  const scopes: [ItemFilters['scope'], string, number][] = [['mine', 'Mine', sc.mine], ['deployed', 'Deployed', sc.deployed], ['all', 'All', sc.all]];
  return (
    <div className="fbar">
      <label className="search">⌕ <input value={filters.query} onChange={(e) => set({ query: e.target.value })} placeholder="Name tokens or job / pipeline ID — e.g. coretables mfg" /></label>
      <div className="vr" />
      <div className="seg" role="group" aria-label="type">
        {types.map(([k, l, n]) => (
          <button key={k} type="button" className={filters.type === k ? 'on' : ''} onClick={() => set({ type: k })}>{l}<i>{n}</i></button>
        ))}
      </div>
      <div className="seg" role="group" aria-label="trigger">
        {triggers.map(([k, l, n]) => (
          <button key={k} type="button" className={filters.trigger === k ? 'on' : ''} onClick={() => set({ trigger: k })}>{l}<i>{n}</i></button>
        ))}
      </div>
      <div className="vr" />
      <div className="seg" role="group" aria-label="scope">
        {scopes.map(([k, l, n]) => (
          <button key={k} type="button" className={filters.scope === k ? 'on' : ''} onClick={() => set({ scope: k })}>{l}<i>{n}</i></button>
        ))}
      </div>
      <TagMenu options={tags} selected={filters.tags} onToggle={(v) => set({ tags: filters.tags.includes(v) ? filters.tags.filter((t) => t !== v) : [...filters.tags, v] })} />
      <label className="sortsel">Sort
        <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as ItemFilters['sort'] })}>
          <option value="name">Name</option>
          <option value="last">Last run</option>
          <option value="failed">Recently failed</option>
          <option value="next">Next start</option>
        </select>
      </label>
    </div>
  );
}

function TagMenu({ options, selected, onToggle }: { options: { value: string; count: number }[]; selected: string[]; onToggle: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [open]);
  return (
    <div className="fm" ref={ref}>
      <button type="button" className={`fm-btn${selected.length ? ' on' : ''}`} onClick={() => setOpen((o) => !o)}>
        {selected.length ? `Tags · ${selected.join(', ')}` : 'Tags'} <span className="chev">▾</span>
      </button>
      {open && (
        <div className="fm-menu">
          {options.map(({ value, count }) => {
            const i = value.indexOf(':');
            return (
              <label key={value}>
                <input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} />
                <span className="k"><b>{value.slice(0, i)}:</b>{value.slice(i + 1)}</span>
                <span className="n">{count}</span>
              </label>
            );
          })}
          {!options.length && <label className="fm-none">No tags</label>}
        </div>
      )}
    </div>
  );
}
