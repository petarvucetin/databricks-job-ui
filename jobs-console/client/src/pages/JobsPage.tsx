import { useEffect, useMemo, useState } from 'react';
import type { Item, Run } from '../../../shared/domain/types';
import type { RunsData } from '../hooks/useRunsData';
import { useItems } from '../hooks/useItems';
import { useNow } from '../hooks/useNow';
import { DEFAULT_FILTERS, filterItems, sortItems, type ItemFilters } from '../model/items';
import { schedBuckets, schedRange, type SchedState } from '../model/schedule';
import { ItemsFilterBar } from '../components/ItemsFilterBar';
import { ScheduleTimeline } from '../components/ScheduleTimeline';
import { ItemList, type ItemsView } from '../components/ItemList';
import './jobs.css';

const NO_ITEMS: Item[] = [];
const NO_RUNS: Run[] = [];

/**
 * The Jobs & ETL tab: filter bar, schedule timeline, and the list (or Load view) with the detail pane.
 * `active`: the tab is showing; document-level keys (Esc) are only handled then.
 */
export function JobsPage({ data, active }: { data: RunsData; active: boolean; onSeeRuns: (name: string) => void; onOpenRun: (runId: number) => void }) {
  const load = useItems(data.intervalMs);
  const [filters, setFilters] = useState<ItemFilters>(DEFAULT_FILTERS);
  const [sched, setSched] = useState<SchedState>({ scale: 'hour', win: null, cube: null });
  const [view, setView] = useState<ItemsView>('list');
  // "type:id" of the selected item; nothing is selected on load (J4).
  const [selected, setSelected] = useState<string | null>(null);

  // "now" runs on from the data's asOf by the wall time since it loaded, so replay data with a frozen asOf stays consistent.
  const tick = useNow(60_000);
  const ready = load.state === 'ready' ? load : null;
  const now = ready ? ready.data.asOf + Math.max(0, tick - ready.loadedAt) : tick;
  const items = ready?.data.items ?? NO_ITEMS;
  const runs = data.runs.state === 'ready' ? data.runs.data.runs : NO_RUNS;

  // The timeline buckets only move when the local hour changes: key them on it so a minute tick doesn't recount.
  const hour = new Date(now).setMinutes(0, 0, 0);
  const bks = useMemo(() => schedBuckets(sched.scale, hour), [sched.scale, hour]);
  const range = useMemo(() => schedRange(sched, bks), [sched, bks]);
  // The other filters apply to the timeline counts; the schedule window applies to the rows only.
  const pool = useMemo(() => filterItems(items, filters, null, now), [items, filters, now]);
  const rows = useMemo(() => {
    const kept = range ? filterItems(pool, DEFAULT_FILTERS, range, now) : pool;
    return sortItems(kept, filters.sort, runs, range ? range.from : now);
  }, [pool, range, filters.sort, runs, now]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSelected(null);
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
      {ready && <ScheduleTimeline items={pool} bks={bks} state={sched} onChange={setSched} />}
      <div className={`split${selected ? ' sel' : ''}`}>
        <ItemList
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
        />
        <aside className="pane" />
      </div>
    </div>
  );
}
