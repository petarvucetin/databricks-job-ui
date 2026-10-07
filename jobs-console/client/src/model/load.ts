import type { Item, Run } from '../../../shared/domain/types';
import { startsOf, typicalSec } from './items';

const H = 3600e3;

/** One expected run of a scheduled item: a start and its typical runtime (estimated when no run is loaded). */
export interface LoadRun {
  item: Item;
  start: number;
  end: number;
  estimated: boolean;
  /** A continuous pipeline: running for the whole range. */
  always?: boolean;
}

/** A continuous pipeline that isn't paused: it counts as running the whole time (U2). */
export const isContinuous = (item: Item): boolean => item.type === 'pipeline' && item.trigger === 'continuous' && !item.paused;

/**
 * Expected runs of the scheduled items: every start in [from − 24 h, to) that is still going after `from`, each lasting
 * the item's typical runtime (a credited pipeline: its jobs' starts, its own runtime). A continuous pipeline is one run
 * over [from − 24 h, to + 24 h], flagged `always`. Items without starts (manual, paused, unparsed, uncredited) add none.
 */
export function loadRuns(items: Item[], runs: Run[], from: number, to: number): LoadRun[] {
  const out: LoadRun[] = [];
  for (const item of items) {
    if (isContinuous(item)) {
      out.push({ item, start: from - 24 * H, end: to + 24 * H, estimated: false, always: true });
      continue;
    }
    const starts = startsOf(item, from - 24 * H, to);
    if (!starts.length) continue;
    const { sec, estimated } = typicalSec(item, runs);
    const d = sec * 1e3;
    for (const t of starts) if (t + d > from) out.push({ item, start: t, end: t + d, estimated });
  }
  return out;
}

/** How many entries of the sorted array are ≤ t. */
function countLE(arr: number[], t: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] <= t) lo = m + 1;
    else hi = m;
  }
  return lo;
}

export interface LoadCurve {
  running: number[];
  runningJobs: number[];
  runningPipelines: number[];
  startsIn: number[];
}

/**
 * Sampled every `step` from `from`: `running[i]` is the runs going at from + i·step (N + 1 samples), split into
 * `runningJobs` and `runningPipelines`; `startsIn[i]` the starts in [from + i·step, from + (i + 1)·step) (N samples).
 * Sorted start and end arrays, binary search.
 */
export function loadCurve(lr: LoadRun[], from: number, to: number, step: number): LoadCurve {
  const sorted = (xs: number[]) => xs.sort((a, b) => a - b);
  const S = sorted(lr.map((r) => r.start));
  const E = sorted(lr.map((r) => r.end));
  const pr = lr.filter((r) => r.item.type === 'pipeline');
  const SP = sorted(pr.map((r) => r.start));
  const EP = sorted(pr.map((r) => r.end));
  const N = Math.round((to - from) / step);
  const at = (i: number) => from + i * step;
  const running = Array.from({ length: N + 1 }, (_, i) => countLE(S, at(i)) - countLE(E, at(i)));
  const runningPipelines = Array.from({ length: N + 1 }, (_, i) => countLE(SP, at(i)) - countLE(EP, at(i)));
  const runningJobs = running.map((n, i) => n - runningPipelines[i]);
  const startsIn = Array.from({ length: N }, (_, i) => countLE(S, at(i + 1) - 1) - countLE(S, at(i) - 1));
  return { running, runningJobs, runningPipelines, startsIn };
}

/** 1 / 2 / 5 × 10ⁿ at or above raw, at least 1. */
function niceStep(raw: number): number {
  if (!(raw > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const f = raw / p;
  return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p);
}

/** Y-axis: a round step for about four gridlines, the top tick at or above max. */
export function niceTicks(max: number): { step: number; top: number; ticks: number[] } {
  const m = Math.max(1, max);
  const step = niceStep(m / 4);
  const top = Math.ceil(m / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { step, top, ticks };
}

/** 999 → "999", 1200 → "1.2k", 3000 → "3k". */
export const fmtN = (n: number): string => (n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : String(n));

/** Tooltip group: the bundle target prefix ("[dev ann]"), else the project tag, else "prod / no prefix". */
export function groupOf(item: Item): string {
  const m = /^\[[^\]]+\]/.exec(item.name);
  if (m) return m[0];
  return item.tags.project || 'prod / no prefix';
}

/** The items with a run going in [a, b), ordered by their first such start, each with those runs. */
export function runningIn(lr: LoadRun[], a: number, b: number): { item: Item; runs: LoadRun[] }[] {
  const hit = lr.filter((r) => r.start < b && r.end > a).sort((x, y) => x.start - y.start);
  const by = new Map<Item, LoadRun[]>();
  for (const r of hit) {
    const list = by.get(r.item);
    if (list) list.push(r);
    else by.set(r.item, [r]);
  }
  return [...by.entries()].map(([item, runs]) => ({ item, runs }));
}
