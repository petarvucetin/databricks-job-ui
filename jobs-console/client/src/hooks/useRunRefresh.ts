import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Run, RunsResponse } from '../../../shared/domain/types';
import { apiUrl } from '../lib/env';

/** One run fetched on its own, and when it arrived. */
export interface RunOverride {
  run: Run;
  /** Epoch ms the single-run answer arrived. */
  at: number;
}

/** How one run's own refresh is going, and when the data shown for it was loaded. */
export interface RunRefreshStatus {
  refreshing: boolean;
  /** Why the last refresh of this run failed; null when it worked (or never ran). */
  error: string | null;
  /** When the data shown for this run was loaded: its own refresh, or the list's. */
  updatedAt: number;
}

export interface RunRefresh {
  /** The list with every still-current single-run refresh merged in. */
  data: RunsResponse;
  /** Fetches /api/runs/:id and shows the answer; resolves when it is done (never rejects). */
  refreshRun: (id: number) => Promise<void>;
  status: (id: number) => RunRefreshStatus;
}

/**
 * A run refreshed after the list loaded, rebased to the list's `loadedAt`: every screen ticks live runs on from
 * loadedAt (`elapsedSec`), so the run's elapsed times are moved back by the time between the two loads.
 */
export function rebase(run: Run, at: number, loadedAt: number): Run {
  const back = Math.max(0, Math.floor((at - loadedAt) / 1000));
  if (!run.live || !back) return run;
  return {
    ...run,
    durationSec: Math.max(0, run.durationSec - back),
    tasks: run.tasks?.map((t) => (t.state === 'r' ? { ...t, durSec: Math.max(0, t.durSec - back) } : t)),
  };
}

/**
 * The list with single-run refreshes in place. An override counts until a list fetch that started after it arrived
 * (`startedAt >= at`): that list already has the run at least as fresh.
 */
export function mergeRuns(data: RunsResponse, loadedAt: number, startedAt: number, overrides: ReadonlyMap<number, RunOverride>): RunsResponse {
  let changed = false;
  const runs = data.runs.map((r) => {
    const o = overrides.get(r.id);
    if (!o || startedAt >= o.at) return r;
    changed = true;
    return rebase(o.run, o.at, loadedAt);
  });
  return changed ? { ...data, runs } : data;
}

async function fetchRun(id: number): Promise<Run> {
  const res = await fetch(apiUrl(`/api/runs/${id}?tzOffset=${new Date().getTimezoneOffset()}`), { signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' ? `HTTP ${res.status}: ${body.error}` : `HTTP ${res.status}`);
  }
  return (await res.json()) as Run;
}

const describe = (err: unknown): string =>
  err instanceof DOMException && err.name === 'TimeoutError'
    ? 'Could not refresh the run: request timed out'
    : `Could not refresh the run: ${err instanceof Error ? err.message : String(err)}`;

/**
 * Refreshes single runs (the open drawer's) on request, over the list from useRuns. `list` is undefined until the
 * list has loaded. The merged data is what the page shows, so the drawer, its row and any comparison see the fresh run.
 */
export function useRunRefresh(list: { data: RunsResponse; loadedAt: number; startedAt: number } | undefined): RunRefresh | undefined {
  const [overrides, setOverrides] = useState<ReadonlyMap<number, RunOverride>>(new Map());
  const [pending, setPending] = useState<ReadonlySet<number>>(new Set());
  const [errors, setErrors] = useState<ReadonlyMap<number, string>>(new Map());
  const inFlight = useRef(new Map<number, Promise<void>>());
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const refreshRun = useCallback((id: number): Promise<void> => {
    const running = inFlight.current.get(id);
    if (running) return running;
    setPending((s) => new Set(s).add(id));
    const work = fetchRun(id)
      .then((run) => {
        if (!alive.current) return;
        const at = Date.now();
        setOverrides((m) => new Map(m).set(id, { run, at }));
        setErrors((m) => {
          if (!m.has(id)) return m;
          const next = new Map(m);
          next.delete(id);
          return next;
        });
      })
      .catch((err: unknown) => {
        if (alive.current) setErrors((m) => new Map(m).set(id, describe(err)));
      })
      .finally(() => {
        inFlight.current.delete(id);
        if (!alive.current) return;
        setPending((s) => {
          const next = new Set(s);
          next.delete(id);
          return next;
        });
      });
    inFlight.current.set(id, work);
    return work;
  }, []);

  const data = list?.data;
  const loadedAt = list?.loadedAt ?? 0;
  const startedAt = list?.startedAt ?? 0;
  const merged = useMemo(() => (data ? mergeRuns(data, loadedAt, startedAt, overrides) : undefined), [data, loadedAt, startedAt, overrides]);
  const status = useCallback(
    (id: number): RunRefreshStatus => {
      const o = overrides.get(id);
      return { refreshing: pending.has(id), error: errors.get(id) ?? null, updatedAt: o && startedAt < o.at ? o.at : loadedAt };
    },
    [overrides, pending, errors, startedAt, loadedAt]
  );
  return merged ? { data: merged, refreshRun, status } : undefined;
}
