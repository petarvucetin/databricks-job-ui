import type { Application, NextFunction, Request, Response } from 'express';
import type { RunSource } from './data/runSource';
import type { EnvRouter } from './envRouter';
import { Session } from './data/capture/recorder';
import { apiErrorParts, isSignInOrConnectionFailure } from './data/live/apiError';
import { SourceError } from './data/sourceError';
import { listRuns, type HandlerResult } from './api/listRuns';
import { taskLog } from './api/taskLog';
import { getRun } from './api/getRun';
import { listItems } from './api/listItems';
import { getItem } from './api/getItem';
import { newSessionId, registerDiag, registerNoDiag } from './api/diag';
import { sendJson } from './api/gzip';

const header = (req: Request, name: string): string | undefined => {
  const v = req.headers[name];
  return (Array.isArray(v) ? v[0] : v) || undefined;
};

/** E10: a sign-in or connection failure's message with the command that fixes it; anything else unchanged. */
export function withLoginHint(message: string, status: number | undefined, profile: string): string {
  return isSignInOrConnectionFailure(status, message) ? `${message} — run: databricks auth login --profile ${profile}` : message;
}

/** Diagnostics exist when the server reads live: always with several envs (each refuses unless live), else when the one env is live. */
export function hasDiagnostics(router: EnvRouter): boolean {
  return router.names.length > 0 || router.built().some((e) => !!e.live);
}

/**
 * The console's routes over `router`: every data request reads the env its `?env=` picks (a 400 before any provider
 * call when that fails), /api/mode describes it, and diagnostics act on it.
 */
export function registerRoutes(app: Application, router: EnvRouter): void {
  const multi = router.names.length > 0;

  /**
   * Resolves the request's env and RunSource (live: as the signed-in user, recorded) and sends the handler's result;
   * `gzipped`: compressed when the browser accepts it (the runs and items lists, megabytes at 10k items and 90 days of
   * history). With several envs, a sign-in or connection failure names its fix (E10).
   */
  function serve(req: Request, res: Response, next: NextFunction, route: string, handle: (source: RunSource) => Promise<HandlerResult>, gzipped = false): void {
    const ws = router.pick(req);
    if ('error' in ws) {
      res.status(ws.status).json({ error: ws.error });
      return;
    }
    const { live, store, profile } = ws;
    const hinted = (message: string, status: number | undefined) => (multi && profile ? withLoginHint(message, status, profile) : message);
    const session = live && store ? new Session({ id: newSessionId(), route, query: { ...req.query, ...req.params }, authMode: live.auth, user: header(req, 'x-forwarded-email') }) : undefined;

    /** A thrown failure: with several envs, a sign-in or connection failure is answered with its fix; anything else is a bug. */
    const failed = (e: unknown) => {
      const { status, message } = e instanceof SourceError ? { status: e.status, message: e.message } : apiErrorParts(e);
      const signIn = multi && !!profile && isSignInOrConnectionFailure(status, message);
      const answer = signIn ? (status === 401 || status === 403 ? status : 502) : 500;
      if (session) store?.add(session.finish({ status: answer, error: e }));
      if (signIn) res.status(answer).json({ error: hinted(message, status) });
      else next(e);
    };

    let source: ReturnType<typeof ws.provider.forRequest>;
    try {
      source = ws.provider.forRequest(req, session);
    } catch (e) {
      failed(e);
      return;
    }
    if ('error' in source) {
      if (session) store?.add(session.finish({ status: source.status, error: source.status >= 500 ? source.error : undefined }));
      res.status(source.status).json({ error: hinted(source.error, source.status) });
      return;
    }
    handle(source)
      .then((result) => {
        const err = (result.body as { error?: unknown } | undefined)?.error;
        if (session) {
          const error = result.status >= 500 ? (typeof err === 'string' ? err : undefined) ?? `HTTP ${result.status}` : undefined;
          store?.add(session.finish({ status: result.status, body: result.body, error }));
        }
        const body = multi && result.status >= 400 && typeof err === 'string' ? { ...(result.body as object), error: hinted(err, result.status) } : result.body;
        if (gzipped) sendJson(req, res, result.status, body);
        else res.status(result.status).json(body);
      })
      .catch(failed);
  }

  app.get('/api/mode', (req, res, next) => {
    const { env, envs } = router.modeFor(req);
    env
      .mode(header(req, 'x-forwarded-email'), req)
      .then((mode) => res.json({ ...mode, ...(envs ? { envs } : {}) }))
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

  if (hasDiagnostics(router)) {
    registerDiag(app, {
      pick: (req) => {
        const ws = router.pick(req);
        if ('error' in ws) return ws;
        if (!ws.live || !ws.store) return { status: 404, error: 'Capture is available in live mode only' };
        return { provider: ws.live, store: ws.store, env: ws.env, name: ws.name, profile: ws.profile };
      },
    });
  } else registerNoDiag(app);
}
