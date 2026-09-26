import { describe, it, expect } from 'vitest';
import { makeRun } from '../test/fixtures';
import { historyByJob, visibleHistory, durShort, HISTORY_MAX } from './history';

const day = 86400000;
const end = new Date(2026, 8, 23).getTime();
const win = { from: end - 2 * day, to: end };

describe('history', () => {
  it('groups runs of the same job inside the window, oldest first', () => {
    const a1 = makeRun({ id: 1, name: 'job_a', startTime: end - 3 * 3600000 });
    const a2 = makeRun({ id: 2, name: 'job_a', startTime: end - 30 * 3600000 });
    const aOld = makeRun({ id: 3, name: 'job_a', startTime: end - 5 * day });
    const b1 = makeRun({ id: 4, name: 'job_b', startTime: end - 3600000 });
    const h = historyByJob([a1, a2, aOld, b1], win);
    expect(h.get('job_a')?.map((r) => r.id)).toEqual([2, 1]);
    expect(h.get('job_b')?.map((r) => r.id)).toEqual([4]);
    expect(h.has('job_c')).toBe(false);
  });

  it('leaves out runs that have not finished (no result yet)', () => {
    const done = makeRun({ id: 1, name: 'job_a', startTime: end - 3 * 3600000, result: 'succeeded' });
    const queued = makeRun({ id: 2, name: 'job_a', kind: 'queued', result: null, startTime: end - 2 * 3600000 });
    const running = makeRun({ id: 3, name: 'job_a', kind: 'running', live: true, result: null, startTime: end - 3600000 });
    expect(historyByJob([done, queued, running], win).get('job_a')?.map((r) => r.id)).toEqual([1]);
    expect(historyByJob([queued], win).has('job_a')).toBe(false);
  });

  it('keeps the newest HISTORY_MAX runs and counts the rest as earlier', () => {
    const runs = Array.from({ length: HISTORY_MAX + 5 }, (_, i) => makeRun({ id: i + 1, name: 'p', startTime: end - (HISTORY_MAX + 5 - i) * 60000 }));
    const v = visibleHistory(runs);
    expect(v.shown).toHaveLength(HISTORY_MAX);
    expect(v.earlier).toBe(5);
    expect(v.shown[v.shown.length - 1]?.id).toBe(HISTORY_MAX + 5);
    expect(visibleHistory(runs.slice(0, 3))).toEqual({ shown: runs.slice(0, 3), earlier: 0 });
  });

  it('formats runtimes to fit a small box', () => {
    expect(durShort(0)).toBe('0s');
    expect(durShort(42)).toBe('42s');
    expect(durShort(1404)).toBe('23m');
    expect(durShort(3900)).toBe('1h05');
    expect(durShort(36000)).toBe('10h');
  });
});
