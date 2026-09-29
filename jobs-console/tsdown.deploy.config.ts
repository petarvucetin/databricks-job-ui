import { resolve } from 'node:path';
import { defineConfig } from 'tsdown';

// Self-contained server for Databricks Apps: every dependency is bundled in, so the deployed
// folder has no package.json and the platform runs no `npm install` (GovCloud apps can't reach the npm registry).
export default defineConfig({
  entry: { server: 'server/server.ts' },
  outDir: 'deploy',
  clean: false,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  tsconfig: 'tsconfig.server.json',
  noExternal: [/.*/],
  // Dev-only, never loaded in production: Vite (AppKit's local hot reload, imported lazily).
  external: ['vite', /^@vitejs\//, /^@tailwindcss\//, 'lightningcss', 'rolldown'],
  // ast-grep is a per-OS native module that AppKit imports eagerly but calls only from dev tooling.
  alias: { '@ast-grep/napi': resolve(import.meta.dirname, 'server/deploy-shims/ast-grep-napi.ts') },
  dts: false,
  sourcemap: false,
  outExtensions: () => ({ js: '.mjs' }),
});
