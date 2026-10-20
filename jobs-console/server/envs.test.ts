import { describe, expect, it, vi } from 'vitest';
import { dropAmbientCredentials, envRecord, parseEnvs, readEnvLabel } from './envs';

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

describe('dropAmbientCredentials (multi-env)', () => {
  const ambient = () => ({
    DATABRICKS_HOST: 'h',
    DATABRICKS_TOKEN: 't',
    DATABRICKS_CONFIG_PROFILE: 'x',
    DATABRICKS_WAREHOUSE_ID: 'w0',
    JOBS_CONSOLE_DATA: 'live',
  });

  it('removes host, token and warehouse when JOBS_CONSOLE_ENVS is set, and names them', () => {
    const env: Record<string, string | undefined> = { ...ambient(), JOBS_CONSOLE_ENVS: 'dev,prod' };
    expect(dropAmbientCredentials(env)).toEqual(['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'DATABRICKS_WAREHOUSE_ID']);
    expect(env).toEqual({ DATABRICKS_CONFIG_PROFILE: 'x', JOBS_CONSOLE_DATA: 'live', JOBS_CONSOLE_ENVS: 'dev,prod' });
  });

  it('keeps the profile (AppKit signs in with it; it never overrides an explicit one)', () => {
    const env: Record<string, string | undefined> = { DATABRICKS_CONFIG_PROFILE: 'x', JOBS_CONSOLE_ENVS: 'dev' };
    expect(dropAmbientCredentials(env)).toEqual([]);
    expect(env.DATABRICKS_CONFIG_PROFILE).toBe('x');
  });

  it('names only what was set', () => {
    const env: Record<string, string | undefined> = { DATABRICKS_HOST: 'h', JOBS_CONSOLE_ENVS: 'dev' };
    expect(dropAmbientCredentials(env)).toEqual(['DATABRICKS_HOST']);
    expect(dropAmbientCredentials({ JOBS_CONSOLE_ENVS: 'dev' })).toEqual([]);
  });

  it('leaves a single-workspace env alone', () => {
    const env: Record<string, string | undefined> = ambient();
    expect(dropAmbientCredentials(env)).toEqual([]);
    expect(env).toEqual(ambient());
  });
});
