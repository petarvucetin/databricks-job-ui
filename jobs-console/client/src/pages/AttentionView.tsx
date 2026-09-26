import { useCallback, useMemo, useState } from 'react';
import type { RunsResponse } from '../../../shared/domain/types';
import { liveCount, menuCounts, passes, scopeCounts, sortRuns, tileCounts } from '../model/filters';
import { timelineEnd } from '../model/timeline';
import { historyByJob } from '../model/history';
import { applyAction, initialState, type Action, type MenuKey, type ViewCtx } from '../model/viewState';
import { useNow } from '../hooks/useNow';
import { useCompactRows, useReferenceLabels, useTimelineCollapsed } from '../hooks/useKeyToggle';
import { FilterBar } from '../components/FilterBar';
import { Timeline } from '../components/Timeline';
import { StatusTiles } from '../components/StatusTiles';
import { RunList } from '../components/RunList';
import { RunDrawer } from '../components/RunDrawer';
import { ReferenceBlock } from '../components/ReferenceBlock';
import './attention.css';

const CODE_OPTIONS = ['CLIENT_ERROR', 'CLOUD_FAILURE', 'TIMEDOUT', 'MAX_CONCURRENT_RUNS_REACHED', 'none'];

export function AttentionView({ data, loadedAt }: { data: RunsResponse; loadedAt: number }) {
  const ctx: ViewCtx = useMemo(() => ({ runs: data.runs, end: timelineEnd(data.asOf) }), [data]);
  const [state, setState] = useState(() => initialState(ctx));
  const dispatch = useCallback((a: Action) => setState((s) => applyAction(s, a, ctx)), [ctx]);
  const [selected, setSelected] = useState<number | null>(null);
  const [openRun, setOpenRun] = useState<number | null>(null);
  const onOpenRun = useCallback((runId: number, rowId: number) => {
    setOpenRun(runId);
    setSelected(rowId);
  }, []);
  const closeDrawer = useCallback(() => setOpenRun(null), []);
  const drawerRun = openRun === null ? undefined : data.runs.find((r) => r.id === openRun);
  const nowMs = useNow(1000);
  const labels = useReferenceLabels();
  const timelineCollapsed = useTimelineCollapsed();
  const compactRows = useCompactRows();
  const f = state.filters;

  const rows = useMemo(() => sortRuns(data.runs.filter((r) => passes(r, f))), [data.runs, f]);
  const tiles = useMemo(() => tileCounts(data.runs, f), [data.runs, f]);
  const history = useMemo(() => historyByJob(data.runs, f.window), [data.runs, f.window]);
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
        dispatch={dispatch}
      />
      <Timeline runs={data.runs} end={ctx.end} scale={state.scale} window={f.window} cube={state.cube} collapsed={timelineCollapsed} dispatch={dispatch} />
      <StatusTiles tiles={tiles} statuses={f.statuses} asOf={data.asOf} dispatch={dispatch} />
      {labels && rows.length > 0 && <ReferenceBlock rows={rows} history={history} nowMs={nowMs} loadedAt={loadedAt} asOf={data.asOf} openRun={drawerRun ? openRun : null} onOpenRun={onOpenRun} />}
      <RunList rows={rows} history={history} cap={state.cap} nowMs={nowMs} loadedAt={loadedAt} asOf={data.asOf} selected={selected} onSelect={setSelected} openRun={drawerRun ? openRun : null} onOpenRun={onOpenRun} dispatch={dispatch} compact={compactRows} />
      {drawerRun && <RunDrawer key={drawerRun.id} run={drawerRun} history={history.get(drawerRun.name)} nowMs={nowMs} loadedAt={loadedAt} onClose={closeDrawer} />}
    </div>
  );
}
