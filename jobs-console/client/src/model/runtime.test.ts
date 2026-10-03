import { describe, it, expect } from 'vitest';
import { makeRun } from '../test/fixtures';
import { columnText, countByColumn, dragRuntimeHandle, inRuntime, normalise, rangeText, runtimeColumns } from './runtime';

const m = 60;
const h = 3600;
const runs = [
  makeRun({ id: 1, kind: 'succeeded', durationSec: 3 * m }),
  makeRun({ id: 2, kind: 'failed', durationSec: 40 * m }),
  makeRun({ id: 3, kind: 'running', live: true, durationSec: 2.5 * h }),
];

describe('runtime slider', () => {
  it('spans round columns from the shortest run to the longest', () => {
    const cols = runtimeColumns(runs, null);
    expect(cols[0]).toEqual({ min: 2 * m, max: 5 * m });
    expect(cols[cols.length - 1]).toEqual({ min: 2 * h, max: 3 * h });
    expect(cols.map((c) => columnText(c).num)).toEqual(['2–5', '5–10', '10–15', '15–30', '30–45', '45–60', '1–1.5', '1.5–2', '2–3']);
    expect(runtimeColumns([], null)).toEqual([]);
  });

  it('counts runs per column by status; a running run counts its time so far', () => {
    const cols = runtimeColumns(runs, null);
    const counts = countByColumn(runs, cols);
    expect(counts[0].succeeded).toBe(1);
    expect(counts[4].failed).toBe(1);
    expect(counts[cols.length - 1].running).toBe(1);
  });

  it('filters by range, min inclusive and max exclusive; queued runs (0s) drop out once the range starts above 0', () => {
    expect(inRuntime(runs[1], { min: 30 * m, max: 45 * m })).toBe(true);
    expect(inRuntime(runs[1], { min: 15 * m, max: 40 * m })).toBe(false);
    expect(inRuntime(makeRun({ kind: 'queued', durationSec: 0 }), { min: m, max: Infinity })).toBe(false);
    expect(inRuntime(runs[0], null)).toBe(true);
  });

  it('keeps the outer edges open, so covering every column means any runtime', () => {
    const cols = runtimeColumns(runs, null);
    expect(normalise({ min: 2 * m, max: 3 * h }, cols)).toBeNull();
    expect(normalise({ min: 30 * m, max: 3 * h }, cols)).toEqual({ min: 30 * m, max: Infinity });
    expect(normalise({ min: 2 * m, max: 15 * m }, cols)).toEqual({ min: 0, max: 15 * m });
  });

  it('drags one handle at a time and never closes the range', () => {
    const cols = runtimeColumns(runs, null);
    const fromLong = dragRuntimeHandle(cols, null, 'min', 4);
    expect(fromLong).toEqual({ min: 30 * m, max: Infinity });
    expect(dragRuntimeHandle(cols, fromLong, 'max', 6)).toEqual({ min: 30 * m, max: h });
    expect(dragRuntimeHandle(cols, fromLong, 'max', 0)).toEqual({ min: 30 * m, max: 45 * m });
    expect(dragRuntimeHandle(cols, fromLong, 'min', 0)).toBeNull();
  });

  it('reads the range in words', () => {
    expect(rangeText(null)).toBe('any runtime');
    expect(rangeText({ min: 30 * m, max: Infinity })).toBe('30m and longer');
    expect(rangeText({ min: 0, max: 5 * m })).toBe('under 5m');
    expect(rangeText({ min: h, max: 1.5 * h })).toBe('1h to 1.5h');
    expect(columnText({ min: 0, max: m }).num).toBe('<1');
    expect(columnText({ min: 24 * h, max: Infinity })).toMatchObject({ num: '24+', unit: 'h' });
  });
});
