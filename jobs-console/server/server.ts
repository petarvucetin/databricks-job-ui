import { createApp, server } from '@databricks/appkit';
import type { NextFunction, Request, Response } from 'express';
import { selectRunSource, type RunSource } from './data/runSource';
import { listRuns, type HandlerResult } from './api/listRuns';
import { taskLog } from './api/taskLog';

const provider = selectRunSource(process.env);

/** Resolves the request's RunSource (live: as the signed-in user) and sends the handler's result. */
function serve(req: Request, res: Response, next: NextFunction, handle: (source: RunSource) => Promise<HandlerResult>): void {
  const source = provider.forRequest(req);
  if ('error' in source) {
    res.status(source.status).json({ error: source.error });
    return;
  }
  handle(source)
    .then((result) => {
      res.status(result.status).json(result.body);
    })
    .catch(next);
}

createApp({
  plugins: [server()],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.get('/api/runs', (req, res, next) => {
        serve(req, res, next, (source) => listRuns(source, req.query));
      });
      app.get('/api/runs/:id/log', (req, res, next) => {
        serve(req, res, next, (source) => taskLog(source, req.params.id, req.query));
      });
    });
  },
}).catch(console.error);
