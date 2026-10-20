import { describe, expect, it } from 'vitest';
import { createMockRunSource } from './mockRunSource';

const clock = () => 1_800_000_000_000;

describe('createMockRunSource variants', () => {
  it('no variant: data is unchanged', async () => {
    const source = createMockRunSource(clock);
    const items = await source.listItems();
    expect(items.items).toHaveLength(1035);
    expect(items.items[0].name).toBe('[dev ana.souza] aiges_ingest_sap_backfill_sys_bic_ngc_dwh_edw_ca_cvg_ct_ecc_td_stas');
    expect((await source.listRuns(undefined, 0)).runs).toHaveLength(5650);
  });

  it('dev: prefixed names, fewer items than prod, runs only of kept items', async () => {
    const dev = createMockRunSource(clock, 'dev');
    const prod = createMockRunSource(clock, 'prod');
    const devItems = (await dev.listItems()).items;
    const prodItems = (await prod.listItems()).items;
    expect(devItems.length).toBeGreaterThan(0);
    expect(devItems.length).toBeLessThan(prodItems.length);
    expect(devItems.every((i) => i.name.startsWith('dev_'))).toBe(true);
    expect(prodItems.every((i) => i.name.startsWith('prod_'))).toBe(true);
    const keys = new Set(devItems.map((i) => `${i.type}|${i.name}`));
    const runs = (await dev.listRuns(undefined, 0)).runs;
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.every((r) => keys.has(`${r.type}|${r.name}`))).toBe(true);
    for (const i of devItems) for (const s of i.startedBy ?? []) expect(s.jobName.startsWith('dev_')).toBe(true);
  });

  it('stg sits between dev and prod', async () => {
    const count = async (v: 'dev' | 'stg' | 'prod') => (await createMockRunSource(clock, v).listItems()).items.length;
    const [d, s, p] = [await count('dev'), await count('stg'), await count('prod')];
    expect(d).toBeLessThan(s);
    expect(s).toBeLessThan(p);
  });

  it('item details and single runs use the prefixed names', async () => {
    const source = createMockRunSource(clock, 'stg');
    const item = (await source.listItems()).items.find((i) => i.type === 'job')!;
    expect((await source.getItem('job', item.id)).item.name).toBe(item.name);
    const run = (await source.listRuns(undefined, 0)).runs[0];
    expect((await source.getRun(run.id)).name).toMatch(/^stg_/);
  });

  it('same variant, equal data', async () => {
    const a = createMockRunSource(clock, 'dev');
    const b = createMockRunSource(clock, 'dev');
    expect(await a.listItems()).toEqual(await b.listItems());
    expect(await a.listRuns(undefined, 0)).toEqual(await b.listRuns(undefined, 0));
  });
});
