import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { RunsResponse } from '../../../shared/domain/types';
import { latestPerJob, liveCount, matchesQuery, menuCounts, passes, passesExceptStatusAndRuntime, scopeCounts, sortRuns, tileCounts, type RowSort } from '../model/filters';
import { timelineEnd } from '../model/timeline';
import { historyByJob } from '../model/history';
import { applyAction, initialState, type Action, type MenuKey, type ViewCtx } from '../model/viewState';
import { useNow } from '../hooks/useNow';
import { useCompactRows, useReferenceLabels, useTimelineCollapsed } from '../hooks/useKeyToggle';
import { FilterBar } from '../components/FilterBar';
import { Timeline } from '../components/Timeline';
import { StatusTiles } from '../components/StatusTiles';
import { RuntimeTile } from '../components/RuntimeTile';
import { RunList } from '../components/RunList';
import { RunDrawer } from '../components/RunDrawer';
import { CompareDrawer } from '../components/CompareView';
import type { OpenHow } from '../components/RunRow';
import { addToStack, idsFromSearch, stackRuns } from '../model/compare';
import { ReferenceBlock } from '../components/ReferenceBlock';
import type { RunRefresh } from '../hooks/useRunRefresh';
import './attention.css';

const CODE_OPTIONS = ['CLIENT_ERROR', 'CLOUD_FAILURE', 'TIMEDOUT', 'MAX_CONCURRENT_RUNS_REACHED', 'none'];

/** `runRefresh` refreshes single runs (the drawer's ↻); `data` should already carry its refreshed runs (useRunRefresh). */
export function AttentionView({ data, loadedAt, refresh, runRefresh, initialQuery, initialRunId }: { data: RunsResponse; loadedAt: number; refresh?: ReactNode; runRefresh?: Pick<RunRefresh, 'refreshRun' | 'status'>; initialQuery?: string; initialRunId?: number }) {
  const ctx: ViewCtx = useMemo(() => ({ runs: data.runs, end: timelineEnd(data.asOf) }), [data]);
  const [state, setState] = useState(() => {
    const s = initialState(ctx);
    // Opened from the Jobs & ETL tab on a job: widen the window to everything loaded, then search for the job.
    return initialQuery ? applyAction(applyAction(s, { type: 'preset', preset: 'all' }, ctx), { type: 'query', query: initialQuery }, ctx) : s;
  });
  const dispatch = useCallback((a: Action) => setState((s) => applyAction(s, a, ctx)), [ctx]);
  // Auto refresh moved "now": keep a window that was showing the present current (viewState followNow).
  const prevAsOf = useRef(data.asOf);
  useEffect(() => {
    if (data.asOf !== prevAsOf.current) dispatch({ type: 'follow', prevAsOf: prevAsOf.current, asOf: data.asOf });
    prevAsOf.current = data.asOf;
  }, [data.asOf, dispatch]);
  const [selected, setSelected] = useState<number | null>(null);
  const byId = useMemo(() => new Map(data.runs.map((r) => [r.id, r])), [data.runs]);
  // Runs open here: one shows the run drawer, two or more the comparison. Ctrl+click adds, a plain click starts over.
  const [stack, setStack] = useState<number[]>(() => (initialRunId !== undefined ? [initialRunId] : []));
  const compareTab = useRef<Window | null>(null);
  const onOpenRun = useCallback((runId: number, rowId: number, how: OpenHow) => {
    if (how === 'tab') {
      // The comparison tab keeps its runs in its URL; read it back so its own × removals stick.
      const w = compareTab.current;
      let current: number[] = [];
      try {
        if (w && !w.closed) current = idsFromSearch(w.location.search);
      } catch {
        current = [];
      }
      const next = addToStack(current, runId, byId);
      compareTab.current = window.open(`/?compare=${next.join(',')}`, 'jobs-console-compare');
      return;
    }
    setSelected(rowId);
    setStack((s) => (how === 'stack' ? addToStack(s, runId, byId) : [runId]));
  }, [byId]);
  const closeDrawer = useCallback(() => setStack([]), []);
  const removeRun = useCallback((id: number) => setStack((s) => s.filter((x) => x !== id)), []);
  const toggleRun = useCallback((id: number) => setStack((s) => (s.includes(id) ? s.filter((x) => x !== id) : addToStack(s, id, byId))), [byId]);
  const open = stackRuns(stack, byId);
  const openIds = open.map((r) => r.id);
  const drawerRun = open.length === 1 ? open[0] : undefined;
  const drawerId = drawerRun?.id;
  const refreshRun = runRefresh?.refreshRun;
  const onRefreshDrawer = () => (refreshRun && drawerId !== undefined ? refreshRun(drawerId) : Promise.resolve());
  const drawerRefresh = runRefresh && drawerId !== undefined ? { onRefresh: onRefreshDrawer, ...runRefresh.status(drawerId) } : undefined;
  const nowMs = useNow(1000);
  const labels = useReferenceLabels();
  const timelineCollapsed = useTimelineCollapsed();
  const compactRows = useCompactRows();
  const f = state.filters;

  const [sort, setSortState] = useState<RowSort>(() => {
    const saved = localStorage.getItem('jobs-console:sort');
    return saved === 'name-asc' || saved === 'name-desc' || saved === 'runtime' ? saved : 'status';
  });
  const setSort = useCallback((s: RowSort) => {
    localStorage.setItem('jobs-console:sort', s);
    setSortState(s);
  }, []);
  const rows = useMemo(() => sortRuns(latestPerJob(data.runs.filter((r) => passes(r, f))), sort), [data.runs, f, sort]);
  const tiles = useMemo(() => tileCounts(data.runs, f), [data.runs, f]);
  const runtimeRuns = useMemo(() => data.runs.filter((r) => passesExceptStatusAndRuntime(r, f) && matchesQuery(r, f.query)), [data.runs, f]);
  const history = useMemo(() => historyByJob(data.runs, f.window), [data.runs, f.window]);
  const jobName = open[0]?.name;
  // The job's runs the comparison can pick from: finished ones in the window, plus any still going.
  const pool = jobName === undefined ? [] : [...(history.get(jobName) ?? []), ...data.runs.filter((r) => r.live && r.name === jobName)].sort((a, b) => a.startTime - b.startTime);
  const menus = useMemo(() => {
    const t = menuCounts(data.runs, 'types');
    const ra = menuCounts(data.runs, 'runAs');
    const co = menuCounts(data.runs, 'codes');
    const out: Record<MenuKey, { value: string; label: string; count: number }[]> = {
      types: [{ value: 'job', label: 'Job', count: t.job ?? 0 }, { value: 'pipeline', label: 'Pipeline', count: t.pipeline ?? 0 }],
      runAs: Object.keys(ra).sort().map((v) => ({ value: v, label: v, count: ra[v] ?? 0 })),
      codes: CODE_OPTIONS.map((v) => ({ value: v, label: v === 'none' ? 'no error code' : v, count: co[v] ?? 0 })),
    };
    return out;
  }, [data.runs]);
  const scope = useMemo(() => scopeCounts(data.runs, ctx.end), [data.runs, ctx.end]);
  const ago = Math.max(0, Math.round((nowMs - loadedAt) / 1000));

  return (
    <div className="att">
      <FilterBar
        filters={f}
        scopeCounts={scope}
        menus={menus}
        liveCount={liveCount(data.runs, f.scope)}
        updatedText={ago < 60 ? `updated ${ago}s ago` : `updated ${Math.floor(ago / 60)}m ago`}
        refresh={refresh}
        dispatch={dispatch}
      />
      <Timeline runs={data.runs} end={ctx.end} scale={state.scale} window={f.window} cube={state.cube} collapsed={timelineCollapsed} dispatch={dispatch} />
      <StatusTiles tiles={tiles} statuses={f.statuses} asOf={data.asOf} dispatch={dispatch}>
        <RuntimeTile runs={runtimeRuns} range={f.runtime} bar={f.runtimeBar} dispatch={dispatch} />
      </StatusTiles>
      {labels && rows.length > 0 && <ReferenceBlock rows={rows} history={history} nowMs={nowMs} loadedAt={loadedAt} asOf={data.asOf} openRuns={openIds} onOpenRun={onOpenRun} />}
      <RunList rows={rows} history={history} cap={state.cap} nowMs={nowMs} loadedAt={loadedAt} asOf={data.asOf} selected={selected} onSelect={setSelected} openRuns={openIds} onOpenRun={onOpenRun} dispatch={dispatch} compact={compactRows} sort={sort} onSort={setSort} />
      {drawerRun && <RunDrawer key={drawerRun.id} run={drawerRun} history={history.get(drawerRun.name)} nowMs={nowMs} loadedAt={loadedAt} onClose={closeDrawer} refresh={drawerRefresh} />}
      {open.length > 1 && <CompareDrawer runs={open} nowMs={nowMs} loadedAt={loadedAt} pool={pool} onToggle={toggleRun} addHint="click to add or remove; Ctrl+click in the list works too" onRemove={removeRun} onClose={closeDrawer} />}
    </div>
  );
}
