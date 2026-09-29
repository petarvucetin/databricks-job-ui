import { describe, it, expect } from 'vitest';
import type { jobs } from '@databricks/sdk-experimental';
import { jobDraft, resultOf } from './jobs';
import type { DiagNote } from './trace';

const NOW = 1_800_000_000_000;
const t0 = NOW - 3600_000;

const finished = (over: Partial<jobs.BaseRun> = {}): jobs.BaseRun => ({
  run_id: 630000000000123,
  job_id: 42,
  run_name: '[dev john smith] finance_gl_load',
  creator_user_name: 'john@x.com',
  start_time: t0,
  end_time: t0 + 600_000,
  run_duration: 600_000,
  status: { state: 'TERMINATED', termination_details: { code: 'SUCCESS', type: 'SUCCESS', message: '' } },
  state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' },
  tasks: [
    { task_key: 'extract', run_id: 1, attempt_number: 0, start_time: t0, run_duration: 200_000, status: { state: 'TERMINATED' }, state: { result_state: 'SUCCESS' } },
    { task_key: 'load', run_id: 2, attempt_number: 0, start_time: t0, run_duration: 400_000, status: { state: 'TERMINATED' }, state: { result_state: 'SUCCESS' } },
  ],
  job_parameters: [{ name: 'date', value: '2026-09-28', default: '2026-01-01' }, { name: 'mode', default: 'incremental' }],
  ...over,
});

describe('jobDraft', () => {
  it('maps a finished successful run', () => {
    const d = jobDraft(finished(), NOW);
    expect(d).toMatchObject({
      id: 630000000000123, runId: '630000000000123', type: 'job', name: '[dev john smith] finance_gl_load', key: 'j:42',
      startTime: t0, durationSec: 600, live: false, queued: false, result: 'succeeded', ntasks: 2, failed: [],
      runAs: 'john@x.com', continuous: false, params: { date: '2026-09-28', mode: 'incremental' }, retryAttempt: 0, cause: null,
    });
  });

  it('falls back to end - start, then to the phase durations', () => {
    expect(jobDraft(finished({ run_duration: undefined }), NOW).durationSec).toBe(600);
    expect(jobDraft(finished({ run_duration: undefined, end_time: undefined, setup_duration: 5000, execution_duration: 60_000, cleanup_duration: 1000 }), NOW).durationSec).toBe(66);
  });

  it('live runs count elapsed time; a started PENDING/WAITING run is live; retries show up', () => {
    const running = jobDraft(finished({ status: { state: 'RUNNING' }, state: { life_cycle_state: 'RUNNING' }, end_time: 0, run_duration: undefined }), NOW);
    expect(running).toMatchObject({ live: true, queued: false, result: null, durationSec: 3600 });
    const waiting = jobDraft(finished({
      status: { state: 'WAITING' }, state: undefined, end_time: 0,
      tasks: [
        { task_key: 'load', run_id: 2, attempt_number: 0, start_time: t0, status: { state: 'TERMINATED' }, state: { result_state: 'FAILED' } },
        { task_key: 'load', run_id: 3, attempt_number: 1, start_time: 0, status: { state: 'WAITING' } },
      ],
    }), NOW);
    expect(waiting).toMatchObject({ live: true, retryAttempt: 1, ntasks: 1, failed: [] });
  });

  it('queued runs: state QUEUED, or PENDING/BLOCKED before any task started; duration 0 and the queue reason', () => {
    const q = jobDraft(finished({ status: { state: 'QUEUED', queue_details: { code: 'MAX_CONCURRENT_RUNS_REACHED', message: 'Queued: max concurrent runs' } }, end_time: 0, tasks: [] }), NOW);
    expect(q).toMatchObject({ queued: true, live: false, durationSec: 0, result: null, cause: { label: 'Queued', code: 'MAX_CONCURRENT_RUNS_REACHED', detail: 'Queued: max concurrent runs' } });
    const blocked = jobDraft(finished({ status: { state: 'BLOCKED' }, end_time: 0, tasks: [{ task_key: 'a', status: { state: 'BLOCKED' }, start_time: t0 }] }), NOW);
    expect(blocked.queued).toBe(true);
  });

  it('failed runs: cause from termination details, failed tasks from each task latest attempt', () => {
    const d = jobDraft(finished({
      status: { state: 'TERMINATED', termination_details: { code: 'CLOUD_FAILURE', type: 'CLOUD_FAILURE', message: 'Spot instances reclaimed' } },
      state: { life_cycle_state: 'TERMINATED', result_state: 'FAILED' },
      tasks: [
        { task_key: 'extract', attempt_number: 0, run_duration: 3000, status: { state: 'TERMINATED', termination_details: { code: 'CLOUD_FAILURE', message: 'lost' } }, state: { result_state: 'FAILED' } },
        { task_key: 'extract', attempt_number: 1, run_duration: 7000, status: { state: 'TERMINATED', termination_details: { code: 'DRIVER_ERROR', message: 'driver died' } }, state: { result_state: 'FAILED' } },
        { task_key: 'load', attempt_number: 0, status: { state: 'TERMINATED', termination_details: { code: 'SKIPPED' } }, state: { result_state: 'UPSTREAM_FAILED' } },
      ],
    }), NOW);
    expect(d.result).toBe('failed');
    expect(d.cause).toEqual({ label: 'Cluster error', code: 'CLOUD_FAILURE', detail: 'Spot instances reclaimed' });
    expect(d.failed).toEqual([{ name: 'extract', cause: { label: 'Cluster error', code: 'DRIVER_ERROR', detail: 'driver died' }, secs: 7 }]);
    expect(d.ntasks).toBe(2);
  });

  it('a generic run-level failure borrows the first failed task cause', () => {
    const d = jobDraft(finished({
      status: { state: 'TERMINATED', termination_details: { code: 'RUN_EXECUTION_ERROR', message: 'Workload failed, see run output for details' } },
      state: { result_state: 'FAILED' },
      tasks: [{ task_key: 'load', attempt_number: 0, run_duration: 2000, status: { state: 'TERMINATED', termination_details: { code: 'RUN_EXECUTION_ERROR', message: '[TABLE_OR_VIEW_NOT_FOUND] The table or view `finance`.`gl` cannot be found.' } }, state: { result_state: 'FAILED' } }],
    }), NOW);
    expect(d.cause?.label).toBe('Table not found');
  });

  it('timed-out runs are labelled Timed out', () => {
    const d = jobDraft(finished({ status: { state: 'TERMINATED', termination_details: { code: 'RUN_EXECUTION_ERROR', message: 'x' } }, state: { result_state: 'TIMEDOUT' }, tasks: [] }), NOW);
    expect(d).toMatchObject({ result: 'failed', cause: { label: 'Timed out', code: 'RUN_EXECUTION_ERROR' } });
  });

  it('falls back to the run name when there is no job id, and to {} when there are no parameters', () => {
    const d = jobDraft(finished({ job_id: undefined, run_name: 'adhoc', job_parameters: undefined }), NOW);
    expect(d.key).toBe('r:adhoc');
    expect(d.params).toEqual({});
  });
});

describe('resultOf', () => {
  it('maps result states, then termination codes', () => {
    expect(resultOf({ result_state: 'SUCCESS' })).toBe('succeeded');
    expect(resultOf({ result_state: 'SUCCESS_WITH_FAILURES' })).toBe('partial');
    expect(resultOf({ result_state: 'CANCELED' })).toBe('cancelled');
    expect(resultOf({ result_state: 'UPSTREAM_FAILED' })).toBe('cancelled');
    for (const s of ['FAILED', 'TIMEDOUT'] as const) expect(resultOf({ result_state: s })).toBe('failed');
    expect(resultOf(undefined, { code: 'SUCCESS' })).toBe('succeeded');
    expect(resultOf(undefined, { code: 'USER_CANCELED' })).toBe('cancelled');
    expect(resultOf(undefined, { code: 'SUCCESS_WITH_FAILURES' })).toBe('partial');
    expect(resultOf(undefined, { code: 'INTERNAL_ERROR' })).toBe('failed');
    expect(resultOf({ life_cycle_state: 'INTERNAL_ERROR' })).toBe('failed');
  });
});

describe('jobDraft tasks', () => {
  const S = 1000;
  const task = (key: string, over: Partial<jobs.RunTask> = {}): jobs.RunTask => ({
    task_key: key, run_id: key.length, attempt_number: 0, status: { state: 'TERMINATED', termination_details: { code: 'SUCCESS' } }, state: { result_state: 'SUCCESS' }, ...over,
  });
  const done = (key: string, startS: number, durS: number, over: Partial<jobs.RunTask> = {}) =>
    task(key, { start_time: t0 + startS * S, end_time: t0 + (startS + durS) * S, run_duration: durS * S, ...over });
  const failedT = { status: { state: 'TERMINATED' as const, termination_details: { code: 'RUN_EXECUTION_ERROR' as const, message: 'boom' } }, state: { result_state: 'FAILED' as const } };
  const dep = (...keys: string[]) => ({ depends_on: keys.map((k) => ({ task_key: k })) });

  // API order scrambled on purpose; extract_b was retried; transform failed; load and publish were skipped.
  const dag = finished({
    status: { state: 'TERMINATED', termination_details: { code: 'RUN_EXECUTION_ERROR', message: 'Task transform failed' } },
    state: { life_cycle_state: 'TERMINATED', result_state: 'FAILED' },
    tasks: [
      task('load', { ...dep('transform'), status: { state: 'TERMINATED', termination_details: { code: 'SKIPPED' } }, state: { result_state: 'UPSTREAM_FAILED' } }),
      done('transform', 300, 100, { ...dep('extract_a', 'extract_b'), ...failedT }),
      done('setup', 0, 60),
      done('extract_b', 100, 200, { ...dep('setup'), attempt_number: 1 }),
      done('extract_a', 60, 120, dep('setup')),
      done('extract_b', 65, 30, { ...dep('setup'), ...failedT }),
      task('publish', { ...dep('load', 'ghost'), status: { state: 'TERMINATED', termination_details: { code: 'SKIPPED' } }, state: { result_state: 'UPSTREAM_FAILED' } }),
    ],
  });

  it('lists each task once, dependencies first then by start, with real times, deps and states', () => {
    const d = jobDraft(dag, NOW);
    expect(d.tasks).toEqual([
      { key: 'setup', startSec: 0, durSec: 60, state: 'ok', deps: [], attempt: 0 },
      { key: 'extract_a', startSec: 60, durSec: 120, state: 'ok', deps: [0], attempt: 0 },
      { key: 'extract_b', startSec: 100, durSec: 200, state: 'ok', deps: [0], attempt: 1 },
      { key: 'transform', startSec: 300, durSec: 100, state: 'f', deps: [1, 2], attempt: 0, failIndex: 0 },
      { key: 'load', startSec: -1, durSec: 0, state: 's', deps: [3], attempt: 0 },
      { key: 'publish', startSec: -1, durSec: 0, state: 's', deps: [4], attempt: 0 },
    ]);
    expect(d.failed.map((f) => f.name)).toEqual(['transform']);
    expect(d.ntasks).toBe(d.tasks?.length);
  });

  it('notes a dependency that is not in the run, and a finished task with no times', () => {
    const notes: DiagNote[] = [];
    jobDraft(finished({ tasks: [...(dag.tasks ?? []), task('orphan')] }), NOW, (n) => notes.push(n));
    expect(notes).toContainEqual(expect.objectContaining({ level: 'warn', code: 'unknown-task-dependency', ref: 'run 630000000000123 task publish', message: expect.stringContaining('ghost') as unknown }));
    expect(notes).toContainEqual(expect.objectContaining({ level: 'info', code: 'task-times-missing', ref: 'run 630000000000123 task orphan' }));
    expect(notes.filter((n) => n.code === 'task-times-missing')).toHaveLength(1);
  });

  it('live run: running tasks count up to now, a task waiting to retry keeps its first start, blocked ones are pending', () => {
    const d = jobDraft(finished({
      status: { state: 'RUNNING' }, state: { life_cycle_state: 'RUNNING' }, end_time: 0, run_duration: undefined,
      tasks: [
        done('a', 0, 600),
        task('b', { ...dep('a'), start_time: t0 + 600 * S, status: { state: 'RUNNING' }, state: { life_cycle_state: 'RUNNING' } }),
        task('c', { ...dep('b'), status: { state: 'BLOCKED' }, state: { life_cycle_state: 'BLOCKED' } }),
        done('d', 100, 50, failedT),
        task('d', { attempt_number: 1, start_time: 0, status: { state: 'WAITING' }, state: { life_cycle_state: 'WAITING_FOR_RETRY' } }),
      ],
    }), NOW);
    expect(d.tasks).toEqual([
      { key: 'a', startSec: 0, durSec: 600, state: 'ok', deps: [], attempt: 0 },
      { key: 'd', startSec: 100, durSec: 3500, state: 'r', deps: [], attempt: 1 },
      { key: 'b', startSec: 600, durSec: 3000, state: 'r', deps: [0], attempt: 0 },
      { key: 'c', startSec: -1, durSec: 0, state: 'p', deps: [2], attempt: 0 },
    ]);
    expect(d.failed).toEqual([]);
  });

  it('breaks a dependency cycle by start time, with a note', () => {
    const notes: DiagNote[] = [];
    const d = jobDraft(finished({ tasks: [done('x', 50, 10, dep('y')), done('y', 0, 10, dep('x'))] }), NOW, (n) => notes.push(n));
    expect(d.tasks?.map((t) => [t.key, t.deps])).toEqual([['y', [1]], ['x', [0]]]);
    expect(notes.map((n) => n.code)).toContain('task-dependency-cycle');
  });

  it('links to the run page: run_page_url when given, else built from the host', () => {
    const host = 'https://x.cloud.databricks.us';
    expect(jobDraft(finished({ run_page_url: 'https://h/?o=1#job/42/run/1' }), NOW, undefined, host)).toMatchObject({ url: 'https://h/?o=1#job/42/run/1', jobId: 42 });
    expect(jobDraft(finished(), NOW, undefined, host).url).toBe('https://x.cloud.databricks.us/jobs/42/runs/630000000000123');
    expect(jobDraft(finished(), NOW).url).toBeUndefined();
  });
});
