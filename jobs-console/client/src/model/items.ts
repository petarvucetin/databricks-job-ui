import type { Item, Run } from '../../../shared/domain/types';
import { scheduleOf, startsBetween, triggerPill } from '../../../shared/domain/cron';
import { bareName } from './filters';

export interface ItemFilters {
  query: string;
  type: 'all' | 'job' | 'pipeline';
  scope: 'mine' | 'deployed' | 'all';
  /** "k:v" */
  tags: string[];
  sort: 'name' | 'last' | 'failed' | 'next';
}

export const DEFAULT_FILTERS: ItemFilters = { query: '', type: 'all', scope: 'all', tags: [], sort: 'name' };

const DAY = 24 * 3600e3;

/** "type:id": how the page keys and selects an item. */
export const itemKey = (it: Item) => `${it.type}:${it.id}`;

/** scheduleOf per item, cached: the pill, the timeline and the footer all ask. */
const parsedCache = new WeakMap<Item, ReturnType<typeof scheduleOf> | null>();
function parsed(item: Item): ReturnType<typeof scheduleOf> | null {
  if (parsedCache.has(item)) return parsedCache.get(item) ?? null;
  const p = item.trigger === 'schedule' && item.schedule ? scheduleOf(item.schedule) : null;
  parsedCache.set(item, p);
  return p;
}

/** A schedule trigger, not paused, that the cron parser understands: the only items with starts. */
export function isOnTimeline(item: Item): boolean {
  return !item.paused && !item.schedule?.paused && parsed(item)?.kind === 'ok';
}

/** A schedule trigger, not paused, whose cron or time zone the parser doesn't understand. */
export function isUnparsed(item: Item): boolean {
  return !item.paused && !item.schedule?.paused && parsed(item)?.kind === 'unparsed';
}

/**
 * Starts cached per item over a horizon (yesterday through +11 days from the first range asked for), sliced by binary
 * search, so 10k items stay fast. A range outside the cached horizon recomputes it around that range.
 */
const startsCache = new WeakMap<Item, { lo: number; hi: number; starts: number[] }>();
export function startsOf(item: Item, from: number, to: number): number[] {
  if (!isOnTimeline(item)) return [];
  let c = startsCache.get(item);
  if (!c || from < c.lo || to > c.hi) {
    const p = parsed(item);
    if (p?.kind !== 'ok' || !item.schedule) return [];
    const lo = from - DAY, hi = Math.max(to, from + 11 * DAY);
    c = { lo, hi, starts: startsBetween(p.spec, item.schedule.tz, lo, hi) };
    startsCache.set(item, c);
  }
  const a = c.starts;
  let lo = 0, hi = a.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < from) lo = m + 1;
    else hi = m;
  }
  const out: number[] = [];
  for (let i = lo; i < a.length && a[i] < to; i++) out.push(a[i]);
  return out;
}

/** Runs indexed by job/pipeline id and, for runs without one, by name; built once per runs array. */
const indexCache = new WeakMap<Run[], Map<string, Run[]>>();
function runIndex(runs: Run[]): Map<string, Run[]> {
  let idx = indexCache.get(runs);
  if (idx) return idx;
  idx = new Map();
  for (const r of runs) {
    const id = r.type === 'job' ? r.jobId : r.pipelineId;
    const key = id !== undefined && id !== null ? `${r.type}#${id}` : `${r.type}:${r.name}`;
    const list = idx.get(key);
    if (list) list.push(r);
    else idx.set(key, [r]);
  }
  for (const list of idx.values()) list.sort((a, b) => a.startTime - b.startTime);
  indexCache.set(runs, idx);
  return idx;
}

/** The item's loaded runs, oldest first: by jobId / pipelineId when the run has one, else by name. */
export function runsFor(item: Item, runs: Run[]): Run[] {
  const idx = runIndex(runs);
  const byId = idx.get(`${item.type}#${item.id}`) ?? [];
  const byName = idx.get(`${item.type}:${item.name}`) ?? [];
  if (!byName.length) return byId;
  if (!byId.length) return byName;
  return [...byId, ...byName].sort((a, b) => a.startTime - b.startTime);
}

export function lastRun(item: Item, runs: Run[]): Run | undefined {
  const rs = runsFor(item, runs);
  return rs[rs.length - 1];
}

/** Typical runtime: the newest run's usual duration, else the last finished run's, else a 10-minute estimate. */
export function typicalSec(item: Item, runs: Run[]): { sec: number; estimated: boolean } {
  const rs = runsFor(item, runs);
  const newest = rs[rs.length - 1];
  if (newest && newest.usualSec > 0) return { sec: newest.usualSec, estimated: false };
  for (let i = rs.length - 1; i >= 0; i--) {
    const r = rs[i];
    if (!r.live && r.durationSec > 0) return { sec: r.durationSec, estimated: false };
  }
  return { sec: 600, estimated: true };
}

export type Pill = ReturnType<typeof triggerPill>;

/**
 * The trigger pill, computed once per item and minute (each call looks 8 days ahead for the next start, and the list,
 * the pane and the search all ask for it on every render).
 */
const pillCache = new WeakMap<Item, { minute: number; pill: Pill }>();
export function pillOf(item: Item, now: number): Pill {
  const minute = Math.floor(now / 60e3);
  const c = pillCache.get(item);
  if (c && c.minute === minute) return c.pill;
  const pill = triggerPill(item, now);
  pillCache.set(item, { minute, pill });
  return pill;
}

/** Search text per item: name, id, run-as, creator, k:v tags and the pill text (of the same minute as pillOf), lower-cased. */
const hayCache = new WeakMap<Item, { minute: number; text: string }>();
function haystack(item: Item, now: number): string {
  const minute = Math.floor(now / 60e3);
  const c = hayCache.get(item);
  if (c && c.minute === minute) return c.text;
  const tags = Object.entries(item.tags).map(([k, v]) => `${k}:${v}`).join(' ');
  const text = [item.name, item.id, item.runAs ?? '', item.creator ?? '', tags, pillOf(item, now).text].join(' ').toLowerCase();
  hayCache.set(item, { minute, text });
  return text;
}

export function filterItems(items: Item[], f: ItemFilters, sched: { from: number; to: number; type?: 'job' | 'pipeline' } | null, now = Date.now()): Item[] {
  const toks = f.query.toLowerCase().split(/\s+/).filter(Boolean);
  const tags = f.tags.map((t) => {
    const i = t.indexOf(':');
    return [t.slice(0, i), t.slice(i + 1)] as const;
  });
  return items.filter((it) => {
    if (f.type !== 'all' && it.type !== f.type) return false;
    if (f.scope === 'mine' && !it.mine) return false;
    if (f.scope === 'deployed' && !it.deployed) return false;
    for (const [k, v] of tags) if (it.tags[k] !== v) return false;
    if (toks.length) {
      const hay = haystack(it, now);
      if (!toks.every((t) => hay.includes(t))) return false;
    }
    if (sched && ((sched.type && it.type !== sched.type) || !startsOf(it, sched.from, sched.to).length)) return false;
    return true;
  });
}

const byName = (a: Item, b: Item) =>
  bareName(a.name).localeCompare(bareName(b.name), undefined, { sensitivity: 'base', numeric: true }) || a.name.localeCompare(b.name);

export function sortItems(items: Item[], sort: ItemFilters['sort'], runs: Run[], now: number): Item[] {
  const out = [...items];
  if (sort === 'name') return out.sort(byName);
  const lt = new Map(out.map((it) => [it, lastRun(it, runs)?.startTime ?? 0]));
  const last = (it: Item) => lt.get(it) ?? 0;
  if (sort === 'last') return out.sort((a, b) => last(b) - last(a) || byName(a, b));
  if (sort === 'failed') {
    const lf = new Map(out.map((it) => [it, runsFor(it, runs).reduce((m, r) => (r.result === 'failed' ? Math.max(m, r.startTime) : m), 0)]));
    const failed = (it: Item) => lf.get(it) ?? 0;
    return out.sort((a, b) => failed(b) - failed(a) || last(b) - last(a) || byName(a, b));
  }
  const nx = new Map(out.map((it) => [it, startsOf(it, now, now + 8 * DAY)[0] ?? Infinity]));
  const next = (it: Item) => nx.get(it) ?? Infinity;
  return out.sort((a, b) => (next(a) === next(b) ? 0 : next(a) < next(b) ? -1 : 1) || byName(a, b));
}

export function typeCounts(items: Item[]): { all: number; job: number; pipeline: number } {
  let job = 0;
  for (const it of items) if (it.type === 'job') job++;
  return { all: items.length, job, pipeline: items.length - job };
}

export function scopeCounts(items: Item[]): { mine: number; deployed: number; all: number } {
  let mine = 0, deployed = 0;
  for (const it of items) {
    if (it.mine) mine++;
    if (it.deployed) deployed++;
  }
  return { mine, deployed, all: items.length };
}

export function tagCounts(items: Item[]): { value: string; count: number }[] {
  const pairs = new Map<string, number>();
  for (const it of items) for (const [k, v] of Object.entries(it.tags)) pairs.set(`${k}:${v}`, (pairs.get(`${k}:${v}`) ?? 0) + 1);
  return [...pairs.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([value, count]) => ({ value, count }));
}
