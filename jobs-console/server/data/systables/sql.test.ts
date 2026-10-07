import { afterEach, describe, it, expect, vi } from 'vitest';
import type { sql } from '@databricks/sdk-experimental';
import { Deadline, TIMEOUT } from '../live/collect';
import { fakeApi } from '../live/fakeApi';
import { runSql } from './sql';

const manifest = { schema: { columns: [{ name: 'a' }, { name: 'b' }] } };
const ok = (rows: (string | null)[][], extra: Partial<sql.ResultData> = {}): sql.StatementResponse => ({
  statement_id: 's1',
  status: { state: 'SUCCEEDED' },
  manifest,
  result: { data_array: rows as string[][], ...extra },
});
const later = () => new Deadline(Date.now() + 60_000);

afterEach(() => {
  vi.useRealTimers();
});

describe('runSql', () => {
  it('sends the statement with named parameters and zips an inline result with the column names', async () => {
    const api = fakeApi({ statements: { responses: [ok([['1', 'x'], ['2', null]])] } });
    const spy = vi.spyOn(api, 'executeStatement');
    const rows = await runSql(api, 'wh1', 'SELECT :p', { p: 'v', q: 'w' }, later());
    expect(rows).toEqual([{ a: '1', b: 'x' }, { a: '2', b: null }]);
    expect(spy).toHaveBeenCalledWith({
      warehouse_id: 'wh1',
      statement: 'SELECT :p',
      parameters: [{ name: 'p', value: 'v' }, { name: 'q', value: 'w' }],
      wait_timeout: '30s',
      on_wait_timeout: 'CONTINUE',
      disposition: 'INLINE',
      format: 'JSON_ARRAY',
    });
    expect(api.calls).toEqual(['executeStatement']);
  });

  it('polls getStatement every second while PENDING or RUNNING, then reads the result', async () => {
    vi.useFakeTimers();
    const api = fakeApi({
      statements: { responses: [{ statement_id: 's1', status: { state: 'PENDING' } }, { statement_id: 's1', status: { state: 'RUNNING' } }, ok([['1', '2']])] },
    });
    const p = runSql(api, 'wh1', 'SELECT 1', {}, later());
    await vi.advanceTimersByTimeAsync(999);
    expect(api.calls).toEqual(['executeStatement']);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.calls).toEqual(['executeStatement', 'getStatement']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toEqual([{ a: '1', b: '2' }]);
    expect(api.calls).toEqual(['executeStatement', 'getStatement', 'getStatement']);
  });

  it('follows next_chunk_index through every chunk', async () => {
    const api = fakeApi({
      statements: {
        responses: [ok([['1', 'a']], { next_chunk_index: 1 })],
        chunks: { 1: { data_array: [['2', 'b']], next_chunk_index: 2 }, 2: { data_array: [['3', 'c']] } },
      },
    });
    const rows = await runSql(api, 'wh1', 'SELECT 1', {}, later());
    expect(rows).toEqual([{ a: '1', b: 'a' }, { a: '2', b: 'b' }, { a: '3', b: 'c' }]);
    expect(api.calls).toEqual(['executeStatement', 'getStatementChunk', 'getStatementChunk']);
  });

  it('answers no rows for a SUCCEEDED statement without a result', async () => {
    const api = fakeApi({ statements: { responses: [{ statement_id: 's1', status: { state: 'SUCCEEDED' }, manifest }] } });
    expect(await runSql(api, 'wh1', 'SELECT 1', {}, later())).toEqual([]);
  });

  it('throws on FAILED with the error message and code', async () => {
    const api = fakeApi({
      statements: { responses: [{ statement_id: 's1', status: { state: 'FAILED', error: { error_code: 'BAD_REQUEST', message: '[INSUFFICIENT_PERMISSIONS] no SELECT on system.lakeflow' } } }] },
    });
    const err = await runSql(api, 'wh1', 'SELECT 1', {}, later()).then(
      () => undefined,
      (e: unknown) => e as Error & { code?: string }
    );
    expect(err?.message).toBe('[INSUFFICIENT_PERMISSIONS] no SELECT on system.lakeflow');
    expect(err?.code).toBe('BAD_REQUEST');
  });

  it('throws on CANCELED found while polling', async () => {
    vi.useFakeTimers();
    const api = fakeApi({
      statements: { responses: [{ statement_id: 's1', status: { state: 'RUNNING' } }, { statement_id: 's1', status: { state: 'CANCELED', error: { error_code: 'CANCELLED', message: 'cancelled' } } }] },
    });
    const p = runSql(api, 'wh1', 'SELECT 1', {}, later()).catch((e: Error & { code?: string }) => e);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await p).toMatchObject({ message: 'cancelled', code: 'CANCELLED' });
  });

  it('lets an HTTP error from executeStatement through unchanged', async () => {
    const boom = Object.assign(new Error('no warehouse'), { statusCode: 404, errorCode: 'RESOURCE_DOES_NOT_EXIST' });
    const api = fakeApi({ sql: () => boom });
    await expect(runSql(api, 'wh1', 'SELECT 1', {}, later())).rejects.toBe(boom);
  });

  it('answers TIMEOUT when the deadline passes while the statement is still running', async () => {
    vi.useFakeTimers();
    const api = fakeApi({ statements: { responses: [{ statement_id: 's1', status: { state: 'PENDING' } }] } });
    const p = runSql(api, 'wh1', 'SELECT 1', {}, new Deadline(Date.now() + 2_500));
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await p).toBe(TIMEOUT);
    // The statement is cancelled on the warehouse, best effort (finding 9).
    expect(api.calls).toEqual(['executeStatement', 'getStatement', 'getStatement', 'cancelStatement']);
    expect(api.cancelled).toEqual(['s1']);
  });

  it('cancels a statement whose execute call the deadline cut off, once its id is known', async () => {
    const api = fakeApi({ statements: { responses: [{ statement_id: 's9', status: { state: 'RUNNING' } }] }, delay: 50 });
    expect(await runSql(api, 'wh1', 'SELECT 1', {}, new Deadline(Date.now() + 10))).toBe(TIMEOUT);
    expect(api.cancelled).toEqual([]);
    await vi.waitFor(() => expect(api.cancelled).toEqual(['s9']));
  });

  it('a failing cancel is swallowed; a finished statement is not cancelled', async () => {
    vi.useFakeTimers();
    const api = fakeApi({ statements: { responses: [{ statement_id: 's1', status: { state: 'PENDING' } }] }, fail: { cancelStatement: new Error('gone') } });
    const p = runSql(api, 'wh1', 'SELECT 1', {}, new Deadline(Date.now() + 1_500));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await p).toBe(TIMEOUT);
    expect(api.calls).toContain('cancelStatement');
    const done = fakeApi({ statements: { responses: [ok([])] } });
    await runSql(done, 'wh1', 'SELECT 1', {}, later());
    expect(done.calls).not.toContain('cancelStatement');
  });

  it('answers TIMEOUT at once when the deadline has already passed', async () => {
    const api = fakeApi({ statements: { responses: [ok([])] } });
    expect(await runSql(api, 'wh1', 'SELECT 1', {}, new Deadline(Date.now() - 1))).toBe(TIMEOUT);
  });
});
