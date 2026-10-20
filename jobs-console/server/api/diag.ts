import { randomBytes } from 'node:crypto';
import type { Application, Request, Response } from 'express';
import type { LiveProvider } from '../data/live/liveProvider';
import { resolveDefaultHost } from '../data/live/api';
import { buildCapture, captureFileName, gzipCapture } from '../data/capture/captureFile';
import { Session, type CaptureStore, type ClientErrorRecord } from '../data/capture/recorder';
import { SWEEP_ROUTE } from '../data/capture/replayProvider';
import { parseSweepDays, readSweepLimits, runSweep } from '../data/capture/sweep';

export const newSessionId = (): string => `${new Date().toISOString().slice(11, 19).replace(/:/g, '')}-${randomBytes(3).toString('hex')}`;

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');

/** POST /api/diag/client-error body -> record; undefined when it has no message. */
export function clientErrorFrom(body: unknown): ClientErrorRecord | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  const message = str(b.message, 2000);
  if (!message) return undefined;
  return { message, stack: str(b.stack, 20000), url: str(b.url, 2000), userAgent: str(b.userAgent, 500), at: str(b.at, 64) };
}

/** A download holds only the requester's own sessions (all of them on a local dev server, which has one user). */
export function visibleTo<T extends { user?: string }>(items: T[], user: string | undefined, dev: boolean): T[] {
  if (dev) return items;
  const me = user?.toLowerCase();
  return me ? items.filter((s) => s.user?.toLowerCase() === me) : [];
}

const header = (req: Request, name: string): string | undefined => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) || undefined;
};

/** One live env's diagnostics: its provider, capture store and env record; `name` / `profile` go into the capture. */
export interface DiagEnv {
  provider: LiveProvider;
  store: CaptureStore;
  env: Record<string, string | undefined>;
  name?: string;
  profile?: string;
}

/** The env a diagnostics request acts on, or the status to refuse it with (no or unknown env; a non-live env). */
export type DiagPick = (req: Request) => DiagEnv | { status: number; error: string };

/**
 * Live mode only. GET /api/diag/capture downloads the capture (gzipped JSON); GET /api/diag/sweep?days=N runs a wide
 * collection first and downloads the capture with it as the newest session; POST /api/diag/client-error stores a
 * browser error. Every route picks its env first; everything is scoped to the requester and that env.
 */
export function registerDiag(app: Application, deps: { pick: DiagPick }): void {
  const { pick } = deps;
  /** `${env name}|${userKey}` of the sweeps running. */
  const sweeping = new Set<string>();
  /** Workspace host per env name, looked up once. */
  const hosts = new Map<string, Promise<string | undefined>>();
  const hostOf = ({ name, env }: DiagEnv): Promise<string | undefined> => {
    let host = hosts.get(name ?? '');
    if (!host) {
      host = env.DATABRICKS_HOST ? Promise.resolve(env.DATABRICKS_HOST) : resolveDefaultHost(env.DATABRICKS_CONFIG_PROFILE);
      hosts.set(name ?? '', host);
    }
    return host;
  };

  async function sendCapture(req: Request, res: Response, d: DiagEnv): Promise<void> {
    const { provider, store } = d;
    const id = provider.identify(req);
    if ('error' in id) {
      res.status(id.status).json({ error: id.error });
      return;
    }
    const user = await id.user().catch(() => header(req, 'x-forwarded-email'));
    const dev = id.userKey === 'dev';
    const workspaceHost = await hostOf(d);
    const file = buildCapture({
      env: d.env,
      host: workspaceHost,
      authMode: provider.auth,
      user,
      envName: d.name,
      profile: d.profile,
      sessions: visibleTo(store.sessions(), user, dev),
      clientErrors: visibleTo(store.clientErrors(), user, dev),
      process: store.process(),
    });
    const body = await gzipCapture(file);
    res.setHeader('Content-Type', 'application/gzip');
    res.setHeader('Content-Disposition', `attachment; filename="${captureFileName(workspaceHost, new Date(), d.name)}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).send(body);
  }

  /** Picks the env (answering a refusal), then runs `fn`; a failure is recorded into that env's store and answered 500. */
  const guarded = (route: string, fn: (req: Request, res: Response, d: DiagEnv) => Promise<void>) => (req: Request, res: Response) => {
    const d = pick(req);
    if ('error' in d) {
      res.status(d.status).json({ error: d.error });
      return;
    }
    fn(req, res, d).catch((e: unknown) => {
      const err = e instanceof Error ? e : new Error(String(e));
      d.store.addProcess({ kind: 'serverError', message: err.message, stack: err.stack, route });
      console.error(`[diag] ${route} failed`, err);
      if (!res.headersSent) res.status(500).json({ error: err.message });
    });
  };

  app.get('/api/diag/capture', guarded('/api/diag/capture', sendCapture));

  app.get(
    SWEEP_ROUTE,
    guarded(SWEEP_ROUTE, async (req, res, d) => {
      const { provider, store } = d;
      const days = parseSweepDays(req.query.days);
      if (days === undefined) {
        res.status(400).json({ error: 'days must be a whole number from 1 to 180' });
        return;
      }
      const id = provider.identify(req);
      if ('error' in id) {
        res.status(id.status).json({ error: id.error });
        return;
      }
      const key = `${d.name ?? ''}|${id.userKey}`;
      if (sweeping.has(key)) {
        res.status(409).json({ error: 'A sweep is already running for you' });
        return;
      }
      sweeping.add(key);
      const session = new Session({ id: newSessionId(), route: SWEEP_ROUTE, query: { ...req.query }, authMode: provider.auth, user: header(req, 'x-forwarded-email') });
      try {
        const out = await runSweep({ api: id.api, user: id.user, session, days, ...readSweepLimits(d.env), concurrency: provider.limits.concurrency, history: provider.historyConfig });
        store.add(session.finish({ status: 200, body: out }));
      } catch (e) {
        // A failed sweep is still worth bringing home: it goes in as the newest session, with its error.
        store.add(session.finish({ status: 502, error: e }));
      } finally {
        sweeping.delete(key);
      }
      await sendCapture(req, res, d);
    })
  );

  app.post('/api/diag/client-error', (req, res) => {
    const d = pick(req);
    if ('error' in d) {
      res.status(d.status).json({ error: d.error });
      return;
    }
    const e = clientErrorFrom(req.body);
    if (!e) {
      res.status(400).json({ error: 'body must be JSON with a message' });
      return;
    }
    const user = header(req, 'x-forwarded-email');
    d.store.addClientError({ ...e, receivedAt: Date.now(), ...(user ? { user } : {}) });
    res.status(204).end();
  });
}

/** Mock and replay: /api/diag does not exist. */
export function registerNoDiag(app: Application): void {
  app.use('/api/diag', (_req, res) => {
    res.status(404).json({ error: 'Not found: diagnostics exist in live mode only' });
  });
}
