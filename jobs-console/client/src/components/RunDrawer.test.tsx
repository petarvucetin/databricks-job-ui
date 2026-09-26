// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { RunDrawer } from './RunDrawer';
import { makeRun } from '../test/fixtures';

afterEach(cleanup);

describe('RunDrawer', () => {
  it('shows the run header, meta line and one line per task, with the failed task carrying its cause', () => {
    const { container } = render(<RunDrawer run={makeRun()} nowMs={0} loadedAt={0} onClose={() => {}} />);
    expect(container.querySelector('.dr-name')!.textContent).toBe('[prod] finance_gl_co_gl_journals_v3');
    expect(container.querySelector('.dr-name i')!.textContent).toBe('[prod] ');
    const meta = container.querySelector('.dr-meta')!;
    expect(meta.querySelector('.dr-r')!.textContent).toBe('failed');
    expect(meta.textContent).toContain('23m 24s');
    expect(meta.textContent).toContain('average 25m 52s');
    expect(meta.textContent).toContain('run as sp-finance');
    expect(container.querySelector('.dr-sec em')!.textContent).toBe('5 ok, 1 failed, 4 skipped');
    const lines = container.querySelectorAll('.dr-t');
    expect(lines).toHaveLength(10);
    const failed = container.querySelector('.dr-t.f')!;
    expect(failed.querySelector('.dr-tn')!.textContent).toBe('load_gl');
    expect(failed.querySelector('.dr-ts')!.textContent).toBe('Cluster error');
    expect(failed.querySelector('code')!.textContent).toBe('CLOUD_FAILURE');
    expect(lines[0].querySelector('.dr-ts')!.textContent).toBe('succeeded');
  });

  it('ticks a live run and labels it running now', () => {
    const run = makeRun({ kind: 'running', failed: [], live: true, result: null, durationSec: 600, usualSec: 1200 });
    const { container } = render(<RunDrawer run={run} nowMs={5000} loadedAt={0} onClose={() => {}} />);
    expect(container.querySelector('.dr-r')!.textContent).toBe('running now');
    expect(container.querySelector('.dr-meta')!.textContent).toContain('10m 05s');
    expect(container.querySelectorAll('.dr-t.r')).toHaveLength(1);
  });

  it('closes on Escape, the scrim and the close button', () => {
    const onClose = vi.fn();
    const { container } = render(<RunDrawer run={makeRun()} nowMs={0} loadedAt={0} onClose={onClose} />);
    expect(document.activeElement).toBe(container.querySelector('.dr-x'));
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(container.querySelector('.dr-scrim')!);
    fireEvent.click(container.querySelector('.dr-x')!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
