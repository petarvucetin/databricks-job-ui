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
    await src.listRuns();
    await src.listRuns();
    expect(api.calls.filter((c) => c === 'listJobRuns')).toHaveLength(1);
    t += 21000;
    await src.listRuns();
    expect(api.calls.filter((c) => c === 'listJobRuns')).toHaveLength(2);
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
