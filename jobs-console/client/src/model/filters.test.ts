import { describe, it, expect } from 'vitest';
import { makeRun } from '../test/fixtures';
import type { Filters } from './filters';
import { passes, passesExceptStatus, matchesQuery, autoStatuses, sortRuns, scopeCounts, menuCounts, liveCount, tileCounts, tileSubtitle, codeOf } from './filters';

const day = 86400000;
const end = new Date(2026, 8, 23).getTime();
const base: Filters = { scope: 'all', types: [], runAs: [], codes: [], statuses: [], live: false, query: '', window: { from: end - 2 * day, to: end } };
const t = new Date(2026, 8, 22, 5).getTime();
const failed = makeRun({ id: 1, startTime: t });
const ok = makeRun({ id: 2, kind: 'succeeded', failed: [], cause: { label: 'Succeeded', code: '', detail: '' }, startTime: t - 1000 });
const live = makeRun({ id: 3, kind: 'running', failed: [], live: true, cause: { label: 'Running', code: '', detail: '' }, startTime: t - 2000, mine: true });
const old = makeRun({ id: 4, startTime: end - 40 * day });

describe('filters', () => {
  it('hides succeeded runs when no status is selected', () => {
    expect(passes(failed, base)).toBe(true);
    expect(passes(ok, base)).toBe(false);
    expect(passes(ok, { ...base, statuses: ['succeeded'] })).toBe(true);
  });

  it('applies scope, window, live, type, run-as and code', () => {
    expect(passes(failed, { ...base, scope: 'mine' })).toBe(false);
    expect(passes(live, { ...base, scope: 'mine' })).toBe(true);
    expect(passes(old, base)).toBe(false);
    expect(passes(failed, { ...base, live: true })).toBe(false);
    expect(passes(live, { ...base, live: true })).toBe(true);
    expect(passes(failed, { ...base, types: ['pipeline'] })).toBe(false);
    expect(passes(failed, { ...base, runAs: ['sp-ingest'] })).toBe(false);
    expect(passes(failed, { ...base, codes: ['CLOUD_FAILURE'] })).toBe(true);
    expect(codeOf(ok)).toBe('none');
    expect(passesExceptStatus(ok, base)).toBe(true);
  });

  it('matches every search token regardless of case and spacing', () => {
    expect(matchesQuery(failed, '  CLUSTER   load_gl ')).toBe(true);
    expect(matchesQuery(failed, 'cluster permission')).toBe(false);
    expect(matchesQuery(failed, '')).toBe(true);
    expect(matchesQuery(failed, '630000000123456')).toBe(true);
    expect(passes(failed, { ...base, query: 'nope' })).toBe(false);
  });

  it('turns on exactly the statuses present in the window, in tile order', () => {
    expect(autoStatuses([ok, failed, live, old], base)).toEqual(['failed', 'running', 'succeeded']);
    expect(autoStatuses([ok, failed, live], { ...base, live: true })).toEqual(['running']);
  });

  it('sorts by status group (running now, waiting, finished) then newest first', () => {
    const a = makeRun({ id: 10, startTime: 1 });
    const b = makeRun({ id: 11, startTime: 2 });
    const slow = makeRun({ id: 12, kind: 'slow', startTime: 3 });
    const retrying = makeRun({ id: 13, kind: 'retrying', startTime: 4 });
    const queued = makeRun({ id: 14, kind: 'queued', startTime: 5 });
    const snoozed = makeRun({ id: 15, kind: 'snoozed', startTime: 6 });
    expect(sortRuns([snoozed, ok, queued, live, a, retrying, b, slow]).map((r) => r.id)).toEqual([3, 12, 13, 14, 11, 10, 2, 15]);
  });

  it('counts scope, menus, live and tiles', () => {
    expect(scopeCounts([failed, ok, live, old], end)).toEqual({ mine: 1, all: 2 });
    expect(menuCounts([failed, ok, live], 'codes')).toEqual({ CLOUD_FAILURE: 1, none: 2 });
    expect(liveCount([failed, live], 'all')).toBe(1);
    expect(liveCount([failed, live], 'mine')).toBe(1);
    const tiles = tileCounts([failed, ok, live, old], base);
    expect(tiles.failed.map((r) => r.id)).toEqual([1]);
    expect(tiles.succeeded.map((r) => r.id)).toEqual([2]);
  });

  it('writes tile subtitles', () => {
    expect(tileSubtitle('failed', [failed, failed, makeRun({ cause: { label: 'Timed out', code: 'TIMEDOUT', detail: '' } })], 0)).toBe('2 cluster error');
    expect(tileSubtitle('running', [live], 0)).toBe('on track');
    expect(tileSubtitle('queued', [makeRun({ kind: 'queued', startTime: 0 })], 49 * 60_000)).toBe('longest 49m 00s');
    expect(tileSubtitle('failed', [], 0)).toBe('');
  });
});
