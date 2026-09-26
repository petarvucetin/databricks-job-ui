import { createApp, server } from '@databricks/appkit';
import { selectRunSource } from './data/runSource';
import { listRuns } from './api/listRuns';
import { taskLog } from './api/taskLog';

const source = selectRunSource(process.env);

createApp({
  plugins: [server()],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      app.get('/api/runs', (req, res, next) => {
        listRuns(source, req.query)
          .then((result) => {
            res.status(result.status).json(result.body);
          })
          .catch(next);
      });
      app.get('/api/runs/:id/log', (req, res, next) => {
        taskLog(source, req.params.id, req.query)
          .then((result) => {
            res.status(result.status).json(result.body);
          })
          .catch(next);
      });
    });
  },
}).catch(console.error);
