// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RunRow } from './RunRow';
import { makeRun } from '../test/fixtures';

afterEach(cleanup);

const live = makeRun({ id: 40, kind: 'running', failed: [], live: true, result: null, ntasks: 10, durationSec: 600, usualSec: 1200, cause: { label: 'Running', code: '', detail: '' } });

describe('RunRow', () => {
  it('renders a finished failed run: full name, run as, took + average, red border, no running parts', () => {
    const { container } = render(<RunRow run={makeRun()} nowMs={0} loadedAt={0} asOf={0} />);
    const row = container.querySelector('.rr')!;
    expect(row.className).toContain('b-red');
    expect(row.className).not.toContain('live');
    expect(container.querySelector('[data-c="3"]')!.textContent).toBe('[prod] finance_gl_co_gl_journals_v3');
    const l1 = [...container.querySelector('.rr-l1')!.children].map((c) => c.getAttribute('data-c'));
    expect(l1).toEqual(['2', '13', '3']);
    expect(container.querySelector('[data-c="13"]')!.className).toContain('rr-ra');
    expect(container.querySelector('[data-c="13"]')!.textContent).toBe('run as sp-finance');
    expect(container.querySelector('[data-c="9"]')!.textContent).toBe('23m 24s');
    expect(container.textContent).toContain('took');
    expect(container.textContent).toContain('25m 52s');
    expect(container.querySelector('[data-c="6"]')).toBeNull();
    expect(container.querySelector('[data-c="4"]')!.textContent).toBe('Cluster error');
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
    expect(boxes.map((b) => b.className)).toEqual(['rh succeeded', 'rh cancelled', 'rh partial', 'rh failed cur']);
    expect(container.querySelector('.rr-hist .rh-more')).toBeNull();
  });

  it('shows no boxes for a run still going when the job has no finished runs in the window', () => {
    const { container } = render(<RunRow run={live} nowMs={0} loadedAt={0} asOf={0} />);
    expect(container.querySelectorAll('.rr-hist .rh')).toHaveLength(0);
    expect(container.querySelector('.rr-hist')!.textContent).toContain('no finished runs in this window');
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
    expect(container.querySelector('.rr-now')).not.toBeNull();
    expect(container.querySelectorAll('[data-c="6"] i')).toHaveLength(10);
    expect(container.querySelector('[data-c="7"]')!.textContent).toBe('5 ok, 1 running, 4 to go');
    expect(container.querySelector('[data-c="8"]')!.textContent).toContain('load_gl running');
    expect(container.querySelector('.rr-bar')).not.toBeNull();
    expect(container.querySelector('.rr-avg')).toBeNull();
  });

  it('marks an over-average live run with stripes and the average tick', () => {
    const { container } = render(<RunRow run={live} nowMs={700_000} loadedAt={0} asOf={0} />);
    expect(container.querySelector('.rr')!.className).toContain('over');
    expect(container.querySelector('.rr-avg')).not.toBeNull();
  });
});
