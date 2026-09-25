import type { Run, RunKind } from '../../../shared/domain/types';
import { dayLabel, pad } from '../../../shared/domain/format';
import type { TimeWindow } from './filters';

export type ScaleId = '24h' | '7d' | '14d' | '30d' | '90d';
export const SCALE_ORDER: ScaleId[] = ['24h', '7d', '14d', '30d', '90d'];
export const SCALES: Record<ScaleId, { days: number; unit: 'hour' | 'day' | 'week' }> = {
  '24h': { days: 1, unit: 'hour' },
  '7d': { days: 7, unit: 'day' },
  '14d': { days: 14, unit: 'day' },
  '30d': { days: 30, unit: 'day' },
  '90d': { days: 91, unit: 'week' },
};
export type Preset = 'all' | 'last7' | 'last2' | 'today';

export interface Bucket {
  start: number;
  end: number;
}

/** Calendar-day arithmetic in local time (safe across DST). */
export function addDays(ms: number, n: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes()).getTime();
}

export function timelineEnd(asOf: number): number {
  const d = new Date(asOf);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

export function buckets(scale: ScaleId, end: number): Bucket[] {
  const s = SCALES[scale];
  const out: Bucket[] = [];
  if (s.unit === 'hour') {
    const d0 = addDays(end, -1);
    const d = new Date(d0);
    const y = d.getFullYear();
    const m = d.getMonth();
    const dt = d.getDate();
    const starts: number[] = [];
    for (let h = 0; h < 24; h++) {
      const start = new Date(y, m, dt, h).getTime();
      if (!starts.length || start !== starts[starts.length - 1]) starts.push(start);
    }
    for (let i = 0; i < starts.length; i++) {
      out.push({ start: starts[i], end: i === starts.length - 1 ? end : starts[i + 1] });
    }
  } else {
    const step = s.unit === 'week' ? 7 : 1;
    for (let i = 0; i < s.days / step; i++) out.push({ start: addDays(end, -s.days + i * step), end: addDays(end, -s.days + (i + 1) * step) });
  }
  return out;
}

export function domainStart(scale: ScaleId, end: number): number {
  return scale === '24h' ? addDays(end, -1) : addDays(end, -SCALES[scale].days);
}

export function fitScale(scale: ScaleId, w: TimeWindow, end: number): ScaleId {
  let i = SCALE_ORDER.indexOf(scale);
  while (w.from < domainStart(SCALE_ORDER[i], end) && i < SCALE_ORDER.length - 1) i++;
  return SCALE_ORDER[i];
}

export function clampWindow(scale: ScaleId, w: TimeWindow, end: number): TimeWindow {
  const d0 = domainStart(scale, end);
  const from = Math.max(w.from, d0);
  return w.to <= from ? { from: d0, to: end } : { from, to: w.to };
}

export function presetWindow(p: Preset, scale: ScaleId, end: number): TimeWindow {
  if (p === 'all') return { from: domainStart(scale, end), to: end };
  return { from: addDays(end, p === 'last7' ? -7 : p === 'last2' ? -2 : -1), to: end };
}

export function sameWindow(a: TimeWindow, b: TimeWindow): boolean {
  return a.from === b.from && a.to === b.to;
}

export function countByBucket(runs: Run[], bks: Bucket[]): Array<Partial<Record<RunKind, number>> & { n: number }> {
  const out: Array<Partial<Record<RunKind, number>> & { n: number }> = bks.map(() => ({ n: 0 }));
  const first = bks[0]?.start ?? 0;
  const last = bks[bks.length - 1]?.end ?? 0;
  for (const r of runs) {
    if (r.startTime < first || r.startTime >= last) continue;
    const i = bks.findIndex((b) => r.startTime >= b.start && r.startTime < b.end);
    const c = out[i];
    c[r.kind] = (c[r.kind] ?? 0) + 1;
    c.n++;
  }
  return out;
}

export function columnLabel(scale: ScaleId, b: Bucket, i: number, prev: Bucket | undefined): { num: string; small: string; month: boolean; title: string } {
  const L = dayLabel(b.start);
  const unit = SCALES[scale].unit;
  if (unit === 'hour') {
    const h = new Date(b.start).getHours();
    return { num: pad(h), small: i === 0 ? L.full : '', month: i === 0, title: `${L.full} ${pad(h)}:00` };
  }
  if (unit === 'week') {
    const newMonth = !prev || dayLabel(prev.start).mon !== L.mon;
    return { num: String(L.num), small: newMonth ? L.mon : 'wk', month: newMonth, title: `week of ${L.full}` };
  }
  const month = i === 0 || L.num === 1;
  return { num: String(L.num), small: month ? L.mon : L.dow, month, title: `${L.dow} ${L.full}` };
}

export function spanText(ms: number): string {
  const hours = Math.round(ms / 3600000);
  const days = Math.round(hours / 24);
  if (hours >= 23 && Math.abs(hours - days * 24) <= 1) {
    if (days % 7 === 0 && days > 14) return `${days / 7} weeks`;
    return days === 1 ? '1 day' : `${days} days`;
  }
  return hours === 1 ? '1 hour' : `${hours} hours`;
}

export function edgeAt(bks: Bucket[], i: number): number {
  return i >= bks.length ? bks[bks.length - 1].end : bks[Math.max(0, i)].start;
}

export function edgeIndex(bks: Bucket[], t: number): number {
  let best = 0;
  for (let i = 1; i <= bks.length; i++) if (Math.abs(edgeAt(bks, i) - t) < Math.abs(edgeAt(bks, best) - t)) best = i;
  return best;
}

export function dragHandle(bks: Bucket[], w: TimeWindow, which: 'from' | 'to', idx: number): TimeWindow {
  const n = bks.length;
  const i = Math.max(0, Math.min(n, idx));
  if (which === 'from') {
    const toIdx = edgeIndex(bks, w.to);
    return { from: edgeAt(bks, Math.min(i, toIdx - 1)), to: w.to };
  }
  const fromIdx = edgeIndex(bks, w.from);
  return { from: w.from, to: edgeAt(bks, Math.max(i, fromIdx + 1)) };
}

export function shiftWindow(bks: Bucket[], w: TimeWindow, deltaCols: number): TimeWindow {
  const f = edgeIndex(bks, w.from);
  const t = edgeIndex(bks, w.to);
  const span = Math.max(1, t - f);
  const nf = Math.max(0, Math.min(bks.length - span, f + deltaCols));
  if (nf === f) return w;
  return { from: edgeAt(bks, nf), to: edgeAt(bks, nf + span) };
}
