import { describe, it, expect } from 'vitest';
import { createMockRunSource } from '../data/mock/mockRunSource';
import { listItems } from './listItems';
import { getItem } from './getItem';

describe('items handlers (mock)', () => {
  const source = createMockRunSource();
  it('lists items', async () => {
    const r = await listItems(source, {});
    expect(r.status).toBe(200);
    expect((r.body as { items: unknown[] }).items.length).toBeGreaterThan(10);
  });
  it('gets one, 404 for unknown, 400 for a bad type', async () => {
    const list = (await listItems(source, {})).body as { items: { type: 'job' | 'pipeline'; id: string }[] };
    const first = list.items[0];
    const ok = await getItem(source, first.type, first.id);
    expect(ok.status).toBe(200);
    expect((await getItem(source, 'job', 'nope')).status).toBe(404);
    expect((await getItem(source, 'cluster', '1')).status).toBe(400);
  });
});
