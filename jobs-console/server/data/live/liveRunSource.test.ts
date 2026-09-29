import { describe, it, expect, vi } from 'vitest';
import type { jobs } from '@databricks/sdk-experimental';
import { apiErrorParts, createLiveRunSource, createLiveState, toSourceError } from './liveRunSource';
import { DEFAULT_LIMITS, type LiveLimits } from './limits';
import { fakeApi, type FakeData } from './fakeApi';
import { pipelineNumber } from './pipelines';
import { SourceError } from '../sourceError';

const NOW = 1_800_000_000_000;
const MIN = 60000;

const jobRun = (i: number, over: Partial<jobs.BaseRun> = {}): jobs.BaseRun => ({
  run_id: 1000 + i, job_id: 1, run_name: 'job', creator_user_name: 'me@x.com', start_time: NOW - (i + 1) * MIN, run_duration: 30000,
  status: { state: 'TERMINATED', termination_details: { code: 'SUCCESS' } }, state: { result_state: 'SUCCESS' }, tasks: [{ task_key: 'a' }], ...over,
});

function source(data: FakeData, limits: Partial<LiveLimits> = {}, clock = () => NOW) {
  const api = fakeApi(data);
  const warn = vi.fn();
  const state = createLiveState();
  const src = createLiveRunSource({ api, user: () => api.me().then((u) => u.userName ?? ''), userKey: 'me', state, limits: { ...DEFAULT_LIMITS, ...limits }, clock, warn });
  return { api, warn, state, src };
}

describe('live listRuns', () => {
  it('merges job runs and pipeline updates newest first, with source live and asOf now', async () => {
    const { src, state } = source({
      runs: [jobRun(0), jobRun(10)],
      pipelines: [{ pipeline_id: 'p1', name: 'pipe' }],
      specs: { p1: { pipeline_id: 'p1', name: 'pipe', run_as_user_name: 'sp-ingest', spec: { continuous: false } } },
      updates: { p1: [{ update_id: 'u-1', creation_time: NOW - 5 * MIN, state: 'COMPLETED' }, { update_id: 'u-old', creation_time: NOW - 40 * 86400000, state: 'COMPLETED' }] },
      events: { p1: [{ event_type: 'update_progress', timestamp: new Date(NOW - 4 * MIN).toISOString(), origin: { update_id: 'u-1' } }] },
    });
    const res = await src.listRuns();
    expect(res.source).toBe('live');
    expect(res.asOf).toBe(NOW);
    expect(res.runs.map((r) => r.runId)).toEqual(['1000', 'upd u-1', '1010']);
    const upd = res.runs[1];
    expect(upd).toMatchObject({ type: 'pipeline', durationSec: 60, runAs: 'sp-ingest', mine: false, kind: 'succeeded' });
    expect(res.runs[0].mine).toBe(true);
    expect(state.pipelineRefs.get(pipelineNumber('u-1'))).toEqual({ pipelineId: 'p1', updateId: 'u-1', startTime: NOW - 5 * MIN, info: { pipelineId: 'p1', name: 'pipe', continuous: false, runAs: 'sp-ingest' } });
  });

  it('uses since as the window start, else windowDays', async () => {
    const runs = [jobRun(0), jobRun(3 * 1440)]; // now-1min, ~3 days ago
    expect((await source({ runs }, { windowDays: 2 }).src.listRuns()).runs).toHaveLength(1);
    expect((await source({ runs }).src.listRuns(NOW - 10 * MIN)).runs).toHaveLength(1);
    expect((await source({ runs }).src.listRuns()).runs).toHaveLength(2);
  });

  it('stops at maxRuns and warns with counts', async () => {
    const { src, warn } = source({ runs: Array.from({ length: 60 }, (_, i) => jobRun(i)) }, { maxRuns: 30 });
    const res = await src.listRuns();
    expect(res.runs).toHaveLength(30);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/cap 30 hit; returned 30 of 30 \(job runs 30/);
  });

  it('returns what it has when the timeout cuts the fan-out short', async () => {
    let t = NOW;
    const { src, warn } = source(
      { runs: Array.from({ length: 100 }, (_, i) => jobRun(i)), runPageSize: 25, delay: 5 },
      { timeoutMs: 1000 },
      () => t
    );
    const origin = Date.now();
    const clockAdvance = setInterval(() => (t = NOW + (Date.now() - origin) * 100), 1);
    const res = await src.listRuns();
    clearInterval(clockAdvance);
    expect(res.runs.length).toBeLessThan(100);
    expect(warn.mock.calls[0][0]).toMatch(/timeout 1000ms hit/);
  });

  it('caches per user and window for 20s', async () => {
    let t = NOW;
    const { src, api } = source({ runs: [jobRun(0)] }, {}, () => t);
    const first = await src.listRuns();
    expect(await src.listRuns()).toBe(first);
    expect(api.calls.filter((c) => c === 'listJobRuns')).toHaveLength(1);
    t += 21000;
    const next = await src.listRuns();
    expect(next).not.toBe(first);
    expect(next.refresh?.mode).toBe('delta');
  });

  it('SDK errors become 502, auth errors keep 401/403', async () => {
    const err = (statusCode: number, errorCode = '') => Object.assign(new Error('boom'), { statusCode, errorCode });
    await expect(source({ fail: { listJobRuns: err(500) } }).src.listRuns()).rejects.toMatchObject({ status: 502, message: 'boom' });
    await expect(source({ fail: { listJobRuns: err(401) } }).src.listRuns()).rejects.toMatchObject({ status: 401 });
    await expect(source({ fail: { listPipelines: err(403, 'PERMISSION_DENIED') } }).src.listRuns()).rejects.toMatchObject({ status: 403 });
  });

  it('skips a pipeline that vanished or is not visible', async () => {
    const { src, warn } = source({
      pipelines: [{ pipeline_id: 'p1' }],
      fail: { getPipeline: Object.assign(new Error('gone'), { statusCode: 404 }) },
    });
    expect((await src.listRuns()).runs).toEqual([]);
    expect(warn.mock.calls[0][0]).toMatch(/1 skipped/);
  });
});

describe('incremental refresh', () => {
  const done = (id: number, ago: number, job = 1): jobs.BaseRun => ({
    run_id: id, job_id: job, run_name: `job${job}`, creator_user_name: 'me@x.com', start_time: NOW - ago * MIN, run_duration: 60000,
    status: { state: 'TERMINATED', termination_details: { code: 'SUCCESS' } }, state: { result_state: 'SUCCESS' }, tasks: [{ task_key: 'a' }],
  });
  const running = (id: number, ago: number): jobs.BaseRun => ({ ...done(id, ago), run_duration: undefined, status: { state: 'RUNNING' }, state: {} });
  const idlePipelines = (n: number): Pick<FakeData, 'pipelines' | 'updates' | 'specs'> => {
    const ids = Array.from({ length: n }, (_, i) => `p${i}`);
    return {
      pipelines: ids.map((id) => ({ pipeline_id: id, name: id, latest_updates: [{ update_id: `${id}-u1`, state: 'COMPLETED' as const }] })),
      specs: Object.fromEntries(ids.map((id) => [id, { pipeline_id: id, name: id, run_as_user_name: 'sp' }])),
      updates: Object.fromEntries(ids.map((id) => [id, [{ update_id: `${id}-u1`, creation_time: NOW - 3 * 60 * MIN, state: 'COMPLETED' as const }]])),
    };
  };

  function live(data: FakeData, opts: { refresh?: { incremental: boolean; fullRefreshMs: number } } = {}) {
    let t = NOW;
    const api = fakeApi(data);
    const notes: { code: string; message: string }[] = [];
    const state = createLiveState();
    const src = createLiveRunSource({
      api, user: () => Promise.resolve('me@x.com'), userKey: 'me', state, limits: DEFAULT_LIMITS, clock: () => t, warn: () => {}, refresh: opts.refresh,
      trace: { diag: (n) => notes.push(n), wrap: (a) => a, note: () => {} },
    });
    return { api, src, notes, state, advance: (ms: number) => (t += ms), since: () => api.calls.length };
  }

  it('an unchanged workspace costs a fixed 3 calls per delta, however long its history', async () => {
    const callsFor = async (history: number) => {
      const w = live({ runs: Array.from({ length: history }, (_, i) => done(i + 1, 10 + i)), runPageSize: 25, ...idlePipelines(20) });
      const full = await w.src.listRuns();
      expect(full.refresh?.mode).toBe('full');
      const mark = w.since();
      w.advance(60000);
      const delta = await w.src.listRuns();
      expect(delta.refresh).toMatchObject({ mode: 'delta', calls: 3 });
      // Same answer as the full load: nothing changed (all finished, so no durations move).
      expect(delta.runs).toEqual(full.runs);
      return { full: full.refresh!.calls, delta: w.api.calls.slice(mark) };
    };
    const small = await callsFor(50);
    const big = await callsFor(500);
    expect(big.delta).toEqual(['listJobRuns', 'listJobRuns', 'listPipelines']);
    expect(small.delta).toEqual(big.delta);
    expect(big.full).toBeGreaterThan(40); // 20 runs pages + 1 + 20 x (getPipeline, listUpdates, events)
  });

  it('merges new, finished and deleted runs and changed pipelines to the same list a full load gives', async () => {
    const data: FakeData = {
      runs: [running(2, 30), running(3, 20), done(1, 60)],
      pipelines: [
        { pipeline_id: 'p1', name: 'p1', latest_updates: [{ update_id: 'a1', state: 'COMPLETED' }] },
        { pipeline_id: 'p2', name: 'p2', latest_updates: [{ update_id: 'b1', state: 'COMPLETED' }] },
      ],
      specs: { p1: { pipeline_id: 'p1', name: 'p1' }, p2: { pipeline_id: 'p2', name: 'p2' } },
      updates: { p1: [{ update_id: 'a1', creation_time: NOW - 90 * MIN, state: 'COMPLETED' }], p2: [{ update_id: 'b1', creation_time: NOW - 90 * MIN, state: 'COMPLETED' }] },
    };
    const w = live(data);
    await w.src.listRuns();
    w.advance(60000);
    // Meanwhile: run 4 started (and finished), run 2 finished, run 3 was deleted, p1 started a new update.
    const finished2 = { ...done(2, 30), run_duration: 29 * MIN };
    data.runs = [{ ...done(4, 0), start_time: NOW + 30000 }, finished2, done(1, 60)];
    data.runsById = { 2: finished2 };
    data.pipelines = [{ pipeline_id: 'p1', name: 'p1', latest_updates: [{ update_id: 'a2', state: 'RUNNING' }] }, data.pipelines![1]];
    data.updates = { ...data.updates, p1: [{ update_id: 'a2', creation_time: NOW + 10000, state: 'RUNNING' }, ...data.updates!.p1] };
    const mark = w.since();
    const delta = await w.src.listRuns();
    expect(delta.refresh?.mode).toBe('delta');
    // No getPipeline: p1 is known. p2 is idle, so not re-read.
    expect(w.api.calls.slice(mark).sort()).toEqual(['getRun', 'getRun', 'listJobRuns', 'listJobRuns', 'listPipelineEvents', 'listPipelines', 'listUpdates']);
    expect(w.notes.find((n) => n.code === 'delta')?.message).toBe('active runs 0, new runs 1, finished via getRun 1, deleted 1, pipelines re-read 1 of 2, aged out of the window 0');
    const fresh = live(data);
    fresh.advance(60000);
    const full = await fresh.src.listRuns();
    expect(delta.runs).toEqual(full.runs);
    expect(delta.runs.map((r) => r.runId)).toEqual(['4', 'upd a2', '2', '1', 'upd a1', 'upd b1']);
  });

  it('falls back to a full load when a delta step fails, with a delta-fallback diagnostic', async () => {
    const data: FakeData = { runs: [running(2, 30), done(1, 60)] };
    const w = live(data);
    await w.src.listRuns();
    w.advance(60000);
    data.runs = [done(1, 60)]; // run 2 left both lists, and getRun fails
    data.fail = { getRun: Object.assign(new Error('busy'), { statusCode: 503 }) };
    const res = await w.src.listRuns();
    expect(res.refresh?.mode).toBe('full');
    expect(res.runs.map((r) => r.id)).toEqual([1]);
    expect(w.notes.find((n) => n.code === 'delta-fallback')?.message).toMatch(/busy/);
    // The full load became the base: the next list is a delta again.
    data.fail = {};
    w.advance(60000);
    expect((await w.src.listRuns()).refresh?.mode).toBe('delta');
  });

  it('never keeps a half-merged base: a failed delta and a failed full load leave the old base', async () => {
    const data: FakeData = { runs: [done(1, 60)] };
    const w = live(data);
    await w.src.listRuns();
    const before = w.state.bases.get('me');
    w.advance(60000);
    data.fail = { listPipelines: Object.assign(new Error('down'), { statusCode: 500 }) };
    await expect(w.src.listRuns()).rejects.toMatchObject({ status: 502 });
    expect(w.state.bases.get('me')).toBe(before);
  });

  it('full=1 loads in full and skips the response cache', async () => {
    const w = live({ runs: [done(1, 60)] });
    await w.src.listRuns();
    w.advance(1000);
    const res = await w.src.listRuns(undefined, undefined, { full: true });
    expect(res.refresh?.mode).toBe('full');
    expect(w.notes.filter((n) => n.code === 'full-load').map((n) => n.message)).toEqual(['full load: no base yet', 'full load: asked for (full=1)']);
  });

  it('loads in full again once the base is older than JOBS_CONSOLE_FULL_REFRESH_MS, and when the window changes', async () => {
    const w = live({ runs: [done(1, 60)] }, { refresh: { incremental: true, fullRefreshMs: 90000 } });
    await w.src.listRuns();
    w.advance(60000);
    expect((await w.src.listRuns()).refresh?.mode).toBe('delta');
    w.advance(40000);
    expect((await w.src.listRuns()).refresh?.mode).toBe('full');
    w.advance(30000);
    expect((await w.src.listRuns(NOW - 60 * MIN)).refresh?.mode).toBe('full');
  });

  it('JOBS_CONSOLE_INCREMENTAL=0: every list is a full load', async () => {
    const w = live({ runs: [done(1, 60)] }, { refresh: { incremental: false, fullRefreshMs: 900000 } });
    await w.src.listRuns();
    w.advance(60000);
    expect((await w.src.listRuns()).refresh?.mode).toBe('full');
    expect(w.state.bases.size).toBe(0);
  });

  it('a single-run refresh updates the base, so the next delta neither re-reads nor rewinds that run', async () => {
    const data: FakeData = { runs: [running(2, 30), done(1, 60)] };
    const w = live(data);
    await w.src.listRuns();
    const finished2 = { ...done(2, 30), run_duration: 29 * MIN };
    data.runs = [finished2, done(1, 60)];
    data.runsById = { 2: finished2 };
    w.advance(30000);
    expect(await w.src.getRun(2)).toMatchObject({ live: false, result: 'succeeded' });
    w.advance(30000);
    const mark = w.since();
    const delta = await w.src.listRuns();
    expect(delta.refresh?.mode).toBe('delta');
    expect(w.api.calls.slice(mark)).not.toContain('getRun');
    expect(delta.runs.find((r) => r.id === 2)).toMatchObject({ live: false, result: 'succeeded', durationSec: 29 * 60 });
  });
});

describe('live taskLog', () => {
  const run: jobs.Run = { run_id: 7, tasks: [{ task_key: 'load', run_id: 70, attempt_number: 0, status: { state: 'TERMINATED' } }, { task_key: 'load', run_id: 71, attempt_number: 1, status: { state: 'TERMINATED' } }] };

  it('reads the latest attempt output of a job task', async () => {
    const { src, api } = source({ runsById: { 7: run }, outputs: { 71: { error: 'boom' } } });
    expect(await src.taskLog(7, 'load')).toBe('ERROR boom');
    expect(api.calls).toEqual(['getRun', 'getRunOutput']);
  });

  it('404 for an unknown run or task', async () => {
    const { src } = source({ runsById: { 7: run } });
    await expect(src.taskLog(8, 'load')).rejects.toMatchObject({ status: 404 });
    await expect(src.taskLog(7, 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('pipeline update ids read the update events', async () => {
    const events = [{ level: 'ERROR' as const, timestamp: new Date(NOW).toISOString(), message: 'failed', origin: { update_id: 'u-1' } }];
    const { src } = source({
      pipelines: [{ pipeline_id: 'p1', name: 'pipe' }],
      updates: { p1: [{ update_id: 'u-1', creation_time: NOW - MIN, state: 'FAILED' }] },
      events: { p1: events },
    });
    await src.listRuns();
    expect(await src.taskLog(pipelineNumber('u-1'), 'pipe')).toBe(`${new Date(NOW).toISOString()} ERROR failed`);
  });
});

describe('toSourceError', () => {
  it('maps statuses', () => {
    const e = (statusCode: number, errorCode = '') => Object.assign(new Error('m'), { statusCode, errorCode });
    expect(toSourceError(e(403)).status).toBe(403);
    expect(toSourceError(e(404)).status).toBe(502);
    expect(toSourceError(e(404), true).status).toBe(404);
    expect(toSourceError(e(400, 'INVALID_PARAMETER_VALUE'), true).status).toBe(404);
    expect(toSourceError(new Error('network')).status).toBe(502);
    const s = new SourceError(418, 'x');
    expect(toSourceError(s)).toBe(s);
  });

  it('recovers the code and message from a body the SDK could not parse', () => {
    const body = '{"error_code":"INVALID_PARAMETER_VALUE","message":"Run 123 does not exist.","details":[{"@type":"type.googleapis.com/google.rpc.RequestInfo","request_id":"r"}]}';
    const e = Object.assign(new Error(`Response from server (Bad Request) ${body}`), { statusCode: 400, errorCode: 'Bad Request' });
    expect(apiErrorParts(e)).toEqual({ status: 400, code: 'INVALID_PARAMETER_VALUE', message: 'Run 123 does not exist.' });
    expect(toSourceError(e, true)).toMatchObject({ status: 404, message: 'Run 123 does not exist.' });
  });
});
