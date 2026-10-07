// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { JobsPage } from './JobsPage';
import type { RunsData } from '../hooks/useRunsData';
import { makeRun } from '../test/fixtures';
import type { Item, ItemsResponse } from '../../../shared/domain/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ASOF = Date.UTC(2026, 9, 6, 16, 16);
const base = (over: Partial<Item>): Item => ({ type: 'job', id: '1', name: 'x', deployed: false, mine: false, tags: {}, trigger: 'manual', paused: false, bundle: false, ...over });
const ITEMS: Item[] = [
  base({ id: '1', name: '[dev ann] aiges_ingest_coretables_mfg_dev', mine: true, tags: { project: 'aiges' } }),
  base({ id: '2', name: 'aiges_finance_daily_report_prod', deployed: true, trigger: 'schedule', schedule: { cron: '0 0 2 * * ?', tz: 'UTC', paused: false } }),
  base({ id: 'p1', type: 'pipeline', name: 'raw_bronze_mfg_dev', trigger: 'continuous' }),
];

function stubItems(items: Item[]) {
  const body: ItemsResponse = { asOf: ASOF, source: 'mock', items };
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 }))));
}

const runsData: RunsData = {
  runs: {
    state: 'ready',
    data: { asOf: ASOF, source: 'mock', runs: [makeRun({ id: 5, name: 'aiges_finance_daily_report_prod', jobId: 2, startTime: ASOF - 3 * 3600e3, result: 'succeeded', kind: 'succeeded' })] },
    loadedAt: ASOF,
    startedAt: ASOF,
    refreshing: false,
    refreshError: null,
    refresh: () => {},
  },
  single: undefined,
  intervalMs: 0,
  setIntervalMs: () => {},
};

const rows = () => document.querySelectorAll('.ir');
const page = (active = true) => render(<JobsPage data={runsData} active={active} onSeeRuns={() => {}} onOpenRun={() => {}} />);

describe('JobsPage', () => {
  it('lists every item; search, the type segment and row selection work; no pane on load', async () => {
    stubItems(ITEMS);
    page();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(document.querySelector('.split.sel')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText(/Name tokens/), { target: { value: 'mfg coretables' } });
    expect(rows()).toHaveLength(1);
    fireEvent.change(screen.getByPlaceholderText(/Name tokens/), { target: { value: '' } });

    fireEvent.click(rows()[0]);
    expect(document.querySelector('.split.sel')).not.toBeNull();
    fireEvent.click(rows()[0]);
    expect(document.querySelector('.split.sel')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^Pipelines/ }));
    expect(rows()).toHaveLength(1);
  });

  it('last run from the loaded runs; "no runs in window" without one', async () => {
    stubItems(ITEMS);
    page();
    await waitFor(() => expect(rows()).toHaveLength(3));
    const byId = (id: string) => document.querySelector(`.ir[data-id="${id}"]`)!;
    expect(byId('2').querySelector('.last')!.textContent).toBe('✓3h ago');
    expect(byId('1').querySelector('.last')!.textContent).toBe('—no runs in window');
  });

  it('Esc clears the selection only while the tab is active', async () => {
    stubItems(ITEMS);
    const { rerender } = page(false);
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(rows()[0]);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.split.sel')).not.toBeNull();
    rerender(<JobsPage data={runsData} active onSeeRuns={() => {}} onOpenRun={() => {}} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(document.querySelector('.split.sel')).toBeNull();
  });

  it('a column head narrows the list to items starting then, with their start times', async () => {
    stubItems(ITEMS);
    page();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(screen.getByText('Scheduled starts by hour')).toBeTruthy();
    // 16:00 is column 0; 02:00 tomorrow is column 10, where the daily job's one start falls
    const heads = document.querySelectorAll('.tl-head');
    expect(heads[10].textContent?.trim()).toBe('02');
    expect(document.querySelectorAll('.cube.job')).toHaveLength(1);
    fireEvent.click(heads[10]);
    expect([...rows()].map((r) => r.getAttribute('data-id'))).toEqual(['2']);
    expect(rows()[0].querySelector('.starts')!.textContent).toBe('⏱ 02:00');
    fireEvent.click(screen.getByText('clear schedule filter ✕'));
    expect(rows()).toHaveLength(3);
  });

  it('footer counts items with no schedule and schedules not understood; those stay off the timeline', async () => {
    stubItems([
      ...ITEMS,
      base({ id: '3', name: 'monthly_close', trigger: 'schedule', schedule: { cron: '0 0 12 L * ?', tz: 'UTC', paused: false } }),
      base({ id: '4', name: 'paused_daily', trigger: 'schedule', paused: true, schedule: { cron: '0 0 3 * * ?', tz: 'UTC', paused: true } }),
      base({ id: '5', name: 'every_four', trigger: 'periodic', periodic: { interval: 4, unit: 'HOURS' } }),
    ]);
    page();
    await waitFor(() => expect(rows()).toHaveLength(6));
    expect(document.querySelector('.tl-foot')!.textContent).toContain('4 have no schedule (manual, triggered, continuous, paused) · 1 schedules not understood');
    const pill = (id: string) => document.querySelector(`.ir[data-id="${id}"] .trg`)!.textContent;
    expect(pill('3')).toBe('⏱ cron 0 0 12 L * ?');
    expect(pill('4')).toBe('paused');
    expect(pill('5')).toBe('every 4h (periodic)');
    // only the daily 02:00 job adds a start
    expect([...document.querySelectorAll('.cube.job')].map((c) => c.textContent)).toEqual(['1']);
  });

  it('no "not understood" part when every schedule parses', async () => {
    stubItems(ITEMS);
    page();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(document.querySelector('.tl-foot')!.textContent).toContain('2 have no schedule (manual, triggered, continuous, paused)');
    expect(document.querySelector('.tl-foot')!.textContent).not.toContain('not understood');
  });
});
