import { describe, expect, it, vi } from 'vitest';
import { envRecord, parseEnvs, readEnvLabel } from './envs';

describe('parseEnvs', () => {
  it('sorts into canonical order and defaults profile to the name', () => {
    expect(parseEnvs('prod,dev', undefined)).toEqual([
      { name: 'dev', profile: 'dev' },
      { name: 'prod', profile: 'prod' },
    ]);
  });

  it('reads profiles and warehouses, trimming whitespace', () => {
    expect(parseEnvs('dev=gov-dev, stg=gov-stg ,prod=gov-prod', 'dev=abc, prod=def')).toEqual([
      { name: 'dev', profile: 'gov-dev', warehouseId: 'abc' },
      { name: 'stg', profile: 'gov-stg' },
      { name: 'prod', profile: 'gov-prod', warehouseId: 'def' },
    ]);
  });

  it('returns [] when unset or blank', () => {
    expect(parseEnvs(undefined, undefined)).toEqual([]);
    expect(parseEnvs('  ', undefined)).toEqual([]);
  });

  it('rejects bad input with readable messages', () => {
    expect(() => parseEnvs('qa', undefined)).toThrow(/unknown env "qa".*dev, stg, prod/);
    expect(() => parseEnvs('dev,dev', undefined)).toThrow(/dev.*twice/);
    expect(() => parseEnvs('dev', 'stg=abc')).toThrow(/stg.*not in JOBS_CONSOLE_ENVS/);
    expect(() => parseEnvs('dev', 'abc')).toThrow(/name=id/);
  });
});

describe('envRecord', () => {
  const base = {
    DATABRICKS_HOST: 'h',
    DATABRICKS_TOKEN: 't',
    DATABRICKS_CONFIG_PROFILE: 'x',
    DATABRICKS_WAREHOUSE_ID: 'w0',
    DATABRICKS_WORKSPACE_ID: '9',
    JOBS_CONSOLE_DATA: 'live',
  };

  it('overrides profile and warehouse and drops host/token/workspace id', () => {
    const out = envRecord(base, { name: 'stg', profile: 'gov-stg', warehouseId: 'w1' });
    expect(out).toEqual({
      JOBS_CONSOLE_DATA: 'live',
      DATABRICKS_CONFIG_PROFILE: 'gov-stg',
      DATABRICKS_WAREHOUSE_ID: 'w1',
    });
    expect('DATABRICKS_HOST' in out).toBe(false);
    expect('DATABRICKS_TOKEN' in out).toBe(false);
    expect('DATABRICKS_WORKSPACE_ID' in out).toBe(false);
  });

  it('does not mutate its input', () => {
    const copy = { ...base };
    envRecord(base, { name: 'stg', profile: 'gov-stg', warehouseId: 'w1' });
    expect(base).toEqual(copy);
  });
});

describe('readEnvLabel', () => {
  it('reads a valid label', () => {
    expect(readEnvLabel({ JOBS_CONSOLE_ENV: 'prod' })).toBe('prod');
  });

  it('warns and returns undefined for an invalid label', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(readEnvLabel({ JOBS_CONSOLE_ENV: 'qa' })).toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('returns undefined when unset', () => {
    expect(readEnvLabel({})).toBeUndefined();
  });
});
