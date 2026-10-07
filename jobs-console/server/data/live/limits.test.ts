import { describe, it, expect } from 'vitest';
import { DEFAULT_LIMITS, readLimits, readRefresh } from './limits';

describe('readRefresh', () => {
  it('deltas on with a 15 min full reload by default; env turns deltas off or changes the period', () => {
    expect(readRefresh({})).toEqual({ incremental: true, fullRefreshMs: 900000 });
    expect(readRefresh({ JOBS_CONSOLE_INCREMENTAL: '0', JOBS_CONSOLE_FULL_REFRESH_MS: '60000' })).toEqual({ incremental: false, fullRefreshMs: 60000 });
    expect(() => readRefresh({ JOBS_CONSOLE_INCREMENTAL: 'no' })).toThrow(/JOBS_CONSOLE_INCREMENTAL/);
    expect(() => readRefresh({ JOBS_CONSOLE_FULL_REFRESH_MS: '0' })).toThrow(/JOBS_CONSOLE_FULL_REFRESH_MS/);
  });
});

describe('readLimits', () => {
  it('defaults to the spec values and takes env overrides', () => {
    expect(readLimits({})).toEqual({ windowDays: 30, maxRuns: 2000, timeoutMs: 12000, concurrency: 8, itemsTimeoutMs: 30000, historyDays: 90, historyMaxRuns: 20000, apiOverlapHours: 3 });
    expect(readLimits({ JOBS_CONSOLE_WINDOW_DAYS: '7', JOBS_CONSOLE_MAX_RUNS: '10000', JOBS_CONSOLE_TIMEOUT_MS: '45000', JOBS_CONSOLE_CONCURRENCY: '16' })).toEqual({
      windowDays: 7, maxRuns: 10000, timeoutMs: 45000, concurrency: 16, itemsTimeoutMs: 30000, historyDays: 90, historyMaxRuns: 20000, apiOverlapHours: 3,
    });
    expect(readLimits({ JOBS_CONSOLE_MAX_RUNS: '' })).toEqual(DEFAULT_LIMITS);
  });

  it('reads the history limits and clamps the days to 365', () => {
    expect(readLimits({ JOBS_CONSOLE_HISTORY_DAYS: '30', JOBS_CONSOLE_HISTORY_MAX_RUNS: '500', JOBS_CONSOLE_API_OVERLAP_HOURS: '6' })).toMatchObject({ historyDays: 30, historyMaxRuns: 500, apiOverlapHours: 6 });
    expect(readLimits({ JOBS_CONSOLE_HISTORY_DAYS: '1000' }).historyDays).toBe(365);
  });

  it('rejects non-positive or non-integer values', () => {
    for (const bad of ['0', '-1', '1.5', 'x']) expect(() => readLimits({ JOBS_CONSOLE_CONCURRENCY: bad })).toThrow(/JOBS_CONSOLE_CONCURRENCY/);
  });
});
