// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
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
    expect(container.querySelectorAll('.tile')).toHaveLength(7);
    expect(screen.getByRole('button', { name: /^1\s*Failed/ })).toBeTruthy();
    expect([...container.querySelectorAll('.rl .rr')].map((r) => r.getAttribute('data-id'))).toEqual(['1', '3', '2']);
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

  it('toggles reference labels with the L key', () => {
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    expect(container.querySelector('.ref')).toBeNull();
    fireEvent.keyDown(document, { key: 'l' });
    expect(container.querySelector('.ref')).not.toBeNull();
    expect(container.querySelectorAll('.ref .rr')).toHaveLength(2);
    expect(localStorage.getItem('jobs-console:labels')).toBe('1');
  });

  it('ignores a Ctrl+L press so the reference block stays hidden', () => {
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
