import { describe, it, expect } from 'vitest';
import { fakeApi } from './fakeApi';

describe('fakeApi statement execution', () => {
  it('answers executeStatement inline from data.sql, with the statement and parameters', async () => {
    const seen: [string, Record<string, string>][] = [];
    const api = fakeApi({
      sql: (statement, params) => {
        seen.push([statement, params]);
        return [['1', 'a'], ['2', 'b']];
      },
    });
    const r = await api.executeStatement({ statement: 'SELECT 1 WHERE x = :x', warehouse_id: 'w', parameters: [{ name: 'x', value: '7' }] });
    expect(r.status?.state).toBe('SUCCEEDED');
    expect(r.result?.data_array).toEqual([['1', 'a'], ['2', 'b']]);
    expect(seen).toEqual([['SELECT 1 WHERE x = :x', { x: '7' }]]);
    expect(api.calls).toEqual(['executeStatement']);
  });

  it('throws when data.sql returns an Error, and answers the workspace id (recorded as a call)', async () => {
    const api = fakeApi({ sql: () => new Error('PERMISSION_DENIED'), workspaceId: '42' });
    await expect(api.executeStatement({ statement: 'x', warehouse_id: 'w' })).rejects.toThrow('PERMISSION_DENIED');
    expect(await api.workspaceId()).toBe('42');
    expect(await fakeApi({}).workspaceId()).toBe('');
    expect(api.calls).toEqual(['executeStatement', 'workspaceId']);
  });
});
