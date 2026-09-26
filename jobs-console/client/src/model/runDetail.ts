import type { FailedTask, Run } from '../../../shared/domain/types';
import { dur } from '../../../shared/domain/format';
import { taskNames, taskStates, type TaskState } from './rowView';

export interface ScheduledTask {
  i: number;
  name: string;
  /** Seconds from the run's start. */
  start: number;
  dur: number;
  state: TaskState;
  /** Index of the task this one waits on; -1 for the first. */
  dep: number;
  /** Index into run.failed when the task failed. */
  fail?: number;
}

/** Length the drawer's timeline spans: the run so far, or its average while it has not started. */
export function spanSec(r: Run, elapsed: number): number {
  return Math.max(1, elapsed || r.usualSec);
}

/**
 * Synthetic per-task start, duration and dependency, ported from the prototype drawer.
 * States come from taskStates so the drawer agrees with the row.
 */
export function schedule(r: Run, elapsed: number = r.durationSec): ScheduledTask[] {
  const n = r.ntasks;
  const total = spanSec(r, elapsed);
  const states = taskStates(r, elapsed);
  const names = taskNames(r);
  const step = Math.floor(n / (r.failed.length + 1));
  const failIdx = new Map(r.failed.map((_, j) => [step * (j + 1), j] as const));
  const firstFail = r.failed.length ? step : Infinity;
  const out: ScheduledTask[] = [];
  for (let i = 0; i < n; i++) {
    const state = states[i] ?? 'ok';
    let start = Math.floor((i / n) * total * 0.92);
    let d = Math.max(20, Math.floor((total / n) * (1.2 + (i % 3) * 0.6)));
    const fail = state === 'f' ? failIdx.get(i) : undefined;
    if (state === 'f') d = r.failed[fail ?? 0]?.secs ?? d;
    else if (state === 's') {
      start = Math.floor((firstFail / n) * total * 0.92) + (r.failed[0]?.secs ?? 0);
      d = 0;
    } else if (state === 'r' && r.kind === 'retrying') d = Math.floor(total - start);
    else if (state === 'p') d = 0;
    const dep = i === 0 ? -1 : Math.max(0, i - 1 - (i % 3));
    const pd = out[dep];
    if (pd) {
      const minStart = state === 's' ? pd.start + Math.floor(total * 0.045) : pd.start + pd.dur + Math.floor(total * 0.01);
      start = Math.min(Math.max(start, minStart), Math.floor(total * 0.96));
    }
    out.push({ i, name: names[i] ?? '', start, dur: d, state, dep, fail });
  }
  return out;
}

/** Five axis labels across the timeline: 0, then quarters of the span. */
export function ticks(total: number): string[] {
  return [0, 1, 2, 3, 4].map((k) => (k === 0 ? '0' : dur(Math.floor((total * k) / 4))));
}

/** Tasks panel headline: counts that match the task boxes. */
export function tasksHead(r: Run, elapsed: number = r.durationSec): string {
  const s = taskStates(r, elapsed);
  const count = (x: TaskState) => s.filter((v) => v === x).length;
  if (r.failed.length) return `${count('f')} failed, ${count('ok')} ok, ${count('s')} skipped`;
  if (r.kind === 'retrying') return `1 retrying, ${r.ntasks - 1} ok`;
  return `${r.ntasks} tasks`;
}

/** Failed tasks grouped by cause label, groups in order of first appearance. */
export function causeGroups(r: Run): { label: string; items: { f: FailedTask; i: number }[] }[] {
  const groups: { label: string; items: { f: FailedTask; i: number }[] }[] = [];
  r.failed.forEach((f, i) => {
    let g = groups.find((x) => x.label === f.cause.label);
    if (!g) groups.push((g = { label: f.cause.label, items: [] }));
    g.items.push({ f, i });
  });
  return groups;
}

/** Duration of this job's previous finished run, from its history; the average when there is none. */
export function lastRunSec(r: Run, history: Run[] | undefined): number {
  const prev = (history ?? []).filter((h) => h.id !== r.id && h.result && h.startTime < r.startTime).sort((a, b) => b.startTime - a.startTime)[0];
  return prev ? prev.durationSec : r.usualSec;
}
