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
    expect(sortRuns([ok, queued, live, a, retrying, b, slow]).map((r) => r.id)).toEqual([3, 12, 13, 14, 11, 10, 2]);
  });

  it('sorts by job name ignoring the [dev …] prefix, either way, status order breaking ties', () => {
    const beta = makeRun({ id: 20, name: '[dev mchen] beta_job' });
    const alpha = makeRun({ id: 21, name: 'Alpha_job' });
    const gamma = makeRun({ id: 22, name: '[dev john smith] gamma_job' });
    const betaLive = makeRun({ id: 23, name: 'beta_job', kind: 'running', live: true });
    expect(sortRuns([gamma, beta, alpha, betaLive], 'name-asc').map((r) => r.id)).toEqual([21, 23, 20, 22]);
    expect(sortRuns([gamma, beta, alpha, betaLive], 'name-desc').map((r) => r.id)).toEqual([22, 23, 20, 21]);
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

  it('keeps runs that were going during the window, not only those that started in it', () => {
    // The 10:00-11:00 hour, as in the native Runs list with "Run status: Active".
    const hour = { from: new Date(2026, 8, 29, 10).getTime(), to: new Date(2026, 8, 29, 11).getTime() };
    const w = { ...base, window: hour };
    const at = (h: number, m = 0) => new Date(2026, 8, 29, h, m).getTime();
    const since4am = makeRun({ id: 10, kind: 'running', live: true, startTime: at(4), durationSec: 6.9 * 3600 });
    const since0954 = makeRun({ id: 11, kind: 'running', live: true, startTime: at(9, 54), durationSec: 3600 });
    const endedIn = makeRun({ id: 12, kind: 'succeeded', live: false, startTime: at(9, 30), durationSec: 45 * 60 }); // 09:30-10:15
    const endedBefore = makeRun({ id: 13, kind: 'succeeded', live: false, startTime: at(9), durationSec: 30 * 60 }); // 09:00-09:30
    const startsAfter = makeRun({ id: 14, kind: 'running', live: true, startTime: at(11, 5) });
    const inside = [since4am, since0954, endedIn, endedBefore, startsAfter].filter((r) => passesExceptStatus(r, w)).map((r) => r.id);
    expect(inside).toEqual([10, 11, 12]);
  });
});
