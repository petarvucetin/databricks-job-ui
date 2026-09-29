import { useCallback, useEffect, useRef, useState } from 'react';
import type { RunsResponse } from '../../../shared/domain/types';

export type RunsState =
  | { state: 'loading' }
  | { state: 'error'; message: string; retry: () => void }
  | {
      state: 'ready';
      data: RunsResponse;
      loadedAt: number;
      /** When the fetch that brought `data` started (a single run fetched after this is newer than the list). */
      startedAt: number;
      /** A background refresh is in flight; the current data stays on screen. */
      refreshing: boolean;
      /** Why the last background refresh failed (the data shown is from loadedAt); null when it worked. */
      refreshError: string | null;
      refresh: () => void;
    };

async function fetchRuns(): Promise<RunsResponse> {
  const res = await fetch(`/api/runs?tzOffset=${new Date().getTimezoneOffset()}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    // The server answers errors as { error }: show its message (e.g. the Databricks error), not just the status.
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' ? `HTTP ${res.status}: ${body.error}` : `HTTP ${res.status}`);
  }
  return (await res.json()) as RunsResponse;
}

const describe = (err: unknown): string =>
  err instanceof DOMException && err.name === 'TimeoutError'
    ? 'Could not load runs: request timed out'
    : `Could not load runs: ${err instanceof Error ? err.message : String(err)}`;

/**
 * Runs from /api/runs. With `intervalMs` > 0 the data refreshes in the background on that interval, keeping what is
 * on screen (filters, drawer, scroll) and the last good data if a refresh fails. Paused while the tab is hidden;
 * a refresh that came due meanwhile runs as soon as the tab is visible again.
 */
export function useRuns(intervalMs = 0): RunsState {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<{ attempt: number; message: string } | null>(null);
  const [latest, setLatest] = useState<{ data: RunsResponse; loadedAt: number; startedAt: number } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  // When the last fetch (good or failed) started: the interval counts from here, so a failing refresh waits a full interval.
  const lastTry = useRef(0);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // First load (and Retry after a failed first load).
  useEffect(() => {
    let current = true;
    const startedAt = Date.now();
    lastTry.current = startedAt;
    fetchRuns()
      .then((data) => {
        if (current) setLatest({ data, loadedAt: Date.now(), startedAt });
      })
      .catch((err: unknown) => {
        if (current) setFailed({ attempt, message: describe(err) });
      });
    return () => {
      current = false;
    };
  }, [attempt, retry]);

  const refresh = useCallback(() => {
    if (inFlight.current) return;
    inFlight.current = true;
    const startedAt = Date.now();
    lastTry.current = startedAt;
    setRefreshing(true);
    fetchRuns()
      .then((data) => {
        if (!alive.current) return;
        setLatest({ data, loadedAt: Date.now(), startedAt });
        setRefreshError(null);
      })
      .catch((err: unknown) => {
        if (alive.current) setRefreshError(describe(err));
      })
      .finally(() => {
        inFlight.current = false;
        if (alive.current) setRefreshing(false);
      });
  }, []);

  // Background refresh: a timer checked every few seconds, so a hidden tab catches up on return.
  const ready = latest !== null;
  useEffect(() => {
    if (!intervalMs || !ready) return;
    const tick = () => {
      if (document.visibilityState === 'hidden') return;
      if (Date.now() - lastTry.current >= intervalMs) refresh();
    };
    const timer = setInterval(tick, Math.min(5000, intervalMs));
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [intervalMs, ready, refresh]);

  if (latest) return { state: 'ready', data: latest.data, loadedAt: latest.loadedAt, startedAt: latest.startedAt, refreshing, refreshError, refresh };
  return failed && failed.attempt === attempt ? { state: 'error', message: failed.message, retry } : { state: 'loading' };
}
