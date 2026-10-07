# Jobs & ETL Tab Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Jobs & ETL" tab that lists job and pipeline definitions, with a schedule timeline, a List · Load switch and an on-demand detail pane. The existing screen becomes the "Runs" tab, unchanged.

**Architecture:** New server endpoints `/api/items` and `/api/items/:type/:id` sit behind the existing `RunSource` (mock, live and replay). Live mode adds two `LiveApi` calls (`jobs/list`, `jobs/get`). Schedules are Quartz cron, evaluated on the client by a shared `cron.ts`. The client lifts the runs data to `App` so both tabs share one list. The new screen is ported 1:1 from the approved mockup.

**Tech Stack:** TypeScript, React 19, Express via AppKit 0.57, `@databricks/sdk-experimental`, vitest + @testing-library/react (jsdom), tsdown.

**Spec:** `docs/superpowers/specs/2026-10-06-jobs-etl-tab.md`. **Mockup (source of truth for markup, CSS and behaviour):** `docs/design/mockups/jobs-etl-tab.html`. Port its CSS and markup; ignore its mockup-only parts: `.mock-sw` (state/data switch), `synth()`, `setScale`, the Density/Gantt code, `#gantt`/`#density`/`#10k` hash handling, and `renderGantt`/`renderDensity`.

## Global Constraints

- Work in `D:\AI\projects\databricks-UI\jobs-console` (the app). Commands run there unless noted.
- Files are **CRLF**. Edit with the Edit tool, never `sed -i` (it rewrites whole files). New files may use LF; match neighbours where easy.
- Commit with pathspecs only: `git commit -m "..." -- <paths>`. Never `git add -A` (parallel agents share the index). End messages with:
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` and `Claude-Session: https://claude.ai/code/session_01WzA2wK2v4bKetURLkeyhEG`
- Checks: `npm test` (vitest, TZ=UTC), `npm run typecheck`, `npm run lint`. All three must pass at the end of every task.
- The Runs screen (`AttentionView`, `Timeline.tsx`, `timeline.css` behaviour) must not change visually. Only its data plumbing changes (Task 4).
- No new npm dependencies.
- Copy rules (UI text, verbatim from the spec/mockup): tabs `Jobs & ETL` and `Runs`; switch `List` / `Load`; card title `Scheduled starts by hour` / `Scheduled starts by day`; button `See runs →`; footer link `clear schedule filter ✕`; Load hint `drag across the chart to list the jobs running then`.
- List view renders ≤ 300 rows; Load selection list renders ≤ 200 rows; each is followed by a `+N more — …` note.

## Review Focus

1. **A cron string the parser doesn't understand** (`0 0 12 L * ?`, `0 15 10 ? * 6#3`), or an invalid `timezone_id`. Expected: the pill shows `cron <expr>`, the item is left off the timeline and the Load curve, the footer counts it, and nothing throws. Tests: Task 1 (`parseQuartz` returns null; `scheduleOf` returns `unparsed`), Task 5 (footer count).
2. **DST change day** in a non-UTC zone (America/Los_Angeles, 2026-03-08 / 2026-11-01). Expected: a daily 02:30 job fires once on the fall-back day, and skips (or shifts by an hour) on the spring-forward day, with no duplicate or missing day elsewhere. Test: Task 1.
3. **Huge workspace / slow API:** `jobs/list` runs out of the items budget. Expected: a 200 with `partial` and the items read so far, never a 502. Tests: Task 2 (fakeApi with a delay and a small budget).
4. **A job with no runs loaded** (new or never run). Expected: last run shows `—` and "no runs in window", Load uses the 10-minute default marked "estimate", and the pane says "No runs in the loaded window". Tests: Task 5, Task 6.
5. **Paused schedule / periodic / file-arrival / continuous job.** Expected: the correct pill (`paused`, `every 4h (periodic)`, `file arrival`, `continuous`), and the item is left off the timeline and the Load curve. Tests: Task 1 (`triggerPill`), Task 5.

---

## File structure

**Shared**
- `shared/domain/types.ts` (modify): add `TriggerKind`, `Schedule`, `Item`, `ItemsResponse`, `ItemDetail`.
- `shared/domain/cron.ts` (create): Quartz parse, time-zone-correct start times, pill text.
- `shared/domain/cron.test.ts` (create).

**Server**
- `server/data/live/api.ts` (modify): `listJobs`, `getJob` on `LiveApi` + `createSdkApi`.
- `server/data/live/fakeApi.ts` (modify): `jobs`, `jobsById` fake data; the two methods.
- `server/data/live/items.ts` (create): pure mappers `jobItem`, `pipelineItem`, `jobDetail`, `pipelineDetail` + `createLiveItems`.
- `server/data/live/items.test.ts` (create).
- `server/data/live/limits.ts` (modify): `itemsTimeoutMs` (env `JOBS_CONSOLE_ITEMS_TIMEOUT_MS`, default 30000).
- `server/data/live/links.ts` (modify): `jobUrl`, `pipelineUrl`.
- `server/data/live/liveRunSource.ts` (modify): `LiveState.items` cache; compose `createLiveItems` into the returned source.
- `server/data/runSource.ts` (modify): `listItems()`, `getItem(type, id)` on `RunSource`.
- `server/data/mock/mockItems.ts` (create) + `mockItems.test.ts`; `server/data/mock/mockRunSource.ts` (modify).
- `server/data/capture/replayApi.ts` (modify): `METHODS` += `listJobs`, `getJob`.
- `server/data/capture/replayProvider.ts` (modify): wrapper forwards `listItems`, `getItem`.
- `server/data/capture/sweep.ts` (modify): also reads items.
- `server/api/listItems.ts`, `server/api/getItem.ts` (create) + tests; `server/server.ts` (modify): routes.

**Client**
- `client/src/App.tsx` (modify): tabs, shared runs, focus.
- `client/src/hooks/useRunsData.ts` (create): lifted from `AttentionPage`.
- `client/src/components/Shell.tsx` + `shell.css` (modify): tabs.
- `client/src/pages/AttentionPage.tsx`, `AttentionView.tsx` (modify): take shared data + `focus`.
- `client/src/hooks/useItems.ts`, `client/src/hooks/useItemDetail.ts` (create).
- `client/src/model/items.ts`, `client/src/model/schedule.ts`, `client/src/model/load.ts` (create) + tests.
- `client/src/pages/JobsPage.tsx`, `client/src/pages/jobs.css` (create).
- `client/src/components/ItemsFilterBar.tsx`, `ScheduleTimeline.tsx`, `ItemList.tsx`, `LoadView.tsx`, `ItemPane.tsx` (create) + `client/src/pages/JobsPage.test.tsx`.

---

### Task 1: Shared types and Quartz cron

**Files:**
- Modify: `shared/domain/types.ts` (append at end)
- Create: `shared/domain/cron.ts`, `shared/domain/cron.test.ts`

**Interfaces:**
- Produces:
  - Types `TriggerKind`, `Schedule`, `Item`, `ItemsResponse`, `ItemDetail`, exactly as in the spec's "Shared types" block. Copy it verbatim; `DataSource` already exists in types.ts.
  - `parseQuartz(expr: string): CronSpec | null`
  - `startsBetween(spec: CronSpec, tz: string, from: number, to: number): number[]` (epoch ms, ascending, `from <= t < to`)
  - `scheduleOf(s: Schedule): { kind: 'ok'; spec: CronSpec } | { kind: 'unparsed' }` (also `unparsed` for an invalid tz)
  - `triggerPill(item: Item, now: number): { text: string; cls: 'sched' | 'cont' | 'none' | 'paused'; title: string }`

- [ ] **Step 1: Append the shared types** to `shared/domain/types.ts`, copied verbatim from the spec section "Shared types".

- [ ] **Step 2: Write the failing tests** `shared/domain/cron.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { parseQuartz, startsBetween, scheduleOf, triggerPill } from './cron';
import type { Item } from './types';

const T = (iso: string) => Date.parse(iso);
const item = (over: Partial<Item>): Item => ({ type: 'job', id: '1', name: 'j', deployed: false, mine: false, tags: {}, trigger: 'manual', paused: false, bundle: false, ...over });

describe('parseQuartz', () => {
  it('parses the common shapes', () => {
    expect(parseQuartz('0 0 2 * * ?')).not.toBeNull();
    expect(parseQuartz('0 15 */6 * * ?')).not.toBeNull();
    expect(parseQuartz('0 0/15 * * * ?')).not.toBeNull();
    expect(parseQuartz('0 0 3 ? * SUN')).not.toBeNull();
    expect(parseQuartz('0 30 9 ? * MON-FRI 2026')).not.toBeNull();
    expect(parseQuartz('0 0 0 1,15 JAN-MAR ?')).not.toBeNull();
  });
  it('rejects what it does not support', () => {
    for (const e of ['0 0 12 L * ?', '0 15 10 ? * 6#3', '0 0 12 15W * ?', '0 0 12 * *', 'nonsense', '0 61 * * * ?', '']) expect(parseQuartz(e)).toBeNull();
  });
});

describe('startsBetween', () => {
  it('daily 02:00 UTC over two days', () => {
    const s = parseQuartz('0 0 2 * * ?')!;
    expect(startsBetween(s, 'UTC', T('2026-10-06T00:00:00Z'), T('2026-10-08T00:00:00Z'))).toEqual([T('2026-10-06T02:00:00Z'), T('2026-10-07T02:00:00Z')]);
  });
  it('every 15 minutes gives 96 a day', () => {
    const s = parseQuartz('0 0/15 * * * ?')!;
    expect(startsBetween(s, 'UTC', T('2026-10-06T00:00:00Z'), T('2026-10-07T00:00:00Z'))).toHaveLength(96);
  });
  it('every 6 hours from 04:15', () => {
    const s = parseQuartz('0 15 4/6 * * ?')!;
    expect(startsBetween(s, 'UTC', T('2026-10-06T00:00:00Z'), T('2026-10-07T00:00:00Z'))).toEqual(['04:15', '10:15', '16:15', '22:15'].map((h) => T(`2026-10-06T${h}:00Z`)));
  });
  it('day of week (Quartz SUN = 1) in a time zone', () => {
    const s = parseQuartz('0 0 3 ? * SUN')!;
    // Sunday 2026-10-11 03:00 in Los Angeles (PDT, UTC-7) = 10:00Z
    expect(startsBetween(s, 'America/Los_Angeles', T('2026-10-05T00:00:00Z'), T('2026-10-13T00:00:00Z'))).toEqual([T('2026-10-11T10:00:00Z')]);
  });
  it('fall-back day in Los Angeles: a daily 02:30 fires once', () => {
    const s = parseQuartz('0 30 2 * * ?')!;
    const out = startsBetween(s, 'America/Los_Angeles', T('2026-10-31T12:00:00Z'), T('2026-11-03T12:00:00Z'));
    expect(out).toEqual([T('2026-11-01T09:30:00Z'), T('2026-11-02T10:30:00Z'), T('2026-11-03T10:30:00Z')]);
  });
  it('spring-forward day: no duplicate, other days intact', () => {
    const s = parseQuartz('0 30 2 * * ?')!;
    const out = startsBetween(s, 'America/Los_Angeles', T('2026-03-07T00:00:00Z'), T('2026-03-10T00:00:00Z'));
    expect(new Set(out).size).toBe(out.length);
    expect(out).toContain(T('2026-03-07T10:30:00Z'));
    expect(out).toContain(T('2026-03-09T09:30:00Z'));
  });
  it('year field limits', () => {
    const s = parseQuartz('0 0 1 * * ? 2025')!;
    expect(startsBetween(s, 'UTC', T('2026-01-01T00:00:00Z'), T('2026-01-05T00:00:00Z'))).toEqual([]);
  });
});

describe('scheduleOf', () => {
  it('unparsed for L/W/# and for an unknown zone', () => {
    expect(scheduleOf({ cron: '0 0 12 L * ?', tz: 'UTC', paused: false }).kind).toBe('unparsed');
    expect(scheduleOf({ cron: '0 0 2 * * ?', tz: 'Mars/Olympus', paused: false }).kind).toBe('unparsed');
    expect(scheduleOf({ cron: '0 0 2 * * ?', tz: 'UTC', paused: false }).kind).toBe('ok');
  });
});

describe('triggerPill', () => {
  const now = T('2026-10-06T16:16:00Z');
  const sched = (cron: string, paused = false) => item({ trigger: 'schedule', schedule: { cron, tz: 'UTC', paused }, paused });
  it('describes schedule shapes in local time (TZ=UTC in tests)', () => {
    expect(triggerPill(sched('0 0 2 * * ?'), now).text).toBe('daily 02:00');
    expect(triggerPill(sched('0 45 * * * ?'), now).text).toBe('hourly · :45');
    expect(triggerPill(sched('0 15 4/6 * * ?'), now).text).toBe('every 6h · 04:15');
    expect(triggerPill(sched('0 0/15 * * * ?'), now).text).toBe('every 15m');
    expect(triggerPill(sched('0 0 3 ? * SUN'), now).text).toBe('Sun 03:00');
    expect(triggerPill(sched('0 0 12 L * ?'), now).text).toBe('cron 0 0 12 L * ?');
    expect(triggerPill(sched('0 0 2 * * ?', true), now)).toMatchObject({ text: 'paused', cls: 'paused' });
  });
  it('other triggers', () => {
    expect(triggerPill(item({ trigger: 'periodic', periodic: { interval: 4, unit: 'HOURS' } }), now).text).toBe('every 4h (periodic)');
    expect(triggerPill(item({ trigger: 'file_arrival' }), now).text).toBe('file arrival');
    expect(triggerPill(item({ trigger: 'table_update' }), now).text).toBe('table update');
    expect(triggerPill(item({ trigger: 'continuous' }), now)).toMatchObject({ text: 'continuous', cls: 'cont' });
    expect(triggerPill(item({ trigger: 'manual' }), now)).toMatchObject({ text: 'manual', cls: 'none' });
    expect(triggerPill(item({ type: 'pipeline', trigger: 'manual' }), now).text).toBe('triggered');
  });
});
```

- [ ] **Step 3: Run and see it fail.** Run `npx vitest run shared/domain/cron.test.ts`. Expected: FAIL, cannot resolve `./cron`.

- [ ] **Step 4: Implement** `shared/domain/cron.ts`:

```ts
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

/** One field: * ? n a-b a/b */b a-b/c and lists; names for month (1-12) and day-of-week (1-7, SUN = 1). null = unsupported. */
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
    const noon = Date.UTC(y, mo - 1, d, 12);
    offs = [offsetAt(noon - 12 * 3600e3 - 3600e3 * 2, tz), offsetAt(noon + 12 * 3600e3, tz)];
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

/** The short trigger pill. Times are the viewer's local time; the cron and its zone go in the title. */
export function triggerPill(item: Item, now: number): { text: string; cls: 'sched' | 'cont' | 'none' | 'paused'; title: string } {
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
```

- [ ] **Step 5: Run the tests until they pass.** Run `npx vitest run shared/domain/cron.test.ts`. Expected: all PASS. If the DST expectations fail, fix `zoned`; do not change the tests. The fall-back case must produce exactly one 2026-11-01 start.

- [ ] **Step 6: Check and commit.** Run `npm run typecheck && npm run lint`, then:

```bash
git commit -m "Shared Item types and a Quartz cron evaluator (time-zone and DST correct, pill text)" -- shared/domain/types.ts shared/domain/cron.ts shared/domain/cron.test.ts
```

---

### Task 2: Server: live items (jobs/list, jobs/get, pipelines) with their own budget

**Files:**
- Modify: `server/data/live/api.ts`, `server/data/live/fakeApi.ts`, `server/data/live/limits.ts`, `server/data/live/links.ts`, `server/data/live/liveRunSource.ts`, `server/data/runSource.ts`
- Create: `server/data/live/items.ts`, `server/data/live/items.test.ts`

**Interfaces:**
- Consumes: `Item`, `ItemsResponse`, `ItemDetail` (Task 1).
- Produces:
  - `LiveApi.listJobs(req: jobs.ListJobsRequest): Promise<jobs.ListJobsResponse>` → `page('/api/2.2/jobs/list', {...req})`
  - `LiveApi.getJob(req: jobs.GetJobRequest): Promise<jobs.Job>` → `client.jobs.get(req)`
  - `RunSource.listItems(): Promise<ItemsResponse>`; `RunSource.getItem(type: 'job' | 'pipeline', id: string): Promise<ItemDetail>` (throws `SourceError(404)` for unknown).
  - `LiveLimits.itemsTimeoutMs` (default 30000, env `JOBS_CONSOLE_ITEMS_TIMEOUT_MS`).
  - `LiveState.items: Map<string, { at: number; data: ItemsResponse }>` (TTL 5 min, per `userKey`).
  - `FakeData.jobs?: jobs.BaseJob[]`, `FakeData.jobPageSize?: number`, `FakeData.jobsById?: Record<number, jobs.Job>`.

- [ ] **Step 1: Extend the API surface.**
  - `api.ts`: add both methods to the `LiveApi` interface (doc comments matching neighbours) and to `createSdkApi`.
  - `limits.ts`: add `itemsTimeoutMs: number` to `LiveLimits`, `itemsTimeoutMs: 30000` to `DEFAULT_LIMITS`, and `itemsTimeoutMs: 'JOBS_CONSOLE_ITEMS_TIMEOUT_MS'` to `ENV`.
  - `links.ts`: next to `jobRunUrl`, add `jobUrl(host, jobId)` → `<origin>/jobs/<id>` and `pipelineUrl(host, pipelineId)` → `<origin>/pipelines/<id>`. Keep the `?o=` handling the run links use; return `undefined` when the host is ''.
  - `fakeApi.ts`: add `jobs`, `jobPageSize` (default 100), `jobsById` to `FakeData`. Add `listJobs`, paged by numeric `page_token` exactly like `listJobRuns` (returns `{ jobs: slice, next_page_token, has_more }`). Add `getJob`, which returns `data.jobsById[job_id]` or throws an error shaped like the existing 404 in `getRun` (copy whatever `getRun` throws for a missing id).
  - `runSource.ts`: add the two methods to `RunSource` with doc comments. Typecheck will now fail in mock, live and replay; Tasks 2 and 3 fix that.

- [ ] **Step 2: Write the failing tests** `server/data/live/items.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import type { jobs, pipelines } from '@databricks/sdk-experimental';
import { jobItem, pipelineItem, createLiveItems } from './items';
import { fakeApi } from './fakeApi';
import { createLiveState } from './liveRunSource';
import { DEFAULT_LIMITS } from './limits';

const ME = 'me@x.com';
const SP = '7c1e9a40-2b3d-4f6e-9a1c-0d5e8b7f2a91';
const job = (id: number, settings: jobs.JobSettings, creator = ME): jobs.BaseJob => ({ job_id: id, creator_user_name: creator, settings: { name: `job_${id}`, ...settings } });

describe('jobItem', () => {
  it('maps schedule, run as, bundle, tags', () => {
    const it1 = jobItem(job(1, { schedule: { quartz_cron_expression: '0 0 2 * * ?', timezone_id: 'UTC', pause_status: 'UNPAUSED' }, run_as: { service_principal_name: SP }, deployment: { kind: 'BUNDLE' }, tags: { project: 'aiges' }, description: 'd' }, 'other@x.com'), ME, 'https://h.example');
    expect(it1).toMatchObject({ type: 'job', id: '1', name: 'job_1', trigger: 'schedule', schedule: { cron: '0 0 2 * * ?', tz: 'UTC', paused: false }, runAs: SP, deployed: true, mine: false, bundle: true, tags: { project: 'aiges' }, description: 'd', paused: false });
    expect(it1.url).toBe('https://h.example/jobs/1');
  });
  it('trigger precedence and pause', () => {
    expect(jobItem(job(2, { continuous: { pause_status: 'UNPAUSED' }, schedule: { quartz_cron_expression: '0 0 2 * * ?', timezone_id: 'UTC' } }), ME, '').trigger).toBe('continuous');
    expect(jobItem(job(3, { trigger: { periodic: { interval: 4, unit: 'HOURS' } } }), ME, '')).toMatchObject({ trigger: 'periodic', periodic: { interval: 4, unit: 'HOURS' } });
    expect(jobItem(job(4, { trigger: { file_arrival: { url: 's3://x' }, pause_status: 'PAUSED' } }), ME, '')).toMatchObject({ trigger: 'file_arrival', paused: true });
    expect(jobItem(job(5, { trigger: { table_update: { table_names: ['a.b.c'] } } }), ME, '').trigger).toBe('table_update');
    expect(jobItem(job(6, {}), ME, '')).toMatchObject({ trigger: 'manual', mine: true, runAs: ME, deployed: false });
    expect(jobItem(job(7, { schedule: { quartz_cron_expression: '0 0 2 * * ?', timezone_id: 'UTC', pause_status: 'PAUSED' } }), ME, '').paused).toBe(true);
  });
});

describe('pipelineItem', () => {
  it('continuous vs triggered, from the spec', () => {
    const p: pipelines.PipelineStateInfo = { pipeline_id: 'p1', name: 'pipe', creator_user_name: 'a@x.com', run_as_user_name: SP };
    const spec = { spec: { continuous: true, deployment: { kind: 'BUNDLE' } } } as pipelines.GetPipelineResponse;
    expect(pipelineItem(p, spec, ME, '')).toMatchObject({ type: 'pipeline', id: 'p1', trigger: 'continuous', deployed: true, bundle: true, mine: false });
    expect(pipelineItem(p, undefined, ME, '').trigger).toBe('manual');
  });
});

describe('createLiveItems', () => {
  const base = { user: () => Promise.resolve(ME), userKey: 'u', limits: DEFAULT_LIMITS, clock: () => 1_000_000 };
  it('reads every jobs/list page and the pipelines, and caches', async () => {
    const api = fakeApi({ jobs: Array.from({ length: 250 }, (_, i) => job(i + 1, {})), jobPageSize: 100, pipelines: [{ pipeline_id: 'p1', name: 'pipe' }], specs: { p1: { spec: { continuous: false } } as pipelines.GetPipelineResponse } });
    const src = createLiveItems({ ...base, api, state: createLiveState() });
    const r = await src.listItems();
    expect(r.items.filter((i) => i.type === 'job')).toHaveLength(250);
    expect(r.items.filter((i) => i.type === 'pipeline')).toHaveLength(1);
    expect(r.partial).toBeUndefined();
    const listCalls = api.calls.filter((c) => c === 'listJobs').length;
    expect(listCalls).toBe(3);
    await src.listItems();
    expect(api.calls.filter((c) => c === 'listJobs').length).toBe(listCalls);
  });
  it('returns partial, not an error, when the items budget runs out', async () => {
    const api = fakeApi({ jobs: Array.from({ length: 500 }, (_, i) => job(i + 1, {})), jobPageSize: 100, delay: 30 });
    const src = createLiveItems({ ...base, clock: Date.now, api, state: createLiveState(), limits: { ...DEFAULT_LIMITS, itemsTimeoutMs: 80 } });
    const r = await src.listItems();
    expect(r.partial).toBeDefined();
    expect(r.items.length).toBeLessThan(500);
  });
  it('getItem: job tasks with deps, pipeline facts, 404 for unknown', async () => {
    const api = fakeApi({
      jobsById: { 9: { job_id: 9, run_as_user_name: SP, settings: { name: 'j9', tasks: [{ task_key: 'a', notebook_task: { notebook_path: '/x' } }, { task_key: 'b', depends_on: [{ task_key: 'a' }], pipeline_task: { pipeline_id: 'p1' } }] } } },
      specs: { p1: { pipeline_id: 'p1', name: 'pipe', spec: { continuous: false, catalog: 'c', schema: 's', serverless: true, channel: 'CURRENT', ingestion_definition: {} } } as pipelines.GetPipelineResponse },
    });
    const src = createLiveItems({ ...base, api, state: createLiveState() });
    const j = await src.getItem('job', '9');
    expect(j.tasks).toEqual([{ key: 'a', type: 'Notebook', dependsOn: [] }, { key: 'b', type: 'Pipeline', dependsOn: ['a'] }]);
    const p = await src.getItem('pipeline', 'p1');
    expect(p.pipeline).toEqual({ kind: 'Ingestion', continuous: false, target: 'c.s', serverless: true, channel: 'CURRENT' });
    await expect(src.getItem('job', '404')).rejects.toMatchObject({ status: 404 });
  });
});
```

- [ ] **Step 3: Run and see it fail.** Run `npx vitest run server/data/live/items.test.ts`. Expected: FAIL, cannot resolve `./items`.

- [ ] **Step 4: Implement** `server/data/live/items.ts`:

```ts
import type { jobs, pipelines } from '@databricks/sdk-experimental';
import type { Item, ItemDetail, ItemsResponse, TriggerKind } from '../../../shared/domain/types';
import type { LiveApi } from './api';
import { Deadline, TIMEOUT, pool } from './collect';
import type { LiveLimits } from './limits';
import { jobUrl, pipelineUrl } from './links';
import { toSourceError, type LiveState } from './liveRunSource';
import { SourceError } from '../sourceError';

const ITEMS_TTL = 5 * 60_000;
const isSp = (s?: string) => !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

export function jobItem(j: jobs.BaseJob | jobs.Job, me: string, host: string): Item {
  const s = j.settings ?? {};
  const id = String(j.job_id ?? '');
  const runAs = s.run_as?.service_principal_name ?? s.run_as?.user_name ?? ('run_as_user_name' in j ? j.run_as_user_name : undefined) ?? j.creator_user_name;
  let trigger: TriggerKind = 'manual';
  let paused = false;
  if (s.continuous) {
    trigger = 'continuous';
    paused = s.continuous.pause_status === 'PAUSED';
  } else if (s.schedule) {
    trigger = 'schedule';
    paused = s.schedule.pause_status === 'PAUSED';
  } else if (s.trigger?.periodic) trigger = 'periodic';
  else if (s.trigger?.file_arrival) trigger = 'file_arrival';
  else if (s.trigger?.table_update) trigger = 'table_update';
  if (s.trigger && trigger !== 'continuous' && trigger !== 'schedule') paused = s.trigger.pause_status === 'PAUSED';
  return {
    type: 'job', id, name: s.name ?? `job ${id}`,
    ...(s.description ? { description: s.description } : {}),
    ...(j.creator_user_name ? { creator: j.creator_user_name } : {}),
    ...(runAs ? { runAs } : {}),
    deployed: !!s.run_as?.service_principal_name || isSp(runAs),
    mine: !!me && (j.creator_user_name === me || runAs === me),
    tags: s.tags ?? {},
    trigger,
    ...(trigger === 'schedule' && s.schedule ? { schedule: { cron: s.schedule.quartz_cron_expression, tz: s.schedule.timezone_id, paused } } : {}),
    ...(trigger === 'periodic' && s.trigger?.periodic ? { periodic: { interval: s.trigger.periodic.interval, unit: s.trigger.periodic.unit } } : {}),
    paused,
    bundle: s.deployment?.kind === 'BUNDLE',
    ...(host ? { url: jobUrl(host, id) } : {}),
  };
}

export function pipelineItem(p: pipelines.PipelineStateInfo, spec: pipelines.GetPipelineResponse | undefined, me: string, host: string): Item {
  const id = p.pipeline_id ?? '';
  const runAs = p.run_as_user_name ?? spec?.run_as_user_name ?? p.creator_user_name;
  const continuous = !!spec?.spec?.continuous;
  return {
    type: 'pipeline', id, name: p.name ?? spec?.name ?? `pipeline ${id}`,
    ...(p.creator_user_name ? { creator: p.creator_user_name } : {}),
    ...(runAs ? { runAs } : {}),
    deployed: isSp(runAs),
    mine: !!me && (p.creator_user_name === me || runAs === me),
    tags: (spec?.spec as { tags?: Record<string, string> } | undefined)?.tags ?? {},
    trigger: continuous ? 'continuous' : 'manual',
    paused: false,
    bundle: spec?.spec?.deployment?.kind === 'BUNDLE',
    ...(host ? { url: pipelineUrl(host, id) } : {}),
  };
}

const TASK_TYPES: [keyof jobs.Task, string][] = [
  ['notebook_task', 'Notebook'], ['spark_python_task', 'Python script'], ['python_wheel_task', 'Python wheel'], ['sql_task', 'SQL'],
  ['pipeline_task', 'Pipeline'], ['run_job_task', 'Run job'], ['dbt_task', 'dbt'], ['spark_jar_task', 'JAR'], ['spark_submit_task', 'Spark submit'],
  ['condition_task', 'Condition'], ['for_each_task', 'For each'], ['clean_rooms_notebook_task', 'Clean room notebook'],
];

export function jobDetail(j: jobs.Job, me: string, host: string): ItemDetail {
  const tasks = (j.settings?.tasks ?? []).map((t) => ({
    key: t.task_key,
    type: TASK_TYPES.find(([k]) => t[k] !== undefined)?.[1] ?? 'Task',
    dependsOn: (t.depends_on ?? []).map((d) => d.task_key),
  }));
  return { item: jobItem(j, me, host), tasks };
}

export function pipelineDetail(spec: pipelines.GetPipelineResponse, me: string, host: string): ItemDetail {
  const s = spec.spec ?? {};
  const target = s.catalog && (s.schema ?? s.target) ? `${s.catalog}.${s.schema ?? s.target}` : (s.schema ?? s.target);
  return {
    item: pipelineItem({ pipeline_id: spec.pipeline_id, name: spec.name, creator_user_name: spec.creator_user_name, run_as_user_name: spec.run_as_user_name }, spec, me, host),
    pipeline: { kind: s.ingestion_definition ? 'Ingestion' : 'ETL', continuous: !!s.continuous, ...(target ? { target } : {}), serverless: !!s.serverless, ...(s.channel ? { channel: s.channel } : {}) },
  };
}

export interface LiveItemsOptions {
  api: LiveApi;
  user: () => Promise<string>;
  userKey: string;
  state: LiveState;
  limits: LiveLimits;
  clock?: () => number;
  timer?: () => number;
  source?: 'live' | 'replay';
}

export function createLiveItems(o: LiveItemsOptions): { listItems: () => Promise<ItemsResponse>; getItem: (type: 'job' | 'pipeline', id: string) => Promise<ItemDetail> } {
  const clock = o.clock ?? Date.now;
  const timer = o.timer ?? clock;
  return {
    async listItems() {
      const now = clock();
      const hit = o.state.items.get(o.userKey);
      if (hit && now - hit.at < ITEMS_TTL) return hit.data;
      const dl = new Deadline(timer() + o.limits.itemsTimeoutMs, timer);
      try {
        const [host, me] = await Promise.all([o.api.host(), o.user().catch(() => '')]);
        const items: Item[] = [];
        let partial: string | undefined;
        let token: string | undefined;
        do {
          const page = await dl.call(() => o.api.listJobs({ limit: 100, page_token: token }));
          if (page === TIMEOUT) {
            partial = `read ${items.length} jobs before the ${o.limits.itemsTimeoutMs / 1000}s limit`;
            break;
          }
          for (const j of page.jobs ?? []) items.push(jobItem(j, me, host));
          token = page.next_page_token;
        } while (token);
        const statuses: pipelines.PipelineStateInfo[] = [];
        if (!partial) {
          let pt: string | undefined;
          do {
            const page = await dl.call(() => o.api.listPipelines({ max_results: 100, page_token: pt }));
            if (page === TIMEOUT) {
              partial = 'pipelines list cut by the time limit';
              break;
            }
            statuses.push(...(page.statuses ?? []));
            pt = page.next_page_token;
          } while (pt);
        }
        const specs = new Map<string, pipelines.GetPipelineResponse>();
        await pool(statuses.filter((p) => p.pipeline_id), o.limits.concurrency, async (p) => {
          const r = await dl.call(() => o.api.getPipeline({ pipeline_id: p.pipeline_id! }).catch(() => undefined));
          if (r && r !== TIMEOUT) specs.set(p.pipeline_id!, r);
        });
        for (const p of statuses) items.push(pipelineItem(p, specs.get(p.pipeline_id ?? ''), me, host));
        const data: ItemsResponse = { asOf: now, source: o.source ?? 'live', items, ...(partial ? { partial: { reason: partial } } : {}) };
        if (!partial) o.state.items.set(o.userKey, { at: now, data });
        return data;
      } catch (e) {
        throw toSourceError(e);
      }
    },
    async getItem(type, id) {
      const [host, me] = await Promise.all([o.api.host(), o.user().catch(() => '')]);
      try {
        if (type === 'job') {
          if (!/^\d+$/.test(id)) throw new SourceError(404, `no job ${id}`);
          return jobDetail(await o.api.getJob({ job_id: Number(id) }), me, host);
        }
        return pipelineDetail(await o.api.getPipeline({ pipeline_id: id }), me, host);
      } catch (e) {
        throw toSourceError(e, true);
      }
    },
  };
}
```

  - In `liveRunSource.ts`, add `items: Map<string, { at: number; data: ItemsResponse }>` to `LiveState` and `items: new Map()` to `createLiveState`. In `createLiveRunSource`, build `const itemsSrc = createLiveItems({ api, user: o.user, userKey: o.userKey, state, limits, clock, timer, source: o.source })` and add `listItems: itemsSrc.listItems, getItem: itemsSrc.getItem` to the returned object. Use the traced `api` there, so captures record the calls.
  - If importing `toSourceError`/`LiveState` from `liveRunSource` into `items.ts` creates a circular import that breaks at runtime, move the `createLiveItems` call to the end of `createLiveRunSource` with a dynamic-free design. Simplest: `items.ts` imports only types from `liveRunSource` (`import type { LiveState }`), and `toSourceError` moves to `apiError.ts` and is re-exported from `liveRunSource` for existing callers.
  - If fakeApi's `getPipeline` doesn't throw a 404-shaped error for an unknown id, make it throw the same shape `getRun` uses.

- [ ] **Step 5: Run the tests until they pass.** Run `npx vitest run server/data/live`. Expected: the new tests PASS and the existing live tests still PASS.

- [ ] **Step 6: Commit** (typecheck still fails until Task 3 fills mock and replay; that's expected, and lint must pass):

```bash
npm run lint
git commit -m "Live items: jobs/list + jobs/get + pipelines as Item definitions, own time budget, partial instead of 502, 5-minute cache" -- server/data/live/api.ts server/data/live/fakeApi.ts server/data/live/limits.ts server/data/live/links.ts server/data/live/liveRunSource.ts server/data/live/items.ts server/data/live/items.test.ts server/data/live/apiError.ts server/data/runSource.ts
```

---

### Task 3: Server: mock items, replay, sweep, endpoints

**Files:**
- Create: `server/data/mock/mockItems.ts`, `server/data/mock/mockItems.test.ts`, `server/api/listItems.ts`, `server/api/getItem.ts`, `server/api/items.test.ts`
- Modify: `server/data/mock/mockRunSource.ts`, `server/data/capture/replayApi.ts`, `server/data/capture/replayProvider.ts`, `server/data/capture/sweep.ts`, `server/server.ts`

**Interfaces:**
- Consumes: `RunSource.listItems/getItem`, `createLiveItems`, `Item` types (Tasks 1–2).
- Produces:
  - `mockItems(runs: Run[], asOf: number): Item[]` (deterministic from names)
  - `mockDetail(item: Item, runs: Run[]): ItemDetail`
  - `listItems(source, query)` and `getItem(source, type, id)` handlers returning `HandlerResult`
  - Routes `GET /api/items`, `GET /api/items/:type/:id`

- [ ] **Step 1: Write the failing tests.**

`server/data/mock/mockItems.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateRuns } from './generateRuns';
import { mockItems } from './mockItems';
import { parseQuartz } from '../../../shared/domain/cron';

describe('mockItems', () => {
  const { runs, asOf } = generateRuns(0);
  const items = mockItems(runs, asOf);
  it('one item per distinct job and pipeline name, stable ids', () => {
    const names = new Set(runs.map((r) => `${r.type}|${r.name}`));
    expect(items).toHaveLength(names.size);
    expect(mockItems(runs, asOf).map((i) => i.id)).toEqual(items.map((i) => i.id));
  });
  it('has the spread the UI needs', () => {
    const jobs = items.filter((i) => i.type === 'job');
    expect(jobs.some((i) => i.trigger === 'schedule' && !i.paused)).toBe(true);
    expect(jobs.some((i) => i.paused)).toBe(true);
    expect(jobs.some((i) => i.trigger === 'periodic')).toBe(true);
    expect(jobs.some((i) => i.trigger === 'file_arrival')).toBe(true);
    expect(jobs.some((i) => i.trigger === 'manual')).toBe(true);
    expect(items.some((i) => i.type === 'pipeline' && i.trigger === 'continuous')).toBe(true);
    expect(items.filter((i) => i.type === 'pipeline').every((i) => i.trigger !== 'schedule')).toBe(true);
    for (const i of jobs) if (i.schedule) expect(parseQuartz(i.schedule.cron)).not.toBeNull();
  });
});
```

Check `generateRuns`'s real signature first (`grep -n "export function generateRuns" server/data/mock/generateRuns.ts`) and adapt the call and the destructuring to it.

`server/api/items.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createMockRunSource } from '../data/mock/mockRunSource';
import { listItems } from './listItems';
import { getItem } from './getItem';

describe('items handlers (mock)', () => {
  const source = createMockRunSource();
  it('lists items', async () => {
    const r = await listItems(source, {});
    expect(r.status).toBe(200);
    expect((r.body as { items: unknown[] }).items.length).toBeGreaterThan(10);
  });
  it('gets one, 404 for unknown, 400 for a bad type', async () => {
    const list = (await listItems(source, {})).body as { items: { type: 'job' | 'pipeline'; id: string }[] };
    const first = list.items[0];
    const ok = await getItem(source, first.type, first.id);
    expect(ok.status).toBe(200);
    expect((await getItem(source, 'job', 'nope')).status).toBe(404);
    expect((await getItem(source, 'cluster', '1')).status).toBe(400);
  });
});
```

Also add a replay round-trip test to `server/data/capture/replay.test.ts`, following that file's existing pattern (record a live session over `fakeApi` → `buildCapture` → `gzipCapture` → `readCapture` → `createReplayProvider`). Record a source over `fakeApi({ jobs: [...3 jobs], pipelines: [...] })`, call `listItems()`, then assert the replay source's `listItems()` returns the same three job ids.

- [ ] **Step 2: Run and see them fail.** Run `npx vitest run server/data/mock/mockItems.test.ts server/api/items.test.ts`. Expected: FAIL, modules missing.

- [ ] **Step 3: Implement.**

`server/data/mock/mockItems.ts`. It is deterministic from a name hash and makes no draws in `generateRuns`:

```ts
import type { Item, ItemDetail, Run } from '../../../shared/domain/types';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
const SP = '7c1e9a40-2b3d-4f6e-9a1c-0d5e8b7f2a91';
// Weighted like real workspaces: on the hour, nightly, a few every-N and weekly; some paused or trigger-based.
const SHAPES: Pick<Item, 'trigger' | 'schedule' | 'periodic' | 'paused'>[] = [
  ...['0 0 2 * * ?', '0 0 0 * * ?', '0 30 0 * * ?', '0 0 6 * * ?', '0 0 6 * * ?', '0 0 7 * * ?', '0 30 7 * * ?', '0 0 12 * * ?', '0 0 18 * * ?', '0 25 16 * * ?'].map((cron) => ({ trigger: 'schedule' as const, schedule: { cron, tz: 'UTC', paused: false }, paused: false })),
  ...['0 0 * * * ?', '0 45 * * * ?', '0 5 * * * ?', '0 15 0/6 * * ?', '0 15 1/6 * * ?', '0 15 2/6 * * ?', '0 0 0/4 * * ?', '0 0/15 * * * ?', '0 0 3 ? * SUN', '0 0 1 ? * SAT'].map((cron) => ({ trigger: 'schedule' as const, schedule: { cron, tz: 'UTC', paused: false }, paused: false })),
  { trigger: 'schedule', schedule: { cron: '0 0 4 * * ?', tz: 'UTC', paused: true }, paused: true },
  { trigger: 'schedule', schedule: { cron: '0 0 12 L * ?', tz: 'UTC', paused: false }, paused: false },
  { trigger: 'periodic', periodic: { interval: 4, unit: 'HOURS' }, paused: false },
  { trigger: 'file_arrival', paused: false },
  { trigger: 'table_update', paused: false },
  ...Array.from({ length: 8 }, () => ({ trigger: 'manual' as const, paused: false })),
];

export function mockItems(runs: Run[], _asOf: number): Item[] {
  const seen = new Map<string, Run>();
  for (const r of runs) {
    const k = `${r.type}|${r.name}`;
    const prev = seen.get(k);
    if (!prev || r.startTime > prev.startTime) seen.set(k, r);
  }
  const out: Item[] = [];
  for (const r of seen.values()) {
    const h = hash(r.name);
    const dev = /^\[dev ([^\]]+)\] /.exec(r.name);
    const mine = r.mine || h % 9 === 0;
    const runAs = dev ? `${dev[1]}@example.com` : SP;
    const base = {
      name: r.name, creator: dev ? `${dev[1]}@example.com` : 'data.platform@example.com', runAs, deployed: !dev, mine,
      tags: { project: r.name.startsWith('finance') ? 'finance' : 'aiges', env: dev ? 'dev' : 'prod' }, bundle: h % 5 !== 0,
    };
    if (r.type === 'pipeline') out.push({ type: 'pipeline', id: `p-${h.toString(16).padStart(8, '0')}`, ...base, trigger: r.continuous || h % 4 === 0 ? 'continuous' : 'manual', paused: false });
    else out.push({ type: 'job', id: String(100000 + (h % 900000)), ...base, ...SHAPES[h % SHAPES.length] });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function mockDetail(item: Item, runs: Run[]): ItemDetail {
  if (item.type === 'pipeline') return { item, pipeline: { kind: hash(item.name) % 3 === 0 ? 'Ingestion' : 'ETL', continuous: item.trigger === 'continuous', target: 'aiges_dev.raw_bronze', serverless: true, channel: 'CURRENT' } };
  const newest = runs.filter((r) => r.name === item.name).sort((a, b) => b.startTime - a.startTime)[0];
  const n = Math.max(1, Math.min(newest?.ntasks ?? 3, 12));
  const keys = ['extract', 'stage_bronze', 'merge_silver', 'refresh_gold', 'validate', 'publish', 'notify', 'archive', 'reconcile', 'export', 'aggregate', 'cleanup'];
  const types = ['Notebook', 'Notebook', 'Python wheel', 'Pipeline', 'SQL', 'Notebook'];
  return { item, tasks: keys.slice(0, n).map((key, i) => ({ key, type: types[i % types.length], dependsOn: i ? [keys[i - 1]] : [] })) };
}
```

- `mockRunSource.ts`: add `listItems()`, which uses the same cached generated runs (tz 0 is fine) and returns `{ asOf: <current shifted asOf>, source: 'mock', items: mockItems(runs, asOf) }`, cached once per process. Add `getItem(type, id)`, which finds the item by type and id, else throws `new SourceError(404, ...)`, and returns `mockDetail(item, runs)`.
- `replayApi.ts`: add `'listJobs', 'getJob'` to `METHODS`.
- `replayProvider.ts`: add `listItems: () => prime().then(() => inner.listItems())` and `getItem: (t, id) => prime().then(() => inner.getItem(t, id))` to the wrapper.
- `sweep.ts`: after it lists runs, also `await source.listItems().catch(() => undefined)`. Read the file first and follow how it calls `listRuns`.
- `server/api/listItems.ts`:

```ts
import type { RunSource } from '../data/runSource';
import { orSourceError, type HandlerResult } from './listRuns';

export async function listItems(source: RunSource, _query: Record<string, unknown>): Promise<HandlerResult> {
  return orSourceError(async () => ({ status: 200, body: await source.listItems() }));
}
```

- `server/api/getItem.ts`:

```ts
import type { RunSource } from '../data/runSource';
import { orSourceError, type HandlerResult } from './listRuns';

export async function getItem(source: RunSource, type: string, id: string): Promise<HandlerResult> {
  if (type !== 'job' && type !== 'pipeline') return { status: 400, body: { error: 'type must be job or pipeline' } };
  if (!id || id.length > 100) return { status: 400, body: { error: 'bad id' } };
  return orSourceError(async () => ({ status: 200, body: await source.getItem(type, id) }));
}
```

- `server.ts`: next to the runs routes, add:

```ts
app.get('/api/items', (req, res, next) => {
  serve(req, res, next, '/api/items', (source) => listItems(source, req.query));
});
app.get('/api/items/:type/:id', (req, res, next) => {
  serve(req, res, next, '/api/items/:type/:id', (source) => getItem(source, req.params.type, req.params.id));
});
```

- [ ] **Step 4: Run everything.** Run `npm test && npm run typecheck && npm run lint`. Expected: all pass, typecheck included.

- [ ] **Step 5: Smoke-test the endpoint in mock mode.** Start the dev server per the project memory (bind 127.0.0.1; see `package.json` `dev` and `run-local.ps1`; use port 8002, e.g. `$env:DATABRICKS_APP_PORT=8002; npm run dev`), then `curl -s http://127.0.0.1:8002/api/items | jq '.items | length'`. Expected: a number > 10. Stop the server.

- [ ] **Step 6: Commit.**

```bash
git commit -m "Items in every mode: mock items from the generated names, replay of jobs/list + jobs/get, sweep reads items, /api/items and /api/items/:type/:id" -- server/data/mock/mockItems.ts server/data/mock/mockItems.test.ts server/data/mock/mockRunSource.ts server/data/capture/replayApi.ts server/data/capture/replayProvider.ts server/data/capture/sweep.ts server/data/capture/replay.test.ts server/api/listItems.ts server/api/getItem.ts server/api/items.test.ts server/server.ts
```

---

### Task 4: Client: tabs, shared runs data, Runs focus

**Files:**
- Create: `client/src/hooks/useRunsData.ts`
- Modify: `client/src/App.tsx`, `client/src/components/Shell.tsx`, `client/src/components/shell.css`, `client/src/pages/AttentionPage.tsx`, `client/src/pages/AttentionView.tsx`, `client/src/components/Shell.test.tsx`, `client/src/pages/AttentionView.test.tsx`
- Create: `client/src/pages/JobsPage.tsx` (placeholder `<div className="jobs" />`, filled in Task 5)

**Interfaces:**
- Produces:
  - `useRunsData(): RunsData` where `RunsData = { runs: RunsState; single: ReturnType<typeof useRunRefresh>; intervalMs: number; setIntervalMs: (n: number) => void }`. This is the code moved out of `AttentionPage`.
  - `type Tab = 'jobs' | 'runs'`; `Shell` gets optional props `tab?: Tab; onTab?: (t: Tab) => void`, and renders `<nav className="tabs">` with two buttons (`Jobs & ETL`, `Runs`) right after the `<h1>`, only when `onTab` is given.
  - `interface RunsFocus { seq: number; query?: string; runId?: number }`
  - `AttentionPage({ data, focus }: { data: RunsData; focus?: RunsFocus })`
  - `AttentionView` gets optional props `initialQuery?: string` and `initialRunId?: number`. On mount, when `initialQuery` is set it dispatches `{ type: 'preset', preset: 'all' }` and then `{ type: 'query', query: initialQuery }`; when `initialRunId` is set it opens that run (`setStack([initialRunId])`).
  - `JobsPage({ data, onSeeRuns, onOpenRun }: { data: RunsData; onSeeRuns: (name: string) => void; onOpenRun: (runId: number) => void })`

- [ ] **Step 1: Write the failing tests.** In `Shell.test.tsx` add:

```tsx
it('renders tabs and reports clicks', () => {
  const onTab = vi.fn();
  render(<Shell tab="runs" onTab={onTab}><p>x</p></Shell>);
  expect(screen.getByRole('button', { name: 'Runs' }).className).toContain('on');
  fireEvent.click(screen.getByRole('button', { name: 'Jobs & ETL' }));
  expect(onTab).toHaveBeenCalledWith('jobs');
});
```

In `AttentionView.test.tsx` add:

```tsx
it('initialQuery widens the window and filters; initialRunId opens the drawer', () => {
  render(<AttentionView data={data} loadedAt={asOf} initialQuery="gl_load" initialRunId={1} />);
  expect((screen.getByRole('searchbox') as HTMLInputElement).value).toBe('gl_load');
  expect(screen.getByRole('dialog')).toBeTruthy();
});
```

Adapt the selectors to how the existing tests find the search input and the drawer (look at the file first). Keep the assertions' meaning.

- [ ] **Step 2: Run and see them fail.** Run `npx vitest run client/src/components/Shell.test.tsx client/src/pages/AttentionView.test.tsx`.

- [ ] **Step 3: Implement.**
  - **`useRunsData`:** the three hooks from `AttentionPage` (`useRefreshInterval`, `useRuns`, `useRunRefresh`). `AttentionPage` keeps its loading and error rendering but reads `data.runs` and `data.single`, and builds `RefreshControl` from `data`.
  - **`App`:**
    - `?compare` → unchanged (no tabs).
    - Otherwise `tab` state comes from `?tab` (`'jobs'` or default `'runs'`). Changing it calls `history.replaceState` with `?tab=<t>`.
    - `const data = useRunsData()`.
    - `const [focus, setFocus] = useState<RunsFocus>()`.
    - Both pages render; the inactive one is wrapped in `<div hidden>`.
    - `<AttentionPage key={focus?.seq ?? 0} data={data} focus={focus} />`.
    - `<JobsPage data={data} onSeeRuns={(name) => { setFocus({ seq: Date.now(), query: name }); setTab('runs'); }} onOpenRun={(runId) => { setFocus({ seq: Date.now(), runId }); setTab('runs'); }} />`.
  - **`Shell` tabs CSS:** port `.tabs` from the mockup into `shell.css`. The mockup's header uses `padding: 10px 24px 0` with tabs aligned to the bottom border. Keep the header's current padding when there are no tabs; add a `shell-top.has-tabs` modifier for the tab layout.

- [ ] **Step 4: Run the checks.** Run `npm test && npm run typecheck && npm run lint`. Expected: pass.

- [ ] **Step 5: Commit.**

```bash
git commit -m "Tabs Jobs & ETL / Runs in the shell (?tab=), runs data shared by both tabs, Runs opens focused on a job or a run" -- client/src/hooks/useRunsData.ts client/src/App.tsx client/src/components/Shell.tsx client/src/components/shell.css client/src/components/Shell.test.tsx client/src/pages/AttentionPage.tsx client/src/pages/AttentionView.tsx client/src/pages/AttentionView.test.tsx client/src/pages/JobsPage.tsx
```

---

### Task 5: Client: Jobs & ETL list, filter bar, schedule timeline

**Files:**
- Create: `client/src/hooks/useItems.ts`, `client/src/model/items.ts`, `client/src/model/items.test.ts`, `client/src/model/schedule.ts`, `client/src/model/schedule.test.ts`, `client/src/components/ItemsFilterBar.tsx`, `client/src/components/ScheduleTimeline.tsx`, `client/src/components/ItemList.tsx`, `client/src/pages/jobs.css`, `client/src/pages/JobsPage.test.tsx`
- Modify: `client/src/pages/JobsPage.tsx`

**Interfaces:**
- Consumes: `Item`, `ItemsResponse`, `startsBetween`, `scheduleOf`, `triggerPill` (Task 1); `RunsData` (Task 4); `Run` from types.
- Produces (`model/items.ts`):
  - `interface ItemFilters { query: string; type: 'all' | 'job' | 'pipeline'; scope: 'mine' | 'deployed' | 'all'; tags: string[] /* "k:v" */; sort: 'name' | 'last' | 'failed' | 'next' }`
  - `startsOf(item: Item, from: number, to: number): number[]`: cached per item object over the horizon [asOf − 1 day, asOf + 11 days]; `[]` for non-schedule, paused or unparsed items.
  - `isOnTimeline(item: Item): boolean`: schedule, not paused, parses.
  - `runsFor(item: Item, runs: Run[]): Run[]`: by `jobId`/`pipelineId` when the run has one, else by name; sorted by start.
  - `lastRun(item: Item, runs: Run[]): Run | undefined`
  - `typicalSec(item: Item, runs: Run[]): { sec: number; estimated: boolean }`: newest run's `usualSec` > 0, else the last finished run's `durationSec` > 0, else `{ sec: 600, estimated: true }`.
  - `filterItems(items: Item[], f: ItemFilters, sched: { from: number; to: number; type?: 'job' | 'pipeline' } | null): Item[]`
  - `sortItems(items: Item[], sort: ItemFilters['sort'], runs: Run[], now: number): Item[]`
  - `typeCounts(items)`, `scopeCounts(items)`, `tagCounts(items): { value: string; count: number }[]`
- Produces (`model/schedule.ts`):
  - `type SchedScale = 'hour' | 'day'`
  - `interface SchedState { scale: SchedScale; win: { a: number; b: number } | null; cube: { col: number; type: 'job' | 'pipeline' } | null }`
  - `schedBuckets(scale: SchedScale, now: number): { start: number; end: number }[]` (hour: 24 from the current local hour; day: 7 from local midnight)
  - `schedRange(s: SchedState, bks): { from: number; to: number; type?: 'job' | 'pipeline' } | null` (null when the whole range is selected)
  - `schedCounts(items: Item[], bks): { job: number; pipeline: number }[]`
  - `PRESETS: Record<SchedScale, { label: string; a: number; b: number }[]>`, copied from the mockup: hour = next 24h 0–24, next 6 hours 0–6, next hour 0–1; day = next 7 days 0–7, tomorrow 1–2, today 0–1
  - `dragHandle(win, which: 'a' | 'b', col: number, n: number): { a: number; b: number }`

- [ ] **Step 1: Write the failing model tests.**

`client/src/model/schedule.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { schedBuckets, schedRange, schedCounts, dragHandle } from './schedule';
import type { Item } from '../../../shared/domain/types';

const NOW = Date.UTC(2026, 9, 6, 16, 16);
const job = (id: string, cron: string | null, over: Partial<Item> = {}): Item => ({ type: 'job', id, name: id, deployed: false, mine: false, tags: {}, trigger: cron ? 'schedule' : 'manual', ...(cron ? { schedule: { cron, tz: 'UTC', paused: false } } : {}), paused: false, bundle: false, ...over });

describe('schedule', () => {
  it('24 hourly buckets from the current hour; 7 days from midnight', () => {
    const h = schedBuckets('hour', NOW);
    expect(h).toHaveLength(24);
    expect(h[0].start).toBe(Date.UTC(2026, 9, 6, 16));
    const d = schedBuckets('day', NOW);
    expect(d).toHaveLength(7);
    expect(d[0].start).toBe(Date.UTC(2026, 9, 6));
  });
  it('counts starts per bucket; paused, unparsed and unscheduled count nothing', () => {
    const bks = schedBuckets('hour', NOW);
    const items = [job('a', '0 0 * * * ?'), job('b', '0 0/15 * * * ?'), job('c', '0 0 2 * * ?', { paused: true }), job('d', '0 0 12 L * ?'), job('e', null)];
    const c = schedCounts(items, bks);
    expect(c[0]).toEqual({ job: 5, pipeline: 0 });
    expect(c.reduce((s, x) => s + x.job, 0)).toBe(24 + 96);
  });
  it('range is null for the full window, else the selected columns or cube', () => {
    const bks = schedBuckets('hour', NOW);
    expect(schedRange({ scale: 'hour', win: null, cube: null }, bks)).toBeNull();
    expect(schedRange({ scale: 'hour', win: { a: 2, b: 5 }, cube: null }, bks)).toEqual({ from: bks[2].start, to: bks[4].end });
    expect(schedRange({ scale: 'hour', win: null, cube: { col: 3, type: 'job' } }, bks)).toEqual({ from: bks[3].start, to: bks[3].end, type: 'job' });
  });
  it('handles never cross', () => {
    expect(dragHandle({ a: 2, b: 5 }, 'a', 9, 24)).toEqual({ a: 4, b: 5 });
    expect(dragHandle({ a: 2, b: 5 }, 'b', 0, 24)).toEqual({ a: 2, b: 3 });
  });
});
```

`client/src/model/items.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterItems, sortItems, lastRun, typicalSec, runsFor, scopeCounts } from './items';
import { makeRun } from '../test/fixtures';
import type { Item } from '../../../shared/domain/types';

const base = (over: Partial<Item>): Item => ({ type: 'job', id: '1', name: 'x', deployed: false, mine: false, tags: {}, trigger: 'manual', paused: false, bundle: false, ...over });
const items: Item[] = [
  base({ id: '1', name: '[dev ann] aiges_ingest_coretables_mfg_dev', mine: true, tags: { project: 'aiges' } }),
  base({ id: '2', name: 'aiges_finance_daily_report_prod', deployed: true, trigger: 'schedule', schedule: { cron: '0 0 2 * * ?', tz: 'UTC', paused: false } }),
  base({ id: 'p1', type: 'pipeline', name: 'raw_bronze_mfg_dev', trigger: 'continuous' }),
];
const F = { query: '', type: 'all' as const, scope: 'all' as const, tags: [], sort: 'name' as const };

describe('items model', () => {
  it('search tokens in any order, ids too', () => {
    expect(filterItems(items, { ...F, query: 'mfg coretables' }, null).map((i) => i.id)).toEqual(['1']);
    expect(filterItems(items, { ...F, query: 'p1' }, null).map((i) => i.id)).toEqual(['p1']);
  });
  it('type, scope, tags', () => {
    expect(filterItems(items, { ...F, type: 'pipeline' }, null)).toHaveLength(1);
    expect(filterItems(items, { ...F, scope: 'mine' }, null).map((i) => i.id)).toEqual(['1']);
    expect(filterItems(items, { ...F, scope: 'deployed' }, null).map((i) => i.id)).toEqual(['2']);
    expect(filterItems(items, { ...F, tags: ['project:aiges'] }, null).map((i) => i.id)).toEqual(['1']);
    expect(scopeCounts(items)).toEqual({ mine: 1, deployed: 1, all: 3 });
  });
  it('schedule window keeps only items starting inside it', () => {
    const from = Date.UTC(2026, 9, 7, 1), to = Date.UTC(2026, 9, 7, 3);
    expect(filterItems(items, F, { from, to }).map((i) => i.id)).toEqual(['2']);
  });
  it('runs match by jobId, else by name; typical runtime falls back to a 10-minute estimate', () => {
    const runs = [makeRun({ id: 1, name: 'aiges_finance_daily_report_prod', jobId: 2, usualSec: 420, startTime: 1 }), makeRun({ id: 2, name: '[dev ann] aiges_ingest_coretables_mfg_dev', startTime: 2 })];
    expect(runsFor(items[1], runs).map((r) => r.id)).toEqual([1]);
    expect(lastRun(items[0], runs)?.id).toBe(2);
    expect(typicalSec(items[1], runs)).toEqual({ sec: 420, estimated: false });
    expect(typicalSec(items[2], runs)).toEqual({ sec: 600, estimated: true });
  });
  it('sort by name and next start', () => {
    expect(sortItems(items, 'name', [], 0).map((i) => i.id)).toEqual(['1', '2', 'p1']);
    expect(sortItems(items, 'next', [], Date.UTC(2026, 9, 6, 16))[0].id).toBe('2');
  });
});
```

Check `client/src/test/fixtures.ts` `makeRun` accepts `jobId`/`usualSec` overrides (it takes a `Partial<Run>`). If the name sort compares the bare name (bundle prefix stripped), set the expected order accordingly: `1` sorts by `aiges_ingest…`, after `aiges_finance…`. Decide on bare-name sorting (strip `[..] `) to match the Runs screen's `bareName`, and assert `['2', '1', 'p1']`.

- [ ] **Step 2: Run and see them fail.** Run `npx vitest run client/src/model/schedule.test.ts client/src/model/items.test.ts`.

- [ ] **Step 3: Implement both models** to the interfaces above. Porting notes from the mockup functions:
  - `filtered()` → `filterItems`; its haystack is name + id + runAs + creator + `k:v` tags + pill text, lower-cased.
  - `buckets()` → `schedBuckets`; `schedRange()` → `schedRange`; the counts in `renderSched()` → `schedCounts`.
  - `fires()` is replaced by `startsOf`, which uses `scheduleOf` + `startsBetween` with a `WeakMap<Item, number[]>` cache over the horizon and a binary-search slice, as in the mockup's cached `fires`.
  - Sort `failed` = newest failed run first, then last run; `last` = newest run first; `next` = next start ascending, unscheduled last.

- [ ] **Step 4: Run the model tests until they pass.**

- [ ] **Step 5: Build the UI**, ported from the mockup. Markup and classes match the mockup; CSS goes in `client/src/pages/jobs.css`, copied from the mockup's `<style>`, minus anything already in `filterbar.css` / `timeline.css` / `runrow.css` (reuse those classes) and minus the mockup-only selectors (`.mock-sw`, `.dn*`, `.hs`, `.lc`, `.wg`, `.pl`, `.gt*`, `.bar`, `.runs-stub`).
  - **`useItems(intervalMs)`:** fetch `/api/items` on mount and every `intervalMs` (when > 0). Returns `{ state: 'loading' } | { state: 'error'; message; retry } | { state: 'ready'; data: ItemsResponse }`, following `useRuns.ts`'s shape and error text style ("Could not load jobs and pipelines: …").
  - **`ItemsFilterBar`:** port the mockup's `.fbar` block: search, `typeSeg`, `scopeSeg`, the Tags menu (`.fm`), Sort.
  - **`ScheduleTimeline`:** port `renderSched()`.
    - Title `Scheduled starts by {hour|day}`, scale switch, span text with day names when crossing midnight, presets.
    - The column grid with `tl-head` buttons (`now` marker in column 0, the day name at midnight) and two `cube job` / `cube pipeline` boxes per column.
    - The `tl-win` outline when narrowed, and the `tl-line` with two draggable handles (pointer capture, as in `Timeline.tsx`).
    - Footer: legend, count without a schedule ("N have no schedule (manual, triggered, continuous, paused)" and, when > 0, "· N schedules not understood"), and `clear schedule filter ✕` when narrowed.
    - Behaviour from the mockup's `sched.onclick` / `onpointerdown`.
  - **`ItemList`:** port `renderList()`.
    - Sticky `.list-meta` header (`{n} of {total} · last-run marks use the loaded runs window`, or `scheduled to start HH:MM–HH:MM` when narrowed) with the `List · Load` switch.
    - Rows `.ir`: tag, `.nm` (rtl ellipsis trick), `.trg` pill from `triggerPill`, then the last-run cell or the starts cell.
    - Cap at 300 with the note. Click toggles selection; Esc clears.
    - Loading skeleton, empty state with `Clear filters`, error with `Try again`, and the `partial` line.
  - **`JobsPage`:** owns `ItemFilters`, `SchedState`, view (`'list' | 'load'`) and `selected: string | null` (starts null, J4). Renders the filter bar, the timeline, and `.split` (`.sel` when selected) with the list or Load view and the pane (Task 6). Until Task 6, render nothing for Load and the pane.

- [ ] **Step 6: Write a page test** `client/src/pages/JobsPage.test.tsx` (jsdom). Stub `fetch` for `/api/items` with three items as in the model test, and give `data` a ready `RunsData` built from `makeRun`. Assert:
  - All three rows render.
  - Typing `mfg coretables` in the search leaves one row.
  - No pane is open on load (`document.querySelector('.split.sel')` is null).
  - Clicking a row adds `.split.sel`, and clicking it again removes it.
  - Clicking the `Pipelines` segment leaves one row.

  Run it to see it pass after implementation.

- [ ] **Step 7: Run all checks.** Run `npm test && npm run typecheck && npm run lint`. Expected: pass.

- [ ] **Step 8: Commit.**

```bash
git commit -m "Jobs & ETL list: filter bar, schedule timeline (starts by hour/day, narrowing filters rows), one-line rows with trigger pills" -- client/src/hooks/useItems.ts client/src/model/items.ts client/src/model/items.test.ts client/src/model/schedule.ts client/src/model/schedule.test.ts client/src/components/ItemsFilterBar.tsx client/src/components/ScheduleTimeline.tsx client/src/components/ItemList.tsx client/src/pages/JobsPage.tsx client/src/pages/JobsPage.test.tsx client/src/pages/jobs.css
```

---

### Task 6: Client: Load view and detail pane

**Files:**
- Create: `client/src/model/load.ts`, `client/src/model/load.test.ts`, `client/src/components/LoadView.tsx`, `client/src/components/ItemPane.tsx`, `client/src/hooks/useItemDetail.ts`
- Modify: `client/src/pages/JobsPage.tsx`, `client/src/pages/jobs.css`, `client/src/pages/JobsPage.test.tsx`

**Interfaces:**
- Consumes: `startsOf`, `typicalSec`, `runsFor`, `lastRun` (Task 5); `triggerPill` (Task 1); `historyByJob`/`visibleHistory`, `durShort`, `dayTime` used by `RunRow` (reuse; import from where `RunRow.tsx` imports them).
- Produces (`model/load.ts`):
  - `interface LoadRun { item: Item; start: number; end: number; estimated: boolean }`
  - `loadRuns(items: Item[], runs: Run[], from: number, to: number): LoadRun[]` (starts in [from − 24 h, to), ending after `from`)
  - `loadCurve(lr: LoadRun[], from: number, to: number, step: number): { running: number[]; startsIn: number[] }` (sorted arrays + binary search; `running[i]` at `from + i*step`, length N+1)
  - `niceTicks(max: number): { step: number; top: number; ticks: number[] }`
  - `fmtN(n: number): string` (999 → "999", 1200 → "1.2k", 3000 → "3k")
  - `groupOf(item: Item): string` (bundle prefix `[dev ann]`, else `tags.project`, else `prod / no prefix`)
  - `runningIn(lr: LoadRun[], a: number, b: number): { item: Item; runs: LoadRun[] }[]` (by first start)
- `ItemPane({ item, runs, onClose, onSeeRuns, onOpenRun })`; `useItemDetail(type, id)` → `{ state: 'loading' | 'error' | 'ready', detail?, message? }`, cached per `type:id` in a module Map.

- [ ] **Step 1: Write the failing tests** `client/src/model/load.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { loadRuns, loadCurve, niceTicks, fmtN, groupOf, runningIn } from './load';
import type { Item } from '../../../shared/domain/types';

const H = 3600e3;
const FROM = Date.UTC(2026, 9, 6, 0);
const job = (id: string, cron: string, over: Partial<Item> = {}): Item => ({ type: 'job', id, name: id, deployed: false, mine: false, tags: {}, trigger: 'schedule', schedule: { cron, tz: 'UTC', paused: false }, paused: false, bundle: false, ...over });

describe('load', () => {
  it('counts overlapping runs with typical runtime (10-minute estimate without runs)', () => {
    const items = [job('a', '0 0 1 * * ?'), job('b', '0 5 1 * * ?')];
    const lr = loadRuns(items, [], FROM, FROM + 24 * H);
    expect(lr.every((r) => r.estimated && r.end - r.start === 600e3)).toBe(true);
    const { running } = loadCurve(lr, FROM, FROM + 24 * H, 5 * 60e3);
    expect(running[12]).toBe(1);   // 01:00 a only
    expect(running[13]).toBe(2);   // 01:05 both
    expect(running[14]).toBe(1);   // 01:10 a ended
    expect(running[0]).toBe(0);
  });
  it('a run started before the window still counts at its start', () => {
    const items = [job('a', '0 50 23 * * ?')];
    const lr = loadRuns(items, [], FROM, FROM + 2 * H);
    expect(loadCurve(lr, FROM, FROM + 2 * H, 5 * 60e3).running[0]).toBe(1);
  });
  it('nice ticks and number format', () => {
    expect(niceTicks(14)).toEqual({ step: 5, top: 15, ticks: [0, 5, 10, 15] });
    expect(niceTicks(2480).top).toBe(3000);
    expect(niceTicks(0).ticks).toEqual([0, 1]);
    expect([fmtN(999), fmtN(1200), fmtN(3000)]).toEqual(['999', '1.2k', '3k']);
  });
  it('groups and selection', () => {
    expect(groupOf(job('x', '* * * * * ?', { name: '[dev ann] x' }))).toBe('[dev ann]');
    expect(groupOf(job('x', '* * * * * ?', { tags: { project: 'crm' } }))).toBe('crm');
    expect(groupOf(job('x', '* * * * * ?'))).toBe('prod / no prefix');
    const items = [job('a', '0 0 1 * * ?'), job('b', '0 0 5 * * ?')];
    const lr = loadRuns(items, [], FROM, FROM + 24 * H);
    expect(runningIn(lr, FROM + H, FROM + 2 * H).map((x) => x.item.id)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run and see it fail.** Run `npx vitest run client/src/model/load.test.ts`.

- [ ] **Step 3: Implement `model/load.ts`.** Port `renderLoad()`'s math from the mockup: `countLE`, `niceStep` (1/2/5 × 10ⁿ for max/4, at least 1), `fmtN`, the sample loop. Pipelines are already excluded, because `startsOf` returns `[]` for non-schedule items.

- [ ] **Step 4: Run the load tests until they pass.**

- [ ] **Step 5: Build `LoadView`**, porting `renderLoad()` and its handlers. These replace the mockup's document-level listeners with React handlers on `.ld-plot`.
  - Header: `Scheduled jobs running at once`, the explanation with peak / count / runs, and the hint or `clear selection ✕`.
  - Y labels `.ld-y`, gridlines, the SVG polygon and polyline (`preserveAspectRatio="none"`, `vector-effect="non-scaling-stroke"`), the `now` line, the selection overlay, the drag overlay, the crosshair `.ld-x` with a dot.
  - Tooltip: a `.tip` div positioned fixed. Content: `HH:MM · N running · M start in the next 5 min`, plus the top 5 groups, `+N more groups`, and `(runtimes estimated for K jobs)` when any are estimated.
  - Pointer drag selects (snapped to the step; a click selects one step).
  - Under it, the list (reuse `ItemList` row markup) shows `runningIn` results when there is a selection (right cell `HH:MM–HH:MM · …`), else everything with a start in range by first start (right cell `⏱ starts`). Cap at 200.
  - The range follows `schedRange(...) ?? full bucket range`. Step is 5 minutes for spans ≤ 26 h, else 30 minutes.
  - Port the `.ld*` CSS. Recompute only when items, runs, filters or range change (`useMemo`).

- [ ] **Step 6: Build `ItemPane`**, porting `renderPane()`.
  - Header: tag, `open in Databricks ↗` (only when `item.url`), ✕.
  - Facts: Run as (a service principal shows `service principal 7c1e9a48…`), Creator, Trigger (pill title text + ` · next Wed 02:00, in 9h 44m` from `startsOf`), Bundle (`from a bundle` / `not from a bundle`), Tags chips, Job ID / Pipeline ID.
  - **Recent runs:** the last 30 runs from `runsFor` as `.rh` boxes, same markup as `RunRow` (`rh {result}`, `rh now {type}` for live). Click → `onOpenRun(run.id)`. Scroll to the newest on mount. With no runs: `No runs in the loaded window.`
  - Structure from `useItemDetail`: Tasks list (key, `after <deps>`, type) or Pipeline facts (Kind, Mode, Target, Compute). Loading text, or the error message, inside the section.
  - **`See runs →`** → `onSeeRuns(item.name)`.
  - Pane width `clamp(360px, 36vw, 560px)`.

- [ ] **Step 7: Wire into `JobsPage`** (view switch → `LoadView`; selected → `ItemPane` in `.pane`) and extend `JobsPage.test.tsx`:
  - Clicking `Load` shows the text `Scheduled jobs running at once`.
  - Selecting a row shows `See runs →`; clicking it calls `onSeeRuns` with the item's name.
  - A recent-run box click calls `onOpenRun`. Give the job a run in the fixture data (`makeRun({ jobId: 2, name: ..., result: 'succeeded' })`).

  Stub `fetch` for `/api/items/job/2` with a detail containing two tasks.

- [ ] **Step 8: Run all checks.** Run `npm test && npm run typecheck && npm run lint`. Expected: pass.

- [ ] **Step 9: Commit.**

```bash
git commit -m "Jobs & ETL: Load view (jobs running at once, y-axis, crosshair, drag to list) and the on-demand detail pane (facts, recent runs, tasks or pipeline facts, See runs)" -- client/src/model/load.ts client/src/model/load.test.ts client/src/components/LoadView.tsx client/src/components/ItemPane.tsx client/src/hooks/useItemDetail.ts client/src/pages/JobsPage.tsx client/src/pages/JobsPage.test.tsx client/src/pages/jobs.css
```

---

### Task 7: Package, verify in the browser, push

**Files:**
- Modify: `deploy/` (generated by `npm run package`)

- [ ] **Step 1: Run the full checks.** Run `npm test && npm run typecheck && npm run lint`. Expected: all pass; record the test count.

- [ ] **Step 2: Package.** Run `npm run package`. Expected: it finishes and `deploy/` changes.

- [ ] **Step 3: Verify in a real browser in mock mode.** Start the dev server on 127.0.0.1:8002. Open `http://127.0.0.1:8002/?tab=jobs` in Chrome and check:
  - The tabs switch and the URL follows.
  - Search, type, scope and tags filter the rows.
  - Timeline presets, a column click, a cube click and the handles all narrow the list, and rows show their starts.
  - The `Load` curve has y labels; hover shows the tooltip; dragging lists the jobs running.
  - A row click opens the pane; `See runs →` lands on Runs with the search filled; a recent-run box opens that run's drawer.
  - The Runs tab looks as before.
  - The console is clean.

  Fix any problem in the task that owns it, re-run the checks, and re-package. Leave the server running for the user, or stop it per the project memory's guidance before any git branch switch.

- [ ] **Step 4: Commit the deploy and push.**

```bash
git commit -m "deploy: rebuild (Jobs & ETL tab)" -- deploy
git push
```

Expected: the push succeeds. Report the commit hashes, the test count, and the URL to open.
