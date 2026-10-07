import { describe, it, expect } from 'vitest';
import { schedBuckets, schedRange, schedCounts, dragHandle, unscheduledCounts } from './schedule';
import type { Item } from '../../../shared/domain/types';

const NOW = Date.UTC(2026, 9, 6, 16, 16);
const job = (id: string, cron: string | null, over: Partial<Item> = {}): Item => ({ type: 'job', id, name: id, deployed: false, mine: false, tags: {}, trigger: cron ? 'schedule' : 'manual', ...(cron ? { schedule: { cron, tz: 'UTC', paused: false } } : {}), paused: false, bundle: false, ...over });

describe('schedule', () => {
  it('24 hourly buckets from the current hour; 7 days from midnight', () => {
    const h = schedBuckets('hour', NOW);
    expect(h).toHaveLength(24);
    expect(h[0].start).toBe(Date.UTC(2026, 9, 6, 16));
    const d = schedBuckets('day', NOW);
    expect(d).toHaveLength(7);
    expect(d[0].start).toBe(Date.UTC(2026, 9, 6));
  });
  it('counts starts per bucket; paused, unparsed and unscheduled count nothing', () => {
    const bks = schedBuckets('hour', NOW);
    const items = [job('a', '0 0 * * * ?'), job('b', '0 0/15 * * * ?'), job('c', '0 0 2 * * ?', { paused: true }), job('d', '0 0 12 L * ?'), job('e', null)];
    const c = schedCounts(items, bks);
    expect(c[0]).toEqual({ job: 5, pipeline: 0 });
    expect(c.reduce((s, x) => s + x.job, 0)).toBe(24 + 96);
  });
  it('range is null for the full window, else the selected columns or cube', () => {
    const bks = schedBuckets('hour', NOW);
    expect(schedRange({ scale: 'hour', win: null, cube: null }, bks)).toBeNull();
    expect(schedRange({ scale: 'hour', win: { a: 2, b: 5 }, cube: null }, bks)).toEqual({ from: bks[2].start, to: bks[4].end });
    expect(schedRange({ scale: 'hour', win: null, cube: { col: 3, type: 'job' } }, bks)).toEqual({ from: bks[3].start, to: bks[3].end, type: 'job' });
  });
  it('handles never cross', () => {
    expect(dragHandle({ a: 2, b: 5 }, 'a', 9, 24)).toEqual({ a: 4, b: 5 });
    expect(dragHandle({ a: 2, b: 5 }, 'b', 0, 24)).toEqual({ a: 2, b: 3 });
  });
  it('footer counts: no schedule (manual, periodic, continuous, paused) apart from schedules not understood', () => {
    const items = [
      job('a', '0 0 * * * ?'),
      job('c', '0 0 2 * * ?', { paused: true }),
      job('d', '0 0 12 L * ?'),
      job('d2', '0 15 10 ? * 6#3'),
      job('z', '0 0 2 * * ?', { schedule: { cron: '0 0 2 * * ?', tz: 'Not/AZone', paused: false } }),
      job('e', null),
      job('p', null, { trigger: 'periodic', periodic: { interval: 4, unit: 'HOURS' } }),
      job('cont', null, { type: 'pipeline', trigger: 'continuous' }),
    ];
    expect(unscheduledCounts(items)).toEqual({ none: 4, unparsed: 3 });
  });
});
