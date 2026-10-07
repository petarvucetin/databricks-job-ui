import { describe, it, expect } from 'vitest';
import type { jobs, pipelines } from '@databricks/sdk-experimental';
import { jobDraft } from './jobs';
import { updateDraft, type PipelineInfo } from './pipelines';
import { Deadline, collectPipelines } from './collect';
import { createLiveRunSource, createLiveState } from './liveRunSource';
import { DEFAULT_LIMITS } from './limits';
import { fakeApi, type FakeData } from './fakeApi';
import type { DiagNote } from './trace';

const NOW = 1_800_000_000_000;
const MIN = 60000;

const sink = () => {
  const notes: DiagNote[] = [];
  return { notes, diag: (n: DiagNote) => notes.push(n), codes: () => notes.map((n) => n.code) };
};

const run = (over: Partial<jobs.BaseRun> = {}): jobs.BaseRun => ({
  run_id: 7, job_id: 1, run_name: 'job', creator_user_name: 'me@x.com', start_time: NOW - MIN, run_duration: 1000,
  status: { state: 'TERMINATED', termination_details: { code: 'SUCCESS' } }, state: { result_state: 'SUCCESS' }, tasks: [{ task_key: 'a' }], ...over,
});

describe('job mapping diagnostics', () => {
  it('is quiet for a well-formed run', () => {
    const s = sink();
    jobDraft(run(), NOW, s.diag);
    expect(s.notes).toEqual([]);
  });

  it('flags an unknown state, termination code and result state', () => {
    const s = sink();
    jobDraft(
      run({
        status: { state: 'HIBERNATING' as never, termination_details: { code: 'DRIVER_UNREACHABLE' as never, message: 'gone' } },
        state: { result_state: 'VAPORISED' as never },
      }),
      NOW,
      s.diag
    );
    expect(s.codes()).toEqual(expect.arrayContaining(['unknown-run-state', 'unknown-termination-code', 'unknown-result-state']));
    expect(s.notes.find((n) => n.code === 'unknown-termination-code')).toMatchObject({ level: 'warn', ref: 'run 7', message: expect.stringContaining('DRIVER_UNREACHABLE') as unknown });
  });

  it('flags unknown task termination codes too', () => {
    const s = sink();
    jobDraft(run({ tasks: [{ task_key: 'a', status: { state: 'TERMINATED', termination_details: { code: 'NEW_CODE' as never } }, state: { result_state: 'FAILED' } }] }), NOW, s.diag);
    expect(s.notes).toContainEqual(expect.objectContaining({ code: 'unknown-termination-code', ref: 'run 7 task a' }));
  });

  it('flags missing expected fields', () => {
    const s = sink();
    jobDraft(run({ run_id: undefined, start_time: undefined, run_name: undefined }), NOW, s.diag);
    expect(s.notes.filter((n) => n.code === 'missing-field').map((n) => n.message)).toEqual([
      expect.stringContaining('run_id') as unknown,
      expect.stringContaining('start_time') as unknown,
      expect.stringContaining('run_name') as unknown,
    ]);
  });
});

describe('pipeline mapping diagnostics', () => {
  const info: PipelineInfo = { pipelineId: 'p1', name: 'pipe', continuous: false, runAs: 'sp' };
  const upd = (over: Partial<pipelines.UpdateInfo> = {}): pipelines.UpdateInfo => ({ update_id: 'u1', creation_time: NOW - MIN, state: 'COMPLETED', ...over });

  it('flags an unknown update state', () => {
    const s = sink();
    updateDraft(upd({ state: 'SPINNING' as never }), info, { endTime: NOW, errors: [] }, NOW, s.diag);
    expect(s.notes).toEqual([expect.objectContaining({ code: 'unknown-update-state', ref: 'update u1' })]);
  });

  it('flags a finished update whose end time could not be found', () => {
    const s = sink();
    updateDraft(upd(), info, undefined, NOW, s.diag);
    expect(s.codes()).toEqual(['pipeline-end-missing']);
    const live = sink();
    updateDraft(upd({ state: 'RUNNING' }), info, undefined, NOW, live.diag);
    expect(live.notes).toEqual([]);
  });

  it('flags missing update fields', () => {
    const s = sink();
    updateDraft(upd({ update_id: undefined, creation_time: undefined }), info, { endTime: NOW, errors: [] }, NOW, s.diag);
    expect(s.codes()).toEqual(['missing-field', 'missing-field']);
  });
});

describe('collection diagnostics', () => {
  it('notes a skipped pipeline with the reason, and a truncated events page', async () => {
    const s = sink();
    const api = fakeApi({
      pipelines: [{ pipeline_id: 'gone' }, { pipeline_id: 'p1' }],
      updates: { p1: [{ update_id: 'u1', creation_time: NOW - MIN, state: 'COMPLETED' }] },
      events: { p1: [] },
    });
    const getPipeline = api.getPipeline;
    api.getPipeline = (req) => (req.pipeline_id === 'gone' ? Promise.reject(Object.assign(new Error('no such pipeline'), { statusCode: 404 })) : getPipeline(req));
    const listEvents = api.listPipelineEvents;
    api.listPipelineEvents = (req) => listEvents(req).then((p) => ({ ...p, next_page_token: 'more' }));
    await collectPipelines(api, NOW - 86400000, 2, new Deadline(NOW + 10000, () => NOW), s.diag);
    expect(s.notes).toContainEqual(expect.objectContaining({ code: 'pipeline-skipped', ref: 'pipeline gone', message: expect.stringContaining('404') as unknown }));
    expect(s.notes).toContainEqual(expect.objectContaining({ code: 'events-truncated', ref: 'pipeline p1' }));
  });

  it('asks for at most 250 events per page and sends the filter only on the first page', async () => {
    const api = fakeApi({
      pipelines: [{ pipeline_id: 'p1' }],
      updates: { p1: [{ update_id: 'u1', creation_time: NOW - MIN, state: 'COMPLETED' }] },
      events: { p1: [] },
    });
    const reqs: pipelines.ListPipelineEventsRequest[] = [];
    api.listPipelineEvents = (req) => {
      reqs.push(req);
      return Promise.resolve({ events: [{ id: `e${reqs.length}` }], next_page_token: reqs.length < 2 ? 'next' : undefined });
    };
    const got = await collectPipelines(api, NOW - 86400000, 2, new Deadline(NOW + 10000, () => NOW));
    expect(reqs.map((r) => r.max_results)).toEqual([250, 250]);
    expect(reqs[0].filter).toBeDefined();
    expect(reqs[1]).toEqual({ pipeline_id: 'p1', max_results: 250, page_token: 'next' });
    expect(got.pipelines[0].events?.map((e) => e.id)).toEqual(['e1', 'e2']);
  });

  it('keeps the pipeline and the whole list when its events call fails', async () => {
    const s = sink();
    const api = fakeApi({
      pipelines: [{ pipeline_id: 'p1' }],
      updates: { p1: [{ update_id: 'u1', creation_time: NOW - MIN, state: 'COMPLETED' }] },
    });
    api.listPipelineEvents = () => Promise.reject(Object.assign(new Error('Cannot have more than 250 events per page.'), { statusCode: 400 }));
    const got = await collectPipelines(api, NOW - 86400000, 2, new Deadline(NOW + 10000, () => NOW), s.diag);
    expect(got.pipelines.map((p) => p.info.pipelineId)).toEqual(['p1']);
    expect(got.pipelines[0].events).toBeUndefined();
    expect(s.notes).toContainEqual(expect.objectContaining({ code: 'events-failed', ref: 'pipeline p1', message: expect.stringContaining('250 events per page') as unknown }));
  });

  it('skips a pipeline on any error except a sign-in failure', async () => {
    const withGetError = (statusCode: number) => {
      const api = fakeApi({ pipelines: [{ pipeline_id: 'bad' }, { pipeline_id: 'p1' }], updates: { p1: [{ update_id: 'u1', creation_time: NOW - MIN, state: 'RUNNING' }] } });
      const get = api.getPipeline;
      api.getPipeline = (req) => (req.pipeline_id === 'bad' ? Promise.reject(Object.assign(new Error('nope'), { statusCode })) : get(req));
      return collectPipelines(api, NOW - 86400000, 2, new Deadline(NOW + 10000, () => NOW));
    };
    for (const status of [400, 403, 404, 500]) {
      const got = await withGetError(status);
      expect(got.pipelines.map((p) => p.info.pipelineId)).toEqual(['p1']);
      expect(got.skipped).toBe(1);
    }
    await expect(withGetError(401)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('notes pipelines not reached and events skipped when the budget runs out', async () => {
    const s = sink();
    let t = NOW;
    const api = fakeApi({
      pipelines: [{ pipeline_id: 'p1' }, { pipeline_id: 'p2' }],
      updates: { p1: [{ update_id: 'u1', creation_time: NOW - MIN, state: 'COMPLETED' }], p2: [] },
    });
    const listUpdates = api.listUpdates;
    api.listUpdates = (req) => listUpdates(req).then((r) => ((t = NOW + 20000), r));
    await collectPipelines(api, NOW - 86400000, 1, new Deadline(NOW + 10000, () => t), s.diag);
    expect(s.codes()).toEqual(expect.arrayContaining(['events-skipped-budget', 'pipelines-not-reached']));
  });
});

describe('list diagnostics', () => {
  const src = (data: FakeData, limits = {}) => {
    const s = sink();
    const api = fakeApi(data);
    const meta: Record<string, unknown>[] = [];
    const source = createLiveRunSource({
      api, user: () => Promise.resolve('me@x.com'), userKey: 'me', state: createLiveState(), limits: { ...DEFAULT_LIMITS, ...limits }, clock: () => NOW, warn: () => {},
      trace: { diag: s.diag, wrap: (a) => a, note: (m) => meta.push({ ...m }) },
    });
    return { s, source, meta };
  };

  it('notes page counts per API, the asOf and user it used', async () => {
    const { s, source, meta } = src({ runs: Array.from({ length: 30 }, (_, i) => run({ run_id: i, start_time: NOW - (i + 1) * MIN })) });
    await source.listRuns();
    const pages = s.notes.find((n) => n.code === 'pages');
    expect(pages).toMatchObject({ level: 'info', message: expect.stringContaining('listJobRuns 2') as unknown });
    expect(meta).toContainEqual(expect.objectContaining({ now: NOW }));
    expect(meta).toContainEqual(expect.objectContaining({ user: 'me@x.com' }));
  });

  it('notes the cap with counts', async () => {
    const { s, source } = src({ runs: Array.from({ length: 30 }, (_, i) => run({ run_id: i, start_time: NOW - (i + 1) * MIN })) }, { maxRuns: 10 });
    await source.listRuns();
    expect(s.notes).toContainEqual(expect.objectContaining({ code: 'cap-hit', level: 'warn', message: expect.stringMatching(/cap 10.*returned 10/) as unknown }));
  });

  it('notes a cache hit', async () => {
    const { s, source } = src({ runs: [run()] });
    await source.listRuns();
    await source.listRuns();
    expect(s.codes()).toContain('cache-hit');
  });
});
