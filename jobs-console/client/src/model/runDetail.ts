import type { FailedTask, Run, RunTask } from '../../../shared/domain/types';
import { dur } from '../../../shared/domain/format';
import { taskNames, taskStates, type TaskState } from './rowView';

export interface ScheduledTask {
  i: number;
  name: string;
  /** Seconds from the run's start. */
  start: number;
  dur: number;
  state: TaskState;
  /** Index of the (first) task this one waits on; -1 when none. */
  dep: number;
  /** Every task this one waits on (real tasks can wait on several). */
  deps: number[];
  /** Index into run.failed when the task failed. */
  fail?: number;
}

/** Length the drawer's timeline spans: the run so far, or its average while it has not started. */
export function spanSec(r: Run, elapsed: number): number {
  return Math.max(1, elapsed || r.usualSec);
}

/**
 * The run's real tasks on the timeline. A running task keeps growing with the client clock; a task that has not started
 * sits, zero-length, where the tasks it waits on end.
 */
function realSchedule(r: Run, tasks: RunTask[], elapsed: number): ScheduledTask[] {
  const grow = r.live ? Math.max(0, elapsed - r.durationSec) : 0;
  const out: ScheduledTask[] = [];
  tasks.forEach((t, i) => {
    let start = t.startSec;
    let d = t.state === 'r' ? t.durSec + grow : t.durSec;
    if (start < 0) {
      start = Math.max(0, ...t.deps.map((j) => {
        const p = out[j];
        return p ? p.start + p.dur : 0;
      }));
      d = 0;
    }
    out.push({ i, name: t.key, start, dur: d, state: t.state, dep: t.deps[0] ?? -1, deps: t.deps, fail: t.failIndex });
  });
  return out;
}

/**
 * Per-task start, duration and dependencies: the real tasks when the run has them, else synthetic ones ported from the
 * prototype drawer (mock data). States come from taskStates so the drawer agrees with the row.
 */
export function schedule(r: Run, elapsed: number = r.durationSec): ScheduledTask[] {
  if (r.tasks) return realSchedule(r, r.tasks, elapsed);
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
    out.push({ i, name: names[i] ?? '', start, dur: d, state, dep, deps: dep < 0 ? [] : [dep], fail });
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
  if (r.tasks) {
    if (count('f')) return `${count('f')} failed, ${count('ok')} ok, ${count('s')} skipped`;
    const retrying = r.tasks.filter((t) => t.state === 'r' && t.attempt > 0).length;
    if (retrying) return `${retrying} retrying, ${count('ok')} ok`;
    return `${s.length} ${s.length === 1 ? 'task' : 'tasks'}`;
  }
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
