// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Profiler } from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import type { Item } from '../../../shared/domain/types';
import { LoadView } from './LoadView';
import { linkStarters } from '../model/items';

// ItemRow counts its renders; ViewSwitch stays real.
const rowRendered = vi.hoisted(() => vi.fn());
vi.mock('./ItemList', async (importOriginal) => {
  const real = await importOriginal<typeof import('./ItemList')>();
  const { memo } = await import('react');
  return {
    ...real,
    ItemRow: memo(function CountedRow(props: Parameters<typeof real.ItemRow>[0]) {
      rowRendered();
      return <real.ItemRow {...props} />;
    }),
  };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const FROM = Date.UTC(2026, 9, 6, 16);
const base = (over: Partial<Item>): Item => ({ type: 'job', id: '1', name: 'x', deployed: false, mine: false, tags: {}, trigger: 'manual', paused: false, bundle: false, ...over });
const ITEMS: Item[] = [
  base({ id: 'e', name: 'every_five', trigger: 'schedule', schedule: { cron: '0 0/5 * * * ?', tz: 'UTC', paused: false } }),
  base({ id: '2', name: 'daily', trigger: 'schedule', schedule: { cron: '0 0 2 * * ?', tz: 'UTC', paused: false } }),
];
const rect = (width: number) => ({ left: 0, top: 0, right: width, bottom: 100, width, height: 100, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;

describe('LoadView hover', () => {
  it('moving within one sample commits nothing and only moves the tooltip; the rows never re-render on hover', () => {
    // the plot is 1000px wide (24h in 288 five-minute samples), other boxes are empty
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return rect(this.classList.contains('ld-plot') ? 1000 : 0);
    });
    let commits = 0;
    const onSelect = () => {};
    const onView = () => {};
    render(
      <Profiler id="load" onRender={() => commits++}>
        <LoadView items={ITEMS} runs={[]} from={FROM} to={FROM + 24 * 3600e3} now={FROM} scale="hour" selected={null} onSelect={onSelect} view="load" onView={onView} />
      </Profiler>,
    );
    expect(document.querySelectorAll('.ir')).toHaveLength(2);
    const rowsAfterMount = rowRendered.mock.calls.length;
    const plot = document.querySelector('.ld-plot')!;

    fireEvent.mouseMove(plot, { clientX: 100, clientY: 50 });
    const tip = document.querySelector<HTMLElement>('.tip')!;
    expect(tip.style.left).toBe('114px');
    const commitsAfterFirst = commits;

    // 100px and 101px are the same sample (i = 29): no commit, the tooltip still follows
    fireEvent.mouseMove(plot, { clientX: 101, clientY: 60 });
    expect(commits).toBe(commitsAfterFirst);
    expect(document.querySelector('.tip')).toBe(tip);
    expect(tip.style.left).toBe('115px');
    expect(tip.style.top).toBe('76px');

    // another sample re-renders the chart, not the rows
    fireEvent.mouseMove(plot, { clientX: 500, clientY: 60 });
    expect(commits).toBe(commitsAfterFirst + 1);
    expect(rowRendered).toHaveBeenCalledTimes(rowsAfterMount);
  });
});

describe('LoadView: jobs and pipelines stacked, continuous pipelines, items not on the chart', () => {
  const DAY = 24 * 3600e3;
  const every5 = base({ id: 'e', name: 'every_five', trigger: 'schedule', schedule: { cron: '0 0/5 * * * ?', tz: 'UTC', paused: false } });
  const credited = base({ id: 'p', type: 'pipeline', name: 'silver_merge', startedBy: [{ jobId: 'e', jobName: 'every_five' }] });
  const cont = base({ id: 'c', type: 'pipeline', name: 'raw_bronze_stream', trigger: 'continuous' });
  const manual = base({ id: 'm', name: 'adhoc_backfill' });
  const show = (items: Item[]) => {
    linkStarters(items);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      return rect(this.classList.contains('ld-plot') ? 1000 : 0);
    });
    return render(<LoadView items={items} runs={[]} from={FROM} to={FROM + DAY} now={FROM} scale="hour" selected={null} onSelect={() => {}} view="load" onView={() => {}} />);
  };
  const ids = () => [...document.querySelectorAll('.ld-list > .ir, .ld-list > .ld-off')].map((r) => r.getAttribute('data-id') ?? 'OFF');
  const right = (id: string) => document.querySelector(`.ir[data-id="${id}"] .ld-offr, .ir[data-id="${id}"] .starts`)!.textContent;

  it('two bands, the key, the header and the tooltip split into jobs and pipelines', () => {
    show([every5, credited, cont, manual]);
    const svg = document.querySelector('.ld-plot svg')!;
    expect([...svg.querySelectorAll('polygon')].map((p) => p.getAttribute('fill'))).toEqual(['#eadfce', '#ddd3f3']);
    expect([...svg.querySelectorAll('polyline')].map((p) => p.getAttribute('stroke'))).toEqual(['#9c8462', '#6a4fb0']);
    expect(document.querySelector('.ld-head > b')!.textContent).toBe('Running at once');
    expect(document.querySelector('.ld-key')!.textContent).toBe('jobs pipelines');
    expect(document.querySelector('.ld-key ~ span')!.textContent).toBe(
      'from schedules and typical runtimes · pipelines count when a scheduled job starts them, continuous ones (1) run the whole time · peak 5 at 16:00',
    );
    fireEvent.mouseMove(document.querySelector('.ld-plot')!, { clientX: 0, clientY: 0 });
    // every_five 15:55–16:05 and 16:00–16:10 (10-minute estimate), the same for the credited pipeline, the continuous one
    expect(document.querySelector('.tip')!.textContent).toBe(
      '16:00 · 5 running: 2 jobs · 3 pipelines · 2 start in the next 5 min\nprod / no prefix  5\n(runtimes estimated for 2 jobs)',
    );
  });

  it('continuous first ("running the whole time"), then by first start, then the items not on the chart', () => {
    show([manual, every5, credited, cont]);
    expect(document.querySelector('.list-meta')!.textContent).toContain('2 scheduled to start in range, by first start · 1 continuous');
    expect(ids()).toEqual(['c', 'e', 'p', 'OFF', 'm']);
    expect(right('c')).toBe('running the whole time');
    expect(document.querySelector('.ld-off')!.textContent).toBe(
      'Not on the chart · 1 with no fixed start times (manual, triggered by a file or a table, paused, or a pipeline no scheduled job starts)',
    );
    expect(right('m')).toBe('no start times');

    // a selection lists the continuous pipeline as running the whole time; the section stays
    const plot = document.querySelector('.ld-plot')!;
    fireEvent.pointerDown(plot, { clientX: 0 });
    fireEvent.pointerUp(plot, { clientX: 0 });
    expect(document.querySelector('.list-meta')!.textContent).toContain('3 jobs and pipelines running between 16:00 and 16:05');
    expect(ids()).toEqual(['c', 'e', 'p', 'OFF', 'm']);
    expect(right('c')).toBe('running the whole time');
    expect(right('e')).toBe('15:55–16:05 · 16:00–16:10');
  });

  it('only a continuous pipeline: counted across the whole range, one band; "N continuous on the chart"', () => {
    show([cont, manual]);
    const svg = document.querySelector('.ld-plot svg')!;
    expect([...svg.querySelectorAll('polygon')].map((p) => p.getAttribute('fill'))).toEqual(['#ddd3f3']);
    expect(svg.querySelector('polyline')!.getAttribute('points')!.split(' ').every((pt) => pt.endsWith(',0'))).toBe(true);
    expect(document.querySelector('.list-meta')!.textContent).toContain('1 continuous on the chart');
    expect(ids()).toEqual(['c', 'OFF', 'm']);
  });

  it('nothing with start times: an empty chart, "Nothing on the chart", the section capped at 200', () => {
    show(Array.from({ length: 201 }, (_, i) => base({ id: `m${i}`, name: `adhoc_${i}` })));
    expect(document.querySelectorAll('.ld-plot svg polygon, .ld-plot svg polyline')).toHaveLength(0);
    expect(document.querySelector('.list-meta')!.textContent).toContain('Nothing on the chart · nothing here has fixed start times, so the chart is empty');
    expect(document.querySelector('.ld-off')!.textContent).toContain('Not on the chart · 201 with no fixed start times');
    expect(document.querySelectorAll('.ld-list .ir')).toHaveLength(200);
    expect(document.querySelector('.ld-list .list-note')!.textContent).toBe('+1 more');
  });
});
