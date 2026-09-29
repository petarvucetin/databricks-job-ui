import { createApp, server } from '@databricks/appkit';
import type { NextFunction, Request, Response } from 'express';
import type { DataMode } from '../shared/domain/types';
import { selectRunSource, type RunSource } from './data/runSource';
import type { LiveProvider } from './data/live/liveProvider';
import { CaptureStore, Session, readCaptureLimits } from './data/capture/recorder';
import { listRuns, type HandlerResult } from './api/listRuns';
import { taskLog } from './api/taskLog';
import { getRun } from './api/getRun';
import { newSessionId, registerDiag, registerNoDiag } from './api/diag';

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

/** Resolves the request's RunSource (live: as the signed-in user, recorded) and sends the handler's result. */
function serve(req: Request, res: Response, next: NextFunction, route: string, handle: (source: RunSource) => Promise<HandlerResult>): void {
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
      res.status(result.status).json(result.body);
    })
    .catch((e: unknown) => {
      if (session) store?.add(session.finish({ status: 500, error: e }));
      next(e);
    });
}

const mode: DataMode = { source: provider.kind, auth: provider.auth, capture: !!store };

createApp({
  plugins: [server()],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.get('/api/mode', (_req, res) => {
        res.json(mode);
      });
      app.get('/api/runs', (req, res, next) => {
        serve(req, res, next, '/api/runs', (source) => listRuns(source, req.query));
      });
      app.get('/api/runs/:id', (req, res, next) => {
        serve(req, res, next, '/api/runs/:id', (source) => getRun(source, req.params.id, req.query));
      });
      app.get('/api/runs/:id/log', (req, res, next) => {
        serve(req, res, next, '/api/runs/:id/log', (source) => taskLog(source, req.params.id, req.query));
      });
      if (live && store) registerDiag(app, { provider: live, store, env: process.env });
      else registerNoDiag(app);
    });
  },
}).catch(console.error);
