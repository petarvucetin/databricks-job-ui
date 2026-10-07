import { createApp, server } from '@databricks/appkit';
import type { NextFunction, Request, Response } from 'express';
import type { DataMode } from '../shared/domain/types';
import { selectRunSource, type RunSource } from './data/runSource';
import type { LiveProvider } from './data/live/liveProvider';
import { CaptureStore, Session, readCaptureLimits } from './data/capture/recorder';
import { listRuns, type HandlerResult } from './api/listRuns';
import { taskLog } from './api/taskLog';
import { getRun } from './api/getRun';
import { listItems } from './api/listItems';
import { getItem } from './api/getItem';
import { newSessionId, registerDiag, registerNoDiag } from './api/diag';
import { createSdkApi, resolveDefaultHost } from './data/live/api';
import { sendJson } from './api/gzip';

const provider = selectRunSource(process.env);
const live = provider.kind === 'live' ? (provider as LiveProvider) : undefined;
/** Live mode records every request (calls, diagnostics, errors) for GET /api/diag/capture. */
const store = live ? new CaptureStore(readCaptureLimits(process.env)) : undefined;

if (store) {
  // Recorded, not fatal: the capture is the way to find out what went wrong, and it lives in this process.
  process.on('unhandledRejection', (reason) => {
    const e = reason instanceof Error ? reason : new Error(String(reason));
    store.addProcess({ kind: 'unhandledRejection', message: e.message, stack: e.stack });
    console.error('Unhandled rejection', reason);
  });
  process.on('uncaughtExceptionMonitor', (e) => {
    store.addProcess({ kind: 'uncaughtException', message: e.message, stack: e.stack });
  });
}

const header = (req: Request, name: string): string | undefined => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) || undefined;
};

/**
 * Resolves the request's RunSource (live: as the signed-in user, recorded) and sends the handler's result; `gzipped`:
 * compressed when the browser accepts it (the runs and items lists, megabytes at 10k items and 90 days of history).
 */
function serve(req: Request, res: Response, next: NextFunction, route: string, handle: (source: RunSource) => Promise<HandlerResult>, gzipped = false): void {
  const session = live && store ? new Session({ id: newSessionId(), route, query: { ...req.query, ...req.params }, authMode: live.auth, user: header(req, 'x-forwarded-email') }) : undefined;
  const source = provider.forRequest(req, session);
  if ('error' in source) {
    if (session) store?.add(session.finish({ status: source.status, error: source.status >= 500 ? source.error : undefined }));
    res.status(source.status).json({ error: source.error });
    return;
  }
  handle(source)
    .then((result) => {
      if (session) {
        const error = result.status >= 500 ? (result.body as { error?: string } | undefined)?.error ?? `HTTP ${result.status}` : undefined;
        store?.add(session.finish({ status: result.status, body: result.body, error }));
      }
      if (gzipped) sendJson(req, res, result.status, result.body);
      else res.status(result.status).json(result.body);
    })
    .catch((e: unknown) => {
      if (session) store?.add(session.finish({ status: 500, error: e }));
      next(e);
    });
}

const mode: DataMode = { source: provider.kind, auth: provider.auth, capture: !!store };

/**
 * Which workspace the top bar names. Deployed: DATABRICKS_HOST (set by Databricks Apps, sometimes without a scheme).
 * Local: the CLI profile's host. Replay: the capture's workspace. Mock: none.
 */
let workspace: Promise<Pick<DataMode, 'workspace' | 'profile'>> | undefined;
async function monitoredWorkspace(): Promise<Pick<DataMode, 'workspace' | 'profile'>> {
  if (provider.kind === 'replay') return { workspace: (provider as { file?: { workspace?: { host?: string } } }).file?.workspace?.host || undefined };
  if (provider.kind !== 'live') return {};
  const env = process.env.DATABRICKS_HOST;
  if (env) return { workspace: (/^https?:\/\//.test(env) ? new URL(env) : new URL(`https://${env}`)).origin };
  return { workspace: await resolveDefaultHost(), profile: process.env.DATABRICKS_CONFIG_PROFILE || undefined };
}

/** The SDK default chain's own identity: the CLI login locally, the app's service principal on Databricks Apps. Cached; retried after a failure. */
let defaultIdentity: Promise<string | undefined> | undefined;
function selfName(): Promise<string | undefined> {
  defaultIdentity ??= createSdkApi({})
    .me()
    // People by email (matches the deployed viewer header); service principals by display name (their userName is a GUID).
    .then((u) => (u.userName?.includes('@') ? u.userName : u.displayName || u.userName) || undefined)
    .catch(() => {
      defaultIdentity = undefined;
      return undefined;
    });
  return defaultIdentity;
}

/** Who is looking, and (when different) who the APIs are called as. See DataMode.user / readAs. */
async function identity(viewer: string | undefined): Promise<Pick<DataMode, 'user' | 'readAs'>> {
  if (provider.kind === 'replay') return { user: (provider as { file?: { workspace?: { user?: string } } }).file?.workspace?.user || undefined };
  if (provider.kind !== 'live') return {};
  if (!viewer) return { user: await selfName() }; // local: the CLI login is both
  return provider.auth === 'app' ? { user: viewer, readAs: await selfName() } : { user: viewer };
}

createApp({
  plugins: [server()],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.get('/api/mode', (req, res, next) => {
        // History: live probes as the requester (cached 10 min); replay answers as recorded; mock has none.
        const history = provider.history ? provider.history(req).catch((): undefined => undefined) : Promise.resolve(undefined);
        Promise.all([(workspace ??= monitoredWorkspace()), identity(header(req, 'x-forwarded-email')), history])
          .then(([ws, who, h]) => res.json({ ...mode, ...ws, ...who, ...(h ? { history: h } : {}) }))
          .catch(next);
      });
      app.get('/api/runs', (req, res, next) => {
        serve(req, res, next, '/api/runs', (source) => listRuns(source, req.query), true);
      });
      app.get('/api/runs/:id', (req, res, next) => {
        serve(req, res, next, '/api/runs/:id', (source) => getRun(source, req.params.id, req.query));
      });
      app.get('/api/runs/:id/log', (req, res, next) => {
        serve(req, res, next, '/api/runs/:id/log', (source) => taskLog(source, req.params.id, req.query));
      });
      app.get('/api/items', (req, res, next) => {
        serve(req, res, next, '/api/items', (source) => listItems(source, req.query), true);
      });
      app.get('/api/items/:type/:id', (req, res, next) => {
        serve(req, res, next, '/api/items/:type/:id', (source) => getItem(source, req.params.type, req.params.id));
      });
      if (live && store) registerDiag(app, { provider: live, store, env: process.env });
      else registerNoDiag(app);
    });
  },
}).catch(console.error);
