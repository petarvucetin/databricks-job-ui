import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Item } from '../../../shared/domain/types';
import { Deadline } from '../live/collect';
import { fakeApi } from '../live/fakeApi';
import { readHistory } from './history';
import { JOB_RUNS_SQL, PIPELINE_UPDATES_SQL, TASK_DEPS_SQL, TASK_RUNS_SQL } from './queries';
import type { SqlRow } from './sql';

// historyDrafts as it is, unless a test makes it throw (finding 13).
const boom = vi.hoisted(() => ({ on: false }));
vi.mock('./mapHistory', async (importOriginal) => {
  const real = await importOriginal<typeof import('./mapHistory')>();
  return {
    ...real,
    historyDrafts: (...args: Parameters<typeof real.historyDrafts>) => {
      if (boom.on) throw new Error('bad row');
      return real.historyDrafts(...args);
    },
  };
});

afterEach(() => {
  boom.on = false;
});

const T = Date.UTC(2026, 9, 6, 10);
const items: Item[] = [{ type: 'job', id: '1', name: 'etl', deployed: false, mine: false, tags: {}, trigger: 'manual', paused: false, bundle: false }];
const run: SqlRow = { job_id: '1', run_id: '300', start_ms: String(T), end_ms: String(T + 600_000), result_state: 'FAILED', termination_code: 'RUN_EXECUTION_ERROR' };
const task = (key: string): SqlRow => ({ job_id: '1', job_run_id: '300', run_id: `30${key}`, task_key: key, start_ms: String(T), end_ms: String(T + 60_000), result_state: 'SUCCEEDED', termination_code: 'SUCCESS' });
const tooLarge = Object.assign(new Error('Inline byte limit exceeded: the result is larger than 25 MiB; use EXTERNAL_LINKS'), { code: 'BAD_REQUEST' });
const denied = Object.assign(new Error('User does not have SELECT on system.lakeflow.job_task_run_timeline'), { statusCode: 403, errorCode: 'PERMISSION_DENIED' });
const busy = Object.assign(new Error('The warehouse is starting'), { statusCode: 503, errorCode: 'TEMPORARILY_UNAVAILABLE' });

function read(answers: Partial<Record<'runs' | 'tasks' | 'deps' | 'updates', SqlRow[] | Error>>) {
  const params: Record<string, Record<string, string>> = {};
  const api = fakeApi({
    sql: (statement, p) => {
      const name = statement === JOB_RUNS_SQL ? 'runs' : statement === TASK_RUNS_SQL ? 'tasks' : statement === TASK_DEPS_SQL ? 'deps' : statement === PIPELINE_UPDATES_SQL ? 'updates' : '?';
      params[name] = p;
      return answers[name as keyof typeof answers] ?? [];
    },
  });
  const got = readHistory({ api, warehouseId: 'wh1', workspaceId: '42', from: T - 86400_000, to: T + 86400_000, maxRuns: 100, items, host: 'https://h', dl: new Deadline(Date.now() + 5000) });
  return { got, params };
}

describe('readHistory', () => {
  it('reads the task dependencies of the kept runs\' jobs only, with the same parameters (finding 2a)', async () => {
    const { got, params } = read({ runs: [run] });
    await got;
    expect(params.deps).toEqual(params.runs);
    expect(TASK_DEPS_SQL).toContain(`WITH kept_runs AS (\n${JOB_RUNS_SQL}\n)`);
    expect(TASK_DEPS_SQL).toContain('job_id IN (SELECT job_id FROM kept_runs)');
  });

  it('a failing task-runs query still answers the runs, without task detail; ntasks from the dependencies read (finding 2b)', async () => {
    const deps: SqlRow[] = [{ job_id: '1', task_key: 'a', depends_on_keys: '[]' }, { job_id: '1', task_key: 'b', depends_on_keys: '["a"]' }];
    const out = await read({ runs: [run], tasks: tooLarge, deps }).got;
    if ('reason' in out) throw new Error(out.reason);
    expect(out.drafts).toHaveLength(1);
    expect(out.drafts[0]).toMatchObject({ id: 300, result: 'failed', ntasks: 2, failed: [] });
    expect(out.drafts[0].tasks).toBeUndefined();
    expect(out.drafts[0].cause).toBeTruthy();
    expect(out.noTasks).toEqual({ reason: expect.stringContaining('Inline byte limit') as unknown, lasting: true });
  });

  it('a failing dependencies query: no task detail either; ntasks from the task runs; a transient failure is not lasting', async () => {
    const out = await read({ runs: [run], tasks: [task('a'), task('b'), task('c')], deps: busy }).got;
    if ('reason' in out) throw new Error(out.reason);
    expect(out.drafts[0]).toMatchObject({ ntasks: 3 });
    expect(out.drafts[0].tasks).toBeUndefined();
    expect(out.noTasks).toEqual({ reason: 'warehouse error: The warehouse is starting', lasting: false });
  });

  it('both task queries failing, nothing known: ntasks 0', async () => {
    const out = await read({ runs: [run], tasks: denied, deps: denied }).got;
    if ('reason' in out) throw new Error(out.reason);
    expect(out.drafts[0]).toMatchObject({ ntasks: 0 });
  });

  it.each([
    ['PERMISSION_DENIED', denied, 'no access to system.lakeflow (PERMISSION_DENIED)', true],
    ['TABLE_OR_VIEW_NOT_FOUND', Object.assign(new Error('[TABLE_OR_VIEW_NOT_FOUND] The table system.lakeflow.job_run_timeline cannot be found'), { code: 'BAD_REQUEST' }), 'no access to system.lakeflow (TABLE_OR_VIEW_NOT_FOUND)', true],
    ['a result too large', tooLarge, expect.stringContaining('Inline byte limit') as unknown as string, true],
    ['BYTE_LIMIT in the code', Object.assign(new Error('result exceeds limit'), { code: 'BYTE_LIMIT_EXCEEDED' }), 'warehouse error: result exceeds limit', true],
    ['a warehouse starting', busy, 'warehouse error: The warehouse is starting', false],
  ])('a failing job-runs query drops the history: %s', async (_, err, reason, lasting) => {
    expect(await read({ runs: err }).got).toEqual({ reason, lasting });
  });

  it('a failing pipeline-updates query drops the history too', async () => {
    expect(await read({ runs: [run], updates: busy }).got).toEqual({ reason: 'warehouse error: The warehouse is starting', lasting: false });
  });

  it('a mapping bug answers a reason (the API fallback), not a thrown error (finding 13)', async () => {
    boom.on = true;
    expect(await read({ runs: [run] }).got).toEqual({ reason: 'mapping the history failed: bad row', lasting: false });
  });
});
