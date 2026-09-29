import { describe, it, expect } from 'vitest';
import { makeRealRun, makeRun } from '../test/fixtures';
import { addToStack, compareRows, idsFromSearch, mergeOrder, paramRows, stackRuns } from './compare';
import { schedule } from './runDetail';

const ok = (over: Parameters<typeof makeRun>[0] = {}) => makeRun({ kind: 'succeeded', failed: [], result: 'succeeded', ...over });

describe('compare', () => {
  it('merges task lists keeping order and slotting extras before the next known key', () => {
    expect(mergeOrder([['a', 'b', 'd'], ['a', 'c', 'd', 'e']])).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(mergeOrder([['x'], []])).toEqual(['x']);
  });

  it('lines tasks up across runs, marking tasks a run did not have, and says what differs and when', () => {
    const d = (day: number) => new Date(2026, 8, day, 5).getTime();
    const runs = [makeRun({ id: 1, startTime: d(20), ntasks: 10, failed: [{ name: 'dq_checks', cause: { label: 'Timed out', code: 'TIMEDOUT', detail: '' }, secs: 3 }] }), ok({ id: 2, startTime: d(21), ntasks: 12 })];
    const rows = compareRows(runs, runs.map((r) => schedule(r)));
    expect(rows).toHaveLength(12);
    const added = rows.filter((r) => r.tone === 'chg');
    expect(added.map((r) => [r.name, r.note])).toEqual([['load_vendors', 'added at 21/05:00'], ['publish', 'added at 21/05:00']]);
    expect(added[0].cells[0]).toBeNull();
    const failed = rows.find((r) => r.tone === 'bad')!;
    expect([failed.name, failed.note]).toEqual(['dq_checks', 'failed at 20/05:00']);
    expect(rows[0].note).toBe('same');
  });

  it('lists every parameter with each run value, null when a run did not set it', () => {
    const runs = [makeRun({ params: { date: '2026-09-20', mode: 'full' } }), makeRun({ params: { date: '2026-09-21', batch_size: '50000' } })];
    expect(paramRows(runs)).toEqual([
      { key: 'date', values: ['2026-09-20', '2026-09-21'] },
      { key: 'mode', values: ['full', null] },
      { key: 'batch_size', values: [null, '50000'] },
    ]);
  });

  it('stacks runs of one job, starts over for another job, and orders them oldest first', () => {
    const a1 = makeRun({ id: 1, startTime: 300 });
    const a2 = makeRun({ id: 2, startTime: 100 });
    const b = makeRun({ id: 3, name: '[prod] other_job' });
    const byId = new Map([a1, a2, b].map((r) => [r.id, r]));
    let s = addToStack([], 1, byId);
    s = addToStack(s, 2, byId);
    expect(s).toEqual([1, 2]);
    expect(addToStack(s, 2, byId)).toEqual([1, 2]);
    expect(addToStack(s, 3, byId)).toEqual([3]);
    expect(addToStack(s, 99, byId)).toEqual([1, 2]);
    expect(stackRuns([1, 2, 99], byId).map((r) => r.id)).toEqual([2, 1]);
  });

  it('reads run ids from ?compare=', () => {
    expect(idsFromSearch('?compare=12,5,x,7')).toEqual([12, 5, 7]);
    expect(idsFromSearch('')).toEqual([]);
  });
});

describe('compare with real tasks', () => {
  it('lines up real task names across runs', () => {
    const a = makeRealRun({ id: 1, startTime: new Date(2026, 8, 20, 5).getTime() });
    const b = makeRealRun({
      id: 2, startTime: new Date(2026, 8, 21, 5).getTime(), kind: 'succeeded', result: 'succeeded', failed: [],
      tasks: [
        { key: 'setup', startSec: 0, durSec: 60, state: 'ok', deps: [], attempt: 0 },
        { key: 'transform', startSec: 60, durSec: 90, state: 'ok', deps: [0], attempt: 0 },
      ],
    });
    const rows = compareRows([a, b], [schedule(a), schedule(b)]);
    expect(rows.map((r) => r.name)).toEqual(['setup', 'extract_a', 'extract_b', 'transform', 'load', 'publish']);
    expect(rows.find((r) => r.name === 'transform')).toMatchObject({ tone: 'bad', note: 'failed at 20/05:00' });
    expect(rows.find((r) => r.name === 'extract_a')).toMatchObject({ tone: 'chg', note: 'removed at 21/05:00' });
  });
});
