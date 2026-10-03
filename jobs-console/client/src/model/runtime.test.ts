import { describe, it, expect } from 'vitest';
import { makeRun } from '../test/fixtures';
import { dragRuntime, handlePositions, histogram, inRuntime, nearestEdge, rangeText, runtimeScale } from './runtime';

const m = 60;
const h = 3600;
const runs = [
  makeRun({ id: 1, kind: 'succeeded', durationSec: 3 * m }),
  makeRun({ id: 2, kind: 'failed', durationSec: 40 * m }),
  makeRun({ id: 3, kind: 'running', live: true, durationSec: 2.5 * h }),
];

describe('runtime filter', () => {
  it('snaps to round runtimes under the longest run, then the longest itself', () => {
    const sc = runtimeScale(runs);
    expect(sc.longest).toBe(2.5 * h);
    expect(sc.edges).toEqual([0, m, 2 * m, 5 * m, 10 * m, 15 * m, 30 * m, 45 * m, h, 1.5 * h, 2 * h, 2.5 * h]);
    expect(sc.x(0)).toBe(0);
    expect(sc.x(2.5 * h)).toBe(1);
    expect(sc.x(10 * m)).toBeGreaterThan(0.5); // logarithmic: minutes get room next to hours
  });

  it('filters by range, min inclusive and max exclusive; queued runs (0s) drop out once the range starts above 0', () => {
    expect(inRuntime(runs[1], { min: 30 * m, max: 45 * m })).toBe(true);
    expect(inRuntime(runs[1], { min: 15 * m, max: 40 * m })).toBe(false);
    expect(inRuntime(makeRun({ kind: 'queued', durationSec: 0 }), { min: m, max: Infinity })).toBe(false);
    expect(inRuntime(runs[0], null)).toBe(true);
  });

  it('drags one handle at a time; the ends stay open and a range open at both ends is no filter', () => {
    const sc = runtimeScale(runs);
    const thirty = sc.edges.indexOf(30 * m);
    const longer = dragRuntime(sc, null, 'min', thirty);
    expect(longer).toEqual({ min: 30 * m, max: Infinity });
    expect(handlePositions(sc, longer)).toEqual([sc.x(30 * m), 1]);
    expect(dragRuntime(sc, longer, 'max', sc.edges.indexOf(h))).toEqual({ min: 30 * m, max: h });
    expect(dragRuntime(sc, longer, 'max', 0)).toEqual({ min: 30 * m, max: 45 * m });
    expect(dragRuntime(sc, longer, 'min', 0)).toBeNull();
    expect(nearestEdge(sc, sc.x(31 * m))).toBe(thirty);
  });

  it('counts runs along the track for the small bars', () => {
    const sc = runtimeScale(runs);
    const bars = histogram(runs, sc, 40);
    expect(bars.reduce((s, n) => s + n, 0)).toBe(3);
    expect(bars[39]).toBe(1);
  });

  it('reads the range in words', () => {
    expect(rangeText(null)).toBe('any runtime');
    expect(rangeText({ min: 30 * m, max: Infinity })).toBe('30m and longer');
    expect(rangeText({ min: 0, max: 5 * m })).toBe('under 5m');
    expect(rangeText({ min: h, max: 1.5 * h })).toBe('1h to 1.5h');
  });
});
