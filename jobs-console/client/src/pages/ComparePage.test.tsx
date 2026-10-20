// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { ComparePage } from './ComparePage';
import { makeRun } from '../test/fixtures';
import type { RunsResponse } from '../../../shared/domain/types';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
});

const data: RunsResponse = {
  asOf: new Date(2026, 8, 22, 8).getTime(),
  source: 'mock',
  runs: [
    makeRun({ id: 1, startTime: new Date(2026, 8, 22, 5).getTime() }),
    makeRun({ id: 2, kind: 'succeeded', failed: [], result: 'succeeded', startTime: new Date(2026, 8, 21, 5).getTime() }),
  ],
};

describe('ComparePage', () => {
  it('shows the runs named in ?compare= and drops one from the URL with its ×', async () => {
    window.history.replaceState(null, '', '/?compare=1,2');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(data) })));
    const { container } = render(<ComparePage />);
    await waitFor(() => expect(container.querySelectorAll('.cmpv .chip')).toHaveLength(2));
    expect(container.querySelector('.cmpv .add')!.textContent).toContain('Ctrl+Shift+click');
    expect(container.querySelector('.cmpv .cmp-h .x')).toBeNull();
    fireEvent.click(container.querySelectorAll('.cmpv .chip .cx')[0]);
    expect(window.location.search).toBe('?compare=1');
    expect(container.querySelectorAll('.cmpv .chip')).toHaveLength(1);
    const pool = container.querySelectorAll<HTMLButtonElement>('.cmpv .pool .rh');
    expect([...pool].map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true']);
    fireEvent.click(pool[0]);
    expect(window.location.search).toBe('?compare=1,2');
  });

  it('keeps ?env when it writes ?compare=', async () => {
    window.history.replaceState(null, '', '/?env=prod&compare=1,2');
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve({ ok: true, json: () => Promise.resolve(data) })));
    const { container } = render(<ComparePage />);
    await waitFor(() => expect(container.querySelectorAll('.cmpv .chip')).toHaveLength(2));
    fireEvent.click(container.querySelectorAll('.cmpv .chip .cx')[0]);
    expect(window.location.search).toBe('?compare=1&env=prod');
  });
});
