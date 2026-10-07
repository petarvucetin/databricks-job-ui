import type { Cause, FailedTask, Item, RunResult, RunTask, TaskState } from '../../../shared/domain/types';
import { failureCause } from '../live/causes';
import { GENERIC, taskOrder } from '../live/jobs';
import type { Draft } from '../live/kinds';
import { jobRunUrl, pipelineUpdateUrl } from '../live/links';
import { pipelineNumber } from '../live/pipelines';
import { noDiag } from '../live/trace';
import type { SqlRow } from './sql';

export type { SqlRow } from './sql';

/** The four history queries' answers (queries.ts), as runSql returns them. */
export interface HistoryRows {
  runs: SqlRow[];
  tasks: SqlRow[];
  deps: SqlRow[];
  updates: SqlRow[];
}

/** result_state of job_run_timeline / job_task_run_timeline. Anything else maps as failed, like the API path. */
const JOB_RESULTS: Record<string, RunResult> = {
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  ERROR: 'failed',
  TIMED_OUT: 'failed',
  CANCELLED: 'cancelled',
  SKIPPED: 'cancelled',
  BLOCKED: 'cancelled',
};
/** result_state of pipeline_update_timeline. */
const UPDATE_RESULTS: Record<string, RunResult> = { COMPLETED: 'succeeded', FAILED: 'failed', CANCELED: 'cancelled' };

const stateOf = (r: RunResult): TaskState => (r === 'succeeded' ? 'ok' : r === 'failed' ? 'f' : 's');

/** Epoch ms from start_ms / end_ms (UNIX_MILLIS), or an ISO timestamp as the API prints one ("2026-01-01 12:00:00+00:00"). */
function ms(v: string | null | undefined): number {
  if (!v) return NaN;
  return /^-?\d+$/.test(v) ? Number(v) : Date.parse(v.replace(' ', 'T'));
}

const secs = (from: number, to: number) => Math.max(0, Math.round((to - from) / 1000));

/** One run (or task run, or update) over its hourly slices: first start, last end, and the final slice's outcome. */
interface Agg {
  start: number;
  end: number;
  /** The slice carrying the result (latest end among the slices with a result_state). */
  final?: SqlRow;
  finalEnd: number;
  first: SqlRow;
}

function aggregate(rows: SqlRow[], key: (r: SqlRow) => string): Map<string, Agg> {
  const out = new Map<string, Agg>();
  for (const r of rows) {
    const start = ms(r.start_ms);
    const end = ms(r.end_ms);
    if (Number.isNaN(start)) continue;
    const k = key(r);
    const a = out.get(k) ?? { start, end: Number.isNaN(end) ? start : end, finalEnd: -Infinity, first: r };
    out.set(k, a);
    a.start = Math.min(a.start, start);
    if (!Number.isNaN(end)) a.end = Math.max(a.end, end);
    if (r.result_state && (Number.isNaN(end) ? a.start : end) >= a.finalEnd) {
      a.final = r;
      a.finalEnd = Number.isNaN(end) ? a.start : end;
    }
  }
  return out;
}

const causeOf = (final: SqlRow): Cause => failureCause(final.termination_code ?? '', '', final.result_state === 'TIMED_OUT');

function parseKeys(v: string | null | undefined): string[] {
  try {
    const x: unknown = JSON.parse(v ?? '[]');
    return Array.isArray(x) ? x.filter((k): k is string => typeof k === 'string') : [];
  } catch {
    return [];
  }
}

/** A run's tasks as the API path gives them: the latest attempt per task key, dependencies first, times from the run's start. */
function runTasks(runStart: number, attempts: Agg[], deps: Map<string, string[]>, jobId: string, runId: string): { tasks: RunTask[]; failed: FailedTask[] } {
  const byKey = new Map<string, Agg[]>();
  for (const a of attempts) {
    const k = a.first.task_key ?? '';
    byKey.set(k, [...(byKey.get(k) ?? []), a]);
  }
  for (const all of byKey.values()) all.sort((x, y) => x.start - y.start);
  const latestStart = (k: string) => {
    const all = byKey.get(k) ?? [];
    return all[all.length - 1]?.start ?? Infinity;
  };
  // Task start order (of the attempt shown), so failed[] and the first-failed cause follow when tasks ran, not row order.
  const keys = [...byKey.keys()].sort((x, y) => latestStart(x) - latestStart(y));
  const index = new Map(keys.map((k, i) => [k, i]));
  const latest = keys.map((k) => {
    const all = byKey.get(k) ?? [];
    return { a: all[all.length - 1], attempt: all.length - 1 };
  });
  const failed: FailedTask[] = [];
  const rows = latest.map(({ a, attempt }, i): RunTask => {
    const final = a.final as SqlRow;
    const state = stateOf(JOB_RESULTS[final.result_state ?? ''] ?? 'failed');
    const dur = secs(a.start, a.end);
    let failIndex: number | undefined;
    if (state === 'f') {
      failIndex = failed.length;
      failed.push({ name: keys[i], cause: causeOf(final), secs: dur });
    }
    const on: number[] = [];
    for (const d of deps.get(`${jobId}|${keys[i]}`) ?? []) {
      const at = index.get(d);
      if (at !== undefined && at !== i && !on.includes(at)) on.push(at);
    }
    return { key: keys[i], startSec: secs(runStart, a.start), durSec: dur, state, deps: on, attempt, ...(failIndex !== undefined ? { failIndex } : {}) };
  });
  const order = taskOrder(keys, rows.map((r) => r.deps), rows.map((r) => r.startSec), `run ${runId}`, noDiag);
  const moved = new Map(order.map((from, to) => [from, to]));
  const tasks = order.map((from) => {
    const r = rows[from];
    return { ...r, deps: r.deps.map((d) => moved.get(d) ?? d).sort((x, y) => x - y) };
  });
  return { tasks, failed };
}

/**
 * System-table rows to Drafts shaped like the API path's (jobDraft / updateDraft), for finalize to join with the API drafts.
 * Rows may be the queries' per-run aggregates or raw hourly slices: they are aggregated here either way. Only the job and
 * pipeline ids among `items` are kept (visibility: what the reading identity can list), and only runs whose final slice
 * has a result. Name and run-as come from the item; there is no message text (the drawer fetches it by run id).
 */
export function historyDrafts(rows: HistoryRows, items: Item[], host: string, _me: string): Draft[] {
  const byId = new Map(items.map((i) => [`${i.type}:${i.id}`, i]));
  const deps = new Map(rows.deps.map((d) => [`${d.job_id ?? ''}|${d.task_key ?? ''}`, parseKeys(d.depends_on_keys)]));
  const taskRuns = aggregate(rows.tasks, (r) => `${r.job_id ?? ''}|${r.job_run_id ?? ''}|${r.run_id ?? ''}|${r.task_key ?? ''}`);
  const tasksOf = new Map<string, Agg[]>();
  for (const t of taskRuns.values()) {
    if (!t.final) continue;
    const k = `${t.first.job_id ?? ''}|${t.first.job_run_id ?? ''}`;
    tasksOf.set(k, [...(tasksOf.get(k) ?? []), t]);
  }

  const out: Draft[] = [];
  for (const a of aggregate(rows.runs, (r) => `${r.job_id ?? ''}|${r.run_id ?? ''}`).values()) {
    const jobId = a.first.job_id ?? '';
    const runId = a.first.run_id ?? '';
    const item = byId.get(`job:${jobId}`);
    if (!item || !a.final) continue;
    const result = JOB_RESULTS[a.final.result_state ?? ''] ?? 'failed';
    const { tasks, failed } = runTasks(a.start, tasksOf.get(`${jobId}|${runId}`) ?? [], deps, jobId, runId);
    let cause: Cause | null = null;
    if (result === 'failed') {
      cause = causeOf(a.final);
      if (GENERIC.has(cause.code) && cause.label !== 'Timed out' && failed.length) cause = failed[0].cause;
    }
    out.push({
      id: Number(runId),
      runId,
      type: 'job',
      name: item.name,
      key: `j:${jobId}`,
      startTime: a.start,
      durationSec: secs(a.start, a.end),
      ntasks: tasks.length,
      failed,
      runAs: item.runAs ?? '',
      live: false,
      queued: false,
      continuous: false,
      result,
      params: {},
      retryAttempt: 0,
      cause,
      tasks,
      url: jobRunUrl(host, { job_id: Number(jobId), run_id: Number(runId) }),
      jobId: Number(jobId),
    });
  }

  for (const a of aggregate(rows.updates, (r) => `${r.pipeline_id ?? ''}|${r.update_id ?? ''}`).values()) {
    const pipelineId = a.first.pipeline_id ?? '';
    const updateId = a.first.update_id ?? '';
    const item = byId.get(`pipeline:${pipelineId}`);
    if (!item || !a.final) continue;
    const result = UPDATE_RESULTS[a.final.result_state ?? ''] ?? 'failed';
    const dur = secs(a.start, a.end);
    // No error events here: a failed update reads as updateDraft's eventless failure.
    const cause = result === 'failed' ? failureCause('FAILED', '') : null;
    out.push({
      id: pipelineNumber(updateId),
      runId: 'upd ' + updateId.slice(0, 8),
      type: 'pipeline',
      name: item.name,
      key: `p:${pipelineId}`,
      startTime: a.start,
      durationSec: dur,
      ntasks: 1,
      failed: cause ? [{ name: item.name, cause, secs: dur }] : [],
      runAs: item.runAs || a.final.run_as_user_name || '',
      live: false,
      queued: false,
      continuous: item.trigger === 'continuous',
      result,
      params: {},
      retryAttempt: 0,
      cause,
      tasks: [{ key: item.name, startSec: 0, durSec: dur, state: stateOf(result), deps: [], attempt: 0, ...(cause ? { failIndex: 0 } : {}) }],
      url: pipelineUpdateUrl(host, pipelineId, updateId),
      pipelineId,
    });
  }
  return out;
}
