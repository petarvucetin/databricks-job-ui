import { describe, it, expect } from 'vitest';
import type { CaptureFile } from './captureFile';
import { summarize } from './summary';

const T = Date.UTC(2027, 0, 15, 8, 0, 0);

const fixture: CaptureFile = {
  format: 'jobs-console-capture',
  version: 1,
  createdAt: '2027-01-15T08:30:00.000Z',
  app: { version: '1.0.0', gitSha: 'abc1234', node: 'v24.1.0' },
  config: { DATABRICKS_HOST: 'https://dbc-1.cloud.databricks.us', JOBS_CONSOLE_DATA: 'live', JOBS_CONSOLE_MAX_RUNS: '5000', authMode: 'user' },
  workspace: { host: 'https://dbc-1.cloud.databricks.us', user: 'ann@agency.gov' },
  sessions: [
    {
      id: 'a1', route: '/api/runs', query: {}, authMode: 'user', user: 'ann@agency.gov', startedAt: T, ms: 8421, now: T,
      calls: [
        { seq: 1, method: 'listJobRuns', args: {}, startedAt: T, ms: 900, ok: true, result: {} },
        { seq: 2, method: 'getPipeline', args: { pipeline_id: 'p9' }, startedAt: T, ms: 80, ok: false, error: { name: 'ApiError', statusCode: 403, errorCode: 'PERMISSION_DENIED', message: 'User cannot view pipeline p9' } },
      ],
      diagnostics: [
        { level: 'warn', code: 'unknown-termination-code', message: 'termination code DRIVER_UNREACHABLE is not known', ref: 'run 17' },
        { level: 'warn', code: 'unknown-termination-code', message: 'termination code DRIVER_UNREACHABLE is not known', ref: 'run 18' },
        { level: 'warn', code: 'pipeline-skipped', message: 'skipped (403): User cannot view pipeline p9', ref: 'pipeline p9' },
        { level: 'info', code: 'pages', message: 'listJobRuns 1, getPipeline 1' },
      ],
      responseSummary: { status: 200, runCount: 3, byKind: { failed: 1, succeeded: 2 }, byType: { job: 3 } },
    },
    {
      id: 'b2', route: '/api/runs/:id/log', query: { task: 'load' }, authMode: 'user', startedAt: T + 60000, ms: 12, calls: [], diagnostics: [],
      responseSummary: { status: 500 }, error: { message: 'Cannot read properties of undefined (reading tasks)' },
    },
  ],
  clientErrors: [{ message: 'TypeError: x is undefined', stack: 'at RunRow', url: 'https://app/runs', userAgent: 'Edge', at: '2027-01-15T08:05:00.000Z' }],
  process: [{ kind: 'unhandledRejection', message: 'socket hang up', at: T }],
};

describe('capture summary', () => {
  it('prints sessions, top diagnostics, errors and client errors', () => {
    expect(summarize(fixture)).toMatchInlineSnapshot(`
      "jobs-console-capture v1, created 2027-01-15T08:30:00.000Z
      app 1.0.0 (abc1234), node v24.1.0; host https://dbc-1.cloud.databricks.us; user ann@agency.gov; auth user
      config: JOBS_CONSOLE_DATA=live JOBS_CONSOLE_MAX_RUNS=5000

      Sessions (2, oldest first)
        id  route              started (UTC)        ms    status  calls  runs  by kind                by type
        a1  /api/runs          2027-01-15 08:00:00  8421  200     2      3     succeeded 2, failed 1  job 3
        b2  /api/runs/:id/log  2027-01-15 08:01:00  12    500     0      -     -                      -

      Diagnostics by code (3 codes)
        2  warn  unknown-termination-code  run 17: termination code DRIVER_UNREACHABLE is not known
        1  info  pages                     listJobRuns 1, getPipeline 1
        1  warn  pipeline-skipped          pipeline p9: skipped (403): User cannot view pipeline p9

      Errors (3)
        1  api getPipeline 403 PERMISSION_DENIED  User cannot view pipeline p9
        1  process unhandledRejection             socket hang up
        1  session /api/runs/:id/log 500          Cannot read properties of undefined (reading tasks)

      Client errors (1)
        2027-01-15T08:05:00.000Z  TypeError: x is undefined  https://app/runs
      "
    `);
  });

  it('prints an empty capture', () => {
    const empty = { ...fixture, sessions: [], clientErrors: [], process: [] };
    expect(summarize(empty)).toContain('Sessions (0, oldest first)');
    expect(summarize(empty)).toContain('Errors (0)');
  });
});
