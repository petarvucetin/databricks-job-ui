// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { JobsPage } from './JobsPage';
import type { RunsData } from '../hooks/useRunsData';
import { makeRun } from '../test/fixtures';
import type { Item, ItemDetail, ItemsResponse } from '../../../shared/domain/types';
import { clearItemDetailCache } from '../hooks/useItemDetail';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearItemDetailCache();
});

const ASOF = Date.UTC(2026, 9, 6, 16, 16);
const base = (over: Partial<Item>): Item => ({ type: 'job', id: '1', name: 'x', deployed: false, mine: false, tags: {}, trigger: 'manual', paused: false, bundle: false, ...over });
const ITEMS: Item[] = [
  base({ id: '1', name: '[dev ann] aiges_ingest_coretables_mfg_dev', mine: true, tags: { project: 'aiges' } }),
  base({ id: '2', name: 'aiges_finance_daily_report_prod', deployed: true, trigger: 'schedule', schedule: { cron: '0 0 2 * * ?', tz: 'UTC', paused: false } }),
  base({ id: 'p1', type: 'pipeline', name: 'raw_bronze_mfg_dev', trigger: 'continuous' }),
];

const DETAIL: ItemDetail = {
  item: ITEMS[1],
  tasks: [
    { key: 'extract_gl', type: 'Notebook', dependsOn: [] },
    { key: 'load_gold', type: 'SQL', dependsOn: ['extract_gl'] },
  ],
};

/** /api/items -> the list; /api/items/job/2 -> a detail with two tasks; any other detail -> 403. */
function stubItems(items: Item[]) {
  const body: ItemsResponse = { asOf: ASOF, source: 'mock', items };
  const fetchMock = vi.fn((url: string) => {
    if (url === '/api/items') return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    if (url === '/api/items/job/2') return Promise.resolve(new Response(JSON.stringify(DETAIL), { status: 200 }));
    return Promise.resolve(new Response(JSON.stringify({ error: 'missing scope pipelines' }), { status: 403 }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
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
const page = (active = true, on: { onSeeRuns?: (n: string) => void; onOpenRun?: (id: number) => void } = {}) =>
  render(<JobsPage data={runsData} active={active} onSeeRuns={on.onSeeRuns ?? (() => {})} onOpenRun={on.onOpenRun ?? (() => {})} />);
const byId = (id: string) => document.querySelector<HTMLElement>(`.ir[data-id="${id}"]`)!;

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
    expect(document.querySelector('.tl-foot')!.textContent).toContain('2 have no schedule (manual, triggered, continuous, paused)');
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
  it('Load shows the jobs running at once; the tooltip marks estimated runtimes; a click selects one step', async () => {
    // every 5 minutes, no runs loaded: the 10-minute estimate, so two runs overlap at every sample
    stubItems([...ITEMS, base({ id: 'e', name: 'every_five', trigger: 'schedule', schedule: { cron: '0 0/5 * * * ?', tz: 'UTC', paused: false } })]);
    page();
    await waitFor(() => expect(rows()).toHaveLength(4));
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    expect(screen.getByText('Running at once')).toBeTruthy();
    expect(screen.getByText('drag across the chart to list the jobs running then')).toBeTruthy();
    // without a selection: the continuous pipeline, everything starting in range by first start (every_five at 16:00,
    // the daily job at 02:00), then the manual job not on the chart
    expect(document.querySelector('.list-meta')!.textContent).toContain('2 scheduled to start in range, by first start · 1 continuous');
    expect([...rows()].map((r) => r.getAttribute('data-id'))).toEqual(['p1', 'e', '2', '1']);

    const plot = document.querySelector('.ld-plot')!;
    fireEvent.mouseMove(plot, { clientX: 0, clientY: 0 });
    expect(document.querySelector('.tip')!.textContent).toBe('16:00 · 3 running: 2 jobs · 1 pipelines · 1 start in the next 5 min\nprod / no prefix  3\n(runtimes estimated for 1 jobs)');
    expect(document.querySelector('.ld-x')).not.toBeNull();
    fireEvent.mouseLeave(plot);
    expect(document.querySelector('.tip')).toBeNull();

    fireEvent.pointerDown(plot, { clientX: 0 });
    fireEvent.pointerUp(plot, { clientX: 0 });
    expect(document.querySelector('.list-meta')!.textContent).toContain('2 jobs and pipelines running between 16:00 and 16:05');
    expect([...rows()].map((r) => r.getAttribute('data-id'))).toEqual(['p1', 'e', '1']);
    expect(byId('e').querySelector('.starts')!.textContent).toBe('15:55–16:05 · 16:00–16:10');
    fireEvent.click(screen.getByText('clear selection ✕'));
    expect(rows()).toHaveLength(4);
  });

  it('the pane: facts, recent runs, tasks from the detail, See runs →', async () => {
    const onSeeRuns = vi.fn();
    const onOpenRun = vi.fn();
    stubItems(ITEMS);
    page(true, { onSeeRuns, onOpenRun });
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(byId('2'));
    const pane = document.querySelector('.pane')!;
    // readable trigger text, the schedule's zone quietly, the next start; the raw cron only as the tooltip
    const trigger = [...pane.querySelectorAll('.facts dt')].find((dt) => dt.textContent === 'Trigger')!.nextElementSibling!;
    expect(trigger.textContent).toBe('daily 02:00 · UTC schedule · next Wed 02:00, in 9h 44m');
    expect(trigger.getAttribute('title')).toBe('cron 0 0 2 * * ? (UTC)');
    expect(pane.textContent).toContain('not from a bundle');
    expect(pane.textContent).toContain('Job ID2');
    await waitFor(() => expect(pane.querySelectorAll('.tasks li')).toHaveLength(2));
    expect(pane.querySelectorAll('.tasks li')[1].textContent).toBe('load_goldafter extract_glSQL');

    const boxes = pane.querySelectorAll('.rh');
    expect(boxes).toHaveLength(1);
    expect(boxes[0].className).toBe('rh succeeded');
    fireEvent.click(boxes[0]);
    expect(onOpenRun).toHaveBeenCalledWith(5);

    fireEvent.click(screen.getByText('See runs →'));
    expect(onSeeRuns).toHaveBeenCalledWith('aiges_finance_daily_report_prod');

    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(document.querySelector('.split.sel')).toBeNull();
  });

  it('a job with no runs loaded: the pane says so; a detail that fails shows its error inside the section', async () => {
    stubItems(ITEMS);
    page();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(byId('1'));
    expect(screen.getByText('No runs in the loaded window.')).toBeTruthy();
    await waitFor(() => expect(document.querySelector('.pane')!.textContent).toContain('Could not load the details: HTTP 403: missing scope pipelines'));
    expect(screen.getByText('See runs →')).toBeTruthy();
  });

  it('the selection clears when filters take the selected item away', async () => {
    stubItems(ITEMS);
    page();
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.click(byId('2'));
    expect(document.querySelector('.split.sel')).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/Name tokens/), { target: { value: 'coretables' } });
    expect(document.querySelector('.split.sel')).toBeNull();
    fireEvent.change(screen.getByPlaceholderText(/Name tokens/), { target: { value: '' } });
    expect(rows()).toHaveLength(3);
    expect(document.querySelector('.ir.on')).toBeNull();
    expect(document.querySelector('.split.sel')).toBeNull();
  });

  it('a pipeline started by a scheduled job: its starts on the timeline, the "· by job" pill; Scheduled · Unscheduled filter', async () => {
    stubItems([...ITEMS, base({ id: 'p2', type: 'pipeline', name: 'silver_merge', trigger: 'manual', startedBy: [{ jobId: '2', jobName: 'aiges_finance_daily_report_prod' }] })]);
    page();
    await waitFor(() => expect(rows()).toHaveLength(4));
    expect([...document.querySelectorAll('.cube.pipeline')].map((c) => c.textContent)).toEqual(['1']);
    const pill = byId('p2').querySelector('.trg')!;
    expect(pill.textContent).toBe('⏱ daily 02:00 · by job');
    expect(pill.getAttribute('title')).toBe('Started by the pipeline task of aiges_finance_daily_report_prod');
    expect(document.querySelector('.tl-foot')!.textContent).toContain('2 have no schedule');
    const seg = document.querySelector('.seg[aria-label="trigger"]')!;
    expect([...seg.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Any trigger4', 'Scheduled2', 'Unscheduled2']);
    fireEvent.click(screen.getByRole('button', { name: /^Scheduled/ }));
    expect([...rows()].map((r) => r.getAttribute('data-id'))).toEqual(['2', 'p2']);
    fireEvent.click(screen.getByRole('button', { name: /^Unscheduled/ }));
    expect([...rows()].map((r) => r.getAttribute('data-id')).sort()).toEqual(['1', 'p1']);
    fireEvent.click(screen.getByRole('button', { name: /^Any trigger/ }));
    expect(rows()).toHaveLength(4);
  });

  it('Load: the type filter toggles the bands; Unscheduled shows the continuous pipeline on the chart, the rest under it', async () => {
    stubItems([...ITEMS, base({ id: 'p2', type: 'pipeline', name: 'silver_merge', trigger: 'manual', startedBy: [{ jobId: '2', jobName: 'aiges_finance_daily_report_prod' }] })]);
    page();
    await waitFor(() => expect(rows()).toHaveLength(4));
    fireEvent.click(screen.getByRole('button', { name: 'Load' }));
    const fills = () => [...document.querySelectorAll('.ld-plot svg polygon')].map((p) => p.getAttribute('fill'));
    const ids = () => [...document.querySelectorAll('.ld-list > .ir, .ld-list > .ld-off')].map((r) => r.getAttribute('data-id') ?? 'OFF');
    expect(fills()).toEqual(['#eadfce', '#ddd3f3']);

    fireEvent.click(screen.getByRole('button', { name: /^Pipelines/ }));
    expect(fills()).toEqual(['#ddd3f3']);
    // the credited pipeline starts with its job at 02:00, the continuous one runs throughout
    expect(ids()).toEqual(['p1', 'p2']);
    fireEvent.click(screen.getByRole('button', { name: /^Jobs/ }));
    expect(fills()).toEqual(['#eadfce']);
    expect(ids()).toEqual(['2', 'OFF', '1']);
    fireEvent.click(document.querySelector('.seg[aria-label="type"] button')!);

    fireEvent.click(screen.getByRole('button', { name: /^Unscheduled/ }));
    expect(fills()).toEqual(['#ddd3f3']);
    expect(document.querySelector('.list-meta')!.textContent).toContain('1 continuous on the chart');
    expect(ids()).toEqual(['p1', 'OFF', '1']);
    expect(document.querySelector('.ld-head')!.textContent).toContain('continuous ones (1) run the whole time');
  });

  it('T collapses the timeline to one line and expands it; the line says when the schedule filter is on', async () => {
    stubItems(ITEMS);
    page();
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(document.querySelector('.tl-hint')!.textContent).toBe('T collapse');
    fireEvent.keyDown(document, { key: 't' });
    expect(document.querySelector('.tl-grid')).toBeNull();
    expect(document.querySelector('.tl-min .tl-span')!.textContent).toBe('Tue 16:00 to Wed 16:00, 1 day');
    expect(document.querySelector('.tl-min .tl-key')!.textContent).toBe('T expand');
    fireEvent.keyDown(document, { key: 'T' });
    expect(document.querySelector('.tl-min')).toBeNull();
    fireEvent.click(document.querySelectorAll('.tl-head')[10]);
    fireEvent.keyDown(document, { key: 't' });
    expect(document.querySelector('.tl-min .tl-span')!.textContent).toBe('02:00 to 03:00, 1 hour · schedule filter on');
    // the schedule filter still applies to the list while collapsed
    expect([...rows()].map((r) => r.getAttribute('data-id'))).toEqual(['2']);
  });

  it('L and D switch List and Load; the switch shows the keys', async () => {
    stubItems(ITEMS);
    page();
    await waitFor(() => expect(rows()).toHaveLength(3));
    const sw = [...document.querySelectorAll('.vsw button')];
    expect(sw.map((b) => [b.textContent, b.getAttribute('title')])).toEqual([['ListL', 'List (L)'], ['LoadD', 'Load (D)']]);
    fireEvent.keyDown(document, { key: 'd' });
    expect(screen.getByText('Running at once')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'L' });
    expect(screen.queryByText('Running at once')).toBeNull();
    expect(rows()).toHaveLength(3);
  });

  it('T, L and D are ignored while typing, with a modifier, and while the tab is inactive', async () => {
    stubItems(ITEMS);
    const { rerender } = page(false);
    await waitFor(() => expect(rows()).toHaveLength(3));
    fireEvent.keyDown(document, { key: 't' });
    fireEvent.keyDown(document, { key: 'd' });
    expect(document.querySelector('.tl-min')).toBeNull();
    expect(screen.queryByText('Running at once')).toBeNull();
    rerender(<JobsPage data={runsData} active onSeeRuns={() => {}} onOpenRun={() => {}} />);
    const input = screen.getByPlaceholderText(/Name tokens/);
    fireEvent.keyDown(input, { key: 't' });
    fireEvent.keyDown(input, { key: 'd' });
    fireEvent.keyDown(document.querySelector('.sortsel select')!, { key: 'd' });
    fireEvent.keyDown(document, { key: 't', ctrlKey: true });
    fireEvent.keyDown(document, { key: 'd', metaKey: true });
    fireEvent.keyDown(document, { key: 'd', altKey: true });
    expect(document.querySelector('.tl-min')).toBeNull();
    expect(screen.queryByText('Running at once')).toBeNull();
    fireEvent.keyDown(document, { key: 't' });
    expect(document.querySelector('.tl-min')).not.toBeNull();
  });

  it('the list refreshes with each runs load (the manual refresh too), not on the first one', async () => {
    const fetchMock = stubItems(ITEMS);
    const listCalls = () => fetchMock.mock.calls.filter(([u]) => u === '/api/items').length;
    const at = (loadedAt: number): RunsData => ({ ...runsData, runs: { ...runsData.runs, loadedAt } as RunsData['runs'] });
    const { rerender } = render(<JobsPage data={at(ASOF)} active onSeeRuns={() => {}} onOpenRun={() => {}} />);
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(listCalls()).toBe(1);
    rerender(<JobsPage data={at(ASOF + 1000)} active onSeeRuns={() => {}} onOpenRun={() => {}} />);
    await waitFor(() => expect(listCalls()).toBe(2));
    rerender(<JobsPage data={at(ASOF + 1000)} active onSeeRuns={() => {}} onOpenRun={() => {}} />);
    expect(listCalls()).toBe(2);
  });
});
