import { describe, it, expect, afterEach } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import express from 'express';
import { clientErrorFrom, registerDiag, visibleTo, type DiagPick } from './diag';
import { CaptureStore, readCaptureLimits, type SessionRecord } from '../data/capture/recorder';
import type { LiveProvider } from '../data/live/liveProvider';

describe('client error body', () => {
  it('keeps the known fields as trimmed strings', () => {
    const e = clientErrorFrom({ message: 'boom', stack: 'at x', url: 'http://h/', userAgent: 'Edge', at: '2027-01-01T00:00:00Z', extra: 'dropped' });
    expect(e).toEqual({ message: 'boom', stack: 'at x', url: 'http://h/', userAgent: 'Edge', at: '2027-01-01T00:00:00Z' });
    expect(clientErrorFrom({ message: 'x'.repeat(5000) })?.message).toHaveLength(2000);
    expect(clientErrorFrom({ message: 'm', stack: 42 })?.stack).toBe('');
  });

  it('rejects a body without a message', () => {
    expect(clientErrorFrom(undefined)).toBeUndefined();
    expect(clientErrorFrom({ stack: 'x' })).toBeUndefined();
    expect(clientErrorFrom('boom')).toBeUndefined();
  });
});

describe('what a capture download holds', () => {
  const s = (id: string, user?: string) => ({ id, user }) as SessionRecord;
  const all = [s('a', 'ann@x.com'), s('b', 'BOB@x.com'), s('c')];

  it("only the requester's own sessions", () => {
    expect(visibleTo(all, 'bob@x.com', false).map((x) => x.id)).toEqual(['b']);
    expect(visibleTo(all, undefined, false)).toEqual([]);
  });

  it('everything on a local dev server (one user)', () => {
    expect(visibleTo(all, 'ann@x.com', true)).toHaveLength(3);
  });
});

describe('registerDiag picks the env first', () => {
  let server: Server | undefined;
  afterEach(() => {
    server?.close();
    server = undefined;
  });

  async function listen(pick: DiagPick): Promise<string> {
    const app = express();
    registerDiag(app, { pick });
    server = await new Promise<Server>((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  /** A live env whose requests read as the local CLI login. */
  const liveEnv = (name: 'dev' | 'prod', host: string) => ({
    name,
    profile: name,
    env: { DATABRICKS_HOST: host },
    store: new CaptureStore(readCaptureLimits({})),
    provider: { auth: 'user', identify: () => ({ api: {}, user: () => Promise.resolve('me@x.com'), userKey: 'dev', readKey: 'dev' }) } as unknown as LiveProvider,
  });

  it('answers the picker refusal before anything else', async () => {
    const base = await listen(() => ({ status: 400, error: 'Pick an environment: ?env=dev|prod' }));
    const res = await fetch(`${base}/api/diag/capture`);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Pick an environment: ?env=dev|prod' });
    const sweep = await fetch(`${base}/api/diag/sweep?days=1`);
    expect(sweep.status).toBe(400);
    expect(await sweep.json()).toEqual({ error: 'Pick an environment: ?env=dev|prod' });
  });

  it("names each download after the picked env and that env's own host", async () => {
    const envs = { dev: liveEnv('dev', 'https://dev.example'), prod: liveEnv('prod', 'https://prod.example') };
    const base = await listen((req) => envs[req.query.env as 'dev' | 'prod']);
    const prod = await fetch(`${base}/api/diag/capture?env=prod`);
    expect(prod.status).toBe(200);
    expect(prod.headers.get('content-disposition')).toMatch(/filename="jobs-console-capture-prod-prod\.example-\d{8}-\d{4}\.json\.gz"/);
    const dev = await fetch(`${base}/api/diag/capture?env=dev`);
    expect(dev.headers.get('content-disposition')).toMatch(/filename="jobs-console-capture-dev-dev\.example-/);
  });
});
