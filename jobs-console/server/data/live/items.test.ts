import { describe, it, expect } from 'vitest';
import type { jobs, pipelines } from '@databricks/sdk-experimental';
import { jobItem, pipelineItem, createLiveItems } from './items';
import { fakeApi } from './fakeApi';
import { createLiveState } from './liveRunSource';
import { DEFAULT_LIMITS } from './limits';

const ME = 'me@x.com';
const SP = '7c1e9a40-2b3d-4f6e-9a1c-0d5e8b7f2a91';
const job = (id: number, settings: jobs.JobSettings, creator = ME): jobs.BaseJob => ({ job_id: id, creator_user_name: creator, settings: { name: `job_${id}`, ...settings } });

describe('jobItem', () => {
  it('maps schedule, run as, bundle, tags', () => {
    const it1 = jobItem(job(1, { schedule: { quartz_cron_expression: '0 0 2 * * ?', timezone_id: 'UTC', pause_status: 'UNPAUSED' }, run_as: { service_principal_name: SP }, deployment: { kind: 'BUNDLE' }, tags: { project: 'aiges' }, description: 'd' }, 'other@x.com'), ME, 'https://h.example');
    expect(it1).toMatchObject({ type: 'job', id: '1', name: 'job_1', trigger: 'schedule', schedule: { cron: '0 0 2 * * ?', tz: 'UTC', paused: false }, runAs: SP, deployed: true, mine: false, bundle: true, tags: { project: 'aiges' }, description: 'd', paused: false });
    expect(it1.url).toBe('https://h.example/jobs/1');
  });
  it('trigger precedence and pause', () => {
    expect(jobItem(job(2, { continuous: { pause_status: 'UNPAUSED' }, schedule: { quartz_cron_expression: '0 0 2 * * ?', timezone_id: 'UTC' } }), ME, '').trigger).toBe('continuous');
    expect(jobItem(job(3, { trigger: { periodic: { interval: 4, unit: 'HOURS' } } }), ME, '')).toMatchObject({ trigger: 'periodic', periodic: { interval: 4, unit: 'HOURS' } });
    expect(jobItem(job(4, { trigger: { file_arrival: { url: 's3://x' }, pause_status: 'PAUSED' } }), ME, '')).toMatchObject({ trigger: 'file_arrival', paused: true });
    expect(jobItem(job(5, { trigger: { table_update: { table_names: ['a.b.c'] } } }), ME, '').trigger).toBe('table_update');
    expect(jobItem(job(6, {}), ME, '')).toMatchObject({ trigger: 'manual', mine: true, runAs: ME, deployed: false });
    expect(jobItem(job(7, { schedule: { quartz_cron_expression: '0 0 2 * * ?', timezone_id: 'UTC', pause_status: 'PAUSED' } }), ME, '').paused).toBe(true);
  });
});

describe('pipelineItem', () => {
  it('continuous vs triggered, from the spec', () => {
    const p: pipelines.PipelineStateInfo = { pipeline_id: 'p1', name: 'pipe', creator_user_name: 'a@x.com', run_as_user_name: SP };
    const spec = { spec: { continuous: true, deployment: { kind: 'BUNDLE' } } } as pipelines.GetPipelineResponse;
    expect(pipelineItem(p, spec, ME, '')).toMatchObject({ type: 'pipeline', id: 'p1', trigger: 'continuous', deployed: true, bundle: true, mine: false });
    expect(pipelineItem(p, undefined, ME, '').trigger).toBe('manual');
  });
});

describe('createLiveItems', () => {
  const base = { user: () => Promise.resolve(ME), userKey: 'u', limits: DEFAULT_LIMITS, clock: () => 1_000_000 };
  it('reads every jobs/list page and the pipelines, and caches', async () => {
    const api = fakeApi({ jobs: Array.from({ length: 250 }, (_, i) => job(i + 1, {})), jobPageSize: 100, pipelines: [{ pipeline_id: 'p1', name: 'pipe' }], specs: { p1: { spec: { continuous: false } } as pipelines.GetPipelineResponse } });
    const src = createLiveItems({ ...base, api, state: createLiveState() });
    const r = await src.listItems();
    expect(r.items.filter((i) => i.type === 'job')).toHaveLength(250);
    expect(r.items.filter((i) => i.type === 'pipeline')).toHaveLength(1);
    expect(r.partial).toBeUndefined();
    const listCalls = api.calls.filter((c) => c === 'listJobs').length;
    expect(listCalls).toBe(3);
    await src.listItems();
    expect(api.calls.filter((c) => c === 'listJobs').length).toBe(listCalls);
  });
  it('returns partial, not an error, when the items budget runs out', async () => {
    // 5 pages at 100 ms each need 500 ms; the budget is 150 ms, so at most 1 page fits and the cut is not timing-sensitive.
    const api = fakeApi({ jobs: Array.from({ length: 500 }, (_, i) => job(i + 1, {})), jobPageSize: 100, delay: 100 });
    const src = createLiveItems({ ...base, clock: Date.now, api, state: createLiveState(), limits: { ...DEFAULT_LIMITS, itemsTimeoutMs: 150 } });
    const r = await src.listItems();
    expect(r.partial).toBeDefined();
    expect(r.items.length).toBeLessThan(500);
  });
  it('partial when the budget expires during the pipeline spec phase, and is not cached', async () => {
    const inner = fakeApi({ jobs: [job(1, {})], pipelines: [{ pipeline_id: 'p1', name: 'pipe' }, { pipeline_id: 'p2', name: 'pipe2' }] });
    const api = { ...inner, getPipeline: (req: { pipeline_id: string }) => new Promise<pipelines.GetPipelineResponse>((r) => setTimeout(() => r({ pipeline_id: req.pipeline_id }), 300)) };
    const src = createLiveItems({ ...base, clock: Date.now, api, state: createLiveState(), limits: { ...DEFAULT_LIMITS, itemsTimeoutMs: 100 } });
    const r = await src.listItems();
    expect(r.partial?.reason).toMatch(/2 pipeline details cut/);
    const calls = inner.calls.filter((c) => c === 'listJobs').length;
    await src.listItems();
    expect(inner.calls.filter((c) => c === 'listJobs').length).toBe(calls + 1);
  });
  it('a partial jobs list is not cached either', async () => {
    const api = fakeApi({ jobs: Array.from({ length: 300 }, (_, i) => job(i + 1, {})), jobPageSize: 100, delay: 100 });
    const src = createLiveItems({ ...base, clock: Date.now, api, state: createLiveState(), limits: { ...DEFAULT_LIMITS, itemsTimeoutMs: 150 } });
    expect((await src.listItems()).partial).toBeDefined();
    const calls = api.calls.length;
    await src.listItems();
    expect(api.calls.length).toBeGreaterThan(calls);
  });
  it('the cache expires after the 5-minute TTL', async () => {
    let now = 1_000_000;
    const api = fakeApi({ jobs: [job(1, {})] });
    const src = createLiveItems({ ...base, clock: () => now, api, state: createLiveState() });
    await src.listItems();
    now += 4 * 60_000;
    await src.listItems();
    expect(api.calls.filter((c) => c === 'listJobs').length).toBe(1);
    now += 61_000;
    await src.listItems();
    expect(api.calls.filter((c) => c === 'listJobs').length).toBe(2);
  });
  it('getItem: job tasks with deps, pipeline facts, 404 for unknown', async () => {
    const api = fakeApi({
      jobsById: { 9: { job_id: 9, run_as_user_name: SP, settings: { name: 'j9', tasks: [{ task_key: 'a', notebook_task: { notebook_path: '/x' } }, { task_key: 'b', depends_on: [{ task_key: 'a' }], pipeline_task: { pipeline_id: 'p1' } }] } } },
      specs: { p1: { pipeline_id: 'p1', name: 'pipe', spec: { continuous: false, catalog: 'c', schema: 's', serverless: true, channel: 'CURRENT', ingestion_definition: {} } } as pipelines.GetPipelineResponse },
    });
    const src = createLiveItems({ ...base, api, state: createLiveState() });
    const j = await src.getItem('job', '9');
    expect(j.tasks).toEqual([{ key: 'a', type: 'Notebook', dependsOn: [] }, { key: 'b', type: 'Pipeline', dependsOn: ['a'] }]);
    const p = await src.getItem('pipeline', 'p1');
    expect(p.pipeline).toEqual({ kind: 'Ingestion', continuous: false, target: 'c.s', serverless: true, channel: 'CURRENT' });
    await expect(src.getItem('job', '404')).rejects.toMatchObject({ status: 404 });
  });
});
