import { describe, it, expect } from 'vitest';
import { DEFAULT_LIMITS } from '../live/limits';
import { cutoffs, localMidnight } from './cutoff';

const H = 3_600_000;
const DAY = 24 * H;

describe('cutoffs', () => {
  it('local midnight follows getTimezoneOffset (UTC minus local, positive west)', () => {
    const now = Date.UTC(2026, 9, 7, 3, 30); // 03:30 UTC = 23:30 Oct 6 in New York (EDT, offset 240)
    expect(localMidnight(now, 240)).toBe(Date.UTC(2026, 9, 6, 4, 0));
    expect(localMidnight(now, -120)).toBe(Date.UTC(2026, 9, 6, 22, 0)); // 05:30 Oct 7 in UTC+2
    expect(localMidnight(now, 0)).toBe(Date.UTC(2026, 9, 7));
    expect(localMidnight(now, undefined)).toBe(Date.UTC(2026, 9, 7));
  });

  it('after 03:00 local the API starts at local midnight; history reaches back historyDays', () => {
    const now = Date.UTC(2026, 9, 7, 14, 0) + 240 * 60_000; // 14:00 New York
    const day = Date.UTC(2026, 9, 7) + 240 * 60_000;
    expect(cutoffs(now, 240, DEFAULT_LIMITS)).toEqual({ day, apiFrom: day, historyFrom: now - 90 * DAY });
  });

  it('at 00:05 local the API reaches back the overlap (21:05 the day before)', () => {
    const day = Date.UTC(2026, 9, 7) + 240 * 60_000;
    const now = day + 5 * 60_000;
    expect(cutoffs(now, 240, DEFAULT_LIMITS)).toEqual({ day, apiFrom: now - 3 * H, historyFrom: now - 90 * DAY });
    expect(cutoffs(now, 240, { ...DEFAULT_LIMITS, apiOverlapHours: 1, historyDays: 365 })).toEqual({ day, apiFrom: now - H, historyFrom: now - 365 * DAY });
  });
});
