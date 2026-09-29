import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { appVersion } from './client/appVersion';

export default defineConfig({
  plugins: [appVersion(__dirname)],
  test: {
    passWithNoTests: true,
    globals: true,
    environment: 'node',
    env: { TZ: 'UTC' },
    exclude: ['**/node_modules/**', '**/dist/**', '**/.databricks/**', 'deploy/**'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './client/src'),
    },
  },
});
