// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { JobsPage } from './JobsPage';
import type { RunsData } from '../hooks/useRunsData';
import type { ItemsResponse, RunsResponse } from '../../../shared/domain/types';
import { clearItemDetailCache } from '../hooks/useItemDetail';
// The mock source's own generators (createMockRunSource itself pulls in server-only modules the client build can't type).
import { generateRuns } from '../../../server/data/mock/generateRuns';
import { mockDetail, mockItems } from '../../../server/data/mock/mockItems';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearItemDetailCache();
});

/**
 * The browser pass reported a 45 s freeze opening the pane for the 4th row on the full mock data set. It was the probe:
 * the tab was in the background, where requestAnimationFrame never fires, so the probe's await never settled. This pins
 * the real cost: the page on the full mock data (1000+ items, thousands of runs), and opening the pane stays well within
 * a frame budget's order of magnitude (generous bound for jsdom and a loaded CI machine).
 */
describe('JobsPage on the full mock data set', () => {
  it('opens the pane for any of the first rows, and after the tab was hidden, quickly', async () => {
    const runsResp: RunsResponse = generateRuns();
    const itemsResp: ItemsResponse = { asOf: runsResp.asOf, source: 'mock', items: mockItems(runsResp.runs, runsResp.asOf) };
    expect(itemsResp.items.length).toBeGreaterThan(1000);
    expect(runsResp.runs.length).toBeGreaterThan(3000);
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url === '/api/items') return Promise.resolve(new Response(JSON.stringify(itemsResp), { status: 200 }));
      const m = /^\/api\/items\/(job|pipeline)\/([^/]+)$/.exec(url);
      const item = m && itemsResp.items.find((it) => it.type === m[1] && it.id === decodeURIComponent(m[2]));
      if (item) return Promise.resolve(new Response(JSON.stringify(mockDetail(item, runsResp.runs)), { status: 200 }));
      return Promise.resolve(new Response('{}', { status: 404 }));
    }));
    const data: RunsData = {
      runs: { state: 'ready', data: runsResp, loadedAt: runsResp.asOf, startedAt: runsResp.asOf, refreshing: false, refreshError: null, refresh: () => {} },
      single: undefined,
      intervalMs: 0,
      setIntervalMs: () => {},
    };
    const ui = (active: boolean) => <JobsPage data={data} active={active} onSeeRuns={() => {}} onOpenRun={() => {}} />;
    const { rerender } = render(ui(true));
    await waitFor(() => expect(document.querySelectorAll('.ir').length).toBe(300));

    const open = (i: number) => {
      const t = performance.now();
      act(() => {
        fireEvent.click(document.querySelectorAll('.ir')[i]);
      });
      const ms = performance.now() - t;
      expect(document.querySelector('.split.sel .p-name')).not.toBeNull();
      act(() => {
        fireEvent.click(document.querySelector('.p-x')!);
      });
      expect(document.querySelector('.split.sel')).toBeNull();
      return ms;
    };
    const times = [0, 3, 7, 3].map(open);
    // The tab was hidden (Runs active), then shown again: the pane opens just as fast.
    rerender(ui(false));
    rerender(ui(true));
    times.push(open(3));
    // In a browser each open is ~30-50 ms of main-thread time; jsdom is slower. 1.5 s still catches a freeze.
    for (const ms of times) expect(ms).toBeLessThan(1500);
    // Let the detail fetches settle inside the test.
    await act(async () => {});
  }, 60000);
});
