// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { RunDrawer } from './RunDrawer';
import { makeRealRun, makeRetryingRun, makeRun } from '../test/fixtures';

const fetchMock = vi.fn();
beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => Promise.resolve({ ok: true, json: () => Promise.resolve({ text: `12:00:01 [pipeline] start\n12:00:02 ERROR [x] boom\nlog for ${url}` }) }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const cause = (label: string) => ({ label, code: 'CLIENT_ERROR', detail: `${label} detail` });
const multi = makeRun({
  ntasks: 12,
  failed: [
    { name: 'load_a', cause: cause('Table not found'), secs: 4 },
    { name: 'load_b', cause: cause('Cluster error'), secs: 6 },
    { name: 'load_c', cause: cause('Table not found'), secs: 2 },
  ],
});

describe('RunDrawer', () => {
  it('shows the prototype header and the Job, Run, Tasks, Root and Task stops on the route', async () => {
    const { container } = render(<RunDrawer run={makeRun()} nowMs={0} loadedAt={0} onClose={() => {}} />);
    expect(container.querySelector('.dh .title')!.textContent).toBe('[prod] finance_gl_co_gl_journals_v3');
    expect(container.querySelector('.dh .ty svg')).not.toBeNull();
    expect(container.querySelector('.dh .when')!.textContent).toBe('failed 22 Sep 02:41, after 23m 24s');
    const ks = [...container.querySelectorAll('.route > .panel .hd .k')].map((k) => k.textContent);
    expect(ks).toEqual(['Job', 'Run', 'Tasks', 'Root', 'Task']);
    expect(container.querySelector('.panel.fail .hd .v')!.textContent).toBe('Cluster error');
    const cmp = [...container.querySelectorAll('.cmp .num')].map((n) => n.textContent);
    expect(cmp).toEqual(['23m 24s', '25m 52s', '25m 52s']);
    expect(container.querySelectorAll('.gantt .grow')).toHaveLength(10);
    expect(container.querySelector('.gantt .grow.sel .lbl')!.textContent).toBe('load_gl');
    await waitFor(() => expect(container.querySelector('.logh span')!.textContent).toBe('3 lines, ends at the error'));
    expect(fetchMock.mock.calls[0][0]).toBe('/api/runs/1/log?task=load_gl&hint=Cluster+error');
    expect(container.querySelector('.log .err')!.textContent).toContain('boom');
  });

  it('groups several failures by cause and switches the Root and Task stops to the picked one', () => {
    const { container } = render(<RunDrawer run={multi} nowMs={0} loadedAt={0} onClose={() => {}} />);
    expect(container.querySelector('.panel .hd .r.amber')!.textContent).toBe('2 causes');
    expect([...container.querySelectorAll('.fgrp')].map((g) => g.textContent)).toEqual(['Table not found2', 'Cluster error1']);
    fireEvent.click([...container.querySelectorAll('.frow')].find((r) => r.textContent.startsWith('load_b'))!);
    expect(container.querySelector('.panel.fail .hd .v')!.textContent).toBe('Cluster error');
    expect(container.querySelector('.panel.last .hd .v')!.textContent).toBe('load_b');
  });

  it('picks any task from the timeline, and shows the grid view on request', () => {
    const { container } = render(<RunDrawer run={makeRun()} nowMs={0} loadedAt={0} onClose={() => {}} />);
    fireEvent.click(container.querySelectorAll('.gantt .grow')[0]);
    expect(container.querySelector('.gantt .grow.sel .lbl')!.textContent).toBe('setup');
    expect(container.querySelector('.panel.last .hd .v')!.textContent).toBe('setup');
    fireEvent.click([...container.querySelectorAll('.vsw span')].find((s) => s.textContent === 'Grid')!);
    expect(container.querySelector('.gantt')).toBeNull();
    expect(container.querySelectorAll('.tasks i')).toHaveLength(10);
    expect(container.querySelectorAll('.tasks i.f')).toHaveLength(1);
  });

  it('collapses and opens a stop from its header', () => {
    const { container } = render(<RunDrawer run={makeRun()} nowMs={0} loadedAt={0} onClose={() => {}} />);
    const run = [...container.querySelectorAll('.route > .panel')][1];
    expect(run.className).toContain('open');
    fireEvent.click(run.querySelector('.hd')!);
    expect(run.className).not.toContain('open');
  });

  it('shows a running run as running and on track, ticking', () => {
    const run = makeRun({ kind: 'running', failed: [], live: true, result: null, durationSec: 600, usualSec: 1200 });
    const { container } = render(<RunDrawer run={run} nowMs={5000} loadedAt={0} onClose={() => {}} />);
    expect(container.querySelector('.dh .when')!.textContent).toBe('started 22 Sep 02:41, 10m 05s');
    expect(container.querySelector('.panel.last .hd .v')!.textContent).toBe('Running, on track');
    expect(container.querySelectorAll('.gantt .sq.r')).toHaveLength(1);
  });

  it('closes on Escape, a click outside and the close button, but not on a history box click', () => {
    const onClose = vi.fn();
    const { container } = render(<RunDrawer run={makeRun()} nowMs={0} loadedAt={0} onClose={onClose} />);
    expect(document.activeElement).toBe(container.querySelector('.dh .x'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(document.body);
    const box = document.createElement('button');
    box.className = 'rh';
    document.body.appendChild(box);
    fireEvent.click(box);
    box.remove();
    fireEvent.click(container.querySelector('.dh .x')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});

describe('RunDrawer with real tasks', () => {
  it('draws the real tasks, one arrow per dependency row, and fetches logs by the real task key', async () => {
    const { container } = render(<RunDrawer run={makeRealRun()} nowMs={0} loadedAt={0} onClose={() => {}} />);
    expect([...container.querySelectorAll('.gantt .grow .lbl')].map((l) => l.textContent)).toEqual(['setup', 'extract_a', 'extract_b', 'transform', 'load', 'publish']);
    expect(container.querySelector('.gantt .grow.sel .lbl')!.textContent).toBe('transform');
    expect(container.querySelector('.route > .panel .hd .v')!.textContent).toBe('6 tasks');
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/runs/7/log?task=transform'), expect.anything()));
    fireEvent.click(container.querySelectorAll('.gantt .grow')[2]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('task=extract_b'), expect.anything()));
    expect(container.textContent).not.toMatch(/line 41|finance-gl|daily 06:00/);
  });

  it('shows a Databricks log written with ANSI colours in colour, without the escape codes or CRs', async () => {
    const ipython = '\x1b[31mPy4JJavaError\x1b[39m                             Traceback (most recent call last)\r\n\x1b[32m----> \x1b[39m\x1b[32m9\x1b[39m   \x1b[43mexec\x1b[49m(x)\r\nplain line';
    fetchMock.mockImplementation(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ text: ipython }) }));
    const { container } = render(<RunDrawer run={makeRealRun()} nowMs={0} loadedAt={0} onClose={() => {}} />);
    await waitFor(() => expect(container.querySelector('.log')!.textContent).toContain('Py4JJavaError'));
    const log = container.querySelector('.log')!;
    for (const bad of ['\x1b', '[31m', '\r']) expect(log.textContent).not.toContain(bad);
    const err = [...log.querySelectorAll('span')].find((s) => s.textContent === 'Py4JJavaError');
    expect(err?.style.color).toBe('rgb(196, 61, 40)');
    const hl = [...log.querySelectorAll('span')].find((s) => s.textContent === 'exec');
    expect(hl?.style.background).toContain('rgb(253, 240, 216)');
    expect(log.querySelectorAll(':scope > div')[2]?.textContent).toBe('plain line');
  });

  it('draws each task bar as long as the task ran on the time axis', () => {
    // Run of 400s: setup 0-60, extract_a 60-180, extract_b 100-300 (second attempt), transform 300-400 failed.
    const { container } = render(<RunDrawer run={makeRealRun()} nowMs={0} loadedAt={0} onClose={() => {}} />);
    const bar = (i: number) => container.querySelectorAll<HTMLElement>('.gantt .grow')[i]?.querySelector<HTMLElement>('.sq') ?? null;
    const pct = (el: HTMLElement | null) => ({ left: parseFloat(el?.style.left ?? ''), width: parseFloat(el?.style.width ?? '') });
    expect(pct(bar(0))).toEqual({ left: 0, width: 15 });
    expect(pct(bar(1))).toEqual({ left: 15, width: 30 });
    expect(pct(bar(2))).toEqual({ left: 25, width: 50 });
    expect(pct(bar(3))).toEqual({ left: 75, width: 25 });
    expect(bar(2)?.textContent).toBe('3m 20s, attempt 2');
    expect(bar(3)?.textContent).toBe('1m 40s, failed');
    expect(container.textContent).not.toMatch(/48m 22s|38m 29s/);
  });

  it('puts the label after a bar too short to hold it', () => {
    const run = makeRealRun({ durationSec: 4000 }); // the 60s setup is 1.5% of the axis
    const { container } = render(<RunDrawer run={run} nowMs={0} loadedAt={0} onClose={() => {}} />);
    const row = container.querySelectorAll<HTMLElement>('.gantt .grow')[0];
    expect(row?.querySelector('.sq')?.textContent).toBe('');
    expect(row?.querySelector('.sq-after')?.textContent).toBe('1m 00s');
  });

  it('"open full log" opens the run in Databricks, and is hidden when the run has no url', () => {
    const { container, unmount } = render(<RunDrawer run={makeRealRun({ url: 'https://adb-1.2.azuredatabricks.net/jobs/10/runs/7?o=1' })} nowMs={0} loadedAt={0} onClose={() => {}} />);
    const a = [...container.querySelectorAll('.logh a')].find((x) => x.textContent === 'open full log ↗');
    expect(a?.getAttribute('href')).toBe('https://adb-1.2.azuredatabricks.net/jobs/10/runs/7?o=1');
    expect(a?.getAttribute('target')).toBe('_blank');
    unmount();
    const plain = render(<RunDrawer run={makeRealRun({ url: undefined })} nowMs={0} loadedAt={0} onClose={() => {}} />);
    expect(plain.container.textContent).not.toContain('open full log');
  });

  it('links the header title when the run has a url, and not otherwise', () => {
    const { container } = render(<RunDrawer run={makeRealRun()} nowMs={0} loadedAt={0} onClose={() => {}} />);
    const a = container.querySelector<HTMLAnchorElement>('.dh .title a')!;
    expect(a.getAttribute('href')).toBe('https://x.cloud.databricks.us/jobs/2/runs/7');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.textContent).toBe('[prod] finance_gl_co_gl_journals_v3');
    cleanup();
    expect(render(<RunDrawer run={makeRun()} nowMs={0} loadedAt={0} onClose={() => {}} />).container.querySelector('.dh .title a')).toBeNull();
  });

  it('a retrying run names its real retrying task', () => {
    const { container } = render(<RunDrawer run={makeRetryingRun()} nowMs={0} loadedAt={0} onClose={() => {}} />);
    expect(container.querySelector('.panel.fail .err')!.textContent).toBe('dattempt 2');
    expect(container.textContent).not.toContain('extract_bseg');
  });
});

describe('RunDrawer refresh', () => {
  const logCalls = () => fetchMock.mock.calls.filter((c) => String(c[0]).includes('/log?')).length;
  const refresh = (over: Partial<{ onRefresh: () => Promise<void>; refreshing: boolean; error: string | null; updatedAt: number }> = {}) => ({
    onRefresh: vi.fn(() => Promise.resolve()), refreshing: false, error: null, updatedAt: 0, ...over,
  });

  it('shows when the run was updated, and a quiet refresh control next to the close button', () => {
    const { container } = render(<RunDrawer run={makeRealRun()} nowMs={12000} loadedAt={0} onClose={() => {}} refresh={refresh({ updatedAt: 2000 })} />);
    expect(container.querySelector('.dh .rf .upd')!.textContent).toBe('updated 10s ago');
    const b = container.querySelector<HTMLButtonElement>('.dh .rf button')!;
    expect(b.getAttribute('title')).toBe('Refresh this run');
    expect(b.textContent).toBe('↻');
    expect(b.nextElementSibling).toBeNull();
    expect(container.querySelector('.dh .rf')!.nextElementSibling!.className).toBe('x');
  });

  it('↻ refreshes the run, then refetches the open task log, keeping the old text meanwhile', async () => {
    const r = refresh();
    const { container } = render(<RunDrawer run={makeRealRun()} nowMs={0} loadedAt={0} onClose={() => {}} refresh={r} />);
    await waitFor(() => expect(container.querySelector('.logh span')!.textContent).toBe('3 lines, ends at the error'));
    expect(logCalls()).toBe(1);
    fireEvent.click(container.querySelector('.dh .rf button')!);
    expect(r.onRefresh).toHaveBeenCalledOnce();
    await waitFor(() => expect(logCalls()).toBe(2));
    expect(fetchMock.mock.calls.at(-1)![0]).toBe('/api/runs/7/log?task=transform&hint=Table+not+found');
    expect(container.querySelector('.logh span')!.textContent).toBe('3 lines, ends at the error');
  });

  it('spins while refreshing and says so quietly when the refresh failed', () => {
    const { container, rerender } = render(<RunDrawer run={makeRealRun()} nowMs={0} loadedAt={0} onClose={() => {}} refresh={refresh({ refreshing: true })} />);
    const b = container.querySelector<HTMLButtonElement>('.dh .rf button')!;
    expect(b.className).toBe('spin');
    expect(b.disabled).toBe(true);
    expect(container.querySelector('.rf-err')).toBeNull();
    rerender(<RunDrawer run={makeRealRun()} nowMs={0} loadedAt={0} onClose={() => {}} refresh={refresh({ error: 'Could not refresh the run: HTTP 502: busy' })} />);
    expect(b.className).toBe('');
    const err = container.querySelector('.dh .rf .rf-err')!;
    expect(err.textContent).toBe('refresh failed');
    expect(err.getAttribute('title')).toBe('Could not refresh the run: HTTP 502: busy');
  });

  it("refetches a live run's log whenever the page data refreshes", async () => {
    const run = makeRetryingRun();
    const { container, rerender } = render(<RunDrawer run={run} nowMs={0} loadedAt={0} onClose={() => {}} refresh={refresh()} />);
    await waitFor(() => expect(logCalls()).toBe(1));
    // Pick a task, so its log stays open once the run has finished.
    fireEvent.click(container.querySelectorAll('.gantt .grow')[0]);
    await waitFor(() => expect(logCalls()).toBe(2));
    fetchMock.mockClear();
    rerender(<RunDrawer run={{ ...run, durationSec: run.durationSec + 60 }} nowMs={60000} loadedAt={60000} onClose={() => {}} refresh={refresh()} />);
    await waitFor(() => expect(logCalls()).toBe(1));
    // The refresh that sees it finish fetches the final log once more; after that, nothing.
    const done = { ...run, live: false, kind: 'succeeded' as const, result: 'succeeded' as const };
    rerender(<RunDrawer run={done} nowMs={120000} loadedAt={120000} onClose={() => {}} refresh={refresh()} />);
    await waitFor(() => expect(logCalls()).toBe(2));
    rerender(<RunDrawer run={done} nowMs={180000} loadedAt={180000} onClose={() => {}} refresh={refresh()} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(logCalls()).toBe(2);
  });

  it("does not refetch a finished run's log when the page data refreshes", async () => {
    const { container, rerender } = render(<RunDrawer run={makeRealRun()} nowMs={0} loadedAt={0} onClose={() => {}} refresh={refresh()} />);
    await waitFor(() => expect(container.querySelector('.logh span')!.textContent).toBe('3 lines, ends at the error'));
    rerender(<RunDrawer run={makeRealRun()} nowMs={60000} loadedAt={60000} onClose={() => {}} refresh={refresh()} />);
    await new Promise((r) => setTimeout(r, 20));
    expect(logCalls()).toBe(1);
  });
});
