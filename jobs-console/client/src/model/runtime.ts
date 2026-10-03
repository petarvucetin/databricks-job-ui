import { RUN_KINDS, type Run, type RunKind } from '../../../shared/domain/types';

/** Runtime filter, in seconds: `min` inclusive, `max` exclusive (Infinity = no upper limit). Null in Filters means any runtime. */
export interface RuntimeRange {
  min: number;
  max: number;
}

const M = 60;
const H = 3600;
/** Column edges of the runtime slider, in seconds: round runtimes, finer at the short end. */
export const RUNTIME_EDGES = [0, M, 2 * M, 5 * M, 10 * M, 15 * M, 30 * M, 45 * M, H, 1.5 * H, 2 * H, 3 * H, 4 * H, 6 * H, 8 * H, 12 * H, 24 * H, Infinity];

/** Index of the last edge at or under `x` (edges ascending), -1 if none. */
const lastAtOrUnder = (edges: number[], x: number): number => {
  let i = -1;
  while (i + 1 < edges.length && edges[i + 1] <= x) i++;
  return i;
};

/** Runtime of a run: time so far while it is going, total once finished, 0 while queued. */
export const runtimeOf = (r: Run): number => r.durationSec;

export function inRuntime(r: Run, range: RuntimeRange | null): boolean {
  if (!range) return true;
  const s = runtimeOf(r);
  return s >= range.min && s < range.max;
}

/**
 * The slider's columns: consecutive edges from the one at or under the shortest run to the first past the longest.
 * The current range's edges stay in, so the handles keep a place when the runs inside it drop out of the window.
 */
export function runtimeColumns(runs: Run[], range: RuntimeRange | null): RuntimeRange[] {
  const xs = runs.map(runtimeOf);
  if (range) xs.push(range.min, range.max === Infinity ? range.min : range.max - 1);
  if (!xs.length) return [];
  const lo = Math.min(...xs);
  const hi = Math.max(...xs);
  const first = lastAtOrUnder(RUNTIME_EDGES, lo);
  const last = RUNTIME_EDGES.findIndex((e) => e > hi);
  const out: RuntimeRange[] = [];
  for (let i = first; i < last; i++) out.push({ min: RUNTIME_EDGES[i], max: RUNTIME_EDGES[i + 1] });
  return out;
}

export function countByColumn(runs: Run[], cols: RuntimeRange[]): Record<RunKind, number>[] {
  const out = cols.map(() => Object.fromEntries(RUN_KINDS.map((k) => [k, 0])) as Record<RunKind, number>);
  for (const r of runs) {
    const i = cols.findIndex((c) => inRuntime(r, c));
    if (i >= 0) out[i][r.kind]++;
  }
  return out;
}

/** Short edge text: "0", "45s"-free round values like "5m", "1h", "1.5h", "24h+". */
export function edgeText(sec: number): string {
  if (sec === Infinity) return 'longest';
  if (sec === 0) return '0';
  if (sec < H) return `${sec / M}m`;
  return `${sec / H}h`;
}

/** Column heading: number on top, unit under it, as the timeline's day columns. "<1 min", "1–2 min", "1–1.5 h", "24+ h". */
export function columnText(c: RuntimeRange): { num: string; unit: string; title: string } {
  const unit = c.max <= H ? 'min' : 'h';
  const v = (s: number) => String(unit === 'min' ? s / M : s / H);
  if (c.max === Infinity) return { num: `${v(c.min)}+`, unit, title: `${edgeText(c.min)} and longer` };
  if (c.min === 0) return { num: `<${v(c.max)}`, unit, title: `under ${edgeText(c.max)}` };
  return { num: `${v(c.min)}–${v(c.max)}`, unit, title: `${edgeText(c.min)} to ${edgeText(c.max)}` };
}

/** "any runtime", "30m and longer", "under 5m", "5m to 30m". */
export function rangeText(range: RuntimeRange | null): string {
  if (!range || (range.min === 0 && range.max === Infinity)) return 'any runtime';
  if (range.max === Infinity) return `${edgeText(range.min)} and longer`;
  if (range.min === 0) return `under ${edgeText(range.max)}`;
  return `${edgeText(range.min)} to ${edgeText(range.max)}`;
}

/**
 * The outer edges stay open (0 and Infinity), so a run still going that grows past the longest column stays in;
 * a range open at both ends is no filter at all.
 */
export function normalise(range: RuntimeRange, cols: RuntimeRange[]): RuntimeRange | null {
  if (!cols.length) return null;
  const r = { min: range.min <= cols[0].min ? 0 : range.min, max: range.max >= cols[cols.length - 1].max ? Infinity : range.max };
  return r.min === 0 && r.max === Infinity ? null : r;
}

export function sameRange(a: RuntimeRange | null, b: RuntimeRange | null): boolean {
  return a === b || (!!a && !!b && a.min === b.min && a.max === b.max);
}

/** Dragging one handle to column edge `edge` (0..cols.length); the other handle stays and the range keeps one column. */
export function dragRuntimeHandle(cols: RuntimeRange[], range: RuntimeRange | null, which: 'min' | 'max', edge: number): RuntimeRange | null {
  const edges = [...cols.map((c) => c.min), cols[cols.length - 1].max];
  const cur = range ?? { min: edges[0], max: edges[edges.length - 1] };
  const lo = Math.max(0, lastAtOrUnder(edges, cur.min));
  const at = edges.findIndex((e) => e >= cur.max);
  const hi = Math.max(lo + 1, at < 0 ? edges.length - 1 : at);
  const next = which === 'min' ? { min: edges[Math.min(edge, hi - 1)], max: edges[hi] } : { min: edges[lo], max: edges[Math.max(edge, lo + 1)] };
  return normalise(next, cols);
}
