import { describe, it, expect } from 'vitest';
import { finalize, type Draft } from './kinds';

const base = (over: Partial<Draft>): Draft => ({
  id: 1, runId: '1', type: 'job', name: 'job', startTime: 0, durationSec: 100, ntasks: 1, failed: [], runAs: 'a@x.com',
  live: false, continuous: false, result: 'succeeded', params: {}, key: 'j:1', queued: false, retryAttempt: 0, cause: null, ...over,
});

describe('finalize (kind rules)', () => {
  it('usualSec is the mean of successful finished runs of the same key, else the run itself', () => {
    const runs = finalize([
      base({ id: 1, durationSec: 100 }),
      base({ id: 2, durationSec: 300 }),
      base({ id: 3, durationSec: 999, result: 'failed' }),
      base({ id: 4, key: 'j:2', durationSec: 50, result: 'failed' }),
    ], 'me');
    expect(runs.map((r) => r.usualSec)).toEqual([200, 200, 200, 50]);
  });

  it('applies the rules in order', () => {
    const [queued, retrying, liveSlow, running, failed, partial, slow, ok, cancelled] = finalize([
      base({ id: 1, queued: true, result: null, durationSec: 0, cause: { label: 'Queued', code: 'MAX_CONCURRENT_RUNS_REACHED', detail: 'x' } }),
      base({ id: 2, live: true, result: null, retryAttempt: 2, durationSec: 10 }),
      base({ id: 3, live: true, result: null, durationSec: 130 }),
      base({ id: 4, live: true, result: null, durationSec: 110 }),
      base({ id: 5, result: 'failed', cause: { label: 'Cluster error', code: 'CLOUD_FAILURE', detail: '' } }),
      base({ id: 6, result: 'partial' }),
      base({ id: 7, durationSec: 160 }),
      base({ id: 8, durationSec: 40 }),
      base({ id: 9, result: 'cancelled', durationSec: 900 }),
    ], 'me');
    // usual = mean(160, 40) = 100
    expect(queued.kind).toBe('queued');
    expect(queued.cause.code).toBe('MAX_CONCURRENT_RUNS_REACHED');
    expect(retrying).toMatchObject({ kind: 'retrying', cause: { label: 'Retrying', detail: 'attempt 3' } });
    expect(liveSlow.kind).toBe('slow');
    expect(running).toMatchObject({ kind: 'running', cause: { label: 'Running' } });
    expect(failed).toMatchObject({ kind: 'failed', cause: { label: 'Cluster error' } });
    expect(partial).toMatchObject({ kind: 'failed', cause: { label: 'Failed' } });
    expect(slow).toMatchObject({ kind: 'slow', cause: { label: 'Slow', code: '', detail: '' } });
    expect(ok).toMatchObject({ kind: 'succeeded', cause: { label: 'Succeeded' } });
    expect(cancelled).toMatchObject({ kind: 'succeeded', result: 'cancelled' });
  });

  it('queued falls back to the mock queued cause; mine compares runAs case-insensitively', () => {
    const [r] = finalize([base({ queued: true, result: null, runAs: 'Me@X.com' })], 'me@x.com');
    expect(r.cause).toEqual({ label: 'Queued', code: '', detail: '' });
    expect(r.mine).toBe(true);
    expect(finalize([base({})], undefined)[0].mine).toBe(false);
  });

  it('drops the internal fields', () => {
    const [r] = finalize([base({})], 'me');
    expect(Object.keys(r).sort()).toEqual(
      ['id', 'runId', 'type', 'name', 'kind', 'cause', 'startTime', 'durationSec', 'usualSec', 'ntasks', 'failed', 'runAs', 'mine', 'live', 'continuous', 'result', 'params'].sort()
    );
  });
});
