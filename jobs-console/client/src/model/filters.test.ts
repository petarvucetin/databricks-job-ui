import { describe, it, expect } from 'vitest';
import { makeRun } from '../test/fixtures';
import type { Filters } from './filters';
import { jobRows, latestPerJob, passes, passesExceptStatus, matchesQuery, autoStatuses, sortRuns, scopeCounts, menuCounts, liveCount, tileCounts, tileSubtitle, codeOf } from './filters';

const day = 86400000;
const end = new Date(2026, 8, 23).getTime();
const base: Filters = { scope: 'all', types: [], runAs: [], codes: [], statuses: [], live: false, query: '', window: { from: end - 2 * day, to: end }, runtime: null, runtimeBar: null };
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

  it('sorts by job name ignoring the [dev …] prefix, either way, running runs on top', () => {
    const beta = makeRun({ id: 20, name: '[dev mchen] beta_job' });
    const alpha = makeRun({ id: 21, name: 'Alpha_job' });
    const gamma = makeRun({ id: 22, name: '[dev john smith] gamma_job' });
    const betaLive = makeRun({ id: 23, name: 'beta_job', kind: 'running', live: true });
    expect(sortRuns([gamma, beta, alpha, betaLive], 'name-asc').map((r) => r.id)).toEqual([23, 21, 20, 22]);
    expect(sortRuns([gamma, beta, alpha, betaLive], 'name-desc').map((r) => r.id)).toEqual([23, 22, 20, 21]);
  });

  it('keeps every running run above every finished one in each sort, the chosen order within each group', () => {
    const zLive = makeRun({ id: 30, name: 'zeta', kind: 'running', live: true, startTime: 1 });
    const aLive = makeRun({ id: 31, name: 'alpha', kind: 'slow', live: true, startTime: 2 });
    const slowDone = makeRun({ id: 32, name: 'beta', kind: 'slow', live: false, startTime: 3 });
    const failedRun = makeRun({ id: 33, name: 'aaa', startTime: 4 });
    const runs = [failedRun, slowDone, zLive, aLive];
    expect(sortRuns(runs, 'status').map((r) => r.id)).toEqual([30, 31, 32, 33]);
    expect(sortRuns(runs, 'name-asc').map((r) => r.id)).toEqual([31, 30, 33, 32]);
    expect(sortRuns(runs, 'name-desc').map((r) => r.id)).toEqual([30, 31, 32, 33]);
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

describe('one row per job', () => {
  it("keeps each job's latest run among the runs given (the ones the filters let through)", () => {
    const old = makeRun({ id: 50, name: 'a', startTime: 1000, durationSec: 2000 });
    const recent = makeRun({ id: 51, name: 'a', startTime: 2000, durationSec: 60 });
    const other = makeRun({ id: 52, name: 'b', startTime: 1500 });
    expect(latestPerJob([old, recent, other]).map((r) => r.id).sort()).toEqual([51, 52]);
    // With a runtime filter that drops the recent short run, the job shows its older long run instead.
    const f = { ...base, window: { from: 0, to: end }, statuses: [], runtime: { min: 1800, max: Infinity } };
    expect(latestPerJob([old, recent, other].filter((r) => passes(r, f))).map((r) => r.id)).toEqual([50]);
  });

  it('Failed lists a job only when its latest run failed; otherwise the job shows its latest run', () => {
    const w = { from: 0, to: end };
    const failedThenOk = [
      makeRun({ id: 60, name: 'a', kind: 'failed', startTime: 1000, durationSec: 2000 }),
      makeRun({ id: 61, name: 'a', kind: 'succeeded', startTime: 5000, durationSec: 60 }),
    ];
    const okThenFailed = [
      makeRun({ id: 62, name: 'b', kind: 'succeeded', startTime: 1000 }),
      makeRun({ id: 63, name: 'b', kind: 'failed', startTime: 5000 }),
    ];
    const runs = [...failedThenOk, ...okThenFailed];
    expect(jobRows(runs, { ...base, window: w, statuses: ['failed'] }).map((r) => r.id)).toEqual([63]);
    expect(jobRows(runs, { ...base, window: w, statuses: ['failed', 'succeeded'] }).map((r) => r.id).sort()).toEqual([61, 63]);
  });
});

describe('runtime filter and longest-first sort', () => {
  const short = makeRun({ id: 40, kind: 'failed', durationSec: 120, startTime: end - day / 2 });
  const long = makeRun({ id: 41, kind: 'failed', durationSec: 7200, startTime: end - day / 2 });
  const going = makeRun({ id: 42, kind: 'running', live: true, durationSec: 60, startTime: end - day / 4 });

  it('keeps only runs inside the runtime range, for rows and tiles alike', () => {
    const f = { ...base, runtime: { min: 1800, max: Infinity } };
    expect([short, long].filter((r) => passes(r, f)).map((r) => r.id)).toEqual([41]);
    expect(tileCounts([short, long], f).failed.map((r) => r.id)).toEqual([41]);
  });

  it('sorts longest first, with runs still going on top', () => {
    expect(sortRuns([short, long, going], 'runtime').map((r) => r.id)).toEqual([42, 41, 40]);
  });
});
