import type { Run } from '../../../shared/domain/types';
import type { TimeWindow } from './filters';
import { pad } from '../../../shared/domain/format';

/** Most boxes a strip shows; older runs in the window collapse into an "+N earlier" chip. */
export const HISTORY_MAX = 24;
/** A run row's history scrolls sideways, so it shows far more; the cap only bounds a busy job over a long window. */
export const ROW_HISTORY_MAX = 200;

/** Finished runs (with a result) of each job, keyed by full name, that started inside the timeline window, oldest first. */
export function historyByJob(runs: Run[], w: TimeWindow): Map<string, Run[]> {
  const out = new Map<string, Run[]>();
  for (const r of runs) {
    if (r.result === null || r.startTime < w.from || r.startTime >= w.to) continue;
    const list = out.get(r.name);
    if (list) list.push(r);
    else out.set(r.name, [r]);
  }
  for (const list of out.values()) list.sort((a, b) => a.startTime - b.startTime);
  return out;
}

export function visibleHistory(runs: Run[], max = HISTORY_MAX): { shown: Run[]; earlier: number } {
  const earlier = Math.max(0, runs.length - max);
  return { shown: earlier ? runs.slice(earlier) : runs, earlier };
}

/** Runtime short enough for a history box: "42s", "23m", "1h05", "10h". */
export function durShort(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h) return m ? `${h}h${m < 10 ? '0' : ''}${m}` : `${h}h`;
  return m ? `${m}m` : `${s}s`;
}

/** When a run started, compact enough for a history box: "18/06:00" (day of month / local time). */
export function dayTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()}/${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Shortest and longest succeeded run in the window, the same runs the average is taken over; null when none succeeded. */
export function durationRange(runs: Run[]): { min: number; max: number } | null {
  const ds = runs.filter((r) => r.result === 'succeeded').map((r) => r.durationSec);
  return ds.length ? { min: Math.min(...ds), max: Math.max(...ds) } : null;
}

export type HistoryStat ={ key: 'failed' | 'slow' | 'ok' | 'cancelled' | 'partial' | 'running'; n: number };

/** How a job's runs in the window went, for the Run history title: failed, slow (finished over its average), ok, cancelled, partial, running; zero counts left out. */
export function historyStats(runs: Run[], live: boolean): HistoryStat[] {
  const n = { failed: 0, slow: 0, ok: 0, cancelled: 0, partial: 0, running: live ? 1 : 0 };
  for (const r of runs) {
    if (r.result === 'failed') n.failed++;
    else if (r.result === 'cancelled') n.cancelled++;
    else if (r.result === 'partial') n.partial++;
    else if (r.result === 'succeeded') n[r.kind === 'slow' ? 'slow' : 'ok']++;
  }
  return (Object.keys(n) as HistoryStat['key'][]).filter((k) => n[k] > 0).map((key) => ({ key, n: n[key] }));
}
