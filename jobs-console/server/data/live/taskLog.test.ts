import { describe, it, expect } from 'vitest';
import type { jobs } from '@databricks/sdk-experimental';
import { findTask, jobLogText, pipelineLogText } from './taskLog';

const run: jobs.Run = {
  run_id: 7,
  tasks: [
    { task_key: 'load', run_id: 101, attempt_number: 0, status: { state: 'TERMINATED' } },
    { task_key: 'load', run_id: 102, attempt_number: 1, status: { state: 'TERMINATED' } },
    { task_key: 'extract', run_id: 100, attempt_number: 0, status: { state: 'RUNNING' } },
  ],
};

describe('findTask', () => {
  it('takes the latest attempt of the task key', () => {
    expect(findTask(run, 'load')?.run_id).toBe(102);
    expect(findTask(run, 'nope')).toBeUndefined();
  });
});

describe('jobLogText', () => {
  it('joins the parts that exist', () => {
    const text = jobLogText(findTask(run, 'load')!, {
      error: 'AnalysisException: boom',
      error_trace: 'Traceback\n  line 1',
      logs: 'hello\nworld',
      logs_truncated: true,
      notebook_output: { result: '42', truncated: false },
      run_job_output: { run_id: 999 },
      sql_output: { query_output: { output_link: 'https://x/sql' } },
      dbt_output: { artifacts_link: 'https://x/dbt' },
    });
    expect(text.split('\n')).toEqual([
      'hello', 'world', '[logs truncated]',
      'Notebook result: 42',
      'Triggered run 999',
      'SQL output: https://x/sql',
      'dbt artifacts: https://x/dbt',
      'Traceback', '  line 1',
      'ERROR AnalysisException: boom',
    ]);
  });

  it('says why when there is no output', () => {
    expect(jobLogText(findTask(run, 'extract')!, {})).toBe('No output yet: the task is still running.');
    expect(jobLogText(findTask(run, 'load')!, {})).toBe('No output recorded for this task.');
    expect(jobLogText({ task_key: 'q', status: { state: 'QUEUED' } }, undefined)).toBe('No output yet: the task has not started.');
  });
});

describe('pipelineLogText', () => {
  it('lists ERROR and WARN events of the update, oldest first, with exception messages', () => {
    const text = pipelineLogText([
      { level: 'ERROR', timestamp: '2026-09-28T10:02:00.000Z', message: 'Update abc is FAILED', origin: { update_id: 'u1' }, error: { exceptions: [{ class_name: 'x.AnalysisException', message: 'table missing' }] } },
      { level: 'WARN', timestamp: '2026-09-28T10:01:00.000Z', message: 'slow\nsource', origin: { update_id: 'u1' } },
      { level: 'INFO', timestamp: '2026-09-28T10:00:00.000Z', message: 'started', origin: { update_id: 'u1' } },
      { level: 'ERROR', timestamp: '2026-09-28T10:03:00.000Z', message: 'other', origin: { update_id: 'u2' } },
    ], 'u1');
    expect(text.split('\n')).toEqual([
      '2026-09-28T10:01:00.000Z WARN slow source',
      '2026-09-28T10:02:00.000Z ERROR Update abc is FAILED',
      '  AnalysisException: table missing',
    ]);
    expect(pipelineLogText([], 'u1')).toBe('No warnings or errors recorded for this update.');
  });
});
