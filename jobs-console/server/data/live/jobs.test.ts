import { describe, it, expect } from 'vitest';
import type { jobs } from '@databricks/sdk-experimental';
import { jobDraft, resultOf } from './jobs';

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
