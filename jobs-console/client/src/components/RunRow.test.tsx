// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { RunRow } from './RunRow';
import { makeRun } from '../test/fixtures';

afterEach(cleanup);

const live = makeRun({ id: 40, kind: 'running', failed: [], live: true, ntasks: 10, durationSec: 600, usualSec: 1200, cause: { label: 'Running', code: '', detail: '' } });

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

  it('draws one runtime box per run of this job in the window, oldest first, current run marked', () => {
    const prev = makeRun({ id: 2, kind: 'succeeded', failed: [], durationSec: 3900, startTime: 1 });
    const cur = makeRun({ id: 3, startTime: 2 });
    const { container } = render(<RunRow run={cur} history={[prev, cur]} nowMs={0} loadedAt={0} asOf={0} />);
    const boxes = [...container.querySelectorAll('.rr-hist .rh')];
    expect(boxes.map((b) => b.textContent)).toEqual(['1h05', '23m']);
    expect(boxes.map((b) => b.className)).toEqual(['rh succeeded', 'rh failed cur']);
    expect(container.querySelector('.rr-hist .rh-more')).toBeNull();
  });

  it('collapses runs beyond the box limit into an "earlier" chip', () => {
    const many = Array.from({ length: 30 }, (_, i) => makeRun({ id: 100 + i, kind: 'succeeded', failed: [], startTime: i }));
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
