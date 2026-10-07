import { describe, it, expect } from 'vitest';
import { loadRuns, loadCurve, niceTicks, fmtN, groupOf, runningIn } from './load';
import type { Item } from '../../../shared/domain/types';
import { makeRun } from '../test/fixtures';

const H = 3600e3;
const FROM = Date.UTC(2026, 9, 6, 0);
const job = (id: string, cron: string, over: Partial<Item> = {}): Item => ({ type: 'job', id, name: id, deployed: false, mine: false, tags: {}, trigger: 'schedule', schedule: { cron, tz: 'UTC', paused: false }, paused: false, bundle: false, ...over });

describe('load', () => {
  it('counts overlapping runs with typical runtime (10-minute estimate without runs)', () => {
    const items = [job('a', '0 0 1 * * ?'), job('b', '0 5 1 * * ?')];
    const lr = loadRuns(items, [], FROM, FROM + 24 * H);
    expect(lr.every((r) => r.estimated && r.end - r.start === 600e3)).toBe(true);
    const { running } = loadCurve(lr, FROM, FROM + 24 * H, 5 * 60e3);
    expect(running[12]).toBe(1);   // 01:00 a only
    expect(running[13]).toBe(2);   // 01:05 both
    expect(running[14]).toBe(1);   // 01:10 a ended
    expect(running[0]).toBe(0);
  });
  it('a run started before the window still counts at its start', () => {
    // 23:55 the day before, 10-minute estimate: running at 00:00 (a run ending exactly at `from` would not count)
    const items = [job('a', '0 55 23 * * ?')];
    const lr = loadRuns(items, [], FROM, FROM + 2 * H);
    expect(loadCurve(lr, FROM, FROM + 2 * H, 5 * 60e3).running[0]).toBe(1);
  });
  it('typical runtime from the loaded runs, not estimated', () => {
    const items = [job('a', '0 0 1 * * ?')];
    const runs = [makeRun({ id: 1, jobId: undefined, name: 'a', usualSec: 1800, result: 'succeeded' })];
    const lr = loadRuns(items, runs, FROM, FROM + 24 * H);
    expect(lr.map((r) => [r.end - r.start, r.estimated])).toEqual([[1800e3, false]]);
  });
  it('starts in the next sample, and pipelines / unscheduled items add nothing', () => {
    const items = [job('a', '0 0 1 * * ?'), job('b', '0 5 1 * * ?'), job('m', '', { trigger: 'manual', schedule: undefined }), { ...job('p', '0 0 1 * * ?'), type: 'pipeline' as const, trigger: 'continuous' as const }];
    const lr = loadRuns(items, [], FROM, FROM + 24 * H);
    expect(lr.map((r) => r.item.id)).toEqual(['a', 'b']);
    const { running, startsIn } = loadCurve(lr, FROM, FROM + 24 * H, 5 * 60e3);
    expect(running).toHaveLength(289);
    expect(startsIn).toHaveLength(288);
    expect([startsIn[11], startsIn[12], startsIn[13], startsIn[14]]).toEqual([0, 1, 1, 0]);
  });
  it('nice ticks and number format', () => {
    expect(niceTicks(14)).toEqual({ step: 5, top: 15, ticks: [0, 5, 10, 15] });
    expect(niceTicks(2480).top).toBe(3000);
    expect(niceTicks(0).ticks).toEqual([0, 1]);
    expect([fmtN(999), fmtN(1200), fmtN(3000)]).toEqual(['999', '1.2k', '3k']);
  });
  it('groups and selection', () => {
    expect(groupOf(job('x', '* * * * * ?', { name: '[dev ann] x' }))).toBe('[dev ann]');
    expect(groupOf(job('x', '* * * * * ?', { tags: { project: 'crm' } }))).toBe('crm');
    expect(groupOf(job('x', '* * * * * ?'))).toBe('prod / no prefix');
    const items = [job('a', '0 0 1 * * ?'), job('b', '0 0 5 * * ?')];
    const lr = loadRuns(items, [], FROM, FROM + 24 * H);
    expect(runningIn(lr, FROM + H, FROM + 2 * H).map((x) => x.item.id)).toEqual(['a']);
  });
  it('the selection list is ordered by first start and keeps each item\'s runs together', () => {
    const items = [job('late', '0 30 1 * * ?'), job('every', '0 0/20 * * * ?')];
    const lr = loadRuns(items, [], FROM, FROM + 24 * H);
    const hit = runningIn(lr, FROM + H, FROM + 2 * H);
    expect(hit.map((x) => x.item.id)).toEqual(['every', 'late']);
    expect(hit[0].runs.map((r) => (r.start - FROM) / 60e3)).toEqual([60, 80, 100]);
  });
});
