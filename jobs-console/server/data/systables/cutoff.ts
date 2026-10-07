import type { LiveLimits } from '../live/limits';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The viewer's local midnight before `now`. tzOffsetMin is their Date.getTimezoneOffset() (UTC minus local; undefined: UTC). */
export function localMidnight(now: number, tzOffsetMin: number | undefined): number {
  const shift = (tzOffsetMin ?? 0) * 60_000;
  const local = now - shift;
  return local - (((local % DAY) + DAY) % DAY) + shift;
}

/**
 * Where history ends and the API begins (decision H1). `day` is the viewer's local midnight: history covers runs that
 * started in [historyFrom, day) and is cached per day. The API covers [apiFrom, now] plus active_only, where apiFrom
 * reaches back apiOverlapHours before now just after midnight (system tables lag), so the two overlap.
 */
export function cutoffs(now: number, tzOffsetMin: number | undefined, limits: Pick<LiveLimits, 'historyDays' | 'apiOverlapHours'>): { day: number; apiFrom: number; historyFrom: number } {
  const day = localMidnight(now, tzOffsetMin);
  return { day, apiFrom: Math.min(day, now - limits.apiOverlapHours * HOUR), historyFrom: now - limits.historyDays * DAY };
}
