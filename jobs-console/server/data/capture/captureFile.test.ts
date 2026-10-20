import { describe, expect, it } from 'vitest';
import { buildCapture, captureFileName } from './captureFile';

const base = { authMode: 'user', sessions: [], clientErrors: [], process: [], app: { version: '1', node: 'v24' } };

describe('capture workspace (E15)', () => {
  it('records the env and CLI profile beside host and user', () => {
    const file = buildCapture({ ...base, env: {}, host: 'https://dbc-1.cloud.databricks.us', user: 'me@x.com', envName: 'prod', profile: 'gov-prod' });
    expect(file.workspace).toEqual({ host: 'https://dbc-1.cloud.databricks.us', user: 'me@x.com', env: 'prod', profile: 'gov-prod' });
  });

  it('has only host and user without an env', () => {
    const file = buildCapture({ ...base, env: { DATABRICKS_HOST: 'https://h' }, user: 'me@x.com' });
    expect(Object.keys(file.workspace)).toEqual(['host', 'user']);
  });
});

describe('captureFileName', () => {
  const at = new Date('2026-10-20T12:34:00Z');

  it('puts the env before the host', () => {
    expect(captureFileName('https://dbc-1.cloud.databricks.us', at, 'prod')).toBe('jobs-console-capture-prod-dbc-1.cloud.databricks.us-20261020-1234.json.gz');
  });

  it('is unchanged without an env', () => {
    expect(captureFileName('https://dbc-1.cloud.databricks.us', at)).toBe('jobs-console-capture-dbc-1.cloud.databricks.us-20261020-1234.json.gz');
    expect(captureFileName(undefined, at)).toBe('jobs-console-capture-local-20261020-1234.json.gz');
  });
});
