import { useCallback, useEffect, useRef, useState } from 'react';
import type { Item, ItemsResponse } from '../../../shared/domain/types';

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

type Rows = Map<string, { item: Item; json: string }>;

/**
 * The response to keep: the previous one as-is when `asOf` matches (a server cache hit), else the new one with the previous
 * `Item` object for every row whose JSON is unchanged, so the per-item caches keyed on the object survive the refetch.
 * `rows` is updated in place.
 */
function reuse(prev: ItemsResponse | undefined, next: ItemsResponse, rows: Rows): ItemsResponse {
  if (prev && prev.asOf === next.asOf) return prev;
  const fresh: Rows = new Map();
  const items = next.items.map((it) => {
    const key = `${it.type}:${it.id}`;
    const json = JSON.stringify(it);
    const old = rows.get(key);
    const item = old && old.json === json ? old.item : it;
    fresh.set(key, { item, json });
    return item;
  });
  rows.clear();
  for (const [k, v] of fresh) rows.set(k, v);
  return { ...next, items };
}

const describe = (err: unknown): string =>
  err instanceof DOMException && err.name === 'TimeoutError'
    ? 'Could not load jobs and pipelines: request timed out'
    : `Could not load jobs and pipelines: ${err instanceof Error ? err.message : String(err)}`;

/**
 * Jobs and pipelines from /api/items, on mount and again whenever `refreshKey` changes after that (the page passes the
 * runs' `loadedAt`, so the list refreshes with every runs load: the runs interval and the manual ↻ alike; with the
 * interval off only ↻ refreshes). A failed background refresh keeps the last good data on screen. A refresh with
 * the same `asOf` keeps the data object, and unchanged rows keep their `Item` objects (see `reuse`).
 */
export function useItems(refreshKey = 0): ItemsState {
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState<{ attempt: number; message: string } | null>(null);
  const [latest, setLatest] = useState<{ data: ItemsResponse; loadedAt: number } | null>(null);
  const inFlight = useRef(false);
  const alive = useRef(true);
  const lastKey = useRef(refreshKey);
  const kept = useRef<{ data: ItemsResponse; loadedAt: number } | null>(null);
  const rows = useRef<Rows>(new Map());
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  /** Keep the new response (reusing what is unchanged); the same `asOf` changes nothing, so nothing re-renders. */
  const accept = useCallback((data: ItemsResponse) => {
    const next = reuse(kept.current?.data, data, rows.current);
    if (next === kept.current?.data) return;
    kept.current = { data: next, loadedAt: Date.now() };
    setLatest(kept.current);
  }, []);

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
        if (current) accept(data);
      })
      .catch((err: unknown) => {
        if (current) setFailed({ attempt, message: describe(err) });
      });
    return () => {
      current = false;
    };
  }, [attempt, accept]);

  const ready = latest !== null;
  useEffect(() => {
    const prev = lastKey.current;
    lastKey.current = refreshKey;
    // Not on the runs' first load (the list is loading alongside it), only on later ones, and once the list is here.
    if (!prev || prev === refreshKey || !ready || inFlight.current) return;
    inFlight.current = true;
    fetchItems()
      .then((data) => {
        if (alive.current) accept(data);
      })
      .catch(() => {
        // keep the last good list
      })
      .finally(() => {
        inFlight.current = false;
      });
  }, [refreshKey, ready, accept]);

  if (latest) return { state: 'ready', data: latest.data, loadedAt: latest.loadedAt };
  return failed && failed.attempt === attempt ? { state: 'error', message: failed.message, retry } : { state: 'loading' };
}
