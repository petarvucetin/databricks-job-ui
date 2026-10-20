import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { registerRoutes, withLoginHint } from './routes';
import { createEnvRouter, type EnvRouter } from './envRouter';
import { createWorkspaceEnv } from './workspaceEnv';
import { createLiveProvider } from './data/live/liveProvider';
import { SourceError } from './data/sourceError';
import type { RunSource, RunSourceProvider } from './data/runSource';

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

/** An express app with the console's routes over `router`, on 127.0.0.1; its base URL. */
async function listen(router: EnvRouter): Promise<string> {
  const app = express();
  registerRoutes(app, router);
  server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

const get = async (url: string): Promise<{ status: number; body: Record<string, unknown> }> => {
  const res = await fetch(url);
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

const MULTI = { JOBS_CONSOLE_DATA: 'mock', JOBS_CONSOLE_ENVS: 'dev,prod' };

/** A provider whose every read fails with `err`. */
const failing = (err: Error): RunSourceProvider => {
  const reject = () => Promise.reject(err);
  const source = { kind: 'live', listRuns: reject, taskLog: reject, getRun: reject, listItems: reject, getItem: reject } as unknown as RunSource;
  return { kind: 'live', forRequest: () => source };
};

/** Router over `base` whose prod env reads through `prod` instead of its own provider. */
const withProd = (base: Record<string, string>, prod: (env: Record<string, string | undefined>) => RunSourceProvider) =>
  createEnvRouter(base, (name, env, deps) => (name === 'prod' || (name === undefined && base.JOBS_CONSOLE_ENV === 'prod') ? createWorkspaceEnv(name, env, { select: prod }) : createWorkspaceEnv(name, env, deps)));

describe('routing by ?env (multi-env, mock dev,prod)', () => {
  it('refuses a data request without env, before any provider call', async () => {
    const base = await listen(createEnvRouter(MULTI));
    expect(await get(`${base}/api/items`)).toEqual({ status: 400, body: { error: 'Pick an environment: ?env=dev|prod' } });
    expect((await get(`${base}/api/runs?env=qa`)).status).toBe(400);
  });

  it('serves the named env', async () => {
    const base = await listen(createEnvRouter(MULTI));
    expect((await get(`${base}/api/items?env=prod`)).status).toBe(200);
    expect((await get(`${base}/api/runs?env=dev`)).status).toBe(200);
  });

  it('mode names the env and offers the switch', async () => {
    const base = await listen(createEnvRouter(MULTI));
    expect((await get(`${base}/api/mode?env=prod`)).body).toEqual({ source: 'mock', capture: false, env: 'prod', envs: ['dev', 'prod'] });
    expect((await get(`${base}/api/mode`)).body).toMatchObject({ env: 'dev', envs: ['dev', 'prod'] });
  });

  it('diagnostics: picks first, and a non-live env has no capture', async () => {
    const base = await listen(createEnvRouter(MULTI));
    expect((await get(`${base}/api/diag/capture`)).status).toBe(400);
    expect(await get(`${base}/api/diag/capture?env=prod`)).toEqual({ status: 404, body: { error: 'Capture is available in live mode only' } });
  });
});

describe('single workspace: as before', () => {
  it('ignores env, has no switch, and no diagnostics in mock', async () => {
    const base = await listen(createEnvRouter({ JOBS_CONSOLE_DATA: 'mock' }));
    expect((await get(`${base}/api/items`)).status).toBe(200);
    expect((await get(`${base}/api/runs?env=qa`)).status).toBe(200);
    expect((await get(`${base}/api/mode`)).body).toEqual({ source: 'mock', capture: false });
    expect(await get(`${base}/api/diag/capture`)).toEqual({ status: 404, body: { error: 'Not found: diagnostics exist in live mode only' } });
  });

  it('labels mode from JOBS_CONSOLE_ENV', async () => {
    const base = await listen(createEnvRouter({ JOBS_CONSOLE_DATA: 'mock', JOBS_CONSOLE_ENV: 'stg' }));
    expect((await get(`${base}/api/mode`)).body).toEqual({ source: 'mock', capture: false, env: 'stg' });
  });

  it('a refused read keeps its message unchanged', async () => {
    const base = await listen(withProd({ JOBS_CONSOLE_DATA: 'mock', JOBS_CONSOLE_ENV: 'prod', DATABRICKS_CONFIG_PROFILE: 'prod' }, () => failing(new SourceError(401, 'Invalid access token'))));
    expect(await get(`${base}/api/items`)).toEqual({ status: 401, body: { error: 'Invalid access token' } });
  });
});

describe('one env failing names its fix (E10, Review Focus 3)', () => {
  it('an SDK auth failure in prod answers with the login command; dev still works', async () => {
    const router = withProd(MULTI, (env) =>
      createLiveProvider(
        { ...env, JOBS_CONSOLE_AUTH: 'app' },
        {
          makeApi: () => {
            throw new Error('default auth: cannot configure default credentials');
          },
        }
      )
    );
    const base = await listen(router);
    const prod = await get(`${base}/api/runs?env=prod`);
    expect(prod.status).toBeGreaterThanOrEqual(400);
    expect(String(prod.body.error)).toContain('databricks auth login --profile prod');
    expect((await get(`${base}/api/runs?env=dev`)).status).toBe(200);
  });

  it('a refused read (401) gets the hint', async () => {
    const base = await listen(withProd(MULTI, () => failing(new SourceError(401, 'Invalid access token'))));
    expect(await get(`${base}/api/items?env=prod`)).toEqual({ status: 401, body: { error: 'Invalid access token — run: databricks auth login --profile prod' } });
  });

  it('an unreachable workspace (thrown) gets the hint', async () => {
    const base = await listen(withProd(MULTI, () => failing(new Error('fetch failed'))));
    expect(await get(`${base}/api/runs?env=prod`)).toEqual({ status: 502, body: { error: 'fetch failed — run: databricks auth login --profile prod' } });
  });

  it('a missing run does not', async () => {
    const base = await listen(withProd(MULTI, () => failing(new SourceError(404, 'Run 1 does not exist'))));
    expect(await get(`${base}/api/runs/1?env=prod`)).toEqual({ status: 404, body: { error: 'Run 1 does not exist' } });
  });
});

describe('withLoginHint', () => {
  const hint = ' — run: databricks auth login --profile gov-prod';
  it('appends the login command to sign-in and connection failures', () => {
    expect(withLoginHint('Invalid access token', 401, 'gov-prod')).toBe('Invalid access token' + hint);
    expect(withLoginHint('nope', 403, 'gov-prod')).toBe('nope' + hint);
    expect(withLoginHint('default auth: cannot configure default credentials, please check ...', 502, 'gov-prod')).toContain(hint);
    expect(withLoginHint('databricks-cli: cannot get access token: exit 1', undefined, 'gov-prod')).toContain(hint);
    expect(withLoginHint('fetch failed (cause: getaddrinfo ENOTFOUND x [ENOTFOUND])', 502, 'gov-prod')).toContain(hint);
  });

  it('leaves everything else alone', () => {
    expect(withLoginHint('Run 1 does not exist', 404, 'gov-prod')).toBe('Run 1 does not exist');
    expect(withLoginHint('since must be epoch milliseconds', 400, 'gov-prod')).toBe('since must be epoch milliseconds');
    expect(withLoginHint('upstream exploded', 502, 'gov-prod')).toBe('upstream exploded');
  });
});
