import type { Item } from '../../../shared/domain/types';
import { dayLabel, pad } from '../../../shared/domain/format';
import { isOnTimeline, isUnparsed, startsOf } from './items';

export type SchedScale = 'hour' | 'day';

export const hhmm = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
export const dayName = (t: number) => dayLabel(t).dow;
/** A start time as the scale reads it: "14:00" by hour, "Tue 14:00" by day. */
export const when = (t: number, scale: SchedScale) => (scale === 'day' ? `${dayName(t)} ${hhmm(t)}` : hhmm(t));

export interface SchedState {
  scale: SchedScale;
  /** Selected columns [a, b); null = all of them. */
  win: { a: number; b: number } | null;
  /** One box (column and type) clicked; it wins over `win`. */
  cube: { col: number; type: 'job' | 'pipeline' } | null;
}

export type Bucket = { start: number; end: number };

/** hour: 24 from the current local hour; day: 7 local days from midnight. */
export function schedBuckets(scale: SchedScale, now: number): Bucket[] {
  const d = new Date(now);
  if (scale === 'hour') {
    d.setMinutes(0, 0, 0);
    const s = d.getTime();
    return Array.from({ length: 24 }, (_, i) => ({ start: s + i * 3600e3, end: s + (i + 1) * 3600e3 }));
  }
  const at = (i: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + i).getTime();
  return Array.from({ length: 7 }, (_, i) => ({ start: at(i), end: at(i + 1) }));
}

export const fullWin = (bks: Bucket[]) => ({ a: 0, b: bks.length });

/** The selected columns, clamped to the buckets (a window from the other scale falls back to all). */
export function winOf(s: SchedState, bks: Bucket[]): { a: number; b: number } {
  const w = s.win;
  if (!w || w.a < 0 || w.b > bks.length || w.a >= w.b) return fullWin(bks);
  return w;
}

export function isNarrowed(s: SchedState, bks: Bucket[]): boolean {
  const w = winOf(s, bks);
  return !!s.cube || w.a > 0 || w.b < bks.length;
}

/** [from, to) the list is filtered to, or null when the whole range is selected. */
export function schedRange(s: SchedState, bks: Bucket[]): { from: number; to: number; type?: 'job' | 'pipeline' } | null {
  if (s.cube && bks[s.cube.col]) return { from: bks[s.cube.col].start, to: bks[s.cube.col].end, type: s.cube.type };
  if (!isNarrowed({ ...s, cube: null }, bks)) return null;
  const w = winOf(s, bks);
  return { from: bks[w.a].start, to: bks[w.b - 1].end };
}

/** Starts per bucket, by type. */
export function schedCounts(items: Item[], bks: Bucket[]): { job: number; pipeline: number }[] {
  const out = bks.map(() => ({ job: 0, pipeline: 0 }));
  if (!bks.length) return out;
  const from = bks[0].start, to = bks[bks.length - 1].end;
  for (const it of items) {
    let i = 0;
    for (const t of startsOf(it, from, to)) {
      while (i < bks.length && t >= bks[i].end) i++;
      if (i < bks.length) out[i][it.type]++;
    }
  }
  return out;
}

/** The timeline footer: items without a schedule (manual, triggered, periodic, file arrival, continuous, paused) and schedules not understood. */
export function unscheduledCounts(items: Item[]): { none: number; unparsed: number } {
  let none = 0, unparsed = 0;
  for (const it of items) {
    if (isOnTimeline(it)) continue;
    if (isUnparsed(it)) unparsed++;
    else none++;
  }
  return { none, unparsed };
}

export const PRESETS: Record<SchedScale, { label: string; a: number; b: number }[]> = {
  hour: [
    { label: 'next 24h', a: 0, b: 24 },
    { label: 'next 6 hours', a: 0, b: 6 },
    { label: 'next hour', a: 0, b: 1 },
  ],
  day: [
    { label: 'next 7 days', a: 0, b: 7 },
    { label: 'tomorrow', a: 1, b: 2 },
    { label: 'today', a: 0, b: 1 },
  ],
};

/** Move one handle to a column boundary; the handles never cross (at least one column stays selected). */
export function dragHandle(win: { a: number; b: number } | null, which: 'a' | 'b', col: number, n: number): { a: number; b: number } {
  const w = win ?? { a: 0, b: n };
  return which === 'a' ? { a: Math.max(0, Math.min(col, w.b - 1)), b: w.b } : { a: w.a, b: Math.min(n, Math.max(col, w.a + 1)) };
}
