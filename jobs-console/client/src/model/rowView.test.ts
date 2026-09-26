import { describe, it, expect } from 'vitest';
import { makeRun } from '../test/fixtures';
import {
  problemText, taskText, taskStates, runningIndex, chainSummary, liveMessage,
  whenText, borderTone, elapsedSec, progress, statBlock, splitName,
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

  it('writes the live message', () => {
    expect(liveMessage(running)).toEqual({ lead: 'load_gl running', dim: '5 of 10 tasks done, 50% of the average time', red: false });
    expect(liveMessage(makeRun({ kind: 'retrying', failed: [] })).lead).toBe('attempt 2 of 4');
  });

  it('keeps the live message in step with an explicit elapsed', () => {
    expect(liveMessage(running, 900).dim).toContain('75% of the average time');
  });

  it('says when, and picks the border tone', () => {
    expect(whenText(makeRun())).toBe('failed 22 Sep 02:41');
    expect(whenText(makeRun({ kind: 'queued' }))).toBe('queued since 22 Sep 02:41');
    expect(borderTone(makeRun())).toBe('red');
    expect(borderTone(running)).toBe('blue');
    expect(borderTone(makeRun({ kind: 'slow' }))).toBe('amber');
    expect(borderTone(makeRun({ kind: 'succeeded' }))).toBe('');
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
