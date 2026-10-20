import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRuns } from '../hooks/useRuns';
import { useNow } from '../hooks/useNow';
import { addToStack, idsFromSearch, stackRuns } from '../model/compare';
import { CompareView } from '../components/CompareView';
import type { RunsResponse } from '../../../shared/domain/types';
import { pageQuery, pageTitle } from '../lib/env';

/** The comparison tab (Ctrl+Shift+click): runs come from ?compare=ids; the opener adds to it by reading this URL. `env` names it in the tab title. */
export function ComparePage({ env }: { env?: string }) {
  const runs = useRuns();
  if (runs.state === 'loading') return <p className="cmp-status">Loading runs…</p>;
  if (runs.state === 'error') return <p className="cmp-status">{runs.message} <button type="button" onClick={runs.retry}>Retry</button></p>;
  return <CompareTab data={runs.data} loadedAt={runs.loadedAt} env={env} />;
}

function CompareTab({ data, loadedAt, env }: { data: RunsResponse; loadedAt: number; env?: string }) {
  const [ids, setIds] = useState(() => idsFromSearch(window.location.search));
  const nowMs = useNow(1000);
  const byId = useMemo(() => new Map(data.runs.map((r) => [r.id, r])), [data.runs]);
  const runs = stackRuns(ids, byId);
  const update = useCallback((change: (cur: number[]) => number[]) => {
    setIds((cur) => {
      const next = change(cur);
      window.history.replaceState(null, '', pageQuery({ compare: next.join(',') }));
      return next;
    });
  }, []);
  const remove = useCallback((id: number) => update((cur) => cur.filter((x) => x !== id)), [update]);
  const toggle = useCallback((id: number) => update((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : addToStack(cur, id, byId))), [update, byId]);
  const jobName = runs[0]?.name;
  const pool = useMemo(() => data.runs.filter((r) => r.name === jobName && (r.result !== null || r.live)).sort((a, b) => a.startTime - b.startTime), [data.runs, jobName]);
  useEffect(() => {
    document.title = pageTitle(runs.length ? `Compare ${runs.length} runs` : 'Compare runs', env);
  }, [runs.length, env]);
  if (!runs.length) return <p className="cmp-status">No runs to compare. Ctrl+Shift+click run boxes in the main tab to add them here.</p>;
  return (
    <div className="cmp-page">
      <CompareView runs={runs} nowMs={nowMs} loadedAt={loadedAt} pool={pool} onToggle={toggle} addHint="click to add or remove; Ctrl+Shift+click in the main tab works too" onRemove={remove} />
    </div>
  );
}
