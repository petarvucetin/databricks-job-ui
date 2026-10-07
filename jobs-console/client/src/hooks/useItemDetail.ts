import { useEffect, useState } from 'react';
import type { ItemDetail } from '../../../shared/domain/types';

export type ItemDetailState =
  | { state: 'loading'; detail?: undefined; message?: undefined }
  | { state: 'error'; detail?: undefined; message: string }
  | { state: 'ready'; detail: ItemDetail; message?: undefined };

/** Details fetched this session, per "type:id": the definition doesn't change while the pane is open. */
const cache = new Map<string, ItemDetail>();

/** Tests: start without cached details. */
export function clearItemDetailCache(): void {
  cache.clear();
}

async function fetchDetail(type: string, id: string): Promise<ItemDetail> {
  const res = await fetch(`/api/items/${encodeURIComponent(type)}/${encodeURIComponent(id)}`, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: unknown } | null;
    throw new Error(typeof body?.error === 'string' ? `HTTP ${res.status}: ${body.error}` : `HTTP ${res.status}`);
  }
  return (await res.json()) as ItemDetail;
}

const describe = (err: unknown): string =>
  err instanceof DOMException && err.name === 'TimeoutError'
    ? 'Could not load the details: request timed out'
    : `Could not load the details: ${err instanceof Error ? err.message : String(err)}`;

/** A job's tasks or a pipeline's spec, from /api/items/:type/:id, fetched on selection and cached per item. */
export function useItemDetail(type: 'job' | 'pipeline', id: string): ItemDetailState {
  const key = `${type}:${id}`;
  const [got, setGot] = useState<{ key: string; result: ItemDetailState } | null>(null);

  useEffect(() => {
    if (cache.has(key)) return;
    let current = true;
    fetchDetail(type, id)
      .then((detail) => {
        cache.set(key, detail);
        if (current) setGot({ key, result: { state: 'ready', detail } });
      })
      .catch((err: unknown) => {
        if (current) setGot({ key, result: { state: 'error', message: describe(err) } });
      });
    return () => {
      current = false;
    };
  }, [key, type, id]);

  const hit = cache.get(key);
  if (hit) return { state: 'ready', detail: hit };
  if (got?.key === key) return got.result;
  return { state: 'loading' };
}
