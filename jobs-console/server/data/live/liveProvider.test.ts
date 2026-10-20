import { describe, it, expect, vi } from 'vitest';
import { createLiveProvider } from './liveProvider';
import { fakeApi } from './fakeApi';
import type { RunSource } from '../runSource';
import type { LiveApi } from './api';

const NOW = 1_800_000_000_000;
const run = { run_id: 1, job_id: 1, run_name: 'j', creator_user_name: 'ann@x.com', start_time: NOW - 60000, run_duration: 1000, status: { state: 'TERMINATED' as const, termination_details: { code: 'SUCCESS' as const } } };

function setup(env: Record<string, string | undefined>) {
  const apis: { opts: { host?: string; token?: string; profile?: string }; api: ReturnType<typeof fakeApi> }[] = [];
  const makeApi = vi.fn((opts: { host?: string; token?: string; profile?: string }) => {
    const api = fakeApi({ user: 'dev@x.com', runs: [run] });
    apis.push({ opts, api });
    return api;
  });
  return { provider: createLiveProvider({ DATABRICKS_HOST: 'adb-1.azuredatabricks.net', ...env }, { makeApi, clock: () => NOW }), apis };
}

describe('live provider auth', () => {
  it('uses the forwarded token and email, one client per request', async () => {
    const { provider, apis } = setup({ NODE_ENV: 'production' });
    const headers = { 'x-forwarded-access-token': 'tok', 'x-forwarded-email': 'ann@x.com', 'x-forwarded-user': '123@456' };
    const src = provider.forRequest({ headers }) as RunSource;
    expect(src.kind).toBe('live');
    const res = await src.listRuns();
    expect(res.runs[0].mine).toBe(true);
    expect(apis[0].opts).toEqual({ host: 'adb-1.azuredatabricks.net', token: 'tok' });
    expect(apis[0].api.calls).not.toContain('me');
    provider.forRequest({ headers });
    expect(apis).toHaveLength(2);
  });

  it('asks currentUser.me() when only the token is forwarded', async () => {
    const { provider, apis } = setup({ NODE_ENV: 'production' });
    const src = provider.forRequest({ headers: { 'x-forwarded-access-token': 'tok' } }) as RunSource;
    const res = await src.listRuns();
    expect(apis[0].api.calls).toContain('me');
    expect(res.runs[0].mine).toBe(false); // dev@x.com is not ann@x.com
  });

  it('falls back to the default auth chain in development, me() cached per process', async () => {
    const { provider, apis } = setup({ NODE_ENV: 'development' });
    await (provider.forRequest({ headers: {} }) as RunSource).listRuns();
    await (provider.forRequest({ headers: {} }) as RunSource).listRuns(NOW - 1000000);
    expect(apis).toHaveLength(1);
    expect(apis[0].opts).toEqual({});
    expect(apis[0].api.calls.filter((c) => c === 'me')).toHaveLength(1);
  });

  it('refuses a production request without a token with 401', () => {
    const { provider, apis } = setup({ NODE_ENV: 'production' });
    expect(provider.forRequest({ headers: { 'x-forwarded-email': 'ann@x.com' } })).toEqual({ status: 401, error: expect.stringMatching(/Not signed in/) as unknown });
    expect(apis).toHaveLength(0);
  });

  it('JOBS_CONSOLE_AUTH=app reads as the app (default chain) for everyone, the forwarded email still decides mine', async () => {
    const { provider, apis } = setup({ NODE_ENV: 'production', JOBS_CONSOLE_AUTH: 'app' });
    expect(provider.auth).toBe('app');
    const src = provider.forRequest({ headers: { 'x-forwarded-access-token': 'tok', 'x-forwarded-email': 'ann@x.com' } }) as RunSource;
    expect((await src.listRuns()).runs[0].mine).toBe(true);
    provider.forRequest({ headers: { 'x-forwarded-email': 'bob@x.com' } });
    expect(apis).toHaveLength(1);
    expect(apis[0].opts).toEqual({});
    expect(() => setup({ JOBS_CONSOLE_AUTH: 'robot' })).toThrow('JOBS_CONSOLE_AUTH must be user or app');
  });

  it("app auth builds its client from the env's CLI profile", async () => {
    const { provider, apis } = setup({ JOBS_CONSOLE_AUTH: 'app', DATABRICKS_CONFIG_PROFILE: 'gov-stg', DATABRICKS_HOST: undefined });
    await (provider.forRequest({ headers: {} }) as RunSource).listRuns();
    expect(apis[0].opts).toEqual({ profile: 'gov-stg' });
  });

  it('no profile → empty opts', async () => {
    const { provider, apis } = setup({ JOBS_CONSOLE_AUTH: 'app', DATABRICKS_HOST: undefined });
    await (provider.forRequest({ headers: {} }) as RunSource).listRuns();
    expect(apis[0].opts).toEqual({});
  });

  it('defaults to user auth', () => {
    expect(setup({}).provider.auth).toBe('user');
  });

  it('hands the trace to the source, which records through it', async () => {
    const { provider } = setup({ NODE_ENV: 'development' });
    const calls: string[] = [];
    const trace = { diag: () => {}, note: () => {}, wrap: (api: LiveApi) => ({ ...api, listJobRuns: (r: Parameters<LiveApi['listJobRuns']>[0]) => (calls.push('listJobRuns'), api.listJobRuns(r)) }) };
    await (provider.forRequest({ headers: {} }, trace) as RunSource).listRuns();
    expect(calls).toEqual(['listJobRuns']);
  });

  it('reads limits from env and rejects bad values', () => {
    expect(() => setup({ JOBS_CONSOLE_MAX_RUNS: 'lots' })).toThrow('JOBS_CONSOLE_MAX_RUNS must be a positive integer');
  });
});
