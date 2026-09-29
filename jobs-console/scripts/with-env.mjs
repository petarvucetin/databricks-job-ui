// Cross-shell `NAME=value command ...` for npm scripts: works the same in cmd, PowerShell and bash,
// so no script-shell setting is needed on Windows. Usage: node scripts/with-env.mjs NODE_ENV=development tsx watch ...
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const env = { ...process.env };
while (args.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(args[0])) {
  const [name, ...rest] = args.shift().split('=');
  env[name] = rest.join('=');
}
if (!args.length) {
  console.error('usage: node scripts/with-env.mjs NAME=value [...] command [args...]');
  process.exit(2);
}
// shell: true so npm-installed binaries (tsx.cmd on Windows) resolve from node_modules/.bin, which npm puts on PATH.
const child = spawn(args.join(' '), { stdio: 'inherit', env, shell: true });
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
