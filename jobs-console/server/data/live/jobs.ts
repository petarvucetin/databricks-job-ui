import type { jobs } from '@databricks/sdk-experimental';
import type { Cause, FailedTask, RunResult } from '../../../shared/domain/types';
import { QUEUED, failureCause } from './causes';
import type { Draft } from './kinds';

type V2State = jobs.RunLifecycleStateV2State;

/** status.state, or the older life_cycle_state translated to it when status is absent. */
function stateOf(r: { status?: jobs.RunStatus; state?: jobs.RunState }): V2State | undefined {
  if (r.status?.state) return r.status.state;
  const lc = r.state?.life_cycle_state;
  switch (lc) {
    case undefined:
      return undefined;
    case 'WAITING_FOR_RETRY':
      return 'WAITING';
    case 'SKIPPED':
    case 'INTERNAL_ERROR':
      return 'TERMINATED';
    default:
      return lc;
  }
}

/** Outcome of a finished run or task: result_state first, then the termination code. */
export function resultOf(state?: jobs.RunState, term?: jobs.TerminationDetails): RunResult {
  switch (state?.result_state) {
    case 'SUCCESS':
      return 'succeeded';
    case 'SUCCESS_WITH_FAILURES':
      return 'partial';
    case 'CANCELED':
    case 'UPSTREAM_CANCELED':
    case 'UPSTREAM_FAILED':
    case 'EXCLUDED':
    case 'DISABLED':
      return 'cancelled';
    case undefined:
      break;
    default:
      return 'failed';
  }
  switch (term?.code) {
    case 'SUCCESS':
      return 'succeeded';
    case 'SUCCESS_WITH_FAILURES':
      return 'partial';
    case 'CANCELED':
    case 'USER_CANCELED':
    case 'SKIPPED':
    case 'DISABLED':
      return 'cancelled';
    default:
      return term?.type === 'SUCCESS' ? 'succeeded' : 'failed';
  }
}

interface Timed {
  start_time?: number;
  end_time?: number;
  run_duration?: number;
  setup_duration?: number;
  execution_duration?: number;
  cleanup_duration?: number;
}

/** Finished duration in seconds: run_duration, else end - start, else the sum of the phases. */
function finishedSec(r: Timed): number {
  const ms = r.run_duration || (r.end_time && r.start_time && r.end_time - r.start_time) || (r.setup_duration ?? 0) + (r.execution_duration ?? 0) + (r.cleanup_duration ?? 0);
  return Math.max(0, Math.round(ms / 1000));
}

/** Latest attempt of each task key, in first-seen order. */
function latestAttempts(tasks: jobs.RunTask[]): jobs.RunTask[] {
  const byKey = new Map<string, jobs.RunTask>();
  for (const t of tasks) {
    const seen = byKey.get(t.task_key);
    if (!seen || (t.attempt_number ?? 0) >= (seen.attempt_number ?? 0)) byKey.set(t.task_key, t);
  }
  return [...byKey.values()];
}

const causeOf = (r: { status?: jobs.RunStatus; state?: jobs.RunState }) =>
  failureCause(r.status?.termination_details?.code, r.status?.termination_details?.message || r.state?.state_message, r.state?.result_state === 'TIMEDOUT');

/** Run-level codes that only say "something failed"; the first failed task says more. */
const GENERIC = new Set(['', 'RUN_EXECUTION_ERROR', 'SUCCESS_WITH_FAILURES']);

export function jobDraft(run: jobs.BaseRun, now: number): Draft {
  const tasks = run.tasks ?? [];
  const state = stateOf(run);
  const started = tasks.some((t) => (t.start_time ?? 0) > 0 && !['QUEUED', 'BLOCKED'].includes(stateOf(t) ?? ''));
  const waiting = state === 'PENDING' || state === 'BLOCKED' || state === 'WAITING';
  const queued = state === 'QUEUED' || (waiting && !started);
  const live = !queued && (state === 'RUNNING' || state === 'TERMINATING' || waiting);
  const finished = !queued && !live;
  const start = run.start_time ?? 0;

  const failed: FailedTask[] = latestAttempts(tasks)
    .filter((t) => stateOf(t) === 'TERMINATED' && resultOf(t.state, t.status?.termination_details) === 'failed')
    .map((t) => ({ name: t.task_key, cause: causeOf(t), secs: finishedSec(t) }));

  const result = finished ? resultOf(run.state, run.status?.termination_details) : null;
  let cause: Cause | null = null;
  if (queued) {
    const q = run.status?.queue_details;
    cause = q ? { label: QUEUED.label, code: q.code ?? '', detail: q.message ?? '' } : QUEUED;
  } else if (result === 'failed' || result === 'partial') {
    cause = causeOf(run);
    if (GENERIC.has(cause.code) && cause.label !== 'Timed out' && failed.length) cause = failed[0].cause;
  }

  return {
    id: run.run_id ?? 0,
    runId: String(run.run_id ?? ''),
    type: 'job',
    name: run.run_name ?? '',
    key: run.job_id !== undefined ? `j:${run.job_id}` : `r:${run.run_name ?? ''}`,
    startTime: start,
    durationSec: queued ? 0 : live ? Math.max(0, Math.round((now - start) / 1000)) : finishedSec(run),
    ntasks: new Set(tasks.map((t) => t.task_key)).size,
    failed,
    runAs: run.creator_user_name ?? '',
    live,
    queued,
    continuous: false,
    result,
    params: Object.fromEntries((run.job_parameters ?? []).flatMap((p): [string, string][] => (p.name ? [[p.name, p.value ?? p.default ?? '']] : []))),
    retryAttempt: live ? Math.max(0, ...tasks.map((t) => t.attempt_number ?? 0)) : 0,
    cause,
  };
}
