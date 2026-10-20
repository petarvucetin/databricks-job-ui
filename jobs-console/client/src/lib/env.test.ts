import { describe, expect, it } from 'vitest';
import { apiUrl, currentEnv, envUrl, pageQuery } from './env';

describe('env helpers', () => {
  it('reads the env', () => {
    expect(currentEnv('?env=prod&tab=jobs')).toBe('prod');
    expect(currentEnv('?tab=jobs')).toBeUndefined();
  });
  it('apiUrl adds env with the right separator', () => {
    expect(apiUrl('/api/items', '?env=prod&tab=jobs')).toBe('/api/items?env=prod');
    expect(apiUrl('/api/runs?tzOffset=60&full=1', '?env=stg')).toBe('/api/runs?tzOffset=60&full=1&env=stg');
    expect(apiUrl('/api/items', '?tab=jobs')).toBe('/api/items');
  });
  it('pageQuery keeps env last', () => {
    expect(pageQuery({ tab: 'runs' }, '?env=prod&tab=jobs')).toBe('?tab=runs&env=prod');
    const q = pageQuery({ compare: '1,2' }, '?env=dev');
    expect(new URLSearchParams(q).get('env')).toBe('dev');
    expect(new URLSearchParams(q).get('compare')).toBe('1,2');
    expect(pageQuery({ tab: 'runs' }, '')).toBe('?tab=runs');
  });
  it('envUrl', () => {
    expect(envUrl('prod', 'jobs')).toBe('?env=prod&tab=jobs');
    expect(envUrl('stg')).toBe('?env=stg');
  });
});
