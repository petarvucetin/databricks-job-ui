import type { Item, Schedule } from './types';

/** Parsed Quartz cron: allowed values per field; `domAny`/`dowAny` when the field is * or ?. */
export interface CronSpec {
  sec: number[];
  min: number[];
  hour: number[];
  dom: Set<number>;
  domAny: boolean;
  month: Set<number>;
  dow: Set<number>;
  dowAny: boolean;
  years: Set<number> | null;
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** One field: * ? n a-b a/b, star-slash-b, a-b/c and lists; names for month (1-12) and day-of-week (1-7, SUN = 1). null = unsupported. */
function field(raw: string, lo: number, hi: number, names?: string[]): { values: number[]; any: boolean } | null {
  if (raw === '*' || raw === '?') return { values: range(lo, hi, 1), any: true };
  const out = new Set<number>();
  const num = (s: string): number | null => {
    const up = s.toUpperCase();
    if (names) {
      const i = names.indexOf(up);
      if (i >= 0) return i + 1;
    }
    if (!/^\d+$/.test(s)) return null;
    const n = Number(s);
    return n >= lo && n <= hi ? n : null;
  };
  for (const part of raw.split(',')) {
    const m = /^([^/]+)(?:\/(\d+))?$/.exec(part);
    if (!m) return null;
    const step = m[2] ? Number(m[2]) : 1;
    if (step < 1) return null;
    let a: number | null;
    let b: number | null;
    if (m[1] === '*') {
      a = lo;
      b = hi;
    } else if (m[1].includes('-')) {
      const [x, y] = m[1].split('-');
      a = num(x);
      b = num(y);
    } else {
      a = num(m[1]);
      b = m[2] ? hi : a;
    }
    if (a === null || b === null || a > b) return null;
    for (const v of range(a, b, step)) out.add(v);
  }
  return { values: [...out].sort((x, y) => x - y), any: false };
}

function range(a: number, b: number, step: number): number[] {
  const out: number[] = [];
  for (let v = a; v <= b; v += step) out.push(v);
  return out;
}

export function parseQuartz(expr: string): CronSpec | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 6 && f.length !== 7) return null;
  // L, W and # are unsupported; strip the month/day names that contain those letters before checking
  if (f.some((x) => /[LW#]/i.test(x.replace(/JUL|WED/gi, '')))) return null;
  const sec = field(f[0], 0, 59);
  const min = field(f[1], 0, 59);
  const hour = field(f[2], 0, 23);
  const dom = field(f[3], 1, 31);
  const month = field(f[4], 1, 12, MONTHS);
  const dow = field(f[5], 1, 7, DAYS);
  const year = f[6] === undefined || f[6] === '*' ? null : field(f[6], 1970, 2199);
  if (!sec || !min || !hour || !dom || !month || !dow || (f[6] !== undefined && f[6] !== '*' && !year)) return null;
  return {
    sec: sec.values, min: min.values, hour: hour.values,
    dom: new Set(dom.values), domAny: dom.any,
    month: new Set(month.values),
    dow: new Set(dow.values), dowAny: dow.any,
    years: year ? new Set(year.values) : null,
  };
}

// ---- time zones: wall time in `tz` -> epoch ms, DST-correct, offsets cached per zone and day ----
const fmts = new Map<string, Intl.DateTimeFormat>();
function fmt(tz: string): Intl.DateTimeFormat {
  let f = fmts.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' });
    fmts.set(tz, f);
  }
  return f;
}
/** Wall-clock parts of `t` in `tz`. */
function parts(t: number, tz: string): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  const p: Record<string, number> = {};
  for (const x of fmt(tz).formatToParts(new Date(t))) if (x.type !== 'literal') p[x.type] = Number(x.value);
  return { y: p.year, mo: p.month, d: p.day, h: p.hour, mi: p.minute, s: p.second };
}
/** Offset of `tz` at `t` in ms (local - UTC). */
function offsetAt(t: number, tz: string): number {
  const p = parts(t, tz);
  return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(t / 1000) * 1000;
}
const dayOffsets = new Map<string, [number, number]>();
/** Epoch ms of a wall time in `tz`. In a DST gap it lands an hour later; in an overlap it takes the first occurrence. */
function zoned(y: number, mo: number, d: number, h: number, mi: number, s: number, tz: string): number {
  const key = `${tz}|${y}-${mo}-${d}`;
  let offs = dayOffsets.get(key);
  if (!offs) {
    // Before local midnight and after the next local midnight for any offset in -12..+14, so a transition day shows.
    offs = [offsetAt(Date.UTC(y, mo - 1, d) - 14 * 3600e3, tz), offsetAt(Date.UTC(y, mo - 1, d + 1) + 12 * 3600e3, tz)];
    dayOffsets.set(key, offs);
  }
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  if (offs[0] === offs[1]) return guess - offs[0];
  // DST day: try both offsets, keep the earliest that reads back as the asked wall time, else the later offset
  const cands = [guess - offs[0], guess - offs[1]].sort((a, b) => a - b);
  for (const t of cands) {
    const p = parts(t, tz);
    if (p.h === h && p.mi === mi && p.d === d) return t;
  }
  return guess - Math.min(offs[0], offs[1]);
}

/** Start times in [from, to), ascending. Walks local days in `tz`, never minutes. */
export function startsBetween(spec: CronSpec, tz: string, from: number, to: number): number[] {
  const out: number[] = [];
  const p0 = parts(from - 24 * 3600e3, tz);
  let day = Date.UTC(p0.y, p0.mo - 1, p0.d);
  const last = to + 2 * 24 * 3600e3;
  for (; day <= last; day += 24 * 3600e3) {
    const dt = new Date(day);
    const y = dt.getUTCFullYear(), mo = dt.getUTCMonth() + 1, d = dt.getUTCDate(), wd = dt.getUTCDay() + 1;
    if (spec.years && !spec.years.has(y)) continue;
    if (!spec.month.has(mo)) continue;
    if (!spec.domAny && !spec.dom.has(d)) continue;
    if (!spec.dowAny && !spec.dow.has(wd)) continue;
    if (d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) continue;
    for (const h of spec.hour) for (const mi of spec.min) for (const s of spec.sec) {
      const t = zoned(y, mo, d, h, mi, s, tz);
      if (t >= from && t < to) out.push(t);
    }
  }
  return [...new Set(out)].sort((a, b) => a - b);
}

export function scheduleOf(s: Schedule): { kind: 'ok'; spec: CronSpec } | { kind: 'unparsed' } {
  const spec = parseQuartz(s.cron);
  if (!spec) return { kind: 'unparsed' };
  try {
    fmt(s.tz).format(0);
  } catch {
    return { kind: 'unparsed' };
  }
  return { kind: 'ok', spec };
}

const pad = (n: number) => String(n).padStart(2, '0');
const hm = (t: number) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
/** Evenly spaced from its first value with step k (k > 1), covering the field. */
function stepOf(vals: number[], span: number): number | null {
  if (vals.length < 2) return null;
  const k = vals[1] - vals[0];
  return vals.every((v, i) => v === vals[0] + i * k) && vals[0] < k && vals[vals.length - 1] + k >= span ? k : null;
}

/**
 * The short trigger pill. Times are the viewer's local time; the cron and its zone go in the title. `starters`: for a
 * pipeline credited to the scheduled jobs that start it through a pipeline task, those jobs (the first one's pill shows).
 * A continuous pipeline, or one with its own schedule, keeps its own pill.
 */
export function triggerPill(item: Item, now: number, starters?: Item[]): { text: string; cls: 'sched' | 'cont' | 'none' | 'paused'; title: string } {
  const ownTrigger = item.trigger === 'continuous' || (item.trigger === 'schedule' && !!item.schedule);
  if (starters?.length && !ownTrigger) {
    return { text: `${triggerPill(starters[0], now).text} · by job`, cls: 'sched', title: `Started by the pipeline task of ${starters.map((j) => j.name).join(', ')}` };
  }
  if (item.trigger === 'continuous' && item.paused) return { text: 'paused', cls: 'paused', title: 'Continuous, paused' };
  if (item.trigger === 'continuous') return { text: 'continuous', cls: 'cont', title: 'Continuous: always on, no scheduled starts' };
  if (item.paused) return { text: 'paused', cls: 'paused', title: `Trigger paused${item.schedule ? ` (cron ${item.schedule.cron}, ${item.schedule.tz})` : ''}` };
  if (item.trigger === 'periodic' && item.periodic) {
    const u = { HOURS: 'h', DAYS: 'd', WEEKS: 'w' }[item.periodic.unit];
    return { text: `every ${item.periodic.interval}${u} (periodic)`, cls: 'none', title: 'Periodic trigger: no fixed start times' };
  }
  if (item.trigger === 'file_arrival') return { text: 'file arrival', cls: 'none', title: 'Starts when new files arrive' };
  if (item.trigger === 'table_update') return { text: 'table update', cls: 'none', title: 'Starts when a source table changes' };
  if (item.trigger !== 'schedule' || !item.schedule) return { text: item.type === 'pipeline' ? 'triggered' : 'manual', cls: 'none', title: item.type === 'pipeline' ? 'Triggered pipeline: runs when started (by a job, the API or a user)' : 'No schedule or trigger' };
  const title = `cron ${item.schedule.cron} (${item.schedule.tz})`;
  const parsed = scheduleOf(item.schedule);
  if (parsed.kind === 'unparsed') return { text: `cron ${item.schedule.cron}`, cls: 'sched', title: `${title}: not understood, left off the timeline` };
  const s = parsed.spec;
  const next = startsBetween(s, item.schedule.tz, now, now + 8 * 24 * 3600e3);
  const everyDay = s.domAny && s.dowAny && s.month.size === 12;
  const single = s.sec.length === 1;
  if (single && next.length && everyDay) {
    if (s.hour.length === 1 && s.min.length === 1) return { text: `daily ${hm(next[0])}`, cls: 'sched', title };
    if (s.hour.length === 24 && s.min.length === 1) return { text: `hourly · :${pad(new Date(next[0]).getMinutes())}`, cls: 'sched', title };
    const km = stepOf(s.min, 60);
    if (s.hour.length === 24 && km) return { text: `every ${km}m`, cls: 'sched', title };
    const kh = stepOf(s.hour, 24);
    if (kh && s.min.length === 1) {
      const first = startsBetween(s, item.schedule.tz, now - 24 * 3600e3, now + 24 * 3600e3).find((t) => new Date(t).getHours() < kh) ?? next[0];
      return { text: `every ${kh}h · ${hm(first)}`, cls: 'sched', title };
    }
  }
  if (single && next.length && s.domAny && !s.dowAny && s.dow.size === 1 && s.hour.length === 1 && s.min.length === 1) {
    return { text: `${new Date(next[0]).toLocaleDateString('en-US', { weekday: 'short' })} ${hm(next[0])}`, cls: 'sched', title };
  }
  return { text: `cron ${item.schedule.cron}`, cls: 'sched', title };
}
