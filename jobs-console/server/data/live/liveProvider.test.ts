import { describe, it, expect, vi } from 'vitest';
import { createLiveProvider } from './liveProvider';
import { fakeApi } from './fakeApi';
import type { RunSource } from '../runSource';

const NOW = 1_800_000_000_000;
const run = { run_id: 1, job_id: 1, run_name: 'j', creator_user_name: 'ann@x.com', start_time: NOW - 60000, run_duration: 1000, status: { state: 'TERMINATED' as const, termination_details: { code: 'SUCCESS' as const } } };

function setup(env: Record<string, string | undefined>) {
  const apis: { opts: { host?: string; token?: string }; api: ReturnType<typeof fakeApi> }[] = [];
  const makeApi = vi.fn((opts: { host?: string; token?: string }) => {
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

  it('reads limits from env and rejects bad values', () => {
    expect(() => setup({ JOBS_CONSOLE_MAX_RUNS: 'lots' })).toThrow('JOBS_CONSOLE_MAX_RUNS must be a positive integer');
  });
});
