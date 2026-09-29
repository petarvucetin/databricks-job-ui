// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { AttentionView } from './AttentionView';
import { AttentionPage } from './AttentionPage';
import { makeRun } from '../test/fixtures';
import type { RunsResponse } from '../../../shared/domain/types';

beforeEach(() => localStorage.clear());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const asOf = new Date(2026, 8, 22, 8).getTime();
const data: RunsResponse = {
  asOf,
  source: 'mock',
  runs: [
    makeRun({ id: 1, startTime: new Date(2026, 8, 22, 5).getTime() }),
    makeRun({ id: 2, kind: 'succeeded', failed: [], cause: { label: 'Succeeded', code: '', detail: '' }, startTime: new Date(2026, 8, 21, 5).getTime() }),
    makeRun({ id: 3, kind: 'running', failed: [], live: true, cause: { label: 'Running', code: '', detail: '' }, startTime: new Date(2026, 8, 22, 7).getTime(), durationSec: 600, usualSec: 1200 }),
    makeRun({ id: 4, startTime: new Date(2026, 7, 30, 5).getTime() }),
  ],
};

describe('AttentionView', () => {
  it('shows the default view: last 2 days, tiles with counts, rows sorted by status', () => {
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    expect(container.querySelectorAll('.tile')).toHaveLength(6);
    expect(screen.getByRole('button', { name: /^1\s*Failed/ })).toBeTruthy();
    expect([...container.querySelectorAll('.rl .rr')].map((r) => r.getAttribute('data-id'))).toEqual(['3', '1', '2']);
  });

  it('filters to running runs with the Running now toggle', () => {
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    fireEvent.click(screen.getByRole('button', { name: /Running now/ }));
    expect([...container.querySelectorAll('.rl .rr')].map((r) => r.getAttribute('data-id'))).toEqual(['3']);
  });

  it('says so when nothing matches, and hides the reference block', () => {
    localStorage.setItem('jobs-console:labels', '1');
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    expect(container.querySelector('.ref')).not.toBeNull();
    fireEvent.change(screen.getByPlaceholderText('search job, task, run id, cause, error'), { target: { value: 'zzzz-no-match' } });
    expect(screen.getByText('Nothing matches these filters.')).toBeTruthy();
    expect(container.querySelector('.ref')).toBeNull();
    for (const b of container.querySelectorAll('.tile b')) expect(b.textContent).toBe('0');
  });

  it('shows reference labels by default and toggles them with the L key', () => {
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    expect(container.querySelector('.ref')).not.toBeNull();
    expect(container.querySelectorAll('.ref .rr')).toHaveLength(2);
    fireEvent.keyDown(document, { key: 'l' });
    expect(container.querySelector('.ref')).toBeNull();
    expect(localStorage.getItem('jobs-console:labels')).toBe('0');
    fireEvent.keyDown(document, { key: 'l' });
    expect(container.querySelector('.ref')).not.toBeNull();
    expect(localStorage.getItem('jobs-console:labels')).toBe('1');
  });

  it('collapses list rows to just the name with the C key, leaving the reference rows full', () => {
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    expect(container.querySelectorAll('.rl .rr.compact')).toHaveLength(0);
    fireEvent.keyDown(document, { key: 'c' });
    const rows = container.querySelectorAll('.rl .rr');
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) expect(r.className).toContain('compact');
    expect(container.querySelectorAll('.ref .rr.compact')).toHaveLength(0);
    expect(localStorage.getItem('jobs-console:compact-rows')).toBe('1');
    fireEvent.keyDown(document, { key: 'c' });
    expect(container.querySelectorAll('.rl .rr.compact')).toHaveLength(0);
  });

  it('remembers hidden labels', () => {
    localStorage.setItem('jobs-console:labels', '0');
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    expect(container.querySelector('.ref')).toBeNull();
  });

  it('ignores a Ctrl+L press so the reference block stays as it is', () => {
    localStorage.setItem('jobs-console:labels', '0');
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    expect(container.querySelector('.ref')).toBeNull();
    fireEvent.keyDown(document, { key: 'l', ctrlKey: true });
    expect(container.querySelector('.ref')).toBeNull();
  });
});

describe('AttentionPage', () => {
  it('shows an error with a retry button when the API fails', async () => {
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('x', { status: 503 }))));
    render(<AttentionPage />);
    expect(await screen.findByText('Could not load runs: HTTP 503')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
});

describe('the drawer follows the data', () => {
  const log = () => Promise.resolve(new Response(JSON.stringify({ text: 'log' }), { status: 200 }));
  /** Opens run 3 (running) from its row's history boxes. */
  const openRunning = (c: HTMLElement) => {
    const t = c.querySelector('.rl .rr[data-id="3"] .rr-hist-t');
    if (t?.getAttribute('aria-expanded') === 'false') fireEvent.click(t);
    const boxes = [...c.querySelectorAll<HTMLButtonElement>('.rl .rr[data-id="3"] .rh')];
    fireEvent.click(boxes[boxes.length - 1]);
  };
  const live = { ...data, runs: data.runs.map((r) => (r.id === 3 ? { ...r, result: null } : r)) };
  const finished = { ...data.runs[2], kind: 'succeeded' as const, live: false, result: 'succeeded' as const, cause: { label: 'Succeeded', code: '', detail: '' }, durationSec: 900 };

  it('shows the updated run after the page data changes', () => {
    vi.stubGlobal('fetch', vi.fn(log));
    const { container, rerender } = render(<AttentionView data={live} loadedAt={Date.now()} />);
    openRunning(container);
    expect(container.querySelector('.dr .panel.last .hd .v')!.textContent).toBe('Running, on track');
    rerender(<AttentionView data={{ ...data, runs: [data.runs[0], data.runs[1], finished, data.runs[3]] }} loadedAt={Date.now()} />);
    expect(container.querySelector('.dr .panel.last .hd .v')!.textContent).toBe('Succeeded');
    expect(container.querySelector('.dr .dh .when')!.textContent).toMatch(/15m 00s$/);
  });

  it('↻ in the drawer fetches the run and shows it in the drawer and its row', async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.startsWith('/api/runs?')) return Promise.resolve(new Response(JSON.stringify(live), { status: 200 }));
      if (url.startsWith('/api/runs/3?')) return Promise.resolve(new Response(JSON.stringify(finished), { status: 200 }));
      return log();
    });
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<AttentionPage />);
    await waitFor(() => expect(container.querySelector('.rl .rr[data-id="3"]')).not.toBeNull());
    openRunning(container);
    expect(container.querySelector('.dr .panel.last .hd .v')!.textContent).toBe('Running, on track');
    expect(container.querySelector('.rl .rr[data-id="3"] .rr-spin')).not.toBeNull();
    expect(container.querySelector('.dr .dh .rf .upd')!.textContent).toMatch(/^updated \d+s ago$/);
    fireEvent.click(screen.getByRole('button', { name: 'Refresh this run' }));
    await waitFor(() => expect(container.querySelector('.dr .panel.last .hd .v')!.textContent).toBe('Succeeded'));
    expect(fetchMock.mock.calls.some(([u]) => /^\/api\/runs\/3\?tzOffset=/.test(u))).toBe(true);
    expect(container.querySelector('.rl .rr[data-id="3"] .rr-spin')).toBeNull();
  });
});
