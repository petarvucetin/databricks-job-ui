// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { Profiler } from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import type { Item } from '../../../shared/domain/types';
import { LoadView } from './LoadView';

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
