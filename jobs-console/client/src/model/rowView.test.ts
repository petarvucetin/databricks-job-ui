import { describe, it, expect } from 'vitest';
import { makeRealRun, makeRetryingRun, makeRun } from '../test/fixtures';
import {
  problemText, taskText, taskStates, runningIndex, chainSummary, taskNames,
  whenText, elapsedSec, progress, statBlock, splitName,
} from './rowView';

const ok = { label: 'Succeeded', code: '', detail: '' };
const running = makeRun({ id: 40, kind: 'running', cause: { label: 'Running', code: '', detail: '' }, failed: [], live: true, ntasks: 10, durationSec: 600, usualSec: 1200 });

describe('rowView', () => {
  it('describes problems like the prototype', () => {
    expect(problemText(makeRun())).toBe('Cluster error');
    expect(problemText(makeRun({ failed: [makeRun().failed[0], { name: 'publish', cause: ok, secs: 2 }] }))).toBe('Cluster error, 2 tasks');
    expect(problemText(makeRun({ kind: 'slow', failed: [], durationSec: 4000, usualSec: 1000 }))).toBe('+50m 00s over usual');
    expect(problemText(running)).toBe('running, on track');
    expect(problemText(makeRun({ type: 'pipeline', kind: 'queued', failed: [] }))).toBe('waiting for resources');
  });

  it('names the failing task', () => {
    expect(taskText(makeRun())).toBe('load_gl');
    expect(taskText(makeRun({ kind: 'retrying', failed: [] }))).toBe('extract_bseg');
    expect(taskText(makeRun({ kind: 'succeeded', failed: [] }))).toBe('');
  });

  it('builds the task chain for failed, retrying and running runs', () => {
    const f = taskStates(makeRun({ ntasks: 10 }));
    expect(f).toHaveLength(10);
    expect(f.filter((s) => s === 'f')).toHaveLength(1);
    expect(taskStates(makeRun({ kind: 'retrying', failed: [], ntasks: 9 }))[4]).toBe('r');
    expect(runningIndex(running)).toBe(5);
    const r = taskStates(running);
    expect(r.slice(0, 5).every((s) => s === 'ok')).toBe(true);
    expect(r[5]).toBe('r');
    expect(r.slice(6).every((s) => s === 'p')).toBe(true);
    expect(chainSummary(running)).toBe('5 ok, 1 running, 4 to go');
  });

  it('keeps the chain in step with an explicit elapsed, so live rows do not freeze between polls', () => {
    expect(chainSummary(running, 1200)).toBe('9 ok, 1 running, 0 to go');
  });

  it('keeps the last task running for a slow job still going, and all ok for a finished slow one', () => {
    const slowLive = makeRun({ kind: 'slow', live: true, result: null, failed: [], ntasks: 5 });
    expect(taskStates(slowLive)).toEqual(['ok', 'ok', 'ok', 'ok', 'r']);
    expect(chainSummary(slowLive)).toBe('4 ok, last task running');
    expect(taskStates(makeRun({ kind: 'slow', failed: [], ntasks: 3 }))).toEqual(['ok', 'ok', 'ok']);
  });

  it('names every task in chain order, failed ones by the name the run reported', () => {
    expect(taskNames(running)).toEqual(['setup', 'extract_bkpf', 'extract_bseg', 'extract_gl', 'transform', 'dq_checks', 'load_gl', 'load_gl_history', 'load_cost_centers', 'load_profit_centers']);
    const long = taskNames(makeRun({ ntasks: 15, failed: [] }));
    expect(long[13]).toBe('setup_2');
    const failed = makeRun({ ntasks: 6, failed: [{ name: 'boom_task', cause: ok, secs: 3 }] });
    expect(taskNames(failed)[3]).toBe('boom_task');
    // load_gl is task 6 already; failing at slot 5 swaps it with dq_checks instead of listing it twice
    const plain = taskNames(makeRun({ ntasks: 10, failed: [] }));
    const swapped = taskNames(makeRun({ ntasks: 10, failed: [{ name: 'load_gl', cause: makeRun().cause, secs: 3 }] }));
    expect(swapped.slice(5, 7)).toEqual(['load_gl', 'dq_checks']);
    expect([...swapped].sort()).toEqual([...plain].sort());
    expect(taskStates(failed)[3]).toBe('f');
    expect(taskNames(makeRun({ type: 'pipeline', ntasks: 2, failed: [] }))).toEqual(['bronze_bkpf', 'bronze_bseg']);
  });

  it('says when', () => {
    expect(whenText(makeRun())).toBe('failed 22 Sep 02:41');
    expect(whenText(makeRun({ kind: 'queued' }))).toBe('queued since 22 Sep 02:41');
  });

  it('ticks elapsed time for live runs only', () => {
    expect(elapsedSec(running, 10_000 + 7_000, 10_000)).toBe(607);
    expect(elapsedSec(makeRun(), 10_000 + 7_000, 10_000)).toBe(1404);
  });

  it('switches the progress edge to "over" once elapsed passes the average', () => {
    expect(progress(running, 600)).toEqual({ p: 0.5, over: false });
    expect(progress(running, 1200)).toEqual({ p: 1, over: false });
    expect(progress(running, 1201).over).toBe(true);
  });

  it('fills the stats block', () => {
    expect(statBlock(running, 3909, 0)).toEqual({ label: 'now', value: '1h 05m 09s', big: true, average: '20m 00s' });
    expect(statBlock(makeRun(), 1404, 0)).toEqual({ label: 'took', value: '23m 24s', big: false, average: '25m 52s' });
    const q = makeRun({ kind: 'queued', durationSec: 0, startTime: 0 });
    expect(statBlock(q, 0, 49 * 60_000)).toEqual({ label: 'waiting', value: '49m 00s', big: false, average: '25m 52s' });
  });

  it('splits the bundle target prefix off the name', () => {
    expect(splitName('[prod] finance_gl_x')).toEqual({ prefix: '[prod] ', rest: 'finance_gl_x' });
    expect(splitName('plain_name')).toEqual({ prefix: '', rest: 'plain_name' });
  });
});

describe('rowView with real tasks', () => {
  it('names, states and summarises the real tasks, not synthetic ones', () => {
    const r = makeRealRun();
    expect(taskNames(r)).toEqual(['setup', 'extract_a', 'extract_b', 'transform', 'load', 'publish']);
    expect(taskStates(r)).toEqual(['ok', 'ok', 'ok', 'f', 's', 's']);
    expect(chainSummary(r)).toBe('3 ok, 1 failed, 2 skipped');
    expect(taskText(r)).toBe('transform');
    expect(runningIndex(r)).toBe(3);
    expect(chainSummary(makeRealRun({ kind: 'succeeded', failed: [], tasks: [{ key: 'main', startSec: 0, durSec: 5, state: 'ok', deps: [], attempt: 0 }] }))).toBe('all ok');
  });

  it('a retried task shows once, with its attempt', () => {
    const r = makeRetryingRun();
    expect(taskNames(r)).toEqual(['a', 'd', 'b', 'c']);
    expect(chainSummary(r)).toBe('1 ok, 1 running, 1 retrying, 1 to go');
    expect(taskText(r)).toBe('d');
    expect(problemText(r)).toBe('attempt 2');
  });

  it('an empty real task list stays empty (no invented tasks)', () => {
    const r = makeRealRun({ kind: 'succeeded', failed: [], tasks: [], ntasks: 0 });
    expect(taskNames(r)).toEqual([]);
    expect(taskStates(r)).toEqual([]);
    expect(chainSummary(r)).toBe('no tasks');
  });
});
