import { describe, it, expect } from 'vitest';
import type { jobs } from '@databricks/sdk-experimental';
import type { Run } from '../../shared/domain/types';
import { getRun } from './getRun';
import type { RunSource } from '../data/runSource';
import { createMockRunSource } from '../data/mock/mockRunSource';
import { createLiveRunSource, createLiveState } from '../data/live/liveRunSource';
import { DEFAULT_LIMITS } from '../data/live/limits';
import { fakeApi, type FakeData } from '../data/live/fakeApi';
import { pipelineNumber } from '../data/live/pipelines';
import { NOW, richWorkspace } from '../data/capture/fixtures';
import { Session } from '../data/capture/recorder';
import { buildCapture, gzipCapture, readCapture } from '../data/capture/captureFile';
import { createReplayProvider } from '../data/capture/replayProvider';

const MIN = 60000;
const iso = (ms: number) => new Date(ms).toISOString();
const RUNNING_UPD = 'aaaa1111-0000-0000-0000-000000000003';

/** The rich workspace where getRun can read every listed job run (as runs/get would return it). */
function workspace(): FakeData {
  const data = structuredClone(richWorkspace);
  data.runsById = Object.fromEntries((data.runs ?? []).map((r) => [r.run_id ?? 0, r as jobs.Run]));
  return data;
}

function live(data: FakeData, state = createLiveState(), userKey = 'me') {
  const api = fakeApi(data);
  const src = createLiveRunSource({ api, user: () => Promise.resolve('me@x.com'), userKey, state, limits: DEFAULT_LIMITS, clock: () => NOW, warn: () => {} });
  return { api, src, state };
}

const body = (r: { body: unknown }) => r.body as Run;

describe('GET /api/runs/:id, live', () => {
  it('maps a job run and a pipeline update exactly as the list does (tasks, url, kind, usualSec)', async () => {
    const { src } = live(workspace());
    const list = await src.listRuns();
    for (const run of list.runs) {
      const res = await getRun(src, String(run.id), {});
      expect(res.status).toBe(200);
      expect(body(res)).toEqual(run);
    }
    expect(list.runs.find((r) => r.id === 104)).toMatchObject({ kind: 'slow', usualSec: 950 });
  });

  it('refreshes a running job run with runs/get and puts it in the cached list', async () => {
    const data = workspace();
    const { src, api } = live(data);
    expect((await src.listRuns()).runs.find((r) => r.id === 105)).toMatchObject({ live: true, kind: 'running' });
    data.runsById![105] = {
      ...data.runsById![105], run_duration: 700_000, status: { state: 'TERMINATED', termination_details: { code: 'SUCCESS', type: 'SUCCESS' } }, state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' },
      tasks: [{ task_key: 'main', run_id: 1050, attempt_number: 0, start_time: NOW - 5 * MIN, run_duration: 700_000, status: { state: 'TERMINATED' }, state: { result_state: 'SUCCESS' } }],
    };
    api.calls.length = 0;
    const run = body(await getRun(src, '105', {}));
    expect(api.calls).toEqual(['getRun']);
    expect(run).toMatchObject({ id: 105, live: false, result: 'succeeded', kind: 'succeeded', durationSec: 700, url: 'https://x.cloud.databricks.us/jobs/1/runs/105' });
    expect(run.tasks).toEqual([{ key: 'main', startSec: 0, durSec: 700, state: 'ok', deps: [], attempt: 0 }]);
    // usualSec from the cached list: jobs 101-104 and this one, all succeeded.
    expect(run.usualSec).toBe(Math.round((2000 + 600 + 620 + 580 + 700) / 5));
    // The next list within the cache TTL shows the refreshed run, not the older one.
    expect((await src.listRuns()).runs.find((r) => r.id === 105)).toEqual(run);
  });

  it('without a cached list, usualSec falls back to the run itself, as the list does for a job seen once', async () => {
    const { src } = live(workspace());
    const run = body(await getRun(src, '104', {}));
    expect(run).toMatchObject({ usualSec: 2000, kind: 'succeeded' });
  });

  it('refreshes a pipeline update with getUpdate and its events', async () => {
    const data = workspace();
    const { src, api } = live(data);
    const id = pipelineNumber(RUNNING_UPD);
    expect((await src.listRuns()).runs.find((r) => r.id === id)).toMatchObject({ live: true, type: 'pipeline' });
    const p1 = data.updates?.p1 ?? [];
    p1[0] = { ...p1[0], state: 'COMPLETED' };
    data.events?.p1?.push({ event_type: 'update_progress', level: 'INFO', timestamp: iso(NOW - 4 * MIN), message: 'Update is COMPLETED', origin: { update_id: RUNNING_UPD, pipeline_id: 'p1' } });
    api.calls.length = 0;
    const run = body(await getRun(src, String(id), {}));
    expect(api.calls).toEqual(['getUpdate', 'listPipelineEvents']);
    expect(run).toMatchObject({ id, name: '[dev ann] raw_bronze', live: false, result: 'succeeded', durationSec: 360, runAs: 'ann@x.com', pipelineId: 'p1' });
    expect(run.tasks).toEqual([{ key: '[dev ann] raw_bronze', startSec: 0, durSec: 360, state: 'ok', deps: [], attempt: 0 }]);
  });

  it('a running pipeline update needs no events call', async () => {
    const { src, api } = live(workspace());
    await src.listRuns();
    api.calls.length = 0;
    await getRun(src, String(pipelineNumber(RUNNING_UPD)), {});
    expect(api.calls).toEqual(['getUpdate']);
  });

  it('answers 404 { error } for an unknown run, 400 for a bad id, and passes auth errors on', async () => {
    const { src } = live(workspace());
    const miss = await getRun(src, '999', {});
    expect(miss.status).toBe(404);
    expect(miss.body).toEqual({ error: expect.stringContaining('999') as unknown });
    expect((await getRun(src, 'abc', {})).status).toBe(400);
    expect((await getRun(src, '1', { tzOffset: 'x' })).status).toBe(400);
    const denied = live({ ...workspace(), fail: { getRun: Object.assign(new Error('no access'), { statusCode: 403, errorCode: 'PERMISSION_DENIED' }) } }).src;
    expect(await getRun(denied, '105', {})).toEqual({ status: 403, body: { error: 'no access' } });
  });
});

describe('GET /api/runs/:id, mock', () => {
  it('returns the run from the current data, or 404', async () => {
    const src = createMockRunSource(() => NOW);
    const list = await src.listRuns(undefined, 0);
    const pick = list.runs[3];
    expect(await getRun(src, String(pick.id), { tzOffset: '0' })).toEqual({ status: 200, body: pick });
    expect((await getRun(src, '987654321', {})).status).toBe(404);
  });
});

describe('GET /api/runs/:id, replay', () => {
  async function replaySource(): Promise<{ src: RunSource; original: Run[] }> {
    const session = new Session({ id: 's-list', route: '/api/runs', query: {}, authMode: 'user' }, () => NOW);
    const rec = createLiveRunSource({ api: fakeApi(richWorkspace), user: () => Promise.resolve('me@x.com'), userKey: 'me', state: createLiveState(), limits: DEFAULT_LIMITS, clock: () => NOW, warn: () => {}, trace: session });
    const original = (await rec.listRuns()).runs;
    const file = buildCapture({ env: { DATABRICKS_HOST: 'https://x.cloud.databricks.us', JOBS_CONSOLE_DATA: 'live' }, authMode: 'user', user: 'me@x.com', sessions: [session.finish({ status: 200 })], clientErrors: [], process: [], app: { version: '1', node: 'v24' } });
    const provider = createReplayProvider({}, { file: readCapture(await gzipCapture(file)), warn: () => {} });
    return { src: provider.forRequest({ headers: {} }) as RunSource, original };
  }

  it('answers a job run never fetched on its own from the recorded list page, even before any list call', async () => {
    const { src, original } = await replaySource();
    const res = await getRun(src, '401', {});
    expect(res.status).toBe(200);
    // Alone (no list cached yet) only usualSec can differ; the rest is the recorded run.
    expect({ ...body(res), usualSec: 0 }).toEqual({ ...original.find((r) => r.id === 401), usualSec: 0 });
    expect(body(res).tasks).toEqual([{ key: 'pull', startSec: 300, durSec: 900, state: 'r', deps: [], attempt: 1 }]);
  });

  it('after a list, job runs and pipeline updates come back as listed; an unknown id is 404, not a nearby run', async () => {
    const { src, original } = await replaySource();
    await src.listRuns();
    for (const run of original) expect(body(await getRun(src, String(run.id), {}))).toEqual(run);
    expect((await getRun(src, '999', {})).status).toBe(404);
  });
});
