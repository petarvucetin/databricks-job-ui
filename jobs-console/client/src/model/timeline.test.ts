import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeRun } from '../test/fixtures';
import {
  buckets, domainStart, fitScale, clampWindow, presetWindow, sameWindow, countByBucket, columnLabel,
  spanText, edgeIndex, edgeAt, dragHandle, shiftWindow, moveWindowTo, timelineEnd, addDays,
} from './timeline';

const asOf = new Date(2026, 8, 22, 8, 0).getTime();
const end = timelineEnd(asOf);

describe('timeline', () => {
  it('ends at the midnight after now', () => {
    expect(end).toBe(new Date(2026, 8, 23).getTime());
    expect(addDays(end, -2)).toBe(new Date(2026, 8, 21).getTime());
  });

  it('builds hour, day and week columns', () => {
    expect(buckets('24h', end)).toHaveLength(24);
    expect(buckets('24h', end)[0].start).toBe(new Date(2026, 8, 22).getTime());
    expect(buckets('7d', end)).toHaveLength(7);
    expect(buckets('30d', end)).toHaveLength(30);
    expect(buckets('30d', end)[0].start).toBe(new Date(2026, 7, 24).getTime());
    const w = buckets('90d', end);
    expect(w).toHaveLength(13);
    expect(w[0].start).toBe(new Date(2026, 5, 24).getTime());
    expect(w[12].end).toBe(end);
    expect(domainStart('90d', end)).toBe(new Date(2026, 5, 24).getTime());
  });

  it('widens the scale when the window does not fit, and trims when narrowing', () => {
    const last7 = presetWindow('last7', '24h', end);
    expect(fitScale('24h', last7, end)).toBe('7d');
    expect(fitScale('30d', presetWindow('last2', '30d', end), end)).toBe('30d');
    expect(clampWindow('24h', presetWindow('last2', '30d', end), end)).toEqual({ from: new Date(2026, 8, 22).getTime(), to: end });
    expect(clampWindow('24h', { from: 0, to: 5 }, end)).toEqual({ from: new Date(2026, 8, 22).getTime(), to: end });
  });

  it('computes presets', () => {
    expect(presetWindow('all', '90d', end)).toEqual({ from: domainStart('90d', end), to: end });
    expect(presetWindow('today', '30d', end)).toEqual({ from: new Date(2026, 8, 22).getTime(), to: end });
    expect(sameWindow(presetWindow('last2', '30d', end), { from: new Date(2026, 8, 21).getTime(), to: end })).toBe(true);
  });

  it('counts runs per column and state', () => {
    const bks = buckets('7d', end);
    const c = countByBucket([
      makeRun({ startTime: new Date(2026, 8, 22, 1).getTime() }),
      makeRun({ startTime: new Date(2026, 8, 22, 3).getTime(), kind: 'succeeded' }),
      makeRun({ startTime: new Date(2026, 7, 1).getTime() }),
    ], bks);
    expect(c[6]).toEqual({ n: 2, failed: 1, succeeded: 1 });
    expect(c[0]).toEqual({ n: 0 });
  });

  it('labels columns', () => {
    const d = buckets('30d', end);
    expect(columnLabel('30d', d[0], 0, undefined)).toEqual({ num: '24', small: 'Aug', month: true, title: 'Mon 24 Aug' });
    expect(columnLabel('30d', d[1], 1, d[0])).toEqual({ num: '25', small: 'Tue', month: false, title: 'Tue 25 Aug' });
    const h = buckets('24h', end);
    expect(columnLabel('24h', h[14], 14, h[13])).toEqual({ num: '14', small: '', month: false, title: '22 Sep 14:00' });
    const w = buckets('90d', end);
    expect(columnLabel('90d', w[1], 1, w[0])).toEqual({ num: '1', small: 'Jul', month: true, title: 'week of 1 Jul' });
    expect(columnLabel('90d', w[2], 2, w[1])).toEqual({ num: '8', small: 'wk', month: false, title: 'week of 8 Jul' });
  });

  it('describes spans', () => {
    expect(spanText(2 * 86400000)).toBe('2 days');
    expect(spanText(86400000)).toBe('1 day');
    expect(spanText(3 * 3600000)).toBe('3 hours');
    expect(spanText(91 * 86400000)).toBe('13 weeks');
    expect(spanText(14 * 86400000)).toBe('14 days');
  });

  it('drags handles and the bar, snapping to column edges and staying in the domain', () => {
    const bks = buckets('30d', end);
    const w = presetWindow('last2', '30d', end);
    expect(edgeIndex(bks, w.from)).toBe(28);
    expect(dragHandle(bks, w, 'from', 25)).toEqual({ from: edgeAt(bks, 25), to: end });
    expect(dragHandle(bks, w, 'from', 30)).toEqual({ from: edgeAt(bks, 29), to: end });
    expect(dragHandle(bks, w, 'to', 10)).toEqual({ from: w.from, to: edgeAt(bks, 29) });
    expect(shiftWindow(bks, w, -5)).toEqual({ from: edgeAt(bks, 23), to: edgeAt(bks, 25) });
    expect(shiftWindow(bks, w, 5)).toEqual(w);
  });

  it('centres a window on a column, keeping its length and staying in the domain', () => {
    const bks = buckets('30d', end);
    const w7 = presetWindow('last7', '30d', end);
    expect(moveWindowTo(bks, w7, 10)).toEqual({ from: edgeAt(bks, 7), to: edgeAt(bks, 14) });
    expect(moveWindowTo(bks, w7, 1)).toEqual({ from: edgeAt(bks, 0), to: edgeAt(bks, 7) });
    expect(moveWindowTo(bks, w7, 28)).toEqual(w7);
    const w2 = presetWindow('last2', '30d', end);
    expect(moveWindowTo(bks, w2, 10)).toEqual({ from: edgeAt(bks, 9), to: edgeAt(bks, 11) });
  });

  it('snaps an unaligned window onto week edges when dragged in the 90d view', () => {
    const bks = buckets('90d', end);
    const w = presetWindow('last2', '90d', end);
    const moved = dragHandle(bks, w, 'from', 11);
    expect(moved).toEqual({ from: edgeAt(bks, 11), to: end });
    expect(moved.from).toBeGreaterThanOrEqual(domainStart('90d', end));
  });
});

describe('timeline DST regression', () => {
  const prevTZ = process.env.TZ ?? undefined;

  beforeAll(() => {
    Object.assign(process.env, { TZ: 'America/New_York' });
  });

  afterAll(() => {
    if (prevTZ === undefined) {
      delete process.env.TZ;
    } else {
      Object.assign(process.env, { TZ: prevTZ });
    }
  });

  it('handles spring-forward DST (23-hour day)', () => {
    const dstEnd = new Date(2026, 2, 9).getTime(); // March 9, 2026 (day after spring-forward on March 8)
    const bks = buckets('24h', dstEnd);
    expect(bks).toHaveLength(23);
    for (const bk of bks) {
      expect(bk.end).toBeGreaterThan(bk.start);
    }
    expect(bks[0].start).toBe(new Date(2026, 2, 8).getTime());
    expect(bks[bks.length - 1].end).toBe(dstEnd);
  });

  it('keeps existing UTC expectations in DST mode', () => {
    // Verify UTC test expectations still hold
    const utcEnd = timelineEnd(new Date(2026, 8, 22, 8, 0).getTime());
    expect(utcEnd).toBe(new Date(2026, 8, 23).getTime());
    const utcBks = buckets('24h', utcEnd);
    expect(utcBks).toHaveLength(24);
    expect(utcBks[0].start).toBe(new Date(2026, 8, 22).getTime());
  });
});
