import { describe, it, expect, vi } from 'vitest';
import { filterItems, sortItems, lastRun, typicalSec, runsFor, scopeCounts, startsOf, isOnTimeline, tagCounts, pillOf, linkStarters, triggerCounts } from './items';
import { makeRun } from '../test/fixtures';
import type { Item } from '../../../shared/domain/types';
import * as cron from '../../../shared/domain/cron';

// startsBetween passes through to the real one; the spy counts how often the starts cache misses.
vi.mock('../../../shared/domain/cron', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../shared/domain/cron')>();
  return { ...real, startsBetween: vi.fn(real.startsBetween) };
});
const startsBetweenSpy = vi.mocked(cron.startsBetween);

const base = (over: Partial<Item>): Item => ({ type: 'job', id: '1', name: 'x', deployed: false, mine: false, tags: {}, trigger: 'manual', paused: false, bundle: false, ...over });
const items: Item[] = [
  base({ id: '1', name: '[dev ann] aiges_ingest_coretables_mfg_dev', mine: true, tags: { project: 'aiges' } }),
  base({ id: '2', name: 'aiges_finance_daily_report_prod', deployed: true, trigger: 'schedule', schedule: { cron: '0 0 2 * * ?', tz: 'UTC', paused: false } }),
  base({ id: 'p1', type: 'pipeline', name: 'raw_bronze_mfg_dev', trigger: 'continuous' }),
];
const F = { query: '', type: 'all' as const, trigger: 'any' as const, scope: 'all' as const, tags: [], sort: 'name' as const };

describe('items model', () => {
  it('search tokens in any order, ids too', () => {
    expect(filterItems(items, { ...F, query: 'mfg coretables' }, null).map((i) => i.id)).toEqual(['1']);
    expect(filterItems(items, { ...F, query: 'p1' }, null).map((i) => i.id)).toEqual(['p1']);
  });
  it('type, scope, tags', () => {
    expect(filterItems(items, { ...F, type: 'pipeline' }, null)).toHaveLength(1);
    expect(filterItems(items, { ...F, scope: 'mine' }, null).map((i) => i.id)).toEqual(['1']);
    expect(filterItems(items, { ...F, scope: 'deployed' }, null).map((i) => i.id)).toEqual(['2']);
    expect(filterItems(items, { ...F, tags: ['project:aiges'] }, null).map((i) => i.id)).toEqual(['1']);
    expect(scopeCounts(items)).toEqual({ mine: 1, deployed: 1, all: 3 });
    expect(tagCounts(items)).toEqual([{ value: 'project:aiges', count: 1 }]);
  });
  it('schedule window keeps only items starting inside it', () => {
    const from = Date.UTC(2026, 9, 7, 1), to = Date.UTC(2026, 9, 7, 3);
    expect(filterItems(items, F, { from, to }).map((i) => i.id)).toEqual(['2']);
    expect(filterItems(items, F, { from, to, type: 'pipeline' })).toEqual([]);
  });
  it('starts: only unpaused schedules that parse; slices outside the first horizon still work', () => {
    const paused = base({ id: '3', trigger: 'schedule', paused: true, schedule: { cron: '0 0 2 * * ?', tz: 'UTC', paused: true } });
    const unparsed = base({ id: '4', trigger: 'schedule', schedule: { cron: '0 0 12 L * ?', tz: 'UTC', paused: false } });
    expect([items[1], paused, unparsed, items[2]].map(isOnTimeline)).toEqual([true, false, false, false]);
    expect(startsOf(paused, 0, Date.UTC(2030, 0, 1))).toEqual([]);
    expect(startsOf(items[2], 0, Date.UTC(2030, 0, 1))).toEqual([]);
    expect(startsOf(items[1], Date.UTC(2026, 9, 6), Date.UTC(2026, 9, 8))).toEqual([Date.UTC(2026, 9, 6, 2), Date.UTC(2026, 9, 7, 2)]);
    expect(startsOf(items[1], Date.UTC(2026, 11, 1), Date.UTC(2026, 11, 2))).toEqual([Date.UTC(2026, 11, 1, 2)]);
  });
  it('runs match by jobId, else by name; typical runtime falls back to a 10-minute estimate', () => {
    const runs = [makeRun({ id: 1, name: 'aiges_finance_daily_report_prod', jobId: 2, usualSec: 420, startTime: 1 }), makeRun({ id: 2, name: '[dev ann] aiges_ingest_coretables_mfg_dev', startTime: 2 })];
    expect(runsFor(items[1], runs).map((r) => r.id)).toEqual([1]);
    expect(lastRun(items[0], runs)?.id).toBe(2);
    expect(lastRun(items[2], runs)).toBeUndefined();
    expect(typicalSec(items[1], runs)).toEqual({ sec: 420, estimated: false });
    expect(typicalSec(items[2], runs)).toEqual({ sec: 600, estimated: true });
  });
  it('a run with a different job id does not match by name', () => {
    const runs = [makeRun({ id: 9, name: 'aiges_finance_daily_report_prod', jobId: 77 })];
    expect(runsFor(items[1], runs)).toEqual([]);
  });
  it('typical runtime: the last finished run when usualSec is missing', () => {
    const runs = [
      makeRun({ id: 1, name: 'x', usualSec: 0, durationSec: 300, startTime: 1, result: 'succeeded', live: false }),
      makeRun({ id: 2, name: 'x', usualSec: 0, durationSec: 50, startTime: 2, result: null, live: true }),
    ];
    expect(typicalSec(base({ id: 'x1', name: 'x' }), runs)).toEqual({ sec: 300, estimated: false });
  });
  it('sort by name (bare name, bundle prefix ignored) and next start', () => {
    expect(sortItems(items, 'name', [], 0).map((i) => i.id)).toEqual(['2', '1', 'p1']);
    expect(sortItems(items, 'next', [], Date.UTC(2026, 9, 6, 16))[0].id).toBe('2');
  });
  it('sort by last run and recently failed', () => {
    const runs = [
      makeRun({ id: 1, name: 'aiges_finance_daily_report_prod', jobId: 2, startTime: 10, result: 'failed' }),
      makeRun({ id: 2, name: '[dev ann] aiges_ingest_coretables_mfg_dev', startTime: 20, result: 'succeeded', kind: 'succeeded' }),
    ];
    expect(sortItems(items, 'last', runs, 0).map((i) => i.id)).toEqual(['1', '2', 'p1']);
    expect(sortItems(items, 'failed', runs, 0).map((i) => i.id)).toEqual(['2', '1', 'p1']);
  });
  it('the trigger pill is computed once per item and minute', () => {
    const it2 = items[1];
    const t = Date.UTC(2026, 9, 6, 16, 16, 5);
    const p = pillOf(it2, t);
    expect(p.text).toBe('daily 02:00');
    expect(pillOf(it2, t + 50e3)).toBe(p);
    expect(pillOf(it2, t + 60e3)).not.toBe(p);
  });
  it('search matches the pill text of the current minute, not the first one asked for', () => {
    // a 2026-only daily schedule: "daily 02:00" while it has starts ahead, "cron …" once it has none
    const y = [base({ id: 'y', name: 'year_bound', trigger: 'schedule', schedule: { cron: '0 0 2 * * ? 2026', tz: 'UTC', paused: false } })];
    expect(filterItems(y, { ...F, query: 'daily' }, null, Date.UTC(2026, 11, 30)).map((i) => i.id)).toEqual(['y']);
    expect(filterItems(y, { ...F, query: 'daily' }, null, Date.UTC(2027, 0, 1))).toEqual([]);
  });
  it('starts are cached by the schedule, not the object: a refetched copy reuses them; a changed cron recomputes', () => {
    const a = base({ id: 'c1', trigger: 'schedule', schedule: { cron: '0 0 5 * * ?', tz: 'UTC', paused: false } });
    const from = Date.UTC(2026, 9, 6), to = Date.UTC(2026, 9, 8);
    startsBetweenSpy.mockClear();
    const first = startsOf(a, from, to);
    expect(startsBetweenSpy).toHaveBeenCalledTimes(1);
    const copy = JSON.parse(JSON.stringify(a)) as Item;
    expect(startsOf(copy, from, to)).toEqual(first);
    expect(startsBetweenSpy).toHaveBeenCalledTimes(1);
    const changed = { ...copy, schedule: { ...copy.schedule!, cron: '0 0 6 * * ?' } };
    expect(startsOf(changed, from, to)).toEqual([Date.UTC(2026, 9, 6, 6), Date.UTC(2026, 9, 7, 6)]);
    expect(startsBetweenSpy).toHaveBeenCalledTimes(2);
  });
});

describe('pipelines credited to the jobs that start them', () => {
  const daily = base({ id: 'j2', name: 'nightly_load', trigger: 'schedule', schedule: { cron: '0 0 2 * * ?', tz: 'UTC', paused: false } });
  const hourly = base({ id: 'j3', name: 'hourly_sync', trigger: 'schedule', schedule: { cron: '0 30 * * * ?', tz: 'UTC', paused: false } });
  const manual = base({ id: 'j4', name: 'adhoc_job' });
  const pipe = (id: string, by: Item[], over: Partial<Item> = {}) =>
    base({ type: 'pipeline', id, name: `pipe_${id}`, startedBy: by.map((j) => ({ jobId: j.id, jobName: j.name })), ...over });

  it('starts are the union of the starting jobs\' starts, sorted and deduped; on the timeline', () => {
    const p = pipe('cp1', [daily, hourly, daily]);
    linkStarters([daily, hourly, p]);
    const from = Date.UTC(2026, 9, 7, 1), to = Date.UTC(2026, 9, 7, 3);
    expect(isOnTimeline(p)).toBe(true);
    expect(startsOf(p, from, to)).toEqual([Date.UTC(2026, 9, 7, 1, 30), Date.UTC(2026, 9, 7, 2), Date.UTC(2026, 9, 7, 2, 30)]);
  });

  it('only jobs the list contains count; a pipeline whose jobs are absent or unscheduled is not on the timeline', () => {
    const absent = pipe('cp2', [daily]);
    const byManual = pipe('cp3', [manual]);
    linkStarters([absent, byManual, manual]);
    expect(isOnTimeline(absent)).toBe(false);
    expect(startsOf(absent, 0, Date.UTC(2030, 0, 1))).toEqual([]);
    expect(isOnTimeline(byManual)).toBe(false);
    expect(pillOf(absent, Date.UTC(2026, 9, 6, 16)).text).toBe('triggered');
    expect(pillOf(byManual, Date.UTC(2026, 9, 6, 16)).text).toBe('triggered');
  });

  it('the pill: the job\'s pill and "· by job", the job names in the title; search finds it', () => {
    const p = pipe('cp4', [daily]);
    const list = [daily, p];
    linkStarters(list);
    const now = Date.UTC(2026, 9, 6, 16, 16);
    expect(pillOf(p, now)).toEqual({ text: 'daily 02:00 · by job', cls: 'sched', title: 'Started by the pipeline task of nightly_load' });
    expect(filterItems(list, { ...F, query: 'by job' }, null, now).map((i) => i.id)).toEqual(['cp4']);
  });

  it('a continuous pipeline, paused or not, is never credited: Unscheduled, no starts, its own pill (R15)', () => {
    const now = Date.UTC(2026, 9, 6, 16, 16);
    for (const paused of [false, true]) {
      const own = base({ type: 'pipeline', id: `own${paused}`, name: 'stream', trigger: 'continuous', paused });
      const p = pipe(`cc${paused}`, [daily], { name: 'stream', trigger: 'continuous', paused });
      const list = [daily, p, own];
      linkStarters(list);
      expect(isOnTimeline(p)).toBe(false);
      expect(startsOf(p, Date.UTC(2026, 9, 7, 1), Date.UTC(2026, 9, 7, 3))).toEqual([]);
      expect(pillOf(p, now)).toEqual(pillOf(own, now));
      expect(triggerCounts(list)).toEqual({ any: 3, sched: 1, unsched: 2 });
    }
  });

  it('a type filter of Pipelines keeps the credited starts (the jobs are linked from the full list)', () => {
    const p = pipe('cp5', [daily]);
    const list = [daily, p];
    linkStarters(list);
    const from = Date.UTC(2026, 9, 7, 1), to = Date.UTC(2026, 9, 7, 3);
    expect(filterItems(list, { ...F, type: 'pipeline' }, { from, to }).map((i) => i.id)).toEqual(['cp5']);
  });

  it('Scheduled · Unscheduled: counts and filtering by "on the timeline"', () => {
    const p = pipe('cp6', [daily]);
    const list = [daily, manual, p, base({ type: 'pipeline', id: 'cont', trigger: 'continuous' })];
    linkStarters(list);
    expect(triggerCounts(list)).toEqual({ any: 4, sched: 2, unsched: 2 });
    expect(filterItems(list, { ...F, trigger: 'sched' }, null).map((i) => i.id)).toEqual(['j2', 'cp6']);
    expect(filterItems(list, { ...F, trigger: 'unsched' }, null).map((i) => i.id)).toEqual(['j4', 'cont']);
  });
});
