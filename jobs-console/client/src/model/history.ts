import type { Run } from '../../../shared/domain/types';
import type { TimeWindow } from './filters';

/** Most boxes a row shows; older runs in the window collapse into an "+N earlier" chip. */
export const HISTORY_MAX = 24;

/** Runs of each job (keyed by full name) that started inside the timeline window, oldest first. */
export function historyByJob(runs: Run[], w: TimeWindow): Map<string, Run[]> {
  const out = new Map<string, Run[]>();
  for (const r of runs) {
    if (r.startTime < w.from || r.startTime >= w.to) continue;
    const list = out.get(r.name);
    if (list) list.push(r);
    else out.set(r.name, [r]);
  }
  for (const list of out.values()) list.sort((a, b) => a.startTime - b.startTime);
  return out;
}

export function visibleHistory(runs: Run[]): { shown: Run[]; earlier: number } {
  const earlier = Math.max(0, runs.length - HISTORY_MAX);
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
