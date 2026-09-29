/**
 * npm run replay -- <capture.json.gz> [session id]: starts the dev server on a capture (JOBS_CONSOLE_DATA=replay).
 * Port: DATABRICKS_APP_PORT (default 8000, or the next free one).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';

const [file, session] = process.argv.slice(2);
if (!file || !existsSync(file)) {
  console.error(file ? `replay: no such file ${file}` : 'usage: npm run replay -- <jobs-console-capture-....json.gz> [session id]');
  process.exit(2);
}
const tsx = createRequire(import.meta.url).resolve('tsx/cli');
const child = spawn(process.execPath, [tsx, '--tsconfig', './tsconfig.server.json', '--env-file-if-exists=./.env', './server/server.ts'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    NODE_ENV: 'development',
    JOBS_CONSOLE_DATA: 'replay',
    JOBS_CONSOLE_REPLAY: path.resolve(file),
    ...(session ? { JOBS_CONSOLE_REPLAY_SESSION: session } : {}),
  },
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => child.kill(sig));
