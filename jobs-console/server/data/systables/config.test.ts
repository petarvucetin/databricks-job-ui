import { describe, it, expect } from 'vitest';
import { readHistoryConfig } from './config';

describe('readHistoryConfig', () => {
  it('is off without a warehouse id', () => {
    expect(readHistoryConfig({})).toEqual({ warehouseId: undefined, workspaceId: undefined, off: false, enabled: false });
    expect(readHistoryConfig({ DATABRICKS_WAREHOUSE_ID: '' }).enabled).toBe(false);
  });

  it('is on with a warehouse id, and carries the workspace id', () => {
    expect(readHistoryConfig({ DATABRICKS_WAREHOUSE_ID: 'wh1', DATABRICKS_WORKSPACE_ID: '123' })).toEqual({ warehouseId: 'wh1', workspaceId: '123', off: false, enabled: true });
  });

  it('JOBS_CONSOLE_HISTORY=off forces it off', () => {
    expect(readHistoryConfig({ DATABRICKS_WAREHOUSE_ID: 'wh1', JOBS_CONSOLE_HISTORY: 'off' })).toMatchObject({ off: true, enabled: false });
    expect(readHistoryConfig({ DATABRICKS_WAREHOUSE_ID: 'wh1', JOBS_CONSOLE_HISTORY: 'on' }).enabled).toBe(true);
  });
});
