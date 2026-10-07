import { describe, it, expect, vi } from 'vitest';
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
  it('a pipeline id that is not letters, digits and hyphens is a 400 (it never reaches the SDK path)', async () => {
    const getItemSpy = vi.fn((type: 'job' | 'pipeline', id: string) => source.getItem(type, id));
    const spied = { ...source, getItem: getItemSpy };
    for (const id of ['../x', 'a/b', 'a%2Fb', '..', '..%2F..%2Fclusters%2Flist', 'a b', 'x'.repeat(65)]) {
      expect((await getItem(spied, 'pipeline', id)).status, id).toBe(400);
    }
    expect(getItemSpy).not.toHaveBeenCalled();
    const list = (await listItems(source, {})).body as { items: { type: 'job' | 'pipeline'; id: string }[] };
    const pipe = list.items.find((it) => it.type === 'pipeline')!;
    expect((await getItem(spied, 'pipeline', pipe.id)).status).toBe(200);
    expect((await getItem(spied, 'pipeline', '0a1b2c3d-4e5f-6789-abcd-ef0123456789')).status).toBe(404);
  });
});
