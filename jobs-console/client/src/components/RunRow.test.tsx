// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { RunRow } from './RunRow';
import { makeRun } from '../test/fixtures';

afterEach(cleanup);

const live = makeRun({ id: 40, kind: 'running', failed: [], live: true, result: null, ntasks: 10, durationSec: 600, usualSec: 1200, cause: { label: 'Running', code: '', detail: '' } });

describe('RunRow', () => {
  it('renders a finished failed run: full name, run as, average only, red border, no running parts', () => {
    const { container } = render(<RunRow run={makeRun()} nowMs={0} loadedAt={0} asOf={0} />);
    const row = container.querySelector('.rr')!;
    expect(row.className).toBe('rr');
    expect(container.querySelector('.rr-hist-boxes')).toBeNull();
    const toggle = container.querySelector('.rr-hist-t')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.querySelector('.rr-n')!.textContent).toBe('1');
    expect(toggle.querySelector('[data-c="20"]')).toBeNull(); // stats sit under the title, not in it
    expect(container.querySelector('.rr-hist > [data-c="20"]')!.textContent).toBe('1 failed');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(container.querySelector('[data-c="20"]')).toBeNull(); // the boxes replace them
    expect(row.className).not.toContain('live');
    expect(container.querySelector('[data-c="3"]')!.textContent).toBe('finance_gl_co_gl_journals_v3');
    expect(container.querySelector('[data-c="19"]')!.textContent).toBe('prod ');
    container.querySelector('[data-c="19"]')!.remove(); // the rest checks the left column is otherwise empty
    const l1 = [...container.querySelector('.rr-l1')!.children].map((c) => c.getAttribute('data-c'));
    expect(l1).toEqual(['2', '13', '3']);
    const main = [...container.querySelector('.rr-main')!.children].map((c) => c.getAttribute('data-c') ?? c.className);
    expect(main).toEqual([]);
    expect(container.querySelector('[data-c="13"]')!.className).toContain('rr-ra');
    expect(container.querySelector('[data-c="13"]')!.textContent).toBe('run as sp-finance');
    expect(container.querySelector('[data-c="9"]')).toBeNull();
    expect(container.textContent).not.toContain('took');
    expect(container.querySelector('[data-c="11"]')).toBeNull();
    expect(container.querySelector('.rr-hist-t [data-c="14"]')!.textContent).toBe('average 25m 52s');
    expect(container.textContent).toContain('25m 52s');
    expect(container.querySelector('[data-c="6"]')).toBeNull();
    expect(container.querySelector('[data-c="4"]')).toBeNull();
    expect(container.querySelector('[data-c="5"]')).toBeNull();
    expect(container.querySelector('.rr-park')).toBeNull();
    const cols = [...container.querySelector('.rr')!.children].map((c) => c.className);
    expect(cols).toEqual(['rr-l1', 'rr-main', 'rr-hist']);
    expect(container.querySelector('[data-c="10"]')).toBeNull();
    expect(container.textContent).not.toContain('failed 22 Sep');
    expect(container.querySelector('.rr-hist')!.textContent).toContain('Run history');
    expect(container.querySelectorAll('.rr-hist .rh')).toHaveLength(1);
    fireEvent.click(toggle);
    expect(container.querySelector('.rr-hist-boxes')).toBeNull();
  });

  it('draws one runtime box per finished run in the window, coloured by result, with runtime over start day/time', () => {
    const d = (day: number) => new Date(2026, 8, day, 5).getTime();
    const ok = makeRun({ id: 2, kind: 'succeeded', failed: [], result: 'succeeded', durationSec: 3900, startTime: d(19) });
    const cancelled = makeRun({ id: 4, kind: 'succeeded', failed: [], result: 'cancelled', durationSec: 42, startTime: d(20) });
    const partial = makeRun({ id: 5, kind: 'succeeded', failed: [], result: 'partial', durationSec: 600, startTime: d(21) });
    const cur = makeRun({ id: 3, startTime: d(22) });
    const { container } = render(<RunRow historyOpen run={cur} history={[ok, cancelled, partial, cur]} nowMs={0} loadedAt={0} asOf={0} />);
    const boxes = [...container.querySelectorAll('.rr-hist .rh')];
    expect(boxes.map((b) => b.querySelector('.rh-t')!.textContent)).toEqual(['1h05', '42s', '10m', '23m']);
    expect(boxes.map((b) => b.querySelector('.rh-w')!.textContent)).toEqual(['19/05:00', '20/05:00', '21/05:00', '22/05:00']);
    expect(boxes.map((b) => b.className)).toEqual(['rh succeeded', 'rh cancelled', 'rh partial', 'rh failed']);
    expect(container.querySelector('.rr-hist .rh-more')).toBeNull();
  });

  it('shows only the current-run box for a run still going when the job has no finished runs in the window', () => {
    const { container } = render(<RunRow historyOpen run={live} nowMs={0} loadedAt={0} asOf={0} />);
    expect(container.querySelectorAll('.rr-hist .rh')).toHaveLength(1);
    expect(container.querySelector('.rr-hist .rh.now')).not.toBeNull();
    expect(container.querySelector('.rr-hist')!.textContent).not.toContain('no finished runs in this window');
  });

  it('shows a dev target as a pill under the name, and none for an unprefixed prod job', () => {
    const { container } = render(<RunRow run={makeRun({ name: '[dev john smith] finance_gl_x' })} nowMs={0} loadedAt={0} asOf={0} />);
    expect(container.querySelector('.rr-name')!.textContent).toBe('finance_gl_x');
    const pill = container.querySelector('.rr-main .rr-tgt')!;
    expect(pill.textContent).toBe('dev john smith');
    expect(pill.querySelector('b')!.textContent).toBe('john smith');
    cleanup();
    const prod = render(<RunRow run={makeRun({ name: 'finance_gl_x' })} nowMs={0} loadedAt={0} asOf={0} />);
    expect(prod.container.querySelector('.rr-tgt')).toBeNull();
  });

  it('collapses runs beyond the box limit into an "earlier" chip', () => {
    const many = Array.from({ length: 30 }, (_, i) => makeRun({ id: 100 + i, kind: 'succeeded', failed: [], result: 'succeeded', startTime: i }));
    const { container } = render(<RunRow historyOpen run={many[29]} history={many} nowMs={0} loadedAt={0} asOf={0} />);
    expect(container.querySelectorAll('.rr-hist .rh')).toHaveLength(24);
    expect(container.querySelector('.rr-hist .rh-more')!.textContent).toBe('+6 earlier');
  });

  it('renders a running run: ticking big NOW, chain, live message, progress edge', () => {
    const { container } = render(<RunRow historyOpen run={live} nowMs={5000} loadedAt={0} asOf={0} />);
    const row = container.querySelector<HTMLElement>('.rr')!;
    expect(row.className).toContain('live');
    expect(container.querySelector('[data-c="9"]')!.textContent).toBe('10m 05s');
    expect(container.querySelector('[data-c="11"]')).toBeNull();
    expect(container.querySelector('.rr-run .rr-spin')).not.toBeNull();
    expect(container.querySelector('.rr-hist-t [data-c="14"]')).not.toBeNull();
    expect(container.querySelector('.rr-chain')).toBeNull();
    expect(container.querySelector('[data-c="8"]')).toBeNull();
    const now = container.querySelector('.rh.now')!;
    expect(now.textContent).toContain('5 of 10');
    expect(now.className).not.toContain('pick');
    expect(row.className).not.toContain('over');
  });

  it('marks an over-average live run and says how far past the average it is', () => {
    const { container } = render(<RunRow historyOpen run={live} nowMs={700_000} loadedAt={0} asOf={0} />);
    expect(container.querySelector('.rr')!.className).toContain('over');
    expect(container.querySelector('.rr-run-avg')!.textContent).toMatch(/^\+.+ over$/);
  });

  it('asks to open, stack (Ctrl or Cmd) or send to the comparison tab (Ctrl+Shift) the clicked run, and marks open runs', () => {
    const d = (day: number) => new Date(2026, 8, day, 5).getTime();
    const past = makeRun({ id: 7, kind: 'succeeded', failed: [], result: 'succeeded', startTime: d(21), ntasks: 4 });
    const onSelect = vi.fn();
    const onOpenRun = vi.fn();
    const { container, rerender } = render(<RunRow historyOpen run={live} history={[past]} nowMs={5000} loadedAt={0} asOf={0} onSelect={onSelect} onOpenRun={onOpenRun} />);
    const boxes = container.querySelectorAll<HTMLButtonElement>('.rr-hist .rh');
    expect(boxes).toHaveLength(2);
    fireEvent.click(boxes[0]);
    expect(onOpenRun).toHaveBeenLastCalledWith(7, 40, 'open');
    fireEvent.click(boxes[0], { ctrlKey: true });
    expect(onOpenRun).toHaveBeenLastCalledWith(7, 40, 'stack');
    fireEvent.click(boxes[0], { metaKey: true });
    expect(onOpenRun).toHaveBeenLastCalledWith(7, 40, 'stack');
    fireEvent.click(boxes[0], { ctrlKey: true, shiftKey: true });
    expect(onOpenRun).toHaveBeenLastCalledWith(7, 40, 'tab');
    expect(onSelect).not.toHaveBeenCalled();
    fireEvent.click(container.querySelector('.rh.now')!);
    expect(onOpenRun).toHaveBeenLastCalledWith(40, 40, 'open');
    expect(container.querySelector('.pick')).toBeNull();
    rerender(<RunRow historyOpen run={live} history={[past]} nowMs={5000} loadedAt={0} asOf={0} openRuns={[7, 40]} onOpenRun={onOpenRun} />);
    expect(boxes[0].className).toContain('pick');
    expect(container.querySelector('.rh.now')!.className).toContain('pick');
    expect(container.querySelector('.rh-pop')).toBeNull();
  });

  it('collapses to just the name in compact mode', () => {
    const onSelect = vi.fn();
    const { container } = render(<RunRow historyOpen run={live} nowMs={5000} loadedAt={0} asOf={0} onSelect={onSelect} compact />);
    const row = container.querySelector('.rr')!;
    expect(row.className).toBe('rr compact');
    expect(row.children).toHaveLength(1);
    expect(row.textContent).toBe(live.name);
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(live.id);
  });
});

describe('RunRow title link', () => {
  it('links the title to the run in Databricks only when the run has a url, without selecting the row', () => {
    const onSelect = vi.fn();
    const { container } = render(<RunRow run={makeRun({ url: 'https://x.cloud.databricks.us/jobs/2/runs/7' })} nowMs={0} loadedAt={0} asOf={0} onSelect={onSelect} />);
    const a = container.querySelector<HTMLAnchorElement>('[data-c="3"] a')!;
    expect(a.getAttribute('href')).toBe('https://x.cloud.databricks.us/jobs/2/runs/7');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    expect(a.getAttribute('title')).toBe('Open in Databricks');
    expect(a.textContent).toBe('finance_gl_co_gl_journals_v3');
    a.addEventListener('click', (e) => e.preventDefault()); // jsdom cannot open the tab
    fireEvent.click(a);
    expect(onSelect).not.toHaveBeenCalled();
    cleanup();
    const plain = render(<RunRow run={makeRun()} nowMs={0} loadedAt={0} asOf={0} />).container;
    expect(plain.querySelector('[data-c="3"] a')).toBeNull();
    expect(plain.querySelector('[data-c="3"]')!.textContent).toBe('finance_gl_co_gl_journals_v3');
  });
});
