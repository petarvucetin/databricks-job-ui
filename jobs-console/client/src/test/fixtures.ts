import type { Run, RunTask } from '../../../shared/domain/types';

const T0 = new Date(2026, 8, 22, 2, 41).getTime();

export function makeRun(over: Partial<Run> = {}): Run {
  return {
    id: 1,
    runId: '630000000123456',
    type: 'job',
    name: '[prod] finance_gl_co_gl_journals_v3',
    kind: 'failed',
    cause: { label: 'Cluster error', code: 'CLOUD_FAILURE', detail: 'spot instances reclaimed' },
    startTime: T0,
    durationSec: 1404,
    usualSec: 1552,
    ntasks: 10,
    failed: [{ name: 'load_gl', cause: { label: 'Cluster error', code: 'CLOUD_FAILURE', detail: 'spot instances reclaimed' }, secs: 3 }],
    runAs: 'sp-finance',
    mine: false,
    live: false,
    continuous: false,
    result: 'failed',
    params: { date: '2026-09-22', catalog: 'finance', mode: 'incremental' },
    ...over,
  };
}

const task = (key: string, startSec: number, durSec: number, state: RunTask['state'], deps: number[] = [], over: Partial<RunTask> = {}): RunTask =>
  ({ key, startSec, durSec, state, deps, attempt: 0, ...over });

/** A finished run with real tasks (as the live mapping sends them): a DAG, a retried task, one failure, two skipped. */
export function makeRealRun(over: Partial<Run> = {}): Run {
  return makeRun({
    id: 7,
    ntasks: 6,
    durationSec: 400,
    usualSec: 420,
    cause: { label: 'Table not found', code: 'RUN_EXECUTION_ERROR', detail: 'no table gl.raw' },
    failed: [{ name: 'transform', cause: { label: 'Table not found', code: 'RUN_EXECUTION_ERROR', detail: 'no table gl.raw' }, secs: 100 }],
    tasks: [
      task('setup', 0, 60, 'ok'),
      task('extract_a', 60, 120, 'ok', [0]),
      task('extract_b', 100, 200, 'ok', [0], { attempt: 1 }),
      task('transform', 300, 100, 'f', [1, 2], { failIndex: 0 }),
      task('load', -1, 0, 's', [3]),
      task('publish', -1, 0, 's', [4]),
    ],
    url: 'https://x.cloud.databricks.us/jobs/2/runs/7',
    jobId: 2,
    ...over,
  });
}

/** A live run with real tasks, one of them waiting to retry (attempt 2). */
export function makeRetryingRun(over: Partial<Run> = {}): Run {
  return makeRun({
    id: 8,
    kind: 'retrying',
    live: true,
    result: null,
    failed: [],
    ntasks: 4,
    durationSec: 3600,
    usualSec: 3000,
    cause: { label: 'Retrying', code: '', detail: 'attempt 2' },
    tasks: [
      task('a', 0, 600, 'ok'),
      task('d', 100, 3500, 'r', [], { attempt: 1 }),
      task('b', 600, 3000, 'r', [0]),
      task('c', -1, 0, 'p', [2]),
    ],
    ...over,
  });
}
