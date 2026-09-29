import type { jobs } from '@databricks/sdk-experimental';
import type { RunsResponse } from '../../../shared/domain/types';
import type { FakeData } from '../live/fakeApi';

/** A response as JSON for comparing a replay with its recording: source and the refresh's wall-clock ms aside. */
export const comparable = (r: RunsResponse): string => JSON.stringify({ ...r, source: 'live', ...(r.refresh ? { refresh: { ...r.refresh, ms: 0 } } : {}) });

/** Test fixture: a small workspace with every kind of job run and pipeline update. Only used by tests. */
export const NOW = 1_800_000_000_000;
const MIN = 60000;
const iso = (ms: number) => new Date(ms).toISOString();

const ok = (runId: number, jobId: number, name: string, ago: number, secs: number): jobs.BaseRun => ({
  run_id: runId, job_id: jobId, run_name: name, creator_user_name: 'me@x.com', start_time: NOW - ago * MIN, run_duration: secs * 1000,
  status: { state: 'TERMINATED', termination_details: { code: 'SUCCESS', type: 'SUCCESS' } }, state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' },
  tasks: [{ task_key: 'main', run_id: runId * 10, attempt_number: 0, start_time: NOW - ago * MIN, run_duration: secs * 1000, status: { state: 'TERMINATED' }, state: { result_state: 'SUCCESS' } }],
  job_parameters: [{ name: 'date', value: '2027-01-15' }],
});

const failedRun: jobs.BaseRun = {
  run_id: 201, job_id: 2, run_name: '[dev ann] gl_load', creator_user_name: 'ann@x.com', start_time: NOW - 90 * MIN, run_duration: 300_000,
  status: { state: 'TERMINATED', termination_details: { code: 'RUN_EXECUTION_ERROR', type: 'CLIENT_ERROR', message: 'Task load failed' } },
  state: { life_cycle_state: 'TERMINATED', result_state: 'FAILED' },
  tasks: [
    { task_key: 'extract', run_id: 2011, attempt_number: 0, start_time: NOW - 90 * MIN, run_duration: 100_000, status: { state: 'TERMINATED', termination_details: { code: 'SUCCESS' } }, state: { result_state: 'SUCCESS' } },
    {
      task_key: 'load', run_id: 2012, attempt_number: 0, start_time: NOW - 88 * MIN, run_duration: 200_000, depends_on: [{ task_key: 'extract' }],
      status: { state: 'TERMINATED', termination_details: { code: 'RUN_EXECUTION_ERROR', message: '[TABLE_OR_VIEW_NOT_FOUND] The table or view `gl`.`raw` cannot be found.' } },
      state: { result_state: 'FAILED' },
    },
  ],
};

export const richWorkspace: FakeData = {
  user: 'me@x.com',
  host: 'https://x.cloud.databricks.us',
  runs: [
    { // running, job 1
      run_id: 105, job_id: 1, run_name: 'nightly_etl', creator_user_name: 'me@x.com', start_time: NOW - 5 * MIN,
      status: { state: 'RUNNING' }, state: { life_cycle_state: 'RUNNING' },
      tasks: [{ task_key: 'main', run_id: 1050, attempt_number: 0, start_time: NOW - 5 * MIN, status: { state: 'RUNNING' } }],
    },
    { // retrying, job 4
      run_id: 401, job_id: 4, run_name: 'flaky_ingest', creator_user_name: 'sp-etl', start_time: NOW - 20 * MIN,
      status: { state: 'RUNNING' }, state: { life_cycle_state: 'RUNNING' },
      tasks: [
        { task_key: 'pull', run_id: 4010, attempt_number: 0, start_time: NOW - 20 * MIN, run_duration: 60_000, status: { state: 'TERMINATED', termination_details: { code: 'DRIVER_ERROR' } }, state: { result_state: 'FAILED' } },
        { task_key: 'pull', run_id: 4011, attempt_number: 1, start_time: NOW - 15 * MIN, status: { state: 'RUNNING' } },
      ],
    },
    { // queued, job 3
      run_id: 301, job_id: 3, run_name: 'report_refresh', creator_user_name: 'me@x.com', start_time: NOW - 2 * MIN,
      status: { state: 'QUEUED', queue_details: { code: 'ACTIVE_RUNS_LIMIT_REACHED', message: 'Queued: max concurrent runs reached' } }, state: { life_cycle_state: 'QUEUED' },
      tasks: [{ task_key: 'main', run_id: 3010, status: { state: 'QUEUED' } }],
    },
    failedRun,
    ok(104, 1, 'nightly_etl', 120, 2000), // slow: well over 1.5x the usual
    ok(103, 1, 'nightly_etl', 1440, 600),
    ok(102, 1, 'nightly_etl', 2880, 620),
    ok(101, 1, 'nightly_etl', 4320, 580),
  ],
  runPageSize: 3,
  pipelines: [{ pipeline_id: 'p1', name: 'raw_bronze' }, { pipeline_id: 'p2', name: 'stream_silver' }],
  specs: {
    p1: { pipeline_id: 'p1', name: '[dev ann] raw_bronze', run_as_user_name: 'ann@x.com', spec: { continuous: false } },
    p2: { pipeline_id: 'p2', name: 'stream_silver', run_as_user_name: 'sp-stream', spec: { continuous: true } },
  },
  updates: {
    p1: [
      { update_id: 'aaaa1111-0000-0000-0000-000000000003', creation_time: NOW - 10 * MIN, state: 'RUNNING', cause: 'API_CALL' },
      { update_id: 'aaaa1111-0000-0000-0000-000000000002', creation_time: NOW - 60 * MIN, state: 'FAILED', cause: 'API_CALL' },
      { update_id: 'aaaa1111-0000-0000-0000-000000000001', creation_time: NOW - 200 * MIN, state: 'COMPLETED', cause: 'JOB_TASK' },
    ],
    p2: [{ update_id: 'bbbb2222-0000-0000-0000-000000000001', creation_time: NOW - 3000 * MIN, state: 'RUNNING', cause: 'RETRY_ON_FAILURE' }],
  },
  events: {
    p1: [
      { event_type: 'update_progress', level: 'INFO', timestamp: iso(NOW - 190 * MIN), message: 'Update is COMPLETED', origin: { update_id: 'aaaa1111-0000-0000-0000-000000000001', pipeline_id: 'p1' } },
      { event_type: 'update_progress', level: 'ERROR', timestamp: iso(NOW - 55 * MIN), message: 'Update is FAILED', origin: { update_id: 'aaaa1111-0000-0000-0000-000000000002', pipeline_id: 'p1' } },
      {
        event_type: 'flow_progress', level: 'ERROR', timestamp: iso(NOW - 56 * MIN), message: 'Flow orders has FAILED',
        origin: { update_id: 'aaaa1111-0000-0000-0000-000000000002', pipeline_id: 'p1', flow_name: 'orders' },
        error: { exceptions: [{ class_name: 'org.apache.spark.sql.AnalysisException', message: '[UNRESOLVED_COLUMN] A column `amt` cannot be resolved.' }] },
      },
    ],
  },
  runsById: { 201: { ...failedRun } },
  outputs: { 2012: { error: '[TABLE_OR_VIEW_NOT_FOUND] The table or view `gl`.`raw` cannot be found.', error_trace: 'AnalysisException: ...\n  at load.py:12' } },
};
