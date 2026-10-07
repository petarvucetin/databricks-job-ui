import { memo, type ReactNode } from 'react';
import type { Item, Run } from '../../../shared/domain/types';
import { dur } from '../../../shared/domain/format';
import type { ItemsState } from '../hooks/useItems';
import { itemKey, lastRun, pillOf, startsOf, type ItemFilters } from '../model/items';
import { splitName } from '../model/rowView';
import { fmtN } from '../model/load';
import { when, type SchedScale } from '../model/schedule';

export type ItemsView = 'list' | 'load';
type Range = { from: number; to: number; type?: 'job' | 'pipeline' };

const CAP = 300;
const ago = (ms: number) => {
  const m = Math.max(0, Math.round(ms / 60e3));
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

/** The list header's List · Load switch. */
export function ViewSwitch({ view, onView }: { view: ItemsView; onView: (v: ItemsView) => void }) {
  return (
    <span className="vsw">
      {(['list', 'load'] as const).map((v) => (
        <button key={v} type="button" className={view === v ? 'on' : ''} onClick={() => onView(v)}>{v === 'list' ? 'List' : 'Load'}</button>
      ))}
    </span>
  );
}

function LastCell({ run, now }: { run: Run | undefined; now: number }) {
  if (!run) return <span className="last"><span className="mk none">—</span>no runs in window</span>;
  if (run.live) {
    const sec = Math.max(run.durationSec, (now - run.startTime) / 1e3);
    return <span className="last"><span className="mk running" />{run.kind === 'queued' ? 'queued' : `running ${dur(sec)}`}</span>;
  }
  const res = run.result ?? 'succeeded';
  const sym = { succeeded: '✓', failed: '✕', cancelled: '–', partial: '!' }[res];
  return <span className="last" title={res === 'partial' ? 'succeeded with failures' : res}><span className={`mk ${res}`}>{sym}</span>{ago(now - run.startTime)}</span>;
}

function StartsCell({ item, range, scale }: { item: Item; range: Range; scale: SchedScale }) {
  const f = startsOf(item, range.from, range.to);
  return (
    <span className="starts" title={f.map((t) => when(t, scale)).join(', ')}>
      ⏱ <b>{f.slice(0, 3).map((t) => when(t, scale)).join(' · ')}</b>{f.length > 3 ? ` +${f.length - 3}` : ''}
    </span>
  );
}

/**
 * One line per job or pipeline: type tag, name, trigger pill, and a right-hand cell (last run, or starts). Memoized: up to
 * 300 rows sit under views that re-render often (the Load chart's hover).
 */
export const ItemRow = memo(function ItemRow({ item, now, selected, onSelect, right }: { item: Item; now: number; selected: string | null; onSelect: (key: string | null) => void; right: ReactNode }) {
  const { prefix, rest: bare } = splitName(item.name);
  const pill = pillOf(item, now);
  const key = itemKey(item);
  return (
    <div className={`ir${selected === key ? ' on' : ''}`} data-id={item.id} title={item.name} onClick={() => onSelect(selected === key ? null : key)}>
      <span className={`tag ${item.type}`}>{item.type === 'job' ? 'Job' : 'Pipeline'}</span>
      <span className="nm"><span><i>{prefix}</i>{bare}</span></span>
      <span className={`trg ${pill.cls}`} title={pill.title}>{pill.cls === 'sched' ? '⏱ ' : ''}{pill.text}</span>
      {right}
    </div>
  );
});

/** The Jobs & ETL list: one line per job or pipeline, at most 300 rows. */
export function ItemList({ load, rows, total, range, scale, runs, now, selected, onSelect, view, onView, filters, onClearFilters }: {
  load: ItemsState;
  rows: Item[];
  total: number;
  range: Range | null;
  scale: SchedScale;
  runs: Run[];
  now: number;
  selected: string | null;
  onSelect: (key: string | null) => void;
  view: ItemsView;
  onView: (v: ItemsView) => void;
  filters: ItemFilters;
  onClearFilters: () => void;
}) {
  if (load.state === 'loading') {
    return (
      <div className="list">
        <div className="list-meta">Loading jobs and pipelines…</div>
        {Array.from({ length: 12 }, (_, i) => <div key={i} className="skel" />)}
      </div>
    );
  }
  if (load.state === 'error') {
    return (
      <div className="list">
        <div className="state">
          <p>Can&apos;t load jobs and pipelines.</p>
          <p className="sub">{load.message}</p>
          <button type="button" onClick={load.retry}>Try again</button>
        </div>
      </div>
    );
  }
  const partial = load.data.partial ? <div className="partial">Partial list: {load.data.partial.reason}.</div> : null;
  if (!rows.length) {
    const words = [
      filters.query ? `“${filters.query}”` : null,
      filters.type === 'all' ? 'all types' : `${filters.type}s`,
      filters.scope,
      ...filters.tags,
      range ? `scheduled to start ${when(range.from, scale)}–${when(range.to, scale)}` : null,
    ].filter(Boolean);
    return (
      <div className="list">
        {partial}
        <div className="state">
          <p>No job or pipeline matches.</p>
          <p className="sub">{words.join(' · ')}</p>
          <button type="button" onClick={onClearFilters}>Clear filters</button>
        </div>
      </div>
    );
  }
  return (
    <div className="list">
      <div className="list-meta">
        <span>
          {rows.length} of {total} · {range ? `scheduled to start ${when(range.from, scale)}–${when(range.to, scale)}${range.type ? ` (${range.type}s)` : ''}` : 'last-run marks use the loaded runs window'}
        </span>
        <ViewSwitch view={view} onView={onView} />
      </div>
      {partial}
      {rows.slice(0, CAP).map((it) => (
        <ItemRow
          key={itemKey(it)}
          item={it}
          now={now}
          selected={selected}
          onSelect={onSelect}
          right={range ? <StartsCell item={it} range={range} scale={scale} /> : <LastCell run={lastRun(it, runs)} now={now} />}
        />
      ))}
      {rows.length > CAP && <div className="list-note">+{fmtN(rows.length - CAP)} more — narrow with search, type, scope, tags or the schedule window</div>}
    </div>
  );
}
