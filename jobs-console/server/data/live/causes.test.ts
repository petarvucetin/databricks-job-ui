import { describe, it, expect } from 'vitest';
import { failureCause, humanise, oneLine } from './causes';

describe('failureCause', () => {
  it('uses the mock vocabulary for known codes and messages', () => {
    expect(failureCause('CLOUD_FAILURE', 'Spot instances reclaimed').label).toBe('Cluster error');
    expect(failureCause('DRIVER_ERROR', 'driver died').label).toBe('Cluster error');
    expect(failureCause('RUN_EXECUTION_ERROR', '[TABLE_OR_VIEW_NOT_FOUND] The table or view `a`.`b` cannot be found.').label).toBe('Table not found');
    expect(failureCause('RUN_EXECUTION_ERROR', '[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table x').label).toBe('Permission denied');
    expect(failureCause('UNAUTHORIZED_ERROR', 'nope').label).toBe('Permission denied');
    expect(failureCause('RUN_EXECUTION_ERROR', 'Run timed out after 3600s').label).toBe('Timed out');
    expect(failureCause('RUN_EXECUTION_ERROR', 'whatever', true).label).toBe('Timed out');
  });

  it('humanises unknown codes and keeps code and a one-line detail', () => {
    const c = failureCause('LIBRARY_INSTALLATION_ERROR', 'pip failed\n  at line 3\n');
    expect(c).toEqual({ label: 'Library installation error', code: 'LIBRARY_INSTALLATION_ERROR', detail: 'pip failed at line 3' });
    expect(failureCause(undefined, undefined)).toEqual({ label: 'Failed', code: '', detail: '' });
  });

  it('trims long messages to about 200 characters', () => {
    const d = failureCause('X', 'a'.repeat(500)).detail;
    expect(d.length).toBe(200);
    expect(d.endsWith('…')).toBe(true);
  });
});

describe('helpers', () => {
  it('humanise and oneLine', () => {
    expect(humanise('RUN_EXECUTION_ERROR')).toBe('Run execution error');
    expect(oneLine('  a \r\n b  ')).toBe('a b');
  });

  it('drops ANSI colour codes from Databricks error text', () => {
    expect(failureCause('RUN_EXECUTION_ERROR', '\x1b[31mPy4JJavaError\x1b[39m: An error occurred\r').detail).toBe('Py4JJavaError: An error occurred');
  });
});
