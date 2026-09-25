import type { Run } from '../../../shared/domain/types';
import { dur, durLive, fmtStart } from '../../../shared/domain/format';

export type TaskState = 'ok' | 'f' | 's' | 'r' | 'p';
export type HistMark = '' | 'f' | 'a' | 'n';

export const TASK_NAMES = ['setup', 'extract_bkpf', 'extract_bseg', 'extract_gl', 'transform', 'dq_checks', 'load_gl', 'load_gl_history', 'load_cost_centers', 'load_profit_centers', 'load_vendors', 'publish', 'notify'] as const;

export function problemText(r: Run): string {
  if (r.type === 'pipeline') {
    if (r.kind === 'failed') return r.failed.length > 1 ? `${r.cause.label}, ${r.failed.length} flows` : r.cause.label;
    if (r.kind === 'slow' && r.continuous) return 'lagging, backlog rising';
    if (r.kind === 'queued') return 'waiting for resources';
    if (r.kind === 'retrying') return 'retry on failure, update 2';
  }
  switch (r.kind) {
    case 'failed':
      return r.failed.length > 1 ? `${r.cause.label}, ${r.failed.length} tasks` : r.cause.label;
    case 'slow':
      return `+${dur(r.durationSec - r.usualSec)} over usual`;
    case 'queued':
      return 'queued, concurrency limit';
    case 'retrying':
      return 'attempt 2 of 4';
    case 'running':
      return 'running, on track';
    case 'succeeded':
      return 'succeeded';
    case 'snoozed':
      return 'snoozed until 15:00';
  }
}

export function taskText(r: Run): string {
  if (r.type === 'pipeline' && !r.failed.length) return r.continuous ? 'bronze_bkpf' : '';
  if (r.failed.length) return r.failed.length > 1 ? `${r.failed[0].name} +${r.failed.length - 1}` : r.failed[0].name;
  return r.kind === 'retrying' ? 'extract_bseg' : '';
}

export function historyMarks(r: Run): HistMark[] {
  const out: HistMark[] = [];
  let x = r.id * 7919;
  for (let i = 0; i < 12; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    const v = x / 2147483648;
    if (i === 11) out.push(r.kind === 'failed' ? 'f' : r.kind === 'slow' || r.kind === 'retrying' ? 'a' : '');
    else out.push(v < 0.08 ? 'f' : v < 0.14 ? 'a' : r.kind === 'queued' && v < 0.4 ? 'n' : '');
  }
  return out;
}

/** Index of the task running now, estimated from elapsed vs average. */
export function runningIndex(r: Run, elapsed: number = r.durationSec): number {
  return Math.min(r.ntasks - 1, Math.floor((r.ntasks * elapsed) / Math.max(1, r.usualSec)));
}

export function taskStates(r: Run, elapsed: number = r.durationSec): TaskState[] {
  const n = r.ntasks;
  const step = Math.floor(n / (r.failed.length + 1));
  const failAt = new Set(r.failed.map((_, i) => step * (i + 1)));
  const firstFail = r.failed.length ? step : Infinity;
  const k = runningIndex(r, elapsed);
  const out: TaskState[] = [];
  for (let i = 0; i < n; i++) {
    if (failAt.has(i)) out.push('f');
    else if (i > firstFail && i % 5 !== 0) out.push('s');
    else if (r.kind === 'retrying' && i === Math.floor(n / 2)) out.push('r');
    else if (r.kind === 'running' && i === k) out.push('r');
    else if ((r.kind === 'running' && i > k) || r.kind === 'queued') out.push('p');
    else out.push('ok');
  }
  return out;
}

export function chainSummary(r: Run, elapsed: number = r.durationSec): string {
  const s = taskStates(r, elapsed);
  const okc = s.filter((x) => x === 'ok').length;
  const sk = s.filter((x) => x === 's').length;
  if (r.kind === 'running') {
    const k = runningIndex(r, elapsed);
    return `${k} ok, 1 running, ${r.ntasks - k - 1} to go`;
  }
  if (r.kind === 'succeeded') return 'all ok';
  if (r.kind === 'queued') return 'waiting to start';
  if (r.failed.length) return `${okc} ok, ${r.failed.length} failed${sk ? `, ${sk} skipped` : ''}`;
  if (r.kind === 'retrying') return r.type === 'pipeline' ? 'whole update retrying' : 'one task retrying';
  return r.continuous ? 'all flows running' : 'all running';
}

export function liveMessage(r: Run, elapsed: number = r.durationSec): { lead: string; dim: string; red: boolean } {
  if (r.type === 'pipeline') {
    if (r.kind === 'slow' && r.continuous) return { lead: 'backlog 48,210 files, rising for 35m', dim: 'Auto Loader source raw_bkpf', red: false };
    if (r.kind === 'retrying') return { lead: 'RETRY_ON_FAILURE', dim: 'update 1 lost its cluster after 48m, a new update started', red: false };
  }
  if (r.kind === 'running') {
    const k = runningIndex(r, elapsed);
    return { lead: `${TASK_NAMES[1 + (k % (TASK_NAMES.length - 1))]} running`, dim: `${k} of ${r.ntasks} tasks done, ${Math.round((100 * elapsed) / Math.max(1, r.usualSec))}% of the average time`, red: false };
  }
  if (r.kind === 'retrying') return { lead: 'attempt 2 of 4', dim: 'attempt 1 lost its cluster after 48m, resuming from checkpoint', red: false };
  return { lead: `${dur(elapsed - r.usualSec)} over usual`, dim: 'same parameters, code and cluster as last run', red: false };
}

export function whenText(r: Run): string {
  const verb = r.kind === 'failed' ? 'failed' : r.kind === 'queued' ? 'queued since' : r.kind === 'succeeded' ? 'finished' : r.kind === 'snoozed' ? 'snoozed, last' : 'started';
  return `${verb} ${fmtStart(r.startTime)}`;
}

export function borderTone(r: Run): '' | 'red' | 'amber' | 'blue' {
  if (r.kind === 'failed') return 'red';
  if (r.kind === 'running') return 'blue';
  if (r.kind === 'slow' || r.kind === 'retrying') return 'amber';
  return '';
}

/** Live runs keep counting from when the data was loaded. */
export function elapsedSec(r: Run, nowMs: number, loadedAt: number): number {
  return r.live ? r.durationSec + Math.max(0, Math.floor((nowMs - loadedAt) / 1000)) : r.durationSec;
}

export function progress(r: Run, elapsed: number): { p: number; over: boolean } {
  const p = elapsed / Math.max(1, r.usualSec);
  return { p: Math.round(p * 1000) / 1000, over: elapsed > r.usualSec };
}

export function statBlock(r: Run, elapsed: number, asOf: number): { label: 'now' | 'took' | 'waiting'; value: string; big: boolean; average: string } {
  const average = dur(r.usualSec);
  if (r.live) return { label: 'now', value: durLive(elapsed), big: true, average };
  if (r.kind === 'queued') return { label: 'waiting', value: dur(Math.max(0, (asOf - r.startTime) / 1000)), big: false, average };
  return { label: 'took', value: dur(elapsed), big: false, average };
}

export function splitName(name: string): { prefix: string; rest: string } {
  const m = /^\[[^\]]+\] /.exec(name);
  const prefix = m ? m[0] : '';
  return { prefix, rest: name.slice(prefix.length) };
}
