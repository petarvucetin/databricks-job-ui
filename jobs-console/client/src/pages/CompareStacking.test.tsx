// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { AttentionView } from './AttentionView';
import { makeRun } from '../test/fixtures';
import type { RunsResponse } from '../../../shared/domain/types';

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve({ text: 'log' }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const at = (day: number, h: number) => new Date(2026, 8, day, h).getTime();
const data: RunsResponse = {
  asOf: at(22, 8),
  source: 'mock',
  runs: [
    makeRun({ id: 1, startTime: at(22, 5) }),
    makeRun({ id: 2, kind: 'succeeded', failed: [], result: 'succeeded', startTime: at(21, 5), ntasks: 12, params: { date: '2026-09-21', catalog: 'finance', mode: 'full', batch_size: '50000' } }),
    makeRun({ id: 3, kind: 'running', failed: [], live: true, result: null, startTime: at(22, 7), durationSec: 600, usualSec: 1200 }),
    makeRun({ id: 5, name: '[prod] other_job', startTime: at(22, 6) }),
  ],
};
/** The row's history boxes, opening its Run history first if it is hidden. */
const boxes = (c: HTMLElement, row: number) => {
  const t = c.querySelector(`.rl .rr[data-id="${row}"] .rr-hist-t`);
  if (t?.getAttribute('aria-expanded') === 'false') fireEvent.click(t);
  return [...c.querySelectorAll<HTMLButtonElement>(`.rl .rr[data-id="${row}"] .rh`)];
};
const chips = (c: HTMLElement) => [...c.querySelectorAll('.cmpv .chip b')].map((b) => b.textContent);

describe('comparing runs', () => {
  it('Ctrl+click stacks runs of the job into the comparison; a plain click goes back to one run', () => {
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    const [older, newer, now] = boxes(container, 3);
    fireEvent.click(newer);
    expect(container.querySelector('.dr .route')).not.toBeNull();
    expect(container.querySelector('.cmpv')).toBeNull();
    fireEvent.click(older, { ctrlKey: true });
    expect(chips(container)).toEqual(['succeeded', 'failed']);
    fireEvent.click(now, { metaKey: true });
    expect(chips(container)).toEqual(['succeeded', 'failed', 'running']);
    expect(boxes(container, 3).every((b) => b.className.includes('pick'))).toBe(true);
    const params = [...container.querySelectorAll('.cmpv .prm')].map((r) => [...r.children].map((c) => c.textContent).slice(0, 4));
    expect(params).toEqual([
      ['date', '2026-09-21', '2026-09-22', '2026-09-22'],
      ['catalog', 'finance', 'finance', 'finance'],
      ['mode', 'full', 'incremental', 'incremental'],
      ['batch_size', '50000', 'not set', 'not set'],
    ]);
    fireEvent.click(container.querySelectorAll('.cmpv .chip .cx')[2]);
    expect(chips(container)).toEqual(['succeeded', 'failed']);
    fireEvent.click(container.querySelectorAll('.cmpv .chip .cx')[0]);
    expect(container.querySelector('.cmpv')).toBeNull();
    expect(container.querySelector('.dr .dh .when')!.textContent).toContain('failed');
    fireEvent.click(older, { ctrlKey: true });
    fireEvent.click(now);
    expect(container.querySelector('.cmpv')).toBeNull();
    expect(container.querySelector('.dr .dh .when')!.textContent).toContain('started');
  });

  it("starts a new comparison when a run of another job is Ctrl+clicked, and closes on Escape", () => {
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    const [older, newer] = boxes(container, 3);
    fireEvent.click(older);
    fireEvent.click(newer, { ctrlKey: true });
    expect(chips(container)).toHaveLength(2);
    fireEvent.click(boxes(container, 5)[0], { ctrlKey: true });
    expect(container.querySelector('.cmpv')).toBeNull();
    expect(container.querySelector('.dr .dh .title')!.textContent).toBe('[prod] other_job');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.dr')).toBeNull();
  });

  it('Ctrl+Shift+click sends runs to one comparison tab, adding to what that tab already shows', () => {
    const tab = { closed: false, location: { search: '' } };
    const open = vi.fn((url: string) => {
      tab.location.search = url.slice(1);
      return tab;
    });
    vi.stubGlobal('open', open);
    const { container } = render(<AttentionView data={data} loadedAt={Date.now()} />);
    const [older, newer] = boxes(container, 3);
    fireEvent.click(older, { ctrlKey: true, shiftKey: true });
    expect(open).toHaveBeenLastCalledWith('/?compare=2', 'jobs-console-compare');
    fireEvent.click(newer, { ctrlKey: true, shiftKey: true });
    expect(open).toHaveBeenLastCalledWith('/?compare=2,1', 'jobs-console-compare');
    tab.location.search = '?compare=1'; // the tab dropped a run with its ×
    fireEvent.click(older, { ctrlKey: true, shiftKey: true });
    expect(open).toHaveBeenLastCalledWith('/?compare=1,2', 'jobs-console-compare');
    tab.closed = true;
    fireEvent.click(newer, { ctrlKey: true, shiftKey: true });
    expect(open).toHaveBeenLastCalledWith('/?compare=1', 'jobs-console-compare');
    expect(container.querySelector('.dr')).toBeNull();
  });
});
