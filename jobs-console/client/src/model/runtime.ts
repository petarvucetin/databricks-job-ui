import type { Run } from '../../../shared/domain/types';

/** Runtime filter, in seconds: `min` inclusive, `max` exclusive (Infinity = no upper limit). Null in Filters means any runtime. */
export interface RuntimeRange {
  min: number;
  max: number;
}

const M = 60;
const H = 3600;
/** Where the runtime handles snap, in seconds: round runtimes, finer at the short end. */
export const RUNTIME_EDGES = [0, M, 2 * M, 5 * M, 10 * M, 15 * M, 30 * M, 45 * M, H, 1.5 * H, 2 * H, 3 * H, 4 * H, 6 * H, 8 * H, 12 * H, 24 * H];

/** Runtime of a run: time so far while it is going, total once finished, 0 while queued. */
export const runtimeOf = (r: Run): number => r.durationSec;

export function inRuntime(r: Run, range: RuntimeRange | null): boolean {
  if (!range) return true;
  const s = runtimeOf(r);
  return s >= range.min && s < range.max;
}

/**
 * The slider's scale, 0..1 from no runtime to the longest run, logarithmic so minutes and hours both get room.
 * `edges` are the snap points: 0, the round runtimes under the longest run, then the longest run itself.
 */
export interface RuntimeScale {
  longest: number;
  edges: number[];
  x: (sec: number) => number;
}

export function runtimeScale(runs: Run[]): RuntimeScale {
  const longest = Math.max(1, ...runs.map(runtimeOf));
  const log = Math.log10(1 + longest);
  return {
    longest,
    edges: [...RUNTIME_EDGES.filter((e) => e < longest), longest],
    x: (sec) => Math.min(1, Math.log10(1 + sec) / log),
  };
}

/** Handle positions (0..1) of a range: the open ends sit at the track's ends. */
export function handlePositions(scale: RuntimeScale, range: RuntimeRange | null): [number, number] {
  if (!range) return [0, 1];
  return [range.min === 0 ? 0 : scale.x(range.min), range.max === Infinity ? 1 : scale.x(range.max)];
}

/** Index of the snap point nearest to track position `pos` (0..1). */
export function nearestEdge(scale: RuntimeScale, pos: number): number {
  let best = 0;
  scale.edges.forEach((e, i) => {
    if (Math.abs(scale.x(e) - pos) < Math.abs(scale.x(scale.edges[best]) - pos)) best = i;
  });
  return best;
}

/**
 * Moving one handle to snap point `edge`; the other stays, and the range keeps at least one step. The first and
 * last snap points are open (0 and Infinity), so a run still going that grows past the longest stays in; a range
 * open at both ends is no filter at all.
 */
export function dragRuntime(scale: RuntimeScale, range: RuntimeRange | null, which: 'min' | 'max', edge: number): RuntimeRange | null {
  const last = scale.edges.length - 1;
  const [a, b] = handlePositions(scale, range);
  let lo = nearestEdge(scale, a);
  let hi = !range || range.max === Infinity ? last : nearestEdge(scale, b);
  if (which === 'min') lo = Math.max(0, Math.min(edge, hi - 1));
  else hi = Math.max(edge, lo + 1);
  const next = { min: lo === 0 ? 0 : scale.edges[lo], max: hi >= last ? Infinity : scale.edges[hi] };
  return next.min === 0 && next.max === Infinity ? null : next;
}

const TICKS = [10, M, 5 * M, 15 * M, H, 4 * H, 12 * H, 24 * H];

/**
 * Time-scale labels under the track: round runtimes under the longest run, then the longest run itself (right-aligned).
 * A tick closer than `gap` (track share) to the previous one or to the longest is dropped.
 */
export function scaleTicks(scale: RuntimeScale, gap = 0.09): { sec: number; x: number }[] {
  const end = { sec: scale.longest, x: 1 };
  const out: { sec: number; x: number }[] = [];
  for (const sec of TICKS) {
    const x = scale.x(sec);
    if (sec >= scale.longest || 1 - x < gap * 1.5 || (out.length && x - out[out.length - 1].x < gap)) continue;
    out.push({ sec, x });
  }
  return [...out, end];
}

/** Runs per slice of the track, for the small bars above it. */
export function histogram(runs: Run[], scale: RuntimeScale, n: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (const r of runs) out[Math.min(n - 1, Math.floor(scale.x(runtimeOf(r)) * n))]++;
  return out;
}

/**
 * Bar `i` of `n` as seconds: its slice of the track. The last bar is open, so a run still going stays in it.
 * Bars split the track evenly, so a slice is the inverse of the log scale at its two edges.
 */
export function barRange(scale: RuntimeScale, i: number, n: number): RuntimeRange {
  const log = Math.log10(1 + scale.longest);
  const at = (pos: number) => 10 ** (pos * log) - 1;
  return { min: i === 0 ? 0 : at(i / n), max: i === n - 1 ? Infinity : at((i + 1) / n) };
}

/** Which bar a selected slice is now (the scale moves when the longest run changes), or -1. */
export function barIndex(scale: RuntimeScale, bar: RuntimeRange | null, n: number): number {
  if (!bar) return -1;
  return bar.max === Infinity ? n - 1 : Math.min(n - 1, Math.floor(scale.x((bar.min + bar.max) / 2) * n));
}

/** Short edge text: "0", "5m", "1h", "1.5h". */
export function edgeText(sec: number): string {
  if (sec === 0) return '0';
  if (sec < H) return `${sec / M}m`;
  return `${sec / H}h`;
}

/** "any runtime", "30m and longer", "under 5m", "5m to 30m". */
export function rangeText(range: RuntimeRange | null): string {
  if (!range || (range.min === 0 && range.max === Infinity)) return 'any runtime';
  if (range.max === Infinity) return `${edgeText(range.min)} and longer`;
  if (range.min === 0) return `under ${edgeText(range.max)}`;
  return `${edgeText(range.min)} to ${edgeText(range.max)}`;
}

export function sameRange(a: RuntimeRange | null, b: RuntimeRange | null): boolean {
  return a === b || (!!a && !!b && a.min === b.min && a.max === b.max);
}
