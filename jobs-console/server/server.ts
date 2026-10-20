import { createApp, server } from '@databricks/appkit';
import type { ProcessRecord } from './data/capture/recorder';
import { dropAmbientCredentials } from './envs';
import { createEnvRouter } from './envRouter';
import { hasDiagnostics, registerRoutes } from './routes';

// Multi-env: each env reads its own CLI profile; the SDK reads a host or token in process.env before any profile, so those go.
const dropped = dropAmbientCredentials(process.env);
if (dropped.length) console.log(`JOBS_CONSOLE_ENVS is set: ignoring ${dropped.join(', ')}; each env reads its own CLI profile`);

const router = createEnvRouter(process.env);

if (hasDiagnostics(router)) {
  // Recorded, not fatal: the capture is the way to find out what went wrong, and it lives in this process.
  const record = (p: ProcessRecord) => {
    for (const env of router.built()) env.store?.addProcess(p);
  };
  process.on('unhandledRejection', (reason) => {
    const e = reason instanceof Error ? reason : new Error(String(reason));
    record({ kind: 'unhandledRejection', message: e.message, stack: e.stack });
    console.error('Unhandled rejection', reason);
  });
  process.on('uncaughtExceptionMonitor', (e) => {
    record({ kind: 'uncaughtException', message: e.message, stack: e.stack });
  });
}

createApp({
  plugins: [server()],
  onPluginsReady(appkit) {
    appkit.server.extend((app) => {
      registerRoutes(app, router);
    });
  },
}).catch(console.error);
