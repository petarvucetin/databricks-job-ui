import { describe, it, expect } from 'vitest';
import { makeRun } from '../test/fixtures';
import { initialState, applyAction, PAGE, type ViewCtx } from './viewState';
import { buckets, presetWindow, domainStart } from './timeline';

const end = new Date(2026, 8, 23).getTime();
const runs = [
  makeRun({ id: 1, startTime: new Date(2026, 8, 22, 5).getTime() }),
  makeRun({ id: 2, kind: 'succeeded', failed: [], startTime: new Date(2026, 8, 21, 5).getTime() }),
  makeRun({ id: 3, kind: 'running', failed: [], live: true, startTime: new Date(2026, 8, 22, 7).getTime() }),
  makeRun({ id: 4, kind: 'succeeded', failed: [], startTime: new Date(2026, 8, 10, 5).getTime() }),
];
const ctx: ViewCtx = { runs, end };

describe('viewState', () => {
  it('starts on 30d, last 2 days, with the statuses present switched on', () => {
    const s = initialState(ctx);
    expect(s.scale).toBe('30d');
    expect(s.filters.window).toEqual(presetWindow('last2', '30d', end));
    expect(s.filters.statuses).toEqual(['failed', 'running', 'succeeded']);
    expect(s.cap).toBe(PAGE);
  });

  it('clicking a day selects it; clicking again selects the whole scale', () => {
    const s0 = initialState(ctx);
    const col = buckets('30d', end).findIndex((b) => b.start === new Date(2026, 8, 10).getTime());
    const s1 = applyAction(s0, { type: 'column', col }, ctx);
    expect(s1.filters.window).toEqual({ from: new Date(2026, 8, 10).getTime(), to: new Date(2026, 8, 11).getTime() });
    expect(s1.filters.statuses).toEqual(['succeeded']);
    const s2 = applyAction(s1, { type: 'column', col }, ctx);
    expect(s2.filters.window).toEqual({ from: domainStart('30d', end), to: end });
  });

  it('double-clicking a day centres the window on it and keeps its length', () => {
    const s0 = applyAction(initialState(ctx), { type: 'preset', preset: 'last7' }, ctx);
    const col = buckets('30d', end).findIndex((b) => b.start === new Date(2026, 8, 10).getTime());
    const s1 = applyAction(s0, { type: 'cube', col, kind: 'succeeded' }, ctx);
    const s2 = applyAction(s1, { type: 'moveWindow', col, window: s0.filters.window }, ctx);
    expect(s2.filters.window).toEqual({ from: new Date(2026, 8, 7).getTime(), to: new Date(2026, 8, 14).getTime() });
    expect(s2.cube).toBeNull();
    expect(s2.filters.statuses).toEqual(['succeeded']);
  });

  it('clicking a count filters to that column and status, and toggles back', () => {
    const s0 = initialState(ctx);
    const s1 = applyAction(s0, { type: 'cube', col: 29, kind: 'failed' }, ctx);
    expect(s1.cube).toEqual({ col: 29, kind: 'failed' });
    expect(s1.filters.statuses).toEqual(['failed']);
    const s2 = applyAction(s1, { type: 'cube', col: 29, kind: 'failed' }, ctx);
    expect(s2.cube).toBeNull();
    expect(s2.filters.window).toEqual({ from: domainStart('30d', end), to: end });
  });

  it('Running now keeps only live statuses; toggling off restores', () => {
    const s1 = applyAction(initialState(ctx), { type: 'toggleLive' }, ctx);
    expect(s1.filters.live).toBe(true);
    expect(s1.filters.statuses).toEqual(['running']);
    const s2 = applyAction(s1, { type: 'toggleLive' }, ctx);
    expect(s2.filters.statuses).toEqual(['failed', 'running', 'succeeded']);
  });

  it('changing scale trims the window; presets widen the scale', () => {
    const s1 = applyAction(initialState(ctx), { type: 'scale', scale: '24h' }, ctx);
    expect(s1.filters.window).toEqual({ from: new Date(2026, 8, 22).getTime(), to: end });
    const s2 = applyAction(s1, { type: 'preset', preset: 'last7' }, ctx);
    expect(s2.scale).toBe('7d');
    const s3 = applyAction(s2, { type: 'preset', preset: 'all' }, ctx);
    expect(s3.filters.window).toEqual({ from: domainStart('7d', end), to: end });
  });

  it('dragging sets the window and fits the scale', () => {
    const s = applyAction(initialState(ctx), { type: 'window', window: { from: new Date(2026, 6, 1).getTime(), to: end } }, ctx);
    expect(s.scale).toBe('90d');
  });

  it('toggles tiles, menus, scope, search; pages and clears', () => {
    let s = initialState(ctx);
    s = applyAction(s, { type: 'toggleStatus', kind: 'failed' }, ctx);
    expect(s.filters.statuses).toEqual(['running', 'succeeded']);
    s = applyAction(s, { type: 'toggleMenu', key: 'runAs', value: 'sp-ingest' }, ctx);
    expect(s.filters.runAs).toEqual(['sp-ingest']);
    s = applyAction(s, { type: 'toggleMenu', key: 'runAs', value: 'sp-ingest' }, ctx);
    expect(s.filters.runAs).toEqual([]);
    s = applyAction(s, { type: 'toggleMenu', key: 'codes', value: 'none' }, ctx);
    s = applyAction(s, { type: 'clearMenu', key: 'codes' }, ctx);
    expect(s.filters.codes).toEqual([]);
    s = applyAction(s, { type: 'scope', scope: 'mine' }, ctx);
    s = applyAction(s, { type: 'query', query: 'gl' }, ctx);
    s = applyAction(s, { type: 'more' }, ctx);
    expect(s.cap).toBe(2 * PAGE);
    s = applyAction(s, { type: 'clear' }, ctx);
    expect(s.filters.scope).toBe('mine');
    expect(s.filters.query).toBe('');
    expect(s.filters.window).toEqual(presetWindow('last2', '30d', end));
    expect(s.cap).toBe(PAGE);
  });
});
