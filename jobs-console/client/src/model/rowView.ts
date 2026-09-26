import type { Run } from '../../../shared/domain/types';
import { dur, durLive, fmtStart } from '../../../shared/domain/format';

export type TaskState = 'ok' | 'f' | 's' | 'r' | 'p';

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
  }
}

export function taskText(r: Run): string {
  if (r.type === 'pipeline' && !r.failed.length) return r.continuous ? 'bronze_bkpf' : '';
  if (r.failed.length) return r.failed.length > 1 ? `${r.failed[0].name} +${r.failed.length - 1}` : r.failed[0].name;
  return r.kind === 'retrying' ? 'extract_bseg' : '';
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
    else if (r.kind === 'slow' && r.live && !r.continuous && i === n - 1) out.push('r'); // over its average and still on the last task
    else if ((r.kind === 'running' && i > k) || r.kind === 'queued') out.push('p');
    else out.push('ok');
  }
  return out;
}

const FLOW_NAMES = ['bronze_bkpf', 'bronze_bseg', 'silver_bkpf', 'silver_bseg', 'silver_gl_accounts', 'gold_gl_balances', 'gold_cost_centers', 'gold_vendors'] as const;

/** Name of each task (flow, for pipelines) in chain order; failed ones carry the name the run reported. */
export function taskNames(r: Run): string[] {
  const base: readonly string[] = r.type === 'pipeline' ? FLOW_NAMES : TASK_NAMES;
  const names = Array.from({ length: r.ntasks }, (_, i) => (i < base.length ? base[i] : `${base[i % base.length]}_${Math.floor(i / base.length) + 1}`));
  const step = Math.floor(r.ntasks / (r.failed.length + 1));
  r.failed.forEach((f, i) => {
    if (step * (i + 1) < r.ntasks) names[step * (i + 1)] = f.name;
  });
  return names;
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
  if (r.kind === 'slow' && r.live && !r.continuous) return `${r.ntasks - 1} ok, last task running`;
  if (r.kind === 'queued') return 'waiting to start';
  if (r.failed.length) return `${okc} ok, ${r.failed.length} failed${sk ? `, ${sk} skipped` : ''}`;
  if (r.kind === 'retrying') return r.type === 'pipeline' ? 'whole update retrying' : 'one task retrying';
  return r.continuous ? 'all flows running' : 'all running';
}

export function whenText(r: Run): string {
  const verb = r.kind === 'failed' ? 'failed' : r.kind === 'queued' ? 'queued since' : r.kind === 'succeeded' ? 'finished' : 'started';
  return `${verb} ${fmtStart(r.startTime)}`;
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
