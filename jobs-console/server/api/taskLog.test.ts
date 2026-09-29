import { describe, it, expect } from 'vitest';
import { taskLog } from './taskLog';
import { createMockRunSource } from '../data/mock/mockRunSource';
import type { RunSource } from '../data/runSource';
import { SourceError } from '../data/sourceError';

const source = createMockRunSource();
const text = (body: unknown) => (body as { text: string }).text;

describe('GET /api/runs/:id/log handler', () => {
  it('returns a sample log, ending at the error when a failure cause is hinted', async () => {
    const plain = await taskLog(source, '12', { task: 'load_gl' });
    expect(plain.status).toBe(200);
    expect(text(plain.body).split('\n').length).toBeGreaterThan(100);
    const failed = text((await taskLog(source, '12', { task: 'load_gl', hint: 'Cluster error' })).body);
    expect(failed.split('\n').pop()).toMatch(/failed: load_gl \(cluster terminated\)$/);
    expect(failed).toContain('CLOUD_PROVIDER_SHUTDOWN');
  });

  it('never carries the sample host or credentials', async () => {
    for (const id of ['1', '2', '3']) {
      const t = text((await taskLog(source, id, { task: 'x' })).body);
      expect(t).not.toMatch(/saphbpdb|northgrum|SID_/i);
    }
  });

  it('rejects a bad run id, task or hint with 400', async () => {
    expect((await taskLog(source, 'abc', { task: 'x' })).status).toBe(400);
    expect((await taskLog(source, '99999999999999999', { task: 'x' })).status).toBe(400);
    expect((await taskLog(source, '1', {})).status).toBe(400);
    expect((await taskLog(source, '1', { task: '../etc' })).status).toBe(400);
    expect((await taskLog(source, '1', { task: 'a\nb' })).status).toBe(400);
    expect((await taskLog(source, '1', { task: 'x', hint: ['a'] })).status).toBe(400);
  });

  it('accepts a 53-bit pipeline update id and a pipeline or flow name as the task', async () => {
    let seen: [number, string] | undefined;
    const spy: RunSource = { kind: 'live', listRuns: () => Promise.reject(new Error('unused')), getRun: () => Promise.reject(new Error('unused')), taskLog: (id, task) => ((seen = [id, task]), Promise.resolve('ok')) };
    const res = await taskLog(spy, '9007199254740991', { task: '[dev john smith] raw_bronze `sap`' });
    expect(res).toEqual({ status: 200, body: { text: 'ok' } });
    expect(seen).toEqual([9007199254740991, '[dev john smith] raw_bronze `sap`']);
  });

  it('passes 404 and 403 from the source on as { error }', async () => {
    for (const status of [404, 403]) {
      const failing: RunSource = { kind: 'live', listRuns: () => Promise.reject(new Error('unused')), getRun: () => Promise.reject(new Error('unused')), taskLog: () => Promise.reject(new SourceError(status, 'no such run')) };
      expect(await taskLog(failing, '5', { task: 'x' })).toEqual({ status, body: { error: 'no such run' } });
    }
  });
});
