// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { mergeRuns, rebase, useRunRefresh, type RunOverride } from './useRunRefresh';
import { makeRealRun, makeRun } from '../test/fixtures';
import type { Run, RunsResponse } from '../../../shared/domain/types';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const T = 1_000_000;
const running = makeRun({ id: 3, kind: 'running', failed: [], live: true, result: null, durationSec: 600 });
const other = makeRun({ id: 4 });
const list: RunsResponse = { asOf: T, source: 'live', runs: [running, other] };

describe('mergeRuns', () => {
  const fresh: Run = { ...running, durationSec: 700 };
  const over = (at: number) => new Map<number, RunOverride>([[3, { run: fresh, at }]]);

  it('puts a run refreshed after the list in its place, rebased to the list load time', () => {
    const merged = mergeRuns(list, T, T - 500, over(T + 30_000));
    expect(merged.runs[0]).toEqual({ ...fresh, durationSec: 670 });
    expect(merged.runs[1]).toBe(other);
  });

  it('drops the override once a list fetch started after it arrived', () => {
    expect(mergeRuns(list, T + 60_000, T + 40_000, over(T + 30_000))).toBe(list);
    expect(mergeRuns(list, T + 60_000, T + 30_000, over(T + 30_000))).toBe(list);
  });

  it('keeps the override over a list that was already on its way when it arrived', () => {
    expect(mergeRuns(list, T + 60_000, T + 20_000, over(T + 30_000)).runs[0].durationSec).toBe(700);
  });

  it('rebases only live runs, and only running tasks', () => {
    const live = makeRealRun({ live: true, durationSec: 100, tasks: [{ key: 'a', startSec: 0, durSec: 40, state: 'ok', deps: [], attempt: 0 }, { key: 'b', startSec: 40, durSec: 60, state: 'r', deps: [0], attempt: 0 }] });
    const r = rebase(live, T + 10_000, T);
    expect(r.durationSec).toBe(90);
    expect(r.tasks?.map((t) => t.durSec)).toEqual([40, 50]);
    const done = makeRealRun();
    expect(rebase(done, T + 10_000, T)).toBe(done);
  });
});

describe('useRunRefresh', () => {
  const answer = (run: Run) => new Response(JSON.stringify(run), { status: 200 });

  it('fetches /api/runs/:id and shows the answer in the data, with its own updatedAt', async () => {
    vi.useFakeTimers({ now: T + 5000, shouldAdvanceTime: true });
    const fetchMock = vi.fn(() => Promise.resolve(answer({ ...running, kind: 'succeeded', live: false, result: 'succeeded', durationSec: 650 })));
    vi.stubGlobal('fetch', fetchMock);
    const { result } = renderHook(() => useRunRefresh({ data: list, loadedAt: T, startedAt: T - 500 }));
    expect(result.current?.data).toBe(list);
    expect(result.current?.status(3)).toEqual({ refreshing: false, error: null, updatedAt: T });
    let done: Promise<void> | undefined;
    act(() => {
      done = result.current?.refreshRun(3);
    });
    expect(result.current?.status(3).refreshing).toBe(true);
    await act(async () => {
      await done;
    });
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).toMatch(/^\/api\/runs\/3\?tzOffset=-?\d+$/);
    expect(result.current?.data.runs[0]).toMatchObject({ id: 3, kind: 'succeeded', durationSec: 650 });
    const st = result.current?.status(3);
    expect(st?.refreshing).toBe(false);
    expect(st?.error).toBeNull();
    expect(st?.updatedAt).toBeGreaterThanOrEqual(T + 5000);
    expect(result.current?.status(4).updatedAt).toBe(T);
  });

  it('a newer list replaces the override', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(answer({ ...running, durationSec: 999 }))));
    const start = Date.now();
    const { result, rerender } = renderHook(({ l }) => useRunRefresh(l), { initialProps: { l: { data: list, loadedAt: start, startedAt: start } } });
    await act(async () => {
      await result.current?.refreshRun(3);
    });
    expect(result.current?.data.runs[0].durationSec).toBeGreaterThan(900);
    const newer: RunsResponse = { ...list, runs: [{ ...running, durationSec: 1234 }, other] };
    rerender({ l: { data: newer, loadedAt: Date.now() + 2000, startedAt: Date.now() + 1000 } });
    expect(result.current?.data).toBe(newer);
  });

  it('reports a failed refresh and keeps the list data', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{"error":"Run 3 does not exist"}', { status: 404 }))));
    const { result } = renderHook(() => useRunRefresh({ data: list, loadedAt: T, startedAt: T }));
    await act(async () => {
      await result.current?.refreshRun(3);
    });
    expect(result.current?.status(3).error).toBe('Could not refresh the run: HTTP 404: Run 3 does not exist');
    expect(result.current?.data).toBe(list);
  });

  it('is undefined until the list has loaded', async () => {
    const { result } = renderHook(() => useRunRefresh(undefined));
    await waitFor(() => expect(result.current).toBeUndefined());
  });
});
