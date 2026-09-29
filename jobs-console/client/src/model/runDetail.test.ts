import { describe, it, expect } from 'vitest';
import { makeRealRun, makeRetryingRun, makeRun } from '../test/fixtures';
import { causeGroups, lastRunSec, schedule, tasksHead, ticks } from './runDetail';
import { taskStates } from './rowView';

describe('runDetail', () => {
  it('schedules every task with the row states, after the task it depends on, inside the run', () => {
    const r = makeRun();
    const rows = schedule(r);
    expect(rows.map((t) => t.state)).toEqual(taskStates(r));
    expect(rows[0].dep).toBe(-1);
    for (const t of rows.slice(1)) {
      const d = rows[t.dep];
      expect(t.dep).toBeLessThan(t.i);
      if (t.state !== 's') expect(t.start).toBeGreaterThanOrEqual(Math.min(d.start + d.dur, r.durationSec * 0.96));
      expect(t.start).toBeLessThanOrEqual(r.durationSec * 0.96);
    }
    const failed = rows.find((t) => t.state === 'f')!;
    expect(failed).toMatchObject({ name: 'load_gl', dur: 3, fail: 0 });
    expect(rows.filter((t) => t.state === 's').every((t) => t.dur === 0)).toBe(true);
  });

  it('counts the tasks headline from the same states the boxes show', () => {
    expect(tasksHead(makeRun())).toBe('1 failed, 5 ok, 4 skipped');
    expect(tasksHead(makeRun({ kind: 'succeeded', failed: [], result: 'succeeded' }))).toBe('10 tasks');
  });

  it('labels the axis in quarters and groups failures by cause', () => {
    expect(ticks(4000)).toEqual(['0', '16m 40s', '33m 20s', '50m 00s', '1h 06m']);
    const c = (label: string) => ({ label, code: '', detail: '' });
    const r = makeRun({ failed: [{ name: 'a', cause: c('X'), secs: 1 }, { name: 'b', cause: c('Y'), secs: 1 }, { name: 'c', cause: c('X'), secs: 1 }] });
    expect(causeGroups(r).map((g) => [g.label, g.items.map((x) => x.i)])).toEqual([['X', [0, 2]], ['Y', [1]]]);
  });

  it("takes the last run from the job's earlier finished runs, else the average", () => {
    const r = makeRun({ id: 5, startTime: 5000 });
    const h = [makeRun({ id: 3, startTime: 3000, durationSec: 30 }), makeRun({ id: 4, startTime: 4000, durationSec: 40 }), r, makeRun({ id: 6, startTime: 6000, durationSec: 60 })];
    expect(lastRunSec(r, h)).toBe(40);
    expect(lastRunSec(r, [r])).toBe(r.usualSec);
  });
});

describe('runDetail with real tasks', () => {
  it('schedules the real tasks: names, starts, durations, every dependency, failure linkage', () => {
    const rows = schedule(makeRealRun());
    expect(rows.map((t) => [t.name, t.start, t.dur, t.state, t.deps, t.fail])).toEqual([
      ['setup', 0, 60, 'ok', [], undefined],
      ['extract_a', 60, 120, 'ok', [0], undefined],
      ['extract_b', 100, 200, 'ok', [0], undefined],
      ['transform', 300, 100, 'f', [1, 2], 0],
      ['load', 400, 0, 's', [3], undefined],
      ['publish', 400, 0, 's', [4], undefined],
    ]);
    expect(rows.map((t) => t.dep)).toEqual([-1, 0, 0, 1, 3, 4]);
  });

  it('running tasks keep growing with the client clock; pending ones wait at their dependency end', () => {
    const r = makeRetryingRun();
    const rows = schedule(r, r.durationSec + 60);
    expect(rows.map((t) => [t.name, t.start, t.dur, t.state])).toEqual([
      ['a', 0, 600, 'ok'],
      ['d', 100, 3560, 'r'],
      ['b', 600, 3060, 'r'],
      ['c', 3660, 0, 'p'],
    ]);
  });

  it('heads the tasks panel from the real states', () => {
    expect(tasksHead(makeRealRun())).toBe('1 failed, 3 ok, 2 skipped');
    expect(tasksHead(makeRetryingRun())).toBe('1 retrying, 1 ok');
    expect(tasksHead(makeRealRun({ failed: [], tasks: [{ key: 'main', startSec: 0, durSec: 5, state: 'ok', deps: [], attempt: 0 }] }))).toBe('1 task');
    expect(causeGroups(makeRealRun())).toEqual([{ label: 'Table not found', items: [{ f: makeRealRun().failed[0], i: 0 }] }]);
  });
});
