import { useEffect, useMemo, useState } from 'react';
import type { Item, Run } from '../../../shared/domain/types';
import type { RunsData } from '../hooks/useRunsData';
import { useItems } from '../hooks/useItems';
import { useNow } from '../hooks/useNow';
import { DEFAULT_FILTERS, filterItems, itemKey, linkStarters, sortItems, type ItemFilters } from '../model/items';
import { schedBuckets, schedRange, type SchedState } from '../model/schedule';
import { ItemsFilterBar } from '../components/ItemsFilterBar';
import { ScheduleTimeline } from '../components/ScheduleTimeline';
import { ItemList, type ItemsView } from '../components/ItemList';
import { LoadView } from '../components/LoadView';
import { ItemPane } from '../components/ItemPane';
import './jobs.css';

const NO_ITEMS: Item[] = [];
const NO_RUNS: Run[] = [];

/**
 * The Jobs & ETL tab: filter bar, schedule timeline, and the list (or Load view) with the detail pane.
 * `active`: the tab is showing; document-level keys are only handled then: Esc closes the pane, and (not while typing)
 * T collapses or expands the timeline, L shows the list, D shows Load.
 */
export function JobsPage({ data, active, onSeeRuns, onOpenRun }: { data: RunsData; active: boolean; onSeeRuns: (name: string) => void; onOpenRun: (runId: number) => void }) {
  // The list refreshes with every runs load (the interval and the manual ↻).
  const load = useItems(data.runs.state === 'ready' ? data.runs.loadedAt : 0);
  const [filters, setFilters] = useState<ItemFilters>(DEFAULT_FILTERS);
  const [sched, setSched] = useState<SchedState>({ scale: 'hour', win: null, cube: null });
  const [view, setView] = useState<ItemsView>('list');
  const [tlCollapsed, setTlCollapsed] = useState(false);
  // "type:id" of the selected item; nothing is selected on load (J4).
  const [selected, setSelected] = useState<string | null>(null);

  // "now" runs on from the data's asOf by the wall time since it loaded, so replay data with a frozen asOf stays consistent.
  const tick = useNow(60_000);
  const ready = load.state === 'ready' ? load : null;
  const now = ready ? ready.data.asOf + Math.max(0, tick - ready.loadedAt) : tick;
  const items = ready?.data.items ?? NO_ITEMS;
  const runs = data.runs.state === 'ready' ? data.runs.data.runs : NO_RUNS;
  // Credit pipelines to the jobs that start them, from the full list (once per list; the model reads it from then on).
  linkStarters(items);

  // The timeline buckets only move when the local hour changes: key them on it so a minute tick doesn't recount.
  const hour = new Date(now).setMinutes(0, 0, 0);
  const bks = useMemo(() => schedBuckets(sched.scale, hour), [sched.scale, hour]);
  const range = useMemo(() => schedRange(sched, bks), [sched, bks]);
  // The other filters apply to the timeline counts; the schedule window applies to the rows only. Keyed on the hour,
  // not the minute, so the timeline doesn't recount every item on each tick (only the search's pill text uses it).
  const pool = useMemo(() => filterItems(items, filters, null, hour), [items, filters, hour]);
  const rows = useMemo(() => {
    const kept = range ? filterItems(pool, DEFAULT_FILTERS, range, now) : pool;
    return sortItems(kept, filters.sort, runs, range ? range.from : now);
  }, [pool, range, filters.sort, runs, now]);

  // The selected item, if it is still shown (the Load view lists from the pool: runs started before the window count).
  const shown = view === 'load' ? pool : rows;
  const selItem = useMemo(() => (selected ? shown.find((it) => itemKey(it) === selected) : undefined), [shown, selected]);
  // Filters or a refresh took the selected item away: close the pane rather than leave it open empty (adjusted while
  // rendering, so the pane never paints empty in between).
  if (selected && !selItem) setSelected(null);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
      const el = e.target as HTMLElement | null;
      // isContentEditable, or an editable ancestor where the DOM doesn't compute it (jsdom).
      const editable = !!el && (el.isContentEditable || !!el.closest?.('[contenteditable]:not([contenteditable="false"])'));
      const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(el?.tagName ?? '') || editable || e.ctrlKey || e.metaKey || e.altKey;
      if (typing) return;
      const k = e.key.toLowerCase();
      if (k === 't') setTlCollapsed((c) => !c);
      else if (k === 'l') setView('list');
      else if (k === 'd') setView('load');
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [active]);

  const clearFilters = () => {
    setFilters({ ...DEFAULT_FILTERS, sort: filters.sort });
    setSched({ ...sched, win: null, cube: null });
  };

  return (
    <div className="jobs">
      <ItemsFilterBar items={items} filters={filters} onChange={setFilters} />
      {ready && <ScheduleTimeline items={pool} bks={bks} state={sched} collapsed={tlCollapsed} onChange={setSched} />}
      <div className={`split${selItem ? ' sel' : ''}`}>
        {view === 'load' && ready && rows.length ? (
          <LoadView
            key={range ? `${range.from}:${range.to}` : `${bks[0].start}:${bks[bks.length - 1].end}`}
            items={pool}
            runs={runs}
            from={range ? range.from : bks[0].start}
            to={range ? range.to : bks[bks.length - 1].end}
            now={now}
            scale={sched.scale}
            selected={selected}
            onSelect={setSelected}
            view={view}
            onView={setView}
            partial={ready.data.partial?.reason}
          />
        ) : <ItemList
          load={load}
          rows={rows}
          total={items.length}
          range={range}
          scale={sched.scale}
          runs={runs}
          now={now}
          selected={selected}
          onSelect={setSelected}
          view={view}
          onView={setView}
          filters={filters}
          onClearFilters={clearFilters}
        />}
        <aside className="pane">
          {selItem && <ItemPane item={selItem} runs={runs} now={now} onClose={() => setSelected(null)} onSeeRuns={onSeeRuns} onOpenRun={onOpenRun} />}
        </aside>
      </div>
    </div>
  );
}
