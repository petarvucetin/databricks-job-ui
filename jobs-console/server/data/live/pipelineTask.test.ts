import { describe, it, expect } from 'vitest';
import type { jobs, pipelines } from '@databricks/sdk-experimental';
import probe from './fixtures/pipelineTaskProbe.json';
import { attemptChain, pipelineOutputOf, pipelineTaskCause, pipelineTaskLogText } from './pipelineTask';

const events = probe.events as pipelines.PipelineEvent[];
const updates = probe.updates as pipelines.UpdateInfo[];
const REQ = 'f8406928-e3e5-4786-9652-afc68b8ed0f2';
const LAST = '865bd04b-abd2-4707-9142-c28657ebe97d';

describe('pipelineOutputOf', () => {
  it('reads the pipeline_output block runs/get-output returns for a pipeline task (not in the SDK types)', () => {
    expect(pipelineOutputOf(probe.output as jobs.RunOutput)).toEqual({ requestId: REQ, updateId: LAST });
  });

  it('is undefined for other tasks or an output without it', () => {
    expect(pipelineOutputOf({ error: 'boom' })).toBeUndefined();
    expect(pipelineOutputOf(undefined)).toBeUndefined();
    expect(pipelineOutputOf({ pipeline_output: {} } as jobs.RunOutput)).toBeUndefined();
  });

  it('with only the request id, the request is also the last update', () => {
    expect(pipelineOutputOf({ pipeline_output: { pipeline_request_id: 'u1' } } as jobs.RunOutput)).toEqual({ requestId: 'u1', updateId: 'u1' });
  });
});

describe('attemptChain', () => {
  it('the update the job started, then the pipeline’s own retries up to the last one, oldest first', () => {
    expect(attemptChain(updates, REQ, LAST).map((u) => u.slice(0, 8))).toEqual(['f8406928', 'fbccc01b', '66467198', '1c5e723c', '587aa538', '865bd04b']);
  });

  it('leaves out updates something else started in between, and stops at the last update', () => {
    const u = (id: string, t: number, cause: pipelines.UpdateInfoCause) => ({ update_id: id, creation_time: t, cause });
    const list = [u('late', 50, 'RETRY_ON_FAILURE'), u('r2', 30, 'RETRY_ON_FAILURE'), u('mine', 10, 'JOB_TASK'), u('other', 20, 'USER_ACTION'), u('before', 5, 'RETRY_ON_FAILURE')];
    expect(attemptChain(list, 'mine', 'r2')).toEqual(['mine', 'r2']);
    expect(attemptChain(list, 'mine', 'not-listed')).toEqual(['mine', 'not-listed']);
  });

  it('without the update list, just the two ids it has', () => {
    expect(attemptChain([], 'a', 'b')).toEqual(['a', 'b']);
    expect(attemptChain([], 'a', 'a')).toEqual(['a']);
  });
});

describe('pipelineTaskLogText', () => {
  it('each attempt under its own heading, its errors with the exception below, the generic task error left out', () => {
    const text = pipelineTaskLogText(events, attemptChain(updates, REQ, LAST), probe.output.error);
    const lines = text.split('\n');
    expect(lines[0]).toBe('Pipeline update f8406928, attempt 1 of 6 (started by this task)');
    expect(lines[1]).toMatch(/ERROR Failed to resolve flow: 'better_ui\.default\.probe_fail'\.$/);
    expect(lines[2]).toMatch(/^ {2}ExtendedAnalysisException: \[TABLE_OR_VIEW_NOT_FOUND\] The table or view `better_ui`\.`default`\.`table_that_does_not_exist` cannot be found/);
    expect(lines).toContain('Pipeline update fbccc01b, attempt 2 of 6 (the pipeline retried)');
    expect(lines[lines.length - 2]).toBe('Pipeline update 865bd04b, attempt 6 of 6 (the pipeline retried)');
    expect(lines[lines.length - 1]).toBe('No warnings or errors recorded for this update.');
    expect(text).not.toContain('Please refer to the logs');
  });

  it('leaves out the generic error of a failed task too', () => {
    expect(pipelineTaskLogText([], ['u1'], 'Workload failed, see run output for details')).not.toContain('Workload failed');
  });

  it('keeps a task error that says something', () => {
    const text = pipelineTaskLogText([], ['u1'], 'Pipeline is not in a valid state');
    expect(text.split('\n')).toEqual(['Pipeline update u1, attempt 1 of 1 (started by this task)', 'No warnings or errors recorded for this update.', 'ERROR Pipeline is not in a valid state']);
  });
});

describe('pipelineTaskCause', () => {
  it('the exception of the latest attempt that has errors, with the flow it came from', () => {
    const got = pipelineTaskCause(events, attemptChain(updates, REQ, LAST));
    expect(got).toMatchObject({ cause: { label: 'Table not found', code: 'TABLE_OR_VIEW_NOT_FOUND' }, flow: 'better_ui.default.probe_fail' });
    expect(got?.cause.detail).toMatch(/^\[TABLE_OR_VIEW_NOT_FOUND\] The table or view `better_ui`/);
  });

  it('undefined when no attempt logged an error', () => {
    expect(pipelineTaskCause([], ['u1'])).toBeUndefined();
  });
});
