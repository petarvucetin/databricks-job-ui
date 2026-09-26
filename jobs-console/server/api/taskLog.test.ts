import { describe, it, expect } from 'vitest';
import { taskLog } from './taskLog';
import { createMockRunSource } from '../data/mock/mockRunSource';

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
    expect((await taskLog(source, '1', {})).status).toBe(400);
    expect((await taskLog(source, '1', { task: '../etc' })).status).toBe(400);
    expect((await taskLog(source, '1', { task: 'x', hint: ['a'] })).status).toBe(400);
  });
});
