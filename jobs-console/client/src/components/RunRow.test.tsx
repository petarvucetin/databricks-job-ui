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
    expect(row.className).toContain('b-red');
    expect(row.className).not.toContain('live');
    expect(container.querySelector('[data-c="3"]')!.textContent).toBe('[prod] finance_gl_co_gl_journals_v3');
    const l1 = [...container.querySelector('.rr-l1')!.children].map((c) => c.getAttribute('data-c'));
    expect(l1).toEqual(['2', '13']);
    const main = [...container.querySelector('.rr-main')!.children].map((c) => c.getAttribute('data-c') ?? c.className);
    expect(main).toEqual(['rr-l1', '3']);
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
    expect(cols).toEqual(['rr-main', 'rr-hist']);
    expect(container.querySelector('[data-c="10"]')).toBeNull();
    expect(container.textContent).not.toContain('failed 22 Sep');
    expect(container.querySelector('.rr-hist')!.textContent).toContain('Run history');
    expect(container.querySelectorAll('.rr-hist .rh')).toHaveLength(1);
  });

  it('draws one runtime box per finished run in the window, coloured by result, with runtime over start day/time', () => {
    const d = (day: number) => new Date(2026, 8, day, 5).getTime();
    const ok = makeRun({ id: 2, kind: 'succeeded', failed: [], result: 'succeeded', durationSec: 3900, startTime: d(19) });
    const cancelled = makeRun({ id: 4, kind: 'succeeded', failed: [], result: 'cancelled', durationSec: 42, startTime: d(20) });
    const partial = makeRun({ id: 5, kind: 'succeeded', failed: [], result: 'partial', durationSec: 600, startTime: d(21) });
    const cur = makeRun({ id: 3, startTime: d(22) });
    const { container } = render(<RunRow run={cur} history={[ok, cancelled, partial, cur]} nowMs={0} loadedAt={0} asOf={0} />);
    const boxes = [...container.querySelectorAll('.rr-hist .rh')];
    expect(boxes.map((b) => b.querySelector('.rh-t')!.textContent)).toEqual(['1h05', '42s', '10m', '23m']);
    expect(boxes.map((b) => b.querySelector('.rh-w')!.textContent)).toEqual(['19/05:00', '20/05:00', '21/05:00', '22/05:00']);
    expect(boxes.map((b) => b.className)).toEqual(['rh succeeded', 'rh cancelled', 'rh partial', 'rh failed']);
    expect(container.querySelector('.rr-hist .rh-more')).toBeNull();
  });

  it('shows only the current-run box for a run still going when the job has no finished runs in the window', () => {
    const { container } = render(<RunRow run={live} nowMs={0} loadedAt={0} asOf={0} />);
    expect(container.querySelectorAll('.rr-hist .rh')).toHaveLength(1);
    expect(container.querySelector('.rr-hist .rh.now')).not.toBeNull();
    expect(container.querySelector('.rr-hist')!.textContent).not.toContain('no finished runs in this window');
  });

  it('collapses runs beyond the box limit into an "earlier" chip', () => {
    const many = Array.from({ length: 30 }, (_, i) => makeRun({ id: 100 + i, kind: 'succeeded', failed: [], result: 'succeeded', startTime: i }));
    const { container } = render(<RunRow run={many[29]} history={many} nowMs={0} loadedAt={0} asOf={0} />);
    expect(container.querySelectorAll('.rr-hist .rh')).toHaveLength(24);
    expect(container.querySelector('.rr-hist .rh-more')!.textContent).toBe('+6 earlier');
  });

  it('renders a running run: ticking big NOW, chain, live message, progress edge', () => {
    const { container } = render(<RunRow run={live} nowMs={5000} loadedAt={0} asOf={0} />);
    const row = container.querySelector<HTMLElement>('.rr')!;
    expect(row.className).toContain('b-blue');
    expect(row.className).toContain('live');
    expect(row.style.getPropertyValue('--p')).toBe('0.504');
    expect(container.querySelector('[data-c="9"]')!.textContent).toBe('10m 05s');
    expect(container.querySelector('[data-c="11"]')).toBeNull();
    expect(container.querySelector('.rr-bar [data-c="9"]')).not.toBeNull();
    expect(row.className).toContain('bar-job');
    expect(container.querySelector('.rr-hist-t [data-c="14"]')).not.toBeNull();
    expect(container.querySelector('.rr-chain')).toBeNull();
    expect(container.querySelector('[data-c="8"]')).toBeNull();
    const now = container.querySelector('.rh.now')!;
    expect(now.textContent).toContain('5 of 10');
    expect(now.className).not.toContain('pick');
    expect(container.querySelector('.rr-bar')).not.toBeNull();
    expect(container.querySelector('.rr-avg')).toBeNull();
  });

  it('marks an over-average live run with a full solid bar and the average tick', () => {
    const { container } = render(<RunRow run={live} nowMs={700_000} loadedAt={0} asOf={0} />);
    expect(container.querySelector('.rr')!.className).toContain('over');
    expect(container.querySelector('.rr-avg')).not.toBeNull();
  });

  it("opens a popup with that run's task boxes under the clicked history box, without selecting the row", () => {
    const d = (day: number) => new Date(2026, 8, day, 5).getTime();
    const past = makeRun({ id: 7, kind: 'succeeded', failed: [], result: 'succeeded', startTime: d(21), ntasks: 4 });
    const onSelect = vi.fn();
    const { container } = render(<RunRow run={live} history={[past]} nowMs={5000} loadedAt={0} asOf={0} onSelect={onSelect} />);
    const boxes = container.querySelectorAll<HTMLButtonElement>('.rr-hist .rh');
    expect(boxes).toHaveLength(2);
    expect(container.querySelector('.rh-pop')).toBeNull();
    fireEvent.click(boxes[0]);
    expect(onSelect).not.toHaveBeenCalled();
    const pop = boxes[0].parentElement!.querySelector('.rh-pop')!;
    expect(pop.querySelectorAll('.rr-chain i')).toHaveLength(4);
    expect(pop.textContent).not.toContain('all ok');
    expect(pop.textContent).toContain('succeeded');
    expect(boxes[0].className).toContain('pick');
    fireEvent.mouseEnter(pop.querySelectorAll('.rr-chain i')[2]);
    expect(pop.querySelector('.rr-task')!.textContent).toBe('extract_bseg');
    expect(pop.querySelector('.rr-task')!.nextElementSibling!.className).toBe('rr-chain');
    fireEvent.click(boxes[0]);
    expect(container.querySelector('.rh-pop')).toBeNull();
  });

  it('closes the popup on Escape and on a click outside, and opens one for the current run too', () => {
    const { container } = render(<RunRow run={live} nowMs={5000} loadedAt={0} asOf={0} />);
    const now = container.querySelector<HTMLButtonElement>('.rh.now')!;
    fireEvent.click(now);
    expect(container.querySelector('.rh-pop')!.textContent).toContain('running now');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(container.querySelector('.rh-pop')).toBeNull();
    fireEvent.click(now);
    fireEvent.pointerDown(document.body);
    expect(container.querySelector('.rh-pop')).toBeNull();
  });

  it("shows the current run's chain and count in its popup, with only the hovered task name above the chain", () => {
    const { container } = render(<RunRow run={live} nowMs={5000} loadedAt={0} asOf={0} />);
    fireEvent.click(container.querySelector('.rh.now')!);
    const pop = container.querySelector('.rh-pop')!;
    expect(pop.querySelectorAll('.rr-chain i')).toHaveLength(10);
    expect(pop.querySelector('.rr-chain em')!.textContent).toBe('5 ok, 1 running, 4 to go');
    expect(pop.querySelector('.rr-task')!.textContent.trim()).toBe('');
    fireEvent.mouseEnter(pop.querySelectorAll('.rr-chain i')[3]);
    expect(pop.querySelector('.rr-task')!.textContent).toBe('extract_gl');
    fireEvent.mouseLeave(pop.querySelector('.rr-chain')!);
    expect(pop.querySelector('.rr-task')!.textContent.trim()).toBe('');
  });
});
