import { describe, it, expect } from 'vitest';
import type { jobs, pipelines } from '@databricks/sdk-experimental';
import { mergeBase, mergeEvents, pipelinesToReread, type Base, type BasePipeline, type DeltaFetched } from './delta';

const NOW = 1_800_000_000_000;
const MIN = 60000;
const T0 = NOW - 5 * MIN; // when the base was fetched
const FROM = NOW - 30 * 86400000;

const done = (id: number, ago: number): jobs.BaseRun => ({ run_id: id, job_id: 1, start_time: NOW - ago * MIN, status: { state: 'TERMINATED' }, state: { result_state: 'SUCCESS' } });
const running = (id: number, ago: number): jobs.BaseRun => ({ run_id: id, job_id: 1, start_time: NOW - ago * MIN, status: { state: 'RUNNING' } });
const upd = (id: string, ago: number, state: pipelines.UpdateInfo['state']): pipelines.UpdateInfo => ({ update_id: id, creation_time: NOW - ago * MIN, state });
const status = (id: string, latest?: pipelines.UpdateInfo): pipelines.PipelineStateInfo => ({
  pipeline_id: id,
  name: id,
  latest_updates: latest ? [{ update_id: latest.update_id, state: latest.state as pipelines.UpdateStateInfo['state'] }] : [],
});
const pipe = (id: string, updates: pipelines.UpdateInfo[]): BasePipeline => ({
  status: status(id, updates[0]),
  info: { pipelineId: id, name: id, continuous: false, runAs: 'sp' },
  updates: new Map(updates.map((u) => [u.update_id!, { value: u, at: T0 }])),
  events: [],
});

function base(runs: jobs.BaseRun[], pipes: BasePipeline[]): Base {
  return {
    since: undefined,
    asOf: T0,
    fullAt: T0,
    capped: false,
    runs: new Map(runs.map((r) => [r.run_id!, { value: r, at: T0 }])),
    pipelines: new Map(pipes.map((p) => [p.info.pipelineId, p])),
  };
}

const delta = (over: Partial<DeltaFetched>): DeltaFetched => ({ asOf: NOW, active: [], fresh: [], finished: [], deleted: [], statuses: [], reread: new Map(), ...over });

describe('mergeBase', () => {
  it('adds a new run, keeps a live run live, and takes a finished run from getRun', () => {
    const b = base([done(1, 60), running(2, 30), running(3, 20)], []);
    const { base: next, counts } = mergeBase(b, delta({ fresh: [done(4, 1)], active: [{ ...running(2, 30), tasks: [{ task_key: 'x' }] }], finished: [done(3, 20)] }), FROM, 2000);
    expect([...next.runs.keys()].sort()).toEqual([1, 2, 3, 4]);
    expect(next.runs.get(4)?.value.status?.state).toBe('TERMINATED');
    expect(next.runs.get(2)?.value.tasks).toEqual([{ task_key: 'x' }]);
    expect(next.runs.get(3)?.value.status?.state).toBe('TERMINATED');
    expect(next.runs.get(3)?.at).toBe(NOW);
    expect(next.runs.get(1)).toBe(b.runs.get(1)); // untouched: not re-read
    expect(next.asOf).toBe(NOW);
    expect(next.fullAt).toBe(T0);
    expect(counts).toMatchObject({ active: 1, fresh: 1, finished: 1, deleted: 0 });
    // The old base is not changed.
    expect(b.runs.size).toBe(3);
    expect(b.runs.get(3)?.value.status?.state).toBe('RUNNING');
  });

  it('drops a deleted run', () => {
    const { base: next, counts } = mergeBase(base([done(1, 60), running(2, 30)], []), delta({ deleted: [2] }), FROM, 2000);
    expect([...next.runs.keys()]).toEqual([1]);
    expect(counts.deleted).toBe(1);
  });

  it('ages out runs and updates that started before the window', () => {
    const b = base([done(1, 60), done(2, 31 * 1440)], [pipe('p1', [upd('u-new', 10, 'COMPLETED'), upd('u-old', 31 * 1440, 'COMPLETED')])]);
    const { base: next, counts } = mergeBase(b, delta({ statuses: [b.pipelines.get('p1')!.status] }), FROM, 2000);
    expect([...next.runs.keys()]).toEqual([1]);
    expect([...next.pipelines.get('p1')!.updates.keys()]).toEqual(['u-new']);
    expect(counts.agedOut).toBe(2);
    expect(b.pipelines.get('p1')!.updates.size).toBe(2);
  });

  it('takes a re-read pipeline with a new update, keeps an unchanged one as it was, and drops one no longer listed', () => {
    const p1 = pipe('p1', [upd('a1', 60, 'COMPLETED')]);
    const p2 = pipe('p2', [upd('b1', 60, 'COMPLETED')]);
    const p3 = pipe('p3', [upd('c1', 60, 'FAILED')]);
    const b = base([], [p1, p2, p3]);
    const a2 = upd('a2', 2, 'RUNNING');
    const d = delta({
      statuses: [status('p1', a2), p2.status],
      reread: new Map([['p1', { info: p1.info, updates: [a2, upd('a1', 60, 'COMPLETED')], events: [{ id: 'e1', timestamp: new Date(NOW - MIN).toISOString(), origin: { update_id: 'a1' } }] }]]),
    });
    const { base: next, counts } = mergeBase(b, d, FROM, 2000);
    expect([...next.pipelines.keys()]).toEqual(['p1', 'p2']);
    expect([...next.pipelines.get('p1')!.updates.keys()]).toEqual(['a2', 'a1']);
    expect(next.pipelines.get('p1')!.status.latest_updates?.[0].update_id).toBe('a2');
    expect(next.pipelines.get('p1')!.events.map((e) => e.id)).toEqual(['e1']);
    expect(next.pipelines.get('p2')!.updates.get('b1')).toBe(p2.updates.get('b1'));
    expect(counts).toMatchObject({ reread: 1, pipelines: 2 });
  });

  it('keeps a copy fetched later than the delta (a single-run refresh) over the delta', () => {
    const b = base([running(2, 30)], []);
    const newer = { value: done(2, 30), at: NOW + 1000 };
    b.runs.set(2, newer);
    const { base: next } = mergeBase(b, delta({ active: [running(2, 30)] }), FROM, 2000);
    expect(next.runs.get(2)).toBe(newer);
  });

  it('caps job runs at maxRuns, newest kept', () => {
    const { base: next } = mergeBase(base([done(1, 60), done(2, 50)], []), delta({ fresh: [done(3, 1)] }), FROM, 2);
    expect([...next.runs.keys()].sort()).toEqual([2, 3]);
    expect(next.capped).toBe(true);
  });

  it('drops a pipeline the re-read skipped (gone or not visible)', () => {
    const p1 = pipe('p1', [upd('a1', 60, 'RUNNING')]);
    const { base: next } = mergeBase(base([], [p1]), delta({ statuses: [p1.status], reread: new Map([['p1', null]]) }), FROM, 2000);
    expect(next.pipelines.size).toBe(0);
  });
});

describe('pipelinesToReread', () => {
  it('re-reads new pipelines, changed latest updates and pipelines with a live update; not idle ones', () => {
    const idle = pipe('idle', [upd('i1', 60, 'COMPLETED')]);
    const live = pipe('live', [upd('l1', 5, 'RUNNING')]);
    const changed = pipe('changed', [upd('c1', 60, 'COMPLETED')]);
    const empty = pipe('empty', []);
    const b = base([], [idle, live, changed, empty]);
    const statuses = [idle.status, live.status, status('changed', upd('c2', 1, 'QUEUED')), empty.status, status('brand-new')];
    expect(pipelinesToReread(b, statuses)).toEqual(['live', 'changed', 'brand-new']);
  });

  it('re-reads when only the state of the newest update changed', () => {
    const p = pipe('p', [upd('u', 5, 'COMPLETED')]);
    const b = base([], [p]);
    expect(pipelinesToReread(b, [status('p', upd('u', 5, 'COMPLETED'))])).toEqual([]);
    expect(pipelinesToReread(b, [status('p', upd('u', 5, 'FAILED'))])).toEqual(['p']);
  });
});

describe('mergeEvents', () => {
  it('keeps each event once, newest first, none before the window', () => {
    const e = (id: string, ago: number) => ({ id, timestamp: new Date(NOW - ago * MIN).toISOString() });
    expect(mergeEvents([e('a', 1), e('b', 5)], [e('b', 5), e('c', 3), e('old', 99)], NOW - 10 * MIN).map((x) => x.id)).toEqual(['a', 'c', 'b']);
  });
});
