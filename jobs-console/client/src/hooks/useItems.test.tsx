// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook, waitFor, act, cleanup } from '@testing-library/react';
import { useItems } from './useItems';
import type { Item, ItemsResponse } from '../../../shared/domain/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base = (over: Partial<Item>): Item => ({ type: 'job', id: '1', name: 'x', deployed: false, mine: false, tags: {}, trigger: 'manual', paused: false, bundle: false, ...over });
const ITEMS: Item[] = [
  base({ id: '1', name: 'a' }),
  base({ id: '2', name: 'b', trigger: 'schedule', schedule: { cron: '0 0 2 * * ?', tz: 'UTC', paused: false } }),
  base({ id: 'p1', type: 'pipeline', name: 'c', trigger: 'continuous' }),
];

/** Each call answers the next body in `bodies` (the last one repeats), as a fresh Response, so new objects every time. */
function stub(bodies: ItemsResponse[]) {
  let n = 0;
  const fetchMock = vi.fn(() => Promise.resolve(new Response(JSON.stringify(bodies[Math.min(n++, bodies.length - 1)]), { status: 200 })));
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const ready = (s: ReturnType<typeof useItems>) => {
  if (s.state !== 'ready') throw new Error(`not ready: ${s.state}`);
  return s;
};
const settle = () => act(() => new Promise((r) => setTimeout(r, 0)));

describe('useItems', () => {
  it('a refresh with the same asOf (a server cache hit) keeps the same data object and items', async () => {
    const body: ItemsResponse = { asOf: 1000, source: 'mock', items: ITEMS };
    const fetchMock = stub([body]);
    const { result, rerender } = renderHook(({ k }) => useItems(k), { initialProps: { k: 1 } });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    const first = ready(result.current);

    for (const k of [2, 3]) {
      rerender({ k });
      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(k));
      await settle();
    }
    const after = ready(result.current);
    expect(after.data).toBe(first.data);
    expect(after.loadedAt).toBe(first.loadedAt);
  });

  it('a refresh with a new asOf reuses the Item object of every row whose JSON is unchanged', async () => {
    const changed = { ...ITEMS[1], schedule: { cron: '0 0 3 * * ?', tz: 'UTC', paused: false } };
    const fetchMock = stub([
      { asOf: 1000, source: 'mock', items: ITEMS },
      { asOf: 2000, source: 'mock', items: ITEMS },
      { asOf: 3000, source: 'mock', items: [ITEMS[0], changed, ITEMS[2]] },
    ]);
    const { result, rerender } = renderHook(({ k }) => useItems(k), { initialProps: { k: 1 } });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    const first = ready(result.current).data.items;

    rerender({ k: 2 });
    await waitFor(() => expect(ready(result.current).data.asOf).toBe(2000));
    const second = ready(result.current).data.items;
    expect(second).toHaveLength(3);
    second.forEach((it, i) => expect(it).toBe(first[i]));

    rerender({ k: 3 });
    await waitFor(() => expect(ready(result.current).data.asOf).toBe(3000));
    const third = ready(result.current).data.items;
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(third[0]).toBe(first[0]);
    expect(third[2]).toBe(first[2]);
    expect(third[1]).not.toBe(first[1]);
    expect(third[1].schedule?.cron).toBe('0 0 3 * * ?');
  });
});
