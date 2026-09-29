import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';

export interface AppVersion {
  /** "1.0.<commits>": major.minor from package.json, patch = number of commits, so every commit bumps it. */
  version: string;
  /** Short hash of the commit it was built from. */
  commit: string;
  /** That commit's date, ISO. */
  date: string;
}

const ID = 'virtual:app-version';
const RESOLVED = '\0' + ID;

const git = (args: string, cwd: string) => execSync(`git ${args}`, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();

export function readVersion(root: string): AppVersion {
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')) as { version: string };
  const [major, minor] = pkg.version.split('.');
  try {
    return { version: `${major}.${minor}.${git('rev-list --count HEAD', root)}`, commit: git('rev-parse --short HEAD', root), date: git('log -1 --format=%cI', root) };
  } catch {
    return { version: pkg.version, commit: '', date: '' };
  }
}

/** `import appVersion from 'virtual:app-version'`. The dev server rechecks git every few seconds and reloads the page when a commit lands. */
export function appVersion(root: string): Plugin {
  let current = readVersion(root);
  return {
    name: 'app-version',
    resolveId: (id) => (id === ID ? RESOLVED : undefined),
    load: (id) => (id === RESOLVED ? `export default ${JSON.stringify(current)};` : undefined),
    configureServer(server) {
      const timer = setInterval(() => {
        const next = readVersion(root);
        if (next.commit === current.commit) return;
        current = next;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      }, 5000);
      timer.unref();
      server.httpServer?.on('close', () => clearInterval(timer));
    },
  };
}
