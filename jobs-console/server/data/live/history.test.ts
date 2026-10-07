import { describe, it, expect, vi } from 'vitest';
import type { jobs } from '@databricks/sdk-experimental';
import type { RunsResponse } from '../../../shared/domain/types';
import { createLiveRunSource, createLiveState, type LiveSourceOptions, type LiveState } from './liveRunSource';
import { createLiveProvider } from './liveProvider';
import { DEFAULT_LIMITS, type LiveLimits, type RefreshSettings } from './limits';
import { fakeApi, type FakeData } from './fakeApi';
import { pipelineNumber } from './pipelines';
import { readHistoryConfig, type HistoryConfig } from '../systables/config';
import { JOB_RUNS_SQL, PIPELINE_UPDATES_SQL, TASK_DEPS_SQL, TASK_RUNS_SQL } from '../systables/queries';
import { PROBE_SQL } from '../systables/probe';
import type { SqlRow } from '../systables/sql';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
/** The viewer is in New York (EDT): getTimezoneOffset() 240. */
const TZ = 240;
/** Local midnight starting Wed Oct 7 2026 in New York. */
const DAY2 = Date.UTC(2026, 9, 7) + TZ * MIN;
const DAY1 = DAY2 - DAY;
const ON: HistoryConfig = readHistoryConfig({ DATABRICKS_WAREHOUSE_ID: 'wh1', DATABRICKS_WORKSPACE_ID: '42' });

const ok = (runId: number, jobId: number, start: number, secs: number): jobs.BaseRun => ({
  run_id: runId, job_id: jobId, run_name: `job_${jobId}`, creator_user_name: 'me@x.com', start_time: start, run_duration: secs * 1000,
  status: { state: 'TERMINATED', termination_details: { code: 'SUCCESS' } }, state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' }, tasks: [{ task_key: 'main' }],
});
const running = (runId: number, jobId: number, start: number): jobs.BaseRun => ({
  run_id: runId, job_id: jobId, run_name: `job_${jobId}`, creator_user_name: 'me@x.com', start_time: start, status: { state: 'RUNNING' }, state: { life_cycle_state: 'RUNNING' }, tasks: [{ task_key: 'main' }],
});

const hRun = (runId: number, jobId: number, start: number, secs: number, result = 'SUCCEEDED'): SqlRow => ({
  job_id: String(jobId), run_id: String(runId), start_ms: String(start), end_ms: String(start + secs * 1000), result_state: result, termination_code: result === 'SUCCEEDED' ? 'SUCCESS' : 'RUN_EXECUTION_ERROR',
});
const hUpdate = (updateId: string, start: number, secs: number): SqlRow => ({ pipeline_id: 'p1', update_id: updateId, start_ms: String(start), end_ms: String(start + secs * 1000), result_state: 'COMPLETED', run_as_user_name: 'svc' });

interface Hist {
  runs?: SqlRow[];
  tasks?: SqlRow[];
  updates?: SqlRow[];
  /** Answers instead of the rows for these statements. */
  fail?: Partial<Record<'probe' | 'runs' | 'tasks', Error>>;
}

/** Answers the probe and the four history queries; records every statement with its parameters. */
function sqlFake(h: () => Hist, seen: { statement: string; params: Record<string, string> }[]): FakeData['sql'] {
  return (statement, params) => {
    seen.push({ statement, params });
    const cur = h();
    if (statement === PROBE_SQL) return cur.fail?.probe ?? [{ ok: '1' }];
    if (statement === JOB_RUNS_SQL) return cur.fail?.runs ?? cur.runs ?? [];
    if (statement === TASK_RUNS_SQL) return cur.fail?.tasks ?? cur.tasks ?? [];
    if (statement === TASK_DEPS_SQL) return [];
    if (statement === PIPELINE_UPDATES_SQL) return cur.updates ?? [];
    return new Error(`unexpected statement ${statement}`);
  };
}

function setup(o: { data?: FakeData; hist?: Hist; config?: HistoryConfig; limits?: Partial<LiveLimits>; refresh?: RefreshSettings; now: number; state?: LiveState; opts?: Partial<LiveSourceOptions> }) {
  const seen: { statement: string; params: Record<string, string> }[] = [];
  let hist = o.hist ?? {};
  let now = o.now;
  const data: FakeData = {
    user: 'me@x.com',
    host: 'https://h.example',
    jobs: [{ job_id: 1, creator_user_name: 'me@x.com', settings: { name: 'etl' } }, { job_id: 2, creator_user_name: 'ann@x.com', settings: { name: 'report' } }],
    pipelines: [{ pipeline_id: 'p1', name: 'pipe' }],
    specs: { p1: { pipeline_id: 'p1', name: 'pipe', run_as_user_name: 'svc', spec: { continuous: false } } },
    ...o.data,
  };
  data.sql = sqlFake(() => hist, seen);
  const api = fakeApi(data);
  const listJobRuns = api.listJobRuns;
  const runReqs: jobs.ListRunsRequest[] = [];
  api.listJobRuns = (req) => (runReqs.push(req), listJobRuns(req));
  const state = o.state ?? createLiveState();
  const src = () =>
    createLiveRunSource({ api, user: () => Promise.resolve('me@x.com'), userKey: 'me', state, limits: { ...DEFAULT_LIMITS, ...o.limits }, refresh: o.refresh, clock: () => now, warn: vi.fn(), history: o.config ?? ON, ...o.opts });
  return {
    api,
    data,
    seen,
    runReqs,
    state,
    list: () => src().listRuns(undefined, TZ),
    setNow: (t: number) => (now = t),
    setHist: (h: Hist) => (hist = h),
    historyCalls: () => seen.filter((s) => s.statement === JOB_RUNS_SQL),
  };
}

const ids = (r: RunsResponse) => r.runs.map((x) => x.id);

describe('run history from system tables, today from the API', () => {
  it('merges history and API runs from both sides of the cutoff; the API copy wins on the same id', async () => {
    const now = DAY2 + 14 * HOUR;
    const t = setup({
      now,
      data: { runs: [ok(500, 1, now - HOUR, 600), running(450, 1, DAY1 + 23 * HOUR)] },
      hist: { runs: [hRun(450, 1, DAY1 + 23 * HOUR, 600, 'FAILED'), hRun(300, 1, DAY1 + 10 * HOUR, 600), hRun(200, 2, DAY1 - 5 * DAY, 900, 'FAILED')], updates: [hUpdate('aaaabbbb-0000-0000-0000-000000000001', DAY1 + 12 * HOUR, 120)] },
    });
    const res = await t.list();
    const upd = pipelineNumber('aaaabbbb-0000-0000-0000-000000000001');
    expect(ids(res)).toEqual([500, 450, upd, 300, 200]);
    const byId = new Map(res.runs.map((r) => [r.id, r]));
    expect(byId.get(450)).toMatchObject({ live: true, kind: 'slow' }); // the API's copy (still running, past its usual), not history's FAILED
    expect(byId.get(300)).toMatchObject({ name: 'etl', kind: 'succeeded', mine: true, url: 'https://h.example/jobs/1/runs/300' });
    expect(byId.get(200)).toMatchObject({ name: 'report', kind: 'failed', mine: false });
    expect(res.history).toEqual({ source: 'system-tables', days: 90 });
    // History is everything before local midnight, back historyDays; parameters are strings.
    expect(t.historyCalls()[0].params).toEqual({ ws: '42', from_ts: new Date(now - 90 * DAY).toISOString(), to_ts: new Date(DAY2).toISOString(), max_runs: '20000' });
    // The dependencies of the kept runs' jobs only: the same parameters (finding 2a).
    expect(t.seen.find((s) => s.statement === TASK_DEPS_SQL)?.params).toEqual(t.historyCalls()[0].params);
    // The API reads today, plus whatever is still running.
    expect(t.runReqs.some((r) => r.start_time_from === DAY2)).toBe(true);
    expect(t.runReqs.some((r) => r.active_only)).toBe(true);
    // A history pipeline update can be refreshed and its log read like any other.
    expect(t.state.pipelineRefs.get(upd)).toEqual({ pipelineId: 'p1', updateId: 'aaaabbbb-0000-0000-0000-000000000001', startTime: DAY1 + 12 * HOUR, info: { pipelineId: 'p1', name: 'pipe', continuous: false, runAs: 'svc' } });
  });

  it('caches history for the local day; at 00:05 the API reaches back to 21:05 and the history is re-queried', async () => {
    const t = setup({ now: DAY2 - 2 * HOUR, data: { runs: [ok(600, 1, DAY2 - 2.5 * HOUR, 60)] }, hist: { runs: [hRun(300, 1, DAY1 + 10 * HOUR, 600)] } });
    await t.list();
    t.setNow(DAY2 - HOUR);
    await t.list();
    expect(t.historyCalls()).toHaveLength(1); // same day: cached
    t.setNow(DAY2 + 5 * MIN);
    // A fresh history read just after midnight does not have yesterday evening's runs yet: the API overlap does.
    const res = await t.list();
    expect(t.historyCalls()).toHaveLength(2);
    expect(t.historyCalls()[1].params.to_ts).toBe(new Date(DAY2).toISOString());
    expect(t.runReqs.some((r) => r.start_time_from === DAY2 + 5 * MIN - 3 * HOUR)).toBe(true);
    expect(ids(res)).toEqual([600, 300]);
    // Hours later the API still covers from 21:05: nothing from yesterday evening is lost while history is cached.
    t.setNow(DAY2 + 10 * HOUR);
    expect(ids(await t.list())).toEqual([600, 300]);
    expect(t.historyCalls()).toHaveLength(2);
  });

  it.each([
    ['deltas', { incremental: true, fullRefreshMs: DAY }],
    ['a full reload', { incremental: true, fullRefreshMs: MIN }],
  ])('a run that started before the API window and was still running when history was cached stays after it finishes (%s)', async (_, refresh) => {
    const late = running(700, 1, DAY1 + 22 * HOUR); // 22:00, after apiFrom (21:30)
    const early = running(710, 1, DAY1 + 20 * HOUR); // 20:00, before apiFrom
    const t = setup({ now: DAY2 + 30 * MIN, refresh, data: { runs: [late, early], runsById: {} }, hist: { runs: [] } });
    expect(ids(await t.list())).toEqual([700, 710]);
    // Both finish at 01:30; the history cached at 00:30 has neither.
    const done = (r: jobs.BaseRun): jobs.BaseRun => ({ ...r, run_duration: DAY2 + 90 * MIN - (r.start_time ?? 0), status: { state: 'TERMINATED', termination_details: { code: 'SUCCESS' } }, state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' } });
    t.data.runs = [done(late), done(early)];
    t.data.runsById = { 700: done(late), 710: done(early) };
    t.setNow(DAY2 + 2 * HOUR);
    const res = await t.list();
    expect(ids(res)).toEqual([700, 710]);
    expect(res.runs.map((r) => r.kind)).toEqual(['succeeded', 'succeeded']);
    expect(res.refresh?.mode).toBe(refresh.fullRefreshMs === MIN ? 'full' : 'delta');
  });

  it('no warehouse: API only as today, with the reason', async () => {
    const now = DAY2 + 14 * HOUR;
    const data: FakeData = { runs: [ok(500, 1, now - HOUR, 600), ok(400, 1, now - 20 * DAY, 600), ok(100, 1, now - 40 * DAY, 600)] };
    const t = setup({ now, data, config: readHistoryConfig({}) });
    const res = await t.list();
    expect(res.history).toEqual({ source: 'api', days: 30, reason: 'no SQL warehouse configured' });
    expect(t.seen).toEqual([]);
    expect(t.api.calls).not.toContain('workspaceId');
    const today = createLiveRunSource({ api: fakeApi({ ...t.data }), user: () => Promise.resolve('me@x.com'), userKey: 'me', state: createLiveState(), limits: DEFAULT_LIMITS, clock: () => now, warn: vi.fn() });
    const before = await today.listRuns(undefined, TZ);
    expect(before.history).toBeUndefined();
    expect(res.runs).toEqual(before.runs);
    expect(ids(res)).toEqual([500, 400]);
  });

  it('PERMISSION_DENIED reading history: API only with that reason, never an error; a lasting failure is kept until the day ends (finding 2c)', async () => {
    const now = DAY2 + 14 * HOUR;
    const denied = Object.assign(new Error('User does not have USE SCHEMA on Schema system.lakeflow'), { statusCode: 403, errorCode: 'PERMISSION_DENIED' });
    const t = setup({ now, data: { runs: [ok(500, 1, now - HOUR, 600), ok(400, 1, now - 20 * DAY, 600)] }, hist: { fail: { runs: denied } } });
    const res = await t.list();
    const fallback = { source: 'api', days: 30, reason: 'no access to system.lakeflow (PERMISSION_DENIED)' };
    expect(res.history).toEqual(fallback);
    expect(ids(res)).toEqual([500, 400]);
    // Granted meanwhile: a deterministic failure is not retried at +6 min, nor hours later (no SQL at all)...
    t.setHist({ runs: [hRun(300, 1, DAY1 + 10 * HOUR, 600)] });
    const statements = t.seen.length;
    for (const later of [MIN, 6 * MIN, 9 * HOUR]) {
      t.setNow(now + later);
      expect((await t.list()).history).toEqual(fallback);
    }
    expect(t.seen).toHaveLength(statements);
    // ...but the next local day reads history again.
    t.setNow(DAY2 + DAY + HOUR);
    const next = await t.list();
    expect(next.history).toEqual({ source: 'system-tables', days: 90 });
    expect(ids(next)).toContain(300);
  });

  it('a transient failure (the warehouse starting) is served for 5 minutes, then history is read again (R11)', async () => {
    const now = DAY2 + 14 * HOUR;
    const busy = Object.assign(new Error('The warehouse is starting'), { statusCode: 503, errorCode: 'TEMPORARILY_UNAVAILABLE' });
    const t = setup({ now, data: { runs: [ok(500, 1, now - HOUR, 600)] }, hist: { fail: { runs: busy } } });
    const fallback = { source: 'api', days: 30, reason: 'warehouse error: The warehouse is starting' };
    expect((await t.list()).history).toEqual(fallback);
    t.setHist({ runs: [hRun(300, 1, DAY1 + 10 * HOUR, 600)] });
    t.setNow(now + MIN);
    const statements = t.seen.length;
    expect((await t.list()).history).toEqual(fallback);
    expect(t.seen).toHaveLength(statements);
    t.setNow(now + 6 * MIN);
    const next = await t.list();
    expect(next.history).toEqual({ source: 'system-tables', days: 90 });
    expect(ids(next)).toContain(300);
  });

  it('a failing task-runs query still serves the history runs, without task detail (finding 2b)', async () => {
    const tooLarge = Object.assign(new Error('Inline byte limit exceeded'), { code: 'BAD_REQUEST' });
    const t = setup({ now: DAY2 + 14 * HOUR, hist: { runs: [hRun(300, 1, DAY1 + 10 * HOUR, 600)], fail: { tasks: tooLarge } } });
    const res = await t.list();
    expect(res.history).toEqual({ source: 'system-tables', days: 90 });
    const run = res.runs.find((r) => r.id === 300);
    expect(run).toMatchObject({ name: 'etl', kind: 'succeeded', ntasks: 0 });
    expect(run?.tasks).toBeUndefined();
    // A result too large lasts the day: the history (without tasks) is not read again.
    t.setNow(DAY2 + 14 * HOUR + 10 * MIN);
    await t.list();
    expect(t.historyCalls()).toHaveLength(1);
  });

  it('a slow warehouse: the response comes at the API\'s pace, the API part served with "timed out", the failure kept 5 minutes (finding 3)', async () => {
    const now = DAY2 + 14 * HOUR;
    const t = setup({ now, data: { runs: [ok(500, 1, now - HOUR, 600), ok(400, 1, now - 20 * DAY, 600)] }, hist: { runs: [hRun(300, 1, DAY1 + 10 * HOUR, 600)] }, opts: { timer: Date.now, historyBudgetMs: 150 } });
    const exec = t.api.executeStatement;
    t.api.executeStatement = (req) => new Promise((r) => setTimeout(r, 700)).then(() => exec(req));
    const t0 = Date.now();
    const res = await t.list();
    expect(Date.now() - t0).toBeLessThan(600);
    expect(res.history).toEqual({ source: 'api', days: 1, reason: 'timed out' });
    expect(ids(res)).toEqual([500]); // today's API part
    // Within 5 minutes: the API alone over 30 days, no SQL; after them, history is tried again.
    t.api.executeStatement = exec;
    t.setNow(now + MIN);
    const statements = t.seen.length;
    const next = await t.list();
    expect(next.history).toEqual({ source: 'api', days: 30, reason: 'timed out' });
    expect(ids(next)).toEqual([500, 400]);
    expect(t.seen).toHaveLength(statements);
    await new Promise((r) => setTimeout(r, 800)); // the first read's statements land meanwhile
    t.setNow(now + 6 * MIN);
    expect((await t.list()).history).toEqual({ source: 'system-tables', days: 90 });
  });

  it('the probe, the history read and the API run side by side: about the slower of the two, not their sum (finding 3)', async () => {
    const now = DAY2 + 14 * HOUR;
    const t = setup({ now, data: { runs: [ok(500, 1, now - HOUR, 600)] }, hist: { runs: [hRun(300, 1, DAY1 + 10 * HOUR, 600)] }, opts: { timer: Date.now } });
    const slow = <A, R>(fn: (a: A) => Promise<R>) => (a: A) => new Promise((r) => setTimeout(r, 300)).then(() => fn(a));
    t.api.executeStatement = slow(t.api.executeStatement);
    t.api.listJobRuns = slow(t.api.listJobRuns);
    const t0 = Date.now();
    const res = await t.list();
    // In sequence: probe 300 + queries 300 + runs list 300 + active runs 300 = 1200 ms.
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(res.history).toEqual({ source: 'system-tables', days: 90 });
    expect(ids(res)).toEqual([500, 300]);
  });

  it('concurrent first lists share one history read (finding 10)', async () => {
    const t = setup({ now: DAY2 + 14 * HOUR, hist: { runs: [hRun(300, 1, DAY1 + 10 * HOUR, 600)] } });
    const other = () => createLiveRunSource({ api: t.api, user: () => Promise.resolve('me@x.com'), userKey: 'me', state: t.state, limits: DEFAULT_LIMITS, clock: () => DAY2 + 14 * HOUR, warn: vi.fn(), history: ON });
    const [a, b] = await Promise.all([t.list(), other().listRuns(undefined, TZ, { full: true })]);
    expect(ids(a)).toContain(300);
    expect(ids(b)).toContain(300);
    expect(t.historyCalls()).toHaveLength(1);
  });

  it('a job or pipeline gone from the item list leaves history on the next list, without reading SQL again (finding 5)', async () => {
    const now = DAY2 + 14 * HOUR;
    const t = setup({ now, hist: { runs: [hRun(300, 1, DAY1 + 10 * HOUR, 600), hRun(200, 2, DAY1 + 9 * HOUR, 600)], updates: [hUpdate('aaaabbbb-0000-0000-0000-000000000009', DAY1 + 12 * HOUR, 60)] } });
    const upd = pipelineNumber('aaaabbbb-0000-0000-0000-000000000009');
    expect(ids(await t.list())).toEqual([upd, 300, 200]);
    // Job 2 and the pipeline are deleted (or no longer visible); the item list is read again (its 5 minutes are up).
    t.data.jobs = t.data.jobs!.filter((j) => j.job_id !== 2);
    t.data.pipelines = [];
    t.setNow(now + 6 * MIN);
    const src = createLiveRunSource({ api: t.api, user: () => Promise.resolve('me@x.com'), userKey: 'me', state: t.state, limits: DEFAULT_LIMITS, clock: () => now + 6 * MIN, warn: vi.fn(), history: ON });
    await src.listItems();
    expect(ids(await t.list())).toEqual([300]);
    expect(t.historyCalls()).toHaveLength(1);
    expect(t.state.pipelineRefs.has(upd)).toBe(true); // remembered from the first list; no longer refreshed from history
  });

  it('an incomplete job list still gives history for the listed jobs, capped "job list incomplete"; read again once the list is complete (finding 6)', async () => {
    const now = DAY2 + 14 * HOUR;
    const t = setup({ now, limits: { itemsTimeoutMs: 60 }, data: { jobPageSize: 1 }, hist: { runs: [hRun(300, 1, DAY1 + 10 * HOUR, 600), hRun(200, 2, DAY1 + 9 * HOUR, 600)] }, opts: { timer: Date.now } });
    const listJobs = t.api.listJobs;
    let slowPage2 = true;
    t.api.listJobs = (req) => (req.page_token && slowPage2 ? new Promise((r) => setTimeout(r, 200)).then(() => listJobs(req)) : listJobs(req));
    const res = await t.list();
    expect(res.history).toEqual({ source: 'system-tables', days: 90, capped: true, reason: 'job list incomplete' });
    expect(ids(res)).toEqual([300]);
    // Not kept for the day: a complete list (read for the Jobs & ETL tab) brings a fresh read.
    slowPage2 = false;
    t.setNow(now + MIN);
    const src = createLiveRunSource({ api: t.api, user: () => Promise.resolve('me@x.com'), userKey: 'me', state: t.state, limits: DEFAULT_LIMITS, clock: () => now + MIN, warn: vi.fn(), history: ON });
    expect((await src.listItems()).partial).toBeUndefined();
    t.setNow(now + 2 * MIN);
    const next = await t.list();
    expect(t.historyCalls()).toHaveLength(2);
    expect(next.history).toEqual({ source: 'system-tables', days: 90 });
    expect(ids(next)).toEqual([300, 200]);
  });

  it('an incomplete job list is read again after 5 minutes even without a complete list', async () => {
    const now = DAY2 + 14 * HOUR;
    const t = setup({ now, limits: { itemsTimeoutMs: 60 }, data: { jobPageSize: 1 }, hist: { runs: [hRun(300, 1, DAY1 + 10 * HOUR, 600)] }, opts: { timer: Date.now } });
    const listJobs = t.api.listJobs;
    t.api.listJobs = (req) => (req.page_token ? new Promise((r) => setTimeout(r, 200)).then(() => listJobs(req)) : listJobs(req));
    await t.list();
    t.setNow(now + 4 * MIN);
    await t.list();
    expect(t.historyCalls()).toHaveLength(1);
    t.setNow(now + 6 * MIN);
    await t.list();
    expect(t.historyCalls()).toHaveLength(2);
  });

  it('a cached day skips the probe: later lists make no SQL calls at all (R11)', async () => {
    const t = setup({ now: DAY2 + 14 * HOUR, hist: { runs: [hRun(300, 1, DAY1 + 10 * HOUR, 600)] } });
    await t.list();
    expect(t.seen.filter((s) => s.statement === PROBE_SQL)).toHaveLength(1);
    for (const m of [11, 30, 60]) {
      t.setNow(DAY2 + 14 * HOUR + m * MIN); // past the probe's 10 minutes too
      expect((await t.list()).history).toEqual({ source: 'system-tables', days: 90 });
    }
    expect(t.seen.filter((s) => s.statement === PROBE_SQL)).toHaveLength(1);
    expect(t.historyCalls()).toHaveLength(1);
  });

  it.each([
    ['deltas', { incremental: true, fullRefreshMs: DAY }],
    ['full reloads', { incremental: true, fullRefreshMs: MIN }],
  ])('a continuous pipeline whose current update started yesterday is listed today, and stays once it finishes (%s)', async (_, refresh) => {
    const now = DAY2 + 14 * HOUR;
    const live = { update_id: 'cont-1', creation_time: DAY1 + 15 * HOUR, state: 'RUNNING' as const };
    const t = setup({
      now, refresh, hist: { runs: [] },
      data: { specs: { p1: { pipeline_id: 'p1', name: 'pipe', run_as_user_name: 'svc', spec: { continuous: true } } }, updates: { p1: [live] } },
    });
    const id = pipelineNumber('cont-1');
    expect((await t.list()).runs.find((r) => r.id === id)).toMatchObject({ live: true, continuous: true });
    t.setNow(now + 30 * MIN);
    expect((await t.list()).runs.find((r) => r.id === id)).toMatchObject({ live: true });
    // It ends (the history cached this morning does not have it): it stays, finished.
    t.data.updates = { p1: [{ ...live, state: 'COMPLETED' }] };
    t.data.events = { p1: [{ event_type: 'update_progress', timestamp: new Date(now + 45 * MIN).toISOString(), origin: { update_id: 'cont-1' } }] };
    t.setNow(now + 60 * MIN);
    const res = await t.list();
    expect(res.runs.find((r) => r.id === id)).toMatchObject({ live: false, kind: 'succeeded' });
    expect(res.refresh?.mode).toBe(refresh.fullRefreshMs === MIN ? 'full' : 'delta');
  });

  it('midnight: a run and an update that ended late yesterday stay while the fresh history lacks them (R10)', async () => {
    const run = ok(800, 1, DAY1 + 20 * HOUR, (3 * 60 + 55) * 60); // 20:00-23:55
    const upd = { update_id: 'eve-1', creation_time: DAY1 + 20 * HOUR, state: 'COMPLETED' as const };
    const t = setup({
      now: DAY2 - 2 * MIN, hist: { runs: [] }, // 23:58
      data: { runs: [run], updates: { p1: [upd] }, events: { p1: [{ event_type: 'update_progress', timestamp: new Date(DAY2 - 5 * MIN).toISOString(), origin: { update_id: 'eve-1' } }] } },
    });
    const both = [800, pipelineNumber('eve-1')];
    expect(ids(await t.list())).toEqual(expect.arrayContaining(both));
    // 00:05: a new day and a fresh history read, which lags and has neither; both started before apiFrom (21:05).
    t.setNow(DAY2 + 5 * MIN);
    const after = await t.list();
    expect(t.historyCalls()).toHaveLength(2);
    expect(after.refresh?.mode).toBe('full');
    expect(ids(after)).toEqual(expect.arrayContaining(both));
    t.setNow(DAY2 + 10 * HOUR);
    expect(ids(await t.list())).toEqual(expect.arrayContaining(both));
  });

  it('a failing probe falls back the same way', async () => {
    const denied = Object.assign(new Error('denied'), { statusCode: 403, errorCode: 'PERMISSION_DENIED' });
    const t = setup({ now: DAY2 + 14 * HOUR, hist: { fail: { probe: denied } } });
    expect((await t.list()).history).toEqual({ source: 'api', days: 30, reason: 'no access to system.lakeflow (PERMISSION_DENIED)' });
  });

  it('history cap: capped when the history rows reach historyMaxRuns, passed as :max_runs', async () => {
    const t = setup({ now: DAY2 + 14 * HOUR, limits: { historyMaxRuns: 3 }, hist: { runs: [1, 2, 3].map((i) => hRun(300 + i, 1, DAY1 + i * HOUR, 60)) } });
    const res = await t.list();
    expect(res.history).toEqual({ source: 'system-tables', days: 90, capped: true });
    expect(t.historyCalls()[0].params.max_runs).toBe('3');
    expect(res.runs).toHaveLength(3);
  });

  it('usualSec is computed over the history runs: a slow run today is detected against 60 days of history', async () => {
    const now = DAY2 + 14 * HOUR;
    const hist = { runs: Array.from({ length: 60 }, (_, i) => hRun(1000 + i, 1, DAY2 - (i + 1) * DAY + 2 * HOUR, 600)) };
    const data = { runs: [ok(5000, 1, now - HOUR, 1500)] };
    const withHistory = (await setup({ now, data, hist }).list()).runs.find((r) => r.id === 5000);
    expect(withHistory).toMatchObject({ kind: 'slow', usualSec: 615 }); // (60 × 600 + 1500) / 61
    const apiOnly = (await setup({ now, data, config: readHistoryConfig({}) }).list()).runs.find((r) => r.id === 5000);
    expect(apiOnly).toMatchObject({ kind: 'succeeded', usualSec: 1500 });
  });

  it('the response cache is keyed by the time zone too', async () => {
    const now = DAY2 + 14 * HOUR;
    const t = setup({ now, hist: { runs: [] } });
    await t.list();
    const src = createLiveRunSource({ api: t.api, user: () => Promise.resolve('me@x.com'), userKey: 'me', state: t.state, limits: DEFAULT_LIMITS, clock: () => now, warn: vi.fn(), history: ON });
    await src.listRuns(undefined, -60);
    expect(t.historyCalls()).toHaveLength(2); // another local day start
    // Two time zones alternating keep their own entries: no re-read either way (finding 4a).
    for (const [tz, m] of [[TZ, 1], [-60, 2], [TZ, 3]]) {
      const later = createLiveRunSource({ api: t.api, user: () => Promise.resolve('me@x.com'), userKey: 'me', state: t.state, limits: DEFAULT_LIMITS, clock: () => now + m * MIN, warn: vi.fn(), history: ON });
      await later.listRuns(undefined, tz, { full: true });
    }
    expect(t.historyCalls()).toHaveLength(2);
  });
});

describe('/api/mode history', () => {
  const NOW = DAY2 + 14 * HOUR;
  const list = (p: ReturnType<typeof createLiveProvider>, headers: Record<string, string> = {}) => {
    const src = p.forRequest({ headers });
    if ('error' in src) throw new Error(src.error);
    return src.listRuns(undefined, TZ);
  };

  it('never waits for a cold probe: nothing until a list has probed, then that answer (finding 11)', async () => {
    const env = { NODE_ENV: 'development', DATABRICKS_WAREHOUSE_ID: 'wh1' };
    const api = fakeApi({ workspaceId: '42', sql: () => [{ ok: '1' }] });
    const provider = createLiveProvider(env, { makeApi: () => api, clock: () => NOW });
    expect(await provider.history({ headers: {} })).toBeUndefined();
    expect(api.calls).toEqual([]);
    await list(provider);
    expect(await provider.history({ headers: {} })).toEqual({ source: 'system-tables', days: 90 });
    const denied = fakeApi({ workspaceId: '42', sql: () => Object.assign(new Error('denied'), { statusCode: 403, errorCode: 'PERMISSION_DENIED' }) });
    const no = createLiveProvider(env, { makeApi: () => denied, clock: () => NOW });
    await list(no);
    expect(await no.history({ headers: {} })).toEqual({ source: 'api', days: 30, reason: 'no access to system.lakeflow (PERMISSION_DENIED)' });
    // Known without a call: no warehouse. Not signed in: nothing.
    expect(await createLiveProvider({ NODE_ENV: 'development' }, { makeApi: () => api }).history({ headers: {} })).toEqual({ source: 'api', days: 30, reason: 'no SQL warehouse configured' });
    expect(await createLiveProvider({ NODE_ENV: 'production' }, { makeApi: () => api }).history({ headers: {} })).toBeUndefined();
  });

  it('says capped when today\'s history read hit its cap', async () => {
    const api = fakeApi({ workspaceId: '42', jobs: [{ job_id: 1, settings: { name: 'etl' } }], sql: (st) => (st === JOB_RUNS_SQL ? [hRun(1, 1, DAY1, 60)] : st === PROBE_SQL ? [{ ok: '1' }] : []) });
    const provider = createLiveProvider({ NODE_ENV: 'development', DATABRICKS_WAREHOUSE_ID: 'wh1', JOBS_CONSOLE_HISTORY_MAX_RUNS: '1' }, { makeApi: () => api, clock: () => NOW });
    expect((await list(provider)).history).toEqual({ source: 'system-tables', days: 90, capped: true });
    expect(await provider.history({ headers: {} })).toEqual({ source: 'system-tables', days: 90, capped: true });
  });

  it('reads the workspace id from the SCIM header once per process when DATABRICKS_WORKSPACE_ID is not set', async () => {
    const api = fakeApi({ workspaceId: '42', sql: () => [{ ok: '1' }] });
    const provider = createLiveProvider({ NODE_ENV: 'development', DATABRICKS_WAREHOUSE_ID: 'wh1' }, { makeApi: () => api, clock: () => NOW });
    await list(provider);
    await list(provider, { 'x-forwarded-access-token': 't', 'x-forwarded-email': 'b@x.com' });
    expect(api.calls.filter((c) => c === 'workspaceId')).toHaveLength(1);
  });
});

describe('JOBS_CONSOLE_AUTH=app: one history for every viewer (finding 4a)', () => {
  it('viewers share the app\'s probe and history read; each still gets their own `mine`', async () => {
    const NOW = DAY2 + 14 * HOUR;
    const seen: { statement: string; params: Record<string, string> }[] = [];
    const api = fakeApi({
      workspaceId: '42',
      jobs: [{ job_id: 1, creator_user_name: 'a@x.com', settings: { name: 'etl' } }],
      sql: sqlFake(() => ({ runs: [hRun(300, 1, DAY1 + 10 * HOUR, 600)] }), seen),
    });
    const provider = createLiveProvider({ NODE_ENV: 'production', JOBS_CONSOLE_AUTH: 'app', DATABRICKS_WAREHOUSE_ID: 'wh1' }, { makeApi: () => api, clock: () => NOW });
    const as = (email: string) => {
      const src = provider.forRequest({ headers: { 'x-forwarded-email': email } });
      if ('error' in src) throw new Error(src.error);
      return src.listRuns(undefined, TZ);
    };
    const a = await as('a@x.com');
    const b = await as('b@x.com');
    expect(seen.filter((x) => x.statement === JOB_RUNS_SQL)).toHaveLength(1);
    expect(seen.filter((x) => x.statement === PROBE_SQL)).toHaveLength(1);
    expect(a.runs.find((r) => r.id === 300)?.mine).toBe(true);
    expect(b.runs.find((r) => r.id === 300)?.mine).toBe(false);
    expect(provider.state.history.size).toBe(1);
  });
});
