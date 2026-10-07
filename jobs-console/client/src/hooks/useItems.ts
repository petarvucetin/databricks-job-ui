import { useCallback, useEffect, useRef, useState } from 'react';
import type { ItemsResponse } from '../../../shared/domain/types';

export type ItemsState =
  | { state: 'loading' }
  | { state: 'error'; message: string; retry: () => void }
  /** `loadedAt`: wall time the data arrived, so the page's "now" can run on from the data's `asOf`. */
  | { state: 'ready'; data: ItemsResponse; loadedAt: number };

async function fetchItems(): Promise<ItemsResponse> {
  const res = await fetch('/api/items', { signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    // The server answers errors as { error }: show its message (e.g. the missing scope), not just the status.
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' ? `HTTP ${res.status}: ${body.error}` : `HTTP ${res.status}`);
  }
  return (await res.json()) as ItemsResponse;
}

const describe = (err: unknown): string =>
  err instanceof DOMException && err.name === 'TimeoutError'
    ? 'Could not load jobs and pipelines: request timed out'
    : `Could not load jobs and pipelines: ${err instanceof Error ? err.message : String(err)}`;

/**
 * Jobs and pipelines from /api/items, on mount and again whenever `refreshKey` changes after that (the page passes the
 * runs' `loadedAt`, so the list refreshes with every runs load: the runs interval and the manual ↻ alike; with the
 * interval off only ↻ refreshes). A failed background refresh keeps the last good data on screen.
 */
export function useItems(refreshKey = 0): ItemsState {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<{ attempt: number; message: string } | null>(null);
  const [latest, setLatest] = useState<{ data: ItemsResponse; loadedAt: number } | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const lastKey = useRef(refreshKey);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let current = true;
    fetchItems()
      .then((data) => {
        if (current) setLatest({ data, loadedAt: Date.now() });
      })
      .catch((err: unknown) => {
        if (current) setFailed({ attempt, message: describe(err) });
      });
    return () => {
      current = false;
    };
  }, [attempt]);

  const ready = latest !== null;
  useEffect(() => {
    const prev = lastKey.current;
    lastKey.current = refreshKey;
    // Not on the runs' first load (the list is loading alongside it), only on later ones, and once the list is here.
    if (!prev || prev === refreshKey || !ready || inFlight.current) return;
    inFlight.current = true;
    fetchItems()
      .then((data) => {
        if (alive.current) setLatest({ data, loadedAt: Date.now() });
      })
      .catch(() => {
        // keep the last good list
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [refreshKey, ready]);

  if (latest) return { state: 'ready', data: latest.data, loadedAt: latest.loadedAt };
  return failed && failed.attempt === attempt ? { state: 'error', message: failed.message, retry } : { state: 'loading' };
}
