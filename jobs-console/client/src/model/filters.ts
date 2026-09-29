import { RUN_KINDS, type Run, type RunKind } from '../../../shared/domain/types';
import { dur, fmtStart } from '../../../shared/domain/format';
import { problemText, taskText } from './rowView';

export type Scope = 'mine' | 'all';

export interface TimeWindow {
  /** Inclusive, epoch ms. */
  from: number;
  /** Exclusive, epoch ms. */
  to: number;
}

export interface Filters {
  scope: Scope;
  /** Empty means no restriction. */
  types: string[];
  runAs: string[];
  /** Error codes; 'none' = runs without a code. */
  codes: string[];
  /** Empty means "everything except succeeded". */
  statuses: RunKind[];
  live: boolean;
  query: string;
  window: TimeWindow;
}

/** Statuses grouped by where the run is: still going, waiting to start, or finished. Tiles and row order follow it. */
export const STATUS_GROUPS: { title: string; kinds: RunKind[] }[] = [
  { title: 'Running now', kinds: ['running', 'slow', 'retrying'] },
  { title: 'Waiting', kinds: ['queued'] },
  { title: 'Finished', kinds: ['failed', 'succeeded'] },
];
const ROW_ORDER: RunKind[] = STATUS_GROUPS.flatMap((g) => g.kinds);

export const KIND_TITLES: Record<RunKind, string> = {
  failed: 'Failed', retrying: 'Retrying', slow: 'Slow', running: 'Running', queued: 'Queued', succeeded: 'Succeeded',
};

const ERRWORDS: Record<string, string> = {
  'Table not found': 'analysisexception table_or_view_not_found finance.gl_staging missing table',
  'Cluster error': 'cloud_provider_shutdown spot reclaimed executor lost cluster terminated',
  'Timed out': 'timedout timeout cancelled partitions',
  'Permission denied': 'insufficient_permissions select grant unauthorized',
};

export function codeOf(r: Run): string {
  return r.cause.code || 'none';
}

/**
 * A run belongs to a time window when it was going during it: started before the window ends, and still running or
 * finished after the window starts. So a run that started at 04:00 and is still running shows in the 10:00 hour,
 * as it does in the native Runs list with "Run status: Active".
 */
export function overlapsWindow(r: Run, w: TimeWindow): boolean {
  if (r.startTime >= w.to) return false;
  const end = r.live ? Infinity : r.startTime + r.durationSec * 1000;
  return end >= w.from;
}

/** Everything except status and search. The status tiles and auto-selection build on this. */
export function passesExceptStatus(r: Run, f: Filters): boolean {
  if (f.scope === 'mine' && !r.mine) return false;
  if (f.live && !r.live) return false;
  if (!overlapsWindow(r, f.window)) return false;
  if (f.runAs.length && !f.runAs.includes(r.runAs)) return false;
  if (f.types.length && !f.types.includes(r.type)) return false;
  if (f.codes.length && !f.codes.includes(codeOf(r))) return false;
  return true;
}

const searchCache = new WeakMap<Run, string>();
function searchText(r: Run): string {
  const hit = searchCache.get(r);
  if (hit) return hit;
  const parts = [
    r.type === 'pipeline' ? 'pipeline etl update' + (r.continuous ? ' continuous lagging' : '') : 'job',
    r.name, r.runId, r.runAs, r.kind, r.cause.label, r.cause.code, r.cause.detail, ERRWORDS[r.cause.label] ?? '',
    problemText(r), fmtStart(r.startTime), r.mine ? 'mine me' : 'service principal deployed',
    ...r.failed.flatMap((x) => [x.name, x.cause.label]),
    r.failed.length ? '' : taskText(r),
  ];
  const s = parts.join(' ').toLowerCase();
  searchCache.set(r, s);
  return s;
}

export function matchesQuery(r: Run, q: string): boolean {
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;
  const hay = searchText(r);
  return tokens.every((tok) => hay.includes(tok));
}

export function passes(r: Run, f: Filters): boolean {
  if (!passesExceptStatus(r, f) || !matchesQuery(r, f.query)) return false;
  return f.statuses.length ? f.statuses.includes(r.kind) : r.kind !== 'succeeded';
}

export function autoStatuses(runs: Run[], f: Filters): RunKind[] {
  const present = new Set<RunKind>();
  for (const r of runs) if (passesExceptStatus(r, f)) present.add(r.kind);
  return RUN_KINDS.filter((k) => present.has(k));
}

/** Row order: by status (needs attention first), or by job name A–Z / Z–A. */
export type RowSort = 'status' | 'name-asc' | 'name-desc';

/** The job name without its bundle target prefix, e.g. "[dev mchen] finance_gl_x" → "finance_gl_x". */
export const bareName = (name: string): string => name.replace(/^\[[^\]]+\] /, '');

export function sortRuns(runs: Run[], sort: RowSort = 'status'): Run[] {
  const order = (k: RunKind) => ROW_ORDER.indexOf(k);
  const byStatus = (a: Run, b: Run) => order(a.kind) - order(b.kind) || b.startTime - a.startTime;
  if (sort === 'status') return [...runs].sort(byStatus);
  const dir = sort === 'name-asc' ? 1 : -1;
  return [...runs].sort((a, b) => dir * bareName(a.name).localeCompare(bareName(b.name), undefined, { sensitivity: 'base', numeric: true }) || byStatus(a, b));
}

/** Runs needing attention over the last 30 days (not succeeded). */
export function scopeCounts(runs: Run[], end: number): { mine: number; all: number } {
  const since = new Date(new Date(end).getFullYear(), new Date(end).getMonth(), new Date(end).getDate() - 30).getTime();
  const att = runs.filter((r) => r.kind !== 'succeeded' && r.startTime >= since);
  return { mine: att.filter((r) => r.mine).length, all: att.length };
}

export function menuCounts(runs: Run[], key: 'types' | 'runAs' | 'codes'): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of runs) {
    const k = key === 'types' ? r.type : key === 'runAs' ? r.runAs : codeOf(r);
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

export function liveCount(runs: Run[], scope: Scope): number {
  return runs.filter((r) => r.live && (scope === 'all' || r.mine)).length;
}

/** Runs per status for the tiles: all filters except status, including search. */
export function tileCounts(runs: Run[], f: Filters): Record<RunKind, Run[]> {
  const out = Object.fromEntries(RUN_KINDS.map((k) => [k, [] as Run[]])) as Record<RunKind, Run[]>;
  for (const r of runs) if (passesExceptStatus(r, f) && matchesQuery(r, f.query)) out[r.kind].push(r);
  return out;
}

export function tileSubtitle(kind: RunKind, runs: Run[], asOf: number): string {
  if (!runs.length) return '';
  switch (kind) {
    case 'failed': {
      const c: Record<string, number> = {};
      for (const r of runs) c[r.cause.label] = (c[r.cause.label] ?? 0) + 1;
      const top = Object.keys(c).sort((a, b) => (c[b] ?? 0) - (c[a] ?? 0))[0];
      return `${c[top]} ${top.toLowerCase()}`;
    }
    case 'retrying':
      return 'attempt 2 of 4';
    case 'slow':
      return `worst +${dur(Math.max(...runs.map((r) => r.durationSec - r.usualSec)))}`;
    case 'running':
      return 'on track';
    case 'queued':
      return `longest ${dur(Math.max(...runs.map((r) => (asOf - r.startTime) / 1000)))}`;
    case 'succeeded': {
      const slower = runs.filter((r) => r.durationSec > r.usualSec * 1.1).length;
      return slower ? `${slower} slower than usual` : '';
    }
  }
}
