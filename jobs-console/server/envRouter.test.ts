import { describe, expect, it, vi } from 'vitest';
import { createEnvRouter } from './envRouter';
import { createWorkspaceEnv, type WorkspaceEnv } from './workspaceEnv';
import type { RunSourceProvider } from './data/runSource';
import { createLiveProvider } from './data/live/liveProvider';
import { fakeApi } from './data/live/fakeApi';

const req = (query: Record<string, unknown> = {}) => ({ query });
const asEnv = (r: WorkspaceEnv | { status: 400; error: string }): WorkspaceEnv => {
  if ('status' in r && 'error' in r) throw new Error(`expected a WorkspaceEnv, got ${r.error}`);
  return r;
};

describe('createEnvRouter', () => {
  it('single: ignores env and labels from JOBS_CONSOLE_ENV', () => {
    const router = createEnvRouter({ JOBS_CONSOLE_DATA: 'mock', JOBS_CONSOLE_ENV: 'prod' });
    const picked = asEnv(router.pick(req({ env: 'dev' })));
    expect(picked.name).toBe('prod');
    expect(router.names).toEqual([]);
    expect(router.pick(req())).toBe(picked);
    expect(router.modeFor(req({ env: 'qa' }))).toEqual({ env: picked });
  });

  it('single: built eagerly over the unmodified base env', () => {
    const make = vi.fn(createWorkspaceEnv);
    const base = { JOBS_CONSOLE_DATA: 'mock', DATABRICKS_HOST: 'https://h' };
    const router = createEnvRouter(base, make);
    expect(make).toHaveBeenCalledTimes(1);
    expect(make.mock.calls[0][0]).toBeUndefined();
    expect(make.mock.calls[0][1]).toBe(base);
    expect(router.built()).toHaveLength(1);
  });

  it('multi: one WorkspaceEnv per env, built lazily and reused', () => {
    const make = vi.fn(createWorkspaceEnv);
    const router = createEnvRouter({ JOBS_CONSOLE_DATA: 'mock', JOBS_CONSOLE_ENVS: 'dev,prod', DATABRICKS_HOST: 'https://ambient' }, make);
    expect(make).not.toHaveBeenCalled();
    expect(router.built()).toEqual([]);
    expect(router.names).toEqual(['dev', 'prod']);

    const prod = asEnv(router.pick(req({ env: 'prod' })));
    expect(asEnv(router.pick(req({ env: 'prod' })))).toBe(prod);
    expect(make).toHaveBeenCalledTimes(1);
    const [name, record] = make.mock.calls[0];
    expect(name).toBe('prod');
    expect(record.DATABRICKS_CONFIG_PROFILE).toBe('prod');
    expect('DATABRICKS_HOST' in record).toBe(false);
    expect(record.JOBS_CONSOLE_MOCK_VARIANT).toBe('prod');

    const dev = asEnv(router.pick(req({ env: 'dev' })));
    expect(dev).not.toBe(prod);
    expect(dev.provider).not.toBe(prod.provider);
    expect(router.built()).toEqual([prod, dev]);
  });

  it('multi: live envs get no mock variant', () => {
    const make = vi.fn((name: Parameters<typeof createWorkspaceEnv>[0], env: Record<string, string | undefined>) =>
      createWorkspaceEnv(name, env, { select: () => ({ kind: 'mock', forRequest: () => ({ status: 500, error: 'x' }) }) }),
    );
    const router = createEnvRouter({ JOBS_CONSOLE_DATA: 'live', JOBS_CONSOLE_ENVS: 'dev=gov-dev' }, make);
    asEnv(router.pick(req({ env: 'dev' })));
    expect(make.mock.calls[0][1].DATABRICKS_CONFIG_PROFILE).toBe('gov-dev');
    expect('JOBS_CONSOLE_MOCK_VARIANT' in make.mock.calls[0][1]).toBe(false);
  });

  it('multi: 400s', () => {
    const make = vi.fn(createWorkspaceEnv);
    const router = createEnvRouter({ JOBS_CONSOLE_DATA: 'mock', JOBS_CONSOLE_ENVS: 'dev,stg,prod' }, make);
    expect(router.pick(req())).toEqual({ status: 400, error: 'Pick an environment: ?env=dev|stg|prod' });
    expect(router.pick(req({ env: '' }))).toEqual({ status: 400, error: 'Pick an environment: ?env=dev|stg|prod' });
    expect(router.pick(req({ env: 'qa' }))).toEqual({ status: 400, error: 'Unknown environment "qa"; configured: dev, stg, prod' });
    expect(router.pick(req({ env: ['dev', 'prod'] }))).toEqual({ status: 400, error: 'Unknown environment "dev,prod"; configured: dev, stg, prod' });
    expect(router.pick(req({ env: { x: 1 } }))).toMatchObject({ status: 400 });
    expect(make).not.toHaveBeenCalled();
  });

  it('multi: the missing-env message lists only the configured envs', () => {
    const router = createEnvRouter({ JOBS_CONSOLE_DATA: 'mock', JOBS_CONSOLE_ENVS: 'dev,prod' });
    expect(router.pick(req())).toEqual({ status: 400, error: 'Pick an environment: ?env=dev|prod' });
    expect(router.pick(req({ env: 'stg' }))).toEqual({ status: 400, error: 'Unknown environment "stg"; configured: dev, prod' });
  });

  it('multi: exactly one configured env is picked when env is missing', () => {
    const router = createEnvRouter({ JOBS_CONSOLE_DATA: 'mock', JOBS_CONSOLE_ENVS: 'stg' });
    expect(asEnv(router.pick(req())).name).toBe('stg');
    expect(router.modeFor(req())).toEqual({ env: router.built()[0] });
  });

  it('multi: modeFor falls back to the first env', () => {
    const router = createEnvRouter({ JOBS_CONSOLE_DATA: 'mock', JOBS_CONSOLE_ENVS: 'prod,dev' });
    expect(router.modeFor(req()).env.name).toBe('dev');
    expect(router.modeFor(req({ env: 'qa' })).env.name).toBe('dev');
    expect(router.modeFor(req({ env: ['prod'] })).env.name).toBe('dev');
    expect(router.modeFor(req({ env: 'prod' })).env.name).toBe('prod');
    expect(router.modeFor(req()).envs).toEqual(['dev', 'prod']);
  });

  it('multi: bad JOBS_CONSOLE_ENVS throws at construction', () => {
    expect(() => createEnvRouter({ JOBS_CONSOLE_ENVS: 'qa' })).toThrow(/unknown env "qa"/);
  });

  it('replay: one workspace even with JOBS_CONSOLE_ENVS set (E15: the captured env, no switch), logged once', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const make = vi.fn((name: Parameters<typeof createWorkspaceEnv>[0], env: Record<string, string | undefined>) =>
      createWorkspaceEnv(name, env, { select: () => ({ kind: 'replay', forRequest: () => ({ status: 500, error: 'x' }) }) }),
    );
    const base = { JOBS_CONSOLE_DATA: 'replay', JOBS_CONSOLE_ENVS: 'dev,stg,prod', JOBS_CONSOLE_ENV: 'stg' };
    const router = createEnvRouter(base, make);
    expect(router.names).toEqual([]);
    expect(make).toHaveBeenCalledTimes(1);
    expect(make.mock.calls[0][0]).toBe('stg');
    expect(make.mock.calls[0][1]).toBe(base);
    expect(router.modeFor(req({ env: 'prod' }))).toEqual({ env: router.built()[0] });
    expect(asEnv(router.pick(req())).name).toBe('stg');
    expect(log).toHaveBeenCalledTimes(1);
    expect(String(log.mock.calls[0][0])).toMatch(/JOBS_CONSOLE_ENVS is ignored in replay/);
    log.mockRestore();
  });

  it('replay: a bad JOBS_CONSOLE_ENVS does not stop a replay', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const make = vi.fn((name: Parameters<typeof createWorkspaceEnv>[0], env: Record<string, string | undefined>) =>
      createWorkspaceEnv(name, env, { select: () => ({ kind: 'replay', forRequest: () => ({ status: 500, error: 'x' }) }) }),
    );
    expect(createEnvRouter({ JOBS_CONSOLE_DATA: 'replay', JOBS_CONSOLE_ENVS: 'qa' }, make).names).toEqual([]);
    log.mockRestore();
  });

  it('two live envs: own profile, own provider state, and runs listed through one never appear in the other (Review Focus 5)', async () => {
    const NOW = 1_800_000_000_000;
    const runOf = (run_id: number, job: string) => ({
      run_id,
      job_id: run_id,
      run_name: job,
      creator_user_name: 'ann@x.com',
      start_time: NOW - 60_000,
      run_duration: 1000,
      status: { state: 'TERMINATED' as const, termination_details: { code: 'SUCCESS' as const } },
    });
    const runsByProfile: Record<string, ReturnType<typeof runOf>[]> = {
      'gov-dev': [runOf(11, 'dev_ingest'), runOf(12, 'dev_report')],
      'gov-prod': [runOf(21, 'prod_ingest'), runOf(22, 'prod_report')],
    };
    const makeApi = vi.fn((opts: { profile?: string }) => fakeApi({ user: 'ann@x.com', runs: runsByProfile[opts.profile ?? ''] ?? [] }));
    const make = (name: Parameters<typeof createWorkspaceEnv>[0], env: Record<string, string | undefined>) =>
      createWorkspaceEnv(name, env, { select: (e) => createLiveProvider(e, { makeApi, clock: () => NOW }) });
    const router = createEnvRouter(
      { JOBS_CONSOLE_DATA: 'live', JOBS_CONSOLE_AUTH: 'app', JOBS_CONSOLE_ENVS: 'dev=gov-dev,prod=gov-prod', DATABRICKS_HOST: 'https://ambient', DATABRICKS_TOKEN: 't' },
      make,
    );
    const list = async (env: string) => {
      const ws = asEnv(router.pick(req({ env })));
      const source = ws.provider.forRequest({ headers: {} });
      if ('status' in source) throw new Error(source.error);
      return { ws, ids: (await source.listRuns()).runs.map((r) => r.runId) };
    };
    const dev = await list('dev');
    const prod = await list('prod');

    expect(makeApi.mock.calls.map((c) => c[0])).toEqual([{ profile: 'gov-dev' }, { profile: 'gov-prod' }]);
    expect(dev.ws.live).toBeDefined();
    expect(prod.ws.live).toBeDefined();
    expect(dev.ws.live!.state).not.toBe(prod.ws.live!.state);
    expect(dev.ws.store).not.toBe(prod.ws.store);
    expect(dev.ids.sort()).toEqual(['11', '12']);
    expect(prod.ids.sort()).toEqual(['21', '22']);
    expect(dev.ids.filter((id) => prod.ids.includes(id))).toEqual([]);
    // Listing again (from each env's cache) still keeps them apart.
    expect((await list('dev')).ids.sort()).toEqual(['11', '12']);
    expect((await list('prod')).ids.sort()).toEqual(['21', '22']);
  });

  it('mock envs serve different data', async () => {
    const router = createEnvRouter({ JOBS_CONSOLE_DATA: 'mock', JOBS_CONSOLE_ENVS: 'dev,prod' });
    const names = async (env: string) => {
      const source = asEnv(router.pick(req({ env }))).provider.forRequest({ headers: {} });
      if ('status' in source) throw new Error(source.error);
      return new Set((await source.listItems()).items.map((i) => i.name));
    };
    const [dev, prod] = [await names('dev'), await names('prod')];
    expect(dev).not.toEqual(prod);
    expect([...dev].every((n) => n.startsWith('dev_'))).toBe(true);
  });
});

describe('createWorkspaceEnv', () => {
  const viewerReq = { headers: {} };

  it('mock: mode is the source and env, with no workspace lookups', async () => {
    const selfName = vi.fn(() => Promise.resolve<string | undefined>('x'));
    const ws = createWorkspaceEnv('stg', { JOBS_CONSOLE_DATA: 'mock' }, { selfName });
    expect(ws.store).toBeUndefined();
    expect(ws.live).toBeUndefined();
    expect(await ws.mode(undefined, viewerReq)).toEqual({ source: 'mock', capture: false, env: 'stg' });
    expect(selfName).not.toHaveBeenCalled();
  });

  it('live: resolves host and identity with its own profile, and has a store', async () => {
    const liveProvider = { kind: 'live', auth: 'user', forRequest: () => ({ status: 500, error: 'x' }) } as unknown as RunSourceProvider;
    const selfName = vi.fn((profile?: string) => Promise.resolve<string | undefined>(`me@${profile}`));
    const resolveHost = vi.fn((profile?: string) => Promise.resolve<string | undefined>(`https://${profile}.example`));
    const ws = createWorkspaceEnv('prod', { JOBS_CONSOLE_DATA: 'live', DATABRICKS_CONFIG_PROFILE: 'gov-prod' }, { select: () => liveProvider, selfName, resolveHost });
    expect(ws.profile).toBe('gov-prod');
    expect(ws.live).toBe(liveProvider);
    expect(ws.store).toBeDefined();
    expect(await ws.mode(undefined, viewerReq)).toEqual({
      source: 'live',
      auth: 'user',
      capture: true,
      workspace: 'https://gov-prod.example',
      profile: 'gov-prod',
      user: 'me@gov-prod',
      env: 'prod',
    });
    await ws.mode(undefined, viewerReq);
    expect(resolveHost).toHaveBeenCalledTimes(1);
    expect(resolveHost).toHaveBeenCalledWith('gov-prod');
    expect(selfName).toHaveBeenCalledTimes(1);
  });

  it('live, deployed: DATABRICKS_HOST names the workspace; app auth reads as the service principal', async () => {
    const liveProvider = { kind: 'live', auth: 'app', forRequest: () => ({ status: 500, error: 'x' }), history: () => Promise.resolve(undefined) } as unknown as RunSourceProvider;
    const resolveHost = vi.fn(() => Promise.resolve<string | undefined>('unused'));
    const ws = createWorkspaceEnv(undefined, { JOBS_CONSOLE_DATA: 'live', DATABRICKS_HOST: 'adb-1.2.azuredatabricks.net' }, {
      select: () => liveProvider,
      selfName: () => Promise.resolve('jobs-console-sp'),
      resolveHost,
    });
    expect(await ws.mode('ann@agency.gov', viewerReq)).toEqual({
      source: 'live',
      auth: 'app',
      capture: true,
      workspace: 'https://adb-1.2.azuredatabricks.net',
      user: 'ann@agency.gov',
      readAs: 'jobs-console-sp',
    });
    expect(resolveHost).not.toHaveBeenCalled();
  });

  it('live: a failed self lookup is retried on the next call', async () => {
    const liveProvider = { kind: 'live', auth: 'user', forRequest: () => ({ status: 500, error: 'x' }) } as unknown as RunSourceProvider;
    const selfName = vi.fn().mockRejectedValueOnce(new Error('expired')).mockResolvedValue('me@x');
    const ws = createWorkspaceEnv('dev', { JOBS_CONSOLE_DATA: 'live', DATABRICKS_HOST: 'https://h' }, { select: () => liveProvider, selfName });
    expect((await ws.mode(undefined, viewerReq)).user).toBeUndefined();
    expect((await ws.mode(undefined, viewerReq)).user).toBe('me@x');
  });

  it('replay: env, host and user come from the capture file', async () => {
    const file = { workspace: { host: 'https://dbc-9.cloud.databricks.us', user: 'ann@agency.gov', env: 'stg' } };
    const replay = { kind: 'replay', auth: 'user', file, forRequest: () => ({ status: 500, error: 'x' }), history: () => Promise.resolve(undefined) } as unknown as RunSourceProvider;
    const ws = createWorkspaceEnv('dev', { JOBS_CONSOLE_DATA: 'replay' }, { select: () => replay });
    expect(ws.store).toBeUndefined();
    expect(await ws.mode(undefined, viewerReq)).toEqual({
      source: 'replay',
      auth: 'user',
      capture: false,
      workspace: 'https://dbc-9.cloud.databricks.us',
      user: 'ann@agency.gov',
      env: 'stg',
    });
  });

  it('replay: without a recorded env, the env name is used', async () => {
    const replay = { kind: 'replay', file: { workspace: {} }, forRequest: () => ({ status: 500, error: 'x' }) } as unknown as RunSourceProvider;
    const ws = createWorkspaceEnv('prod', { JOBS_CONSOLE_DATA: 'replay' }, { select: () => replay });
    expect((await ws.mode(undefined, viewerReq)).env).toBe('prod');
  });
});
