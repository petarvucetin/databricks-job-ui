import { describe, it, expect } from 'vitest';
import { fakeApi, type FakeData } from '../live/fakeApi';
import { readHistoryConfig, type HistoryConfig } from './config';
import { createHistoryProbe, PROBE_SQL } from './probe';

const ON: HistoryConfig = readHistoryConfig({ DATABRICKS_WAREHOUSE_ID: 'wh1' });
const fail = (state: 'FAILED' | 'CANCELED', error_code: string, message: string): FakeData['statements'] => ({
  responses: [{ statement_id: 's', status: { state, error: { error_code: error_code as never, message } } }],
});

function probe(data: FakeData, config: HistoryConfig = ON, extra: { clock?: () => number; timeoutMs?: number } = {}) {
  const api = fakeApi({ workspaceId: '42', sql: () => [{ ok: '1' }], ...data });
  return { api, p: createHistoryProbe({ api, config, clock: extra.clock ?? (() => 0), timeoutMs: extra.timeoutMs }) };
}

describe('createHistoryProbe', () => {
  it('is ok with the workspace id when the probe query answers, filtered to that workspace', async () => {
    const seen: [string, Record<string, string>][] = [];
    const { p } = probe({
      sql: (s, params) => {
        seen.push([s, params]);
        return [{ ok: '1' }];
      },
    });
    expect(await p.check('u1')).toEqual({ ok: true, workspaceId: '42' });
    expect(seen).toEqual([['SELECT 1 AS ok FROM system.lakeflow.job_run_timeline WHERE workspace_id = :ws LIMIT 1', { ws: '42' }]]);
    expect(PROBE_SQL).toBe('SELECT 1 AS ok FROM system.lakeflow.job_run_timeline WHERE workspace_id = :ws LIMIT 1');
  });

  it('is ok on an empty answer too (no runs in this workspace yet)', async () => {
    expect(await probe({ sql: () => [] }).p.check('u1')).toEqual({ ok: true, workspaceId: '42' });
  });

  it('prefers DATABRICKS_WORKSPACE_ID over the SCIM header', async () => {
    const { api, p } = probe({}, readHistoryConfig({ DATABRICKS_WAREHOUSE_ID: 'wh1', DATABRICKS_WORKSPACE_ID: '7' }));
    expect(await p.check('u1')).toEqual({ ok: true, workspaceId: '7' });
    expect(api.calls).toEqual(['executeStatement']);
  });

  it('history off', async () => {
    const { api, p } = probe({}, readHistoryConfig({ DATABRICKS_WAREHOUSE_ID: 'wh1', JOBS_CONSOLE_HISTORY: 'off' }));
    expect(await p.check('u1')).toEqual({ ok: false, reason: 'history off' });
    expect(await probe({}, readHistoryConfig({ JOBS_CONSOLE_HISTORY: 'off' })).p.check('u1')).toEqual({ ok: false, reason: 'history off' });
    expect(api.calls).toEqual([]);
  });

  it('no SQL warehouse configured', async () => {
    const { api, p } = probe({}, readHistoryConfig({}));
    expect(await p.check('u1')).toEqual({ ok: false, reason: 'no SQL warehouse configured' });
    expect(api.calls).toEqual([]);
  });

  it('no workspace id (empty header, or the SCIM call failing)', async () => {
    const empty = probe({ workspaceId: '' });
    expect(await empty.p.check('u1')).toEqual({ ok: false, reason: 'no workspace id' });
    expect(empty.api.calls).toEqual(['workspaceId']);
    expect(await probe({ fail: { workspaceId: new Error('403') } }).p.check('u1')).toEqual({ ok: false, reason: 'no workspace id' });
  });

  it('no access: the code named in the statement error message, else the error code', async () => {
    const r1 = await probe({ statements: fail('FAILED', 'BAD_REQUEST', '[INSUFFICIENT_PERMISSIONS] User does not have USE SCHEMA on Schema system.lakeflow') }).p.check('u1');
    expect(r1).toEqual({ ok: false, reason: 'no access to system.lakeflow (INSUFFICIENT_PERMISSIONS)' });
    const r2 = await probe({ statements: fail('FAILED', 'NOT_FOUND', '[TABLE_OR_VIEW_NOT_FOUND] The table or view `system`.`lakeflow`.`job_run_timeline` cannot be found.') }).p.check('u1');
    expect(r2).toEqual({ ok: false, reason: 'no access to system.lakeflow (TABLE_OR_VIEW_NOT_FOUND)' });
    const r3 = await probe({ statements: fail('FAILED', 'PERMISSION_DENIED', 'denied') }).p.check('u1');
    expect(r3).toEqual({ ok: false, reason: 'no access to system.lakeflow (PERMISSION_DENIED)' });
  });

  it('no access: an HTTP 403 / PERMISSION_DENIED thrown by the API', async () => {
    const denied = Object.assign(new Error('User is not authorized to use this warehouse'), { statusCode: 403, errorCode: 'PERMISSION_DENIED' });
    expect(await probe({ sql: () => denied }).p.check('u1')).toEqual({ ok: false, reason: 'no access to system.lakeflow (PERMISSION_DENIED)' });
  });

  it('warehouse error: <message> for anything else', async () => {
    const gone = Object.assign(new Error('Warehouse abc does not exist'), { statusCode: 404, errorCode: 'RESOURCE_DOES_NOT_EXIST' });
    expect(await probe({ sql: () => gone }).p.check('u1')).toEqual({ ok: false, reason: 'warehouse error: Warehouse abc does not exist' });
    const failed = await probe({ statements: fail('FAILED', 'INTERNAL_ERROR', 'something broke') }).p.check('u1');
    expect(failed).toEqual({ ok: false, reason: 'warehouse error: something broke' });
  });

  it('timed out', async () => {
    const { p } = probe({ delay: 200 }, ON, { timeoutMs: 20 });
    expect(await p.check('u1')).toEqual({ ok: false, reason: 'timed out' });
  });

  it('caches each user for 10 minutes, then checks again', async () => {
    let now = 0;
    let n = 0;
    const { p } = probe(
      {
        sql: () => {
          n++;
          return n === 1 ? new Error('x') : [{ ok: '1' }];
        },
      },
      ON,
      { clock: () => now }
    );
    const [a, b] = await Promise.all([p.check('u1'), p.check('u1')]);
    expect(a).toEqual({ ok: false, reason: 'warehouse error: x' });
    expect(b).toBe(a);
    now = 10 * 60_000 - 1;
    expect(await p.check('u1')).toEqual({ ok: false, reason: 'warehouse error: x' });
    expect(n).toBe(1);
    expect(await p.check('u2')).toEqual({ ok: true, workspaceId: '42' });
    expect(n).toBe(2);
    now = 10 * 60_000;
    expect(await p.check('u1')).toEqual({ ok: true, workspaceId: '42' });
    expect(n).toBe(3);
  });
});
