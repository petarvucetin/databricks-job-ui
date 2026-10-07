import { describe, it, expect } from 'vitest';
import type { Item } from '../../../shared/domain/types';
import { pipelineNumber } from '../live/pipelines';
import { historyDrafts, type SqlRow } from './mapHistory';

const HOST = 'https://dbc-1.cloud.databricks.com';
const T0 = Date.UTC(2026, 8, 20, 10, 0, 0);
const MIN = 60_000;
const HOUR = 60 * MIN;
const ms = (t: number) => String(t);

const item = (o: Partial<Item> & Pick<Item, 'type' | 'id' | 'name'>): Item => ({ deployed: false, mine: false, tags: {}, trigger: 'manual', paused: false, bundle: false, ...o });
const ITEMS: Item[] = [
  item({ type: 'job', id: '11', name: 'nightly_load', runAs: 'svc-etl' }),
  item({ type: 'job', id: '22', name: 'reports', runAs: 'me@x.com' }),
  item({ type: 'pipeline', id: 'p-1', name: 'bronze_pipe', runAs: 'svc-dlt', trigger: 'continuous' }),
];

const run = (o: SqlRow): SqlRow => ({ job_id: '11', run_id: '100', start_ms: ms(T0), end_ms: ms(T0 + 10 * MIN), result_state: 'SUCCEEDED', termination_code: 'SUCCESS', ...o });
const task = (o: SqlRow): SqlRow => ({ job_id: '11', job_run_id: '100', run_id: '1000', task_key: 'a', start_ms: ms(T0), end_ms: ms(T0 + MIN), result_state: 'SUCCEEDED', termination_code: 'SUCCESS', ...o });
const map = (rows: Partial<Parameters<typeof historyDrafts>[0]>, items = ITEMS) => historyDrafts({ runs: [], tasks: [], deps: [], updates: [], ...rows }, items, HOST, 'me@x.com');

describe('historyDrafts: job runs', () => {
  it('maps one run to a Draft shaped like the API path (name, runAs from the item; url; params {})', () => {
    const [d] = map({ runs: [run({})] });
    expect(d).toEqual({
      id: 100,
      runId: '100',
      type: 'job',
      name: 'nightly_load',
      key: 'j:11',
      startTime: T0,
      durationSec: 600,
      ntasks: 0,
      failed: [],
      runAs: 'svc-etl',
      live: false,
      queued: false,
      continuous: false,
      result: 'succeeded',
      params: {},
      retryAttempt: 0,
      cause: null,
      tasks: [],
      url: `${HOST}/jobs/11/runs/100`,
      jobId: 11,
    });
  });

  it('aggregates hourly slices into one run: first start, last end, the final slice result and termination code', () => {
    const rows = [
      run({ start_ms: ms(T0 + 2 * HOUR), end_ms: ms(T0 + 2 * HOUR + 15 * MIN), result_state: 'FAILED', termination_code: 'DRIVER_ERROR' }),
      run({ start_ms: ms(T0), end_ms: ms(T0 + HOUR), result_state: null, termination_code: null }),
      run({ start_ms: ms(T0 + HOUR), end_ms: ms(T0 + 2 * HOUR), result_state: null, termination_code: null }),
    ];
    const ds = map({ runs: rows });
    expect(ds).toHaveLength(1);
    expect(ds[0]).toMatchObject({ startTime: T0, durationSec: 2 * 3600 + 15 * 60, result: 'failed', cause: { label: 'Cluster error', code: 'DRIVER_ERROR', detail: '' } });
  });

  it('drops a run whose final slice has not been written yet (every result_state still NULL)', () => {
    expect(map({ runs: [run({ result_state: null, termination_code: null })] })).toEqual([]);
  });

  describe('ruling R8: a run that crossed the cutoff (started 23:00, slices to 01:00)', () => {
    const CUT = Date.UTC(2026, 8, 21, 0, 0, 0);
    const slices = (final: string | null) => [
      run({ run_id: '500', start_ms: ms(CUT - HOUR), end_ms: ms(CUT), result_state: null, termination_code: null }),
      run({ run_id: '500', start_ms: ms(CUT), end_ms: ms(CUT + HOUR), result_state: final, termination_code: final ? 'SUCCESS' : null }),
    ];

    it('is kept as one run once its final slice is SUCCEEDED, ending after the cutoff', () => {
      const ds = map({ runs: slices('SUCCEEDED') });
      expect(ds).toHaveLength(1);
      expect(ds[0]).toMatchObject({ id: 500, startTime: CUT - HOUR, durationSec: 2 * 3600, result: 'succeeded' });
    });

    it('is left out while its final slice has no result yet (the API active_only read covers it)', () => {
      expect(map({ runs: slices(null) })).toEqual([]);
    });
  });

  it('reads ISO timestamps too (space or T, with an offset)', () => {
    const [d] = map({ runs: [run({ start_ms: '2026-09-20 10:00:00.000+00:00', end_ms: '2026-09-20T10:05:00.000Z' })] });
    expect(d).toMatchObject({ startTime: T0, durationSec: 300 });
  });

  it.each([
    ['SUCCEEDED', 'succeeded'],
    ['FAILED', 'failed'],
    ['ERROR', 'failed'],
    ['TIMED_OUT', 'failed'],
    ['CANCELLED', 'cancelled'],
    ['SKIPPED', 'cancelled'],
    ['BLOCKED', 'cancelled'],
  ])('result_state %s -> %s', (state, result) => {
    expect(map({ runs: [run({ result_state: state, termination_code: '' })] })[0].result).toBe(result);
  });

  it('cause: failureCause(termination_code, ""), Timed out for TIMED_OUT, none for succeeded or cancelled runs', () => {
    expect(map({ runs: [run({ result_state: 'FAILED', termination_code: 'CLUSTER_ERROR' })] })[0].cause).toEqual({ label: 'Cluster error', code: 'CLUSTER_ERROR', detail: '' });
    expect(map({ runs: [run({ result_state: 'TIMED_OUT', termination_code: 'RUN_EXECUTION_ERROR' })] })[0].cause).toMatchObject({ label: 'Timed out' });
    expect(map({ runs: [run({ result_state: 'CANCELLED', termination_code: 'USER_CANCELED' })] })[0].cause).toBeNull();
  });

  it('a generic run failure takes the first failed task cause (like the API path)', () => {
    const [d] = map({
      runs: [run({ result_state: 'FAILED', termination_code: 'RUN_EXECUTION_ERROR' })],
      tasks: [task({ task_key: 'a', result_state: 'FAILED', termination_code: 'LIBRARY_INSTALLATION_ERROR' })],
    });
    expect(d.cause).toEqual({ label: 'Library installation error', code: 'LIBRARY_INSTALLATION_ERROR', detail: '' });
  });

  it('a run with failed tasks but a SUCCEEDED final state stays succeeded', () => {
    const [d] = map({ runs: [run({})], tasks: [task({ result_state: 'FAILED', termination_code: 'RUN_EXECUTION_ERROR' })] });
    expect(d.result).toBe('succeeded');
    expect(d.failed).toHaveLength(1);
  });

  it('drops rows for job ids that are not among the items (visibility), and tasks of runs it does not keep', () => {
    const ds = map({ runs: [run({ job_id: '99', run_id: '900' }), run({ job_id: '22', run_id: '200' })], tasks: [task({ job_id: '99', job_run_id: '900' })] });
    expect(ds.map((d) => d.id)).toEqual([200]);
    expect(ds[0]).toMatchObject({ name: 'reports', runAs: 'me@x.com', ntasks: 0 });
  });

  it('pipeline items do not let a job row through with the same id', () => {
    expect(map({ runs: [run({ job_id: 'p-1' })] })).toEqual([]);
  });
});

describe('historyDrafts: tasks', () => {
  it('keeps the latest attempt of each task key (attempt = count - 1), aggregates task slices, resolves deps to indexes', () => {
    const tasks = [
      // b: two attempts, the first failed; the retry ran over an hour boundary (two slices).
      task({ task_key: 'b', run_id: '2001', start_ms: ms(T0 + 2 * MIN), end_ms: ms(T0 + 3 * MIN), result_state: 'FAILED', termination_code: 'RUN_EXECUTION_ERROR' }),
      task({ task_key: 'b', run_id: '2002', start_ms: ms(T0 + 4 * MIN), end_ms: ms(T0 + 60 * MIN), result_state: null, termination_code: null }),
      task({ task_key: 'b', run_id: '2002', start_ms: ms(T0 + 60 * MIN), end_ms: ms(T0 + 64 * MIN), result_state: 'SUCCEEDED', termination_code: 'SUCCESS' }),
      task({ task_key: 'c', run_id: '3001', start_ms: ms(T0 + 65 * MIN), end_ms: ms(T0 + 66 * MIN), result_state: 'FAILED', termination_code: 'DRIVER_ERROR' }),
      task({ task_key: 'a', run_id: '1001', start_ms: ms(T0), end_ms: ms(T0 + 2 * MIN) }),
      task({ task_key: 'd', run_id: '4001', start_ms: ms(T0 + 66 * MIN), end_ms: ms(T0 + 66 * MIN), result_state: 'SKIPPED', termination_code: 'SKIPPED' }),
    ];
    const deps = [
      { job_id: '11', task_key: 'b', depends_on_keys: '["a"]' },
      { job_id: '11', task_key: 'c', depends_on_keys: '["a","b","gone"]' },
      { job_id: '11', task_key: 'd', depends_on_keys: '["c"]' },
      { job_id: '22', task_key: 'b', depends_on_keys: '["x"]' },
    ];
    const [d] = map({ runs: [run({ end_ms: ms(T0 + 70 * MIN), result_state: 'FAILED', termination_code: 'RUN_EXECUTION_ERROR' })], tasks, deps });
    expect(d.ntasks).toBe(4);
    expect(d.tasks).toEqual([
      { key: 'a', startSec: 0, durSec: 120, state: 'ok', deps: [], attempt: 0 },
      { key: 'b', startSec: 240, durSec: 3600, state: 'ok', deps: [0], attempt: 1 },
      { key: 'c', startSec: 3900, durSec: 60, state: 'f', deps: [0, 1], attempt: 0, failIndex: 0 },
      { key: 'd', startSec: 3960, durSec: 0, state: 's', deps: [2], attempt: 0 },
    ]);
    expect(d.failed).toEqual([{ name: 'c', cause: { label: 'Cluster error', code: 'DRIVER_ERROR', detail: '' }, secs: 60 }]);
    expect(d.cause).toEqual(d.failed[0].cause);
  });

  it('builds failed[] in task start order (not row order), so the run cause is the first task that failed', () => {
    const tasks = [
      task({ task_key: 'late', run_id: '2', start_ms: ms(T0 + 5 * MIN), end_ms: ms(T0 + 6 * MIN), result_state: 'FAILED', termination_code: 'DRIVER_ERROR' }),
      task({ task_key: 'early', run_id: '1', start_ms: ms(T0), end_ms: ms(T0 + MIN), result_state: 'FAILED', termination_code: 'LIBRARY_INSTALLATION_ERROR' }),
    ];
    const [d] = map({ runs: [run({ result_state: 'FAILED', termination_code: 'RUN_EXECUTION_ERROR' })], tasks });
    expect(d.failed.map((f) => f.name)).toEqual(['early', 'late']);
    expect(d.cause).toMatchObject({ code: 'LIBRARY_INSTALLATION_ERROR' });
    expect(d.tasks?.map((t) => [t.key, t.failIndex])).toEqual([
      ['early', 0],
      ['late', 1],
    ]);
  });

  it('orders tasks dependencies first, so a dependency that started later still comes before its dependant', () => {
    const tasks = [task({ task_key: 'x', run_id: '1', start_ms: ms(T0) }), task({ task_key: 'y', run_id: '2', start_ms: ms(T0 + MIN) })];
    const [d] = map({ runs: [run({})], tasks, deps: [{ job_id: '11', task_key: 'x', depends_on_keys: '["y"]' }] });
    expect(d.tasks?.map((t) => [t.key, t.deps])).toEqual([
      ['y', []],
      ['x', [0]],
    ]);
  });
});

describe('historyDrafts: pipeline updates', () => {
  const upd = (o: SqlRow): SqlRow => ({ pipeline_id: 'p-1', update_id: 'abcdef12-3456', start_ms: ms(T0), end_ms: ms(T0 + 5 * MIN), result_state: 'COMPLETED', run_as_user_name: 'svc-dlt-row', ...o });

  it('maps an update like updateDraft: pipelineNumber id, one task named after the pipeline, url', () => {
    const [d] = map({ updates: [upd({})] });
    expect(d).toEqual({
      id: pipelineNumber('abcdef12-3456'),
      runId: 'upd abcdef12',
      type: 'pipeline',
      name: 'bronze_pipe',
      key: 'p:p-1',
      startTime: T0,
      durationSec: 300,
      ntasks: 1,
      failed: [],
      runAs: 'svc-dlt',
      live: false,
      queued: false,
      continuous: true,
      result: 'succeeded',
      params: {},
      retryAttempt: 0,
      cause: null,
      tasks: [{ key: 'bronze_pipe', startSec: 0, durSec: 300, state: 'ok', deps: [], attempt: 0 }],
      url: `${HOST}/pipelines/p-1/updates/abcdef12-3456`,
      pipelineId: 'p-1',
    });
  });

  it('aggregates slices, maps COMPLETED / FAILED / CANCELED, and drops unknown pipelines and unfinished updates', () => {
    const ds = map({
      updates: [
        upd({ update_id: 'u-fail', start_ms: ms(T0), end_ms: ms(T0 + HOUR), result_state: null }),
        upd({ update_id: 'u-fail', start_ms: ms(T0 + HOUR), end_ms: ms(T0 + HOUR + MIN), result_state: 'FAILED' }),
        upd({ update_id: 'u-cancel', result_state: 'CANCELED' }),
        upd({ update_id: 'u-open', result_state: null }),
        upd({ pipeline_id: 'p-unknown', update_id: 'u-x' }),
      ],
    });
    expect(ds.map((d) => [d.runId, d.result, d.durationSec])).toEqual([
      ['upd u-fail', 'failed', 3660],
      ['upd u-cancel', 'cancelled', 300],
    ]);
    expect(ds[0]).toMatchObject({
      cause: { label: 'Failed', code: 'FAILED', detail: '' },
      failed: [{ name: 'bronze_pipe', cause: { label: 'Failed', code: 'FAILED', detail: '' }, secs: 3660 }],
      tasks: [{ key: 'bronze_pipe', startSec: 0, durSec: 3660, state: 'f', deps: [], attempt: 0, failIndex: 0 }],
    });
    expect(ds[1].tasks?.[0].state).toBe('s');
  });

  it('falls back to the row run_as_user_name when the item has no runAs', () => {
    const [d] = map({ updates: [upd({})] }, [item({ type: 'pipeline', id: 'p-1', name: 'bronze_pipe' })]);
    expect(d).toMatchObject({ runAs: 'svc-dlt-row', continuous: false });
  });
});
