import type { Run } from '../../../shared/domain/types';
import { dur } from '../../../shared/domain/format';
import { dayTime } from './history';
import type { ScheduledTask } from './runDetail';

export type CompareTone = '' | 'chg' | 'bad' | 'slow';

export interface CompareRow {
  key: string;
  name: string;
  /** One per run, oldest first; null when that run did not have the task. */
  cells: (ScheduledTask | null)[];
  note: string;
  tone: CompareTone;
  /** The run whose bar is the slow one, when tone is 'slow'. */
  slowIdx?: number;
}

/** Tasks keyed by name plus occurrence, so a name used twice in one run stays two rows. */
function keyed(tasks: ScheduledTask[]): Map<string, ScheduledTask> {
  const seen = new Map<string, number>();
  const out = new Map<string, ScheduledTask>();
  for (const t of tasks) {
    const n = (seen.get(t.name) ?? 0) + 1;
    seen.set(t.name, n);
    out.set(n === 1 ? t.name : `${t.name}#${n}`, t);
  }
  return out;
}

/** Every key from any list, in order: the first list sets the order, later ones slot their extras in just before the next key already known. */
export function mergeOrder(lists: string[][]): string[] {
  const out: string[] = [];
  for (const list of lists) {
    let pending: string[] = [];
    for (const k of list) {
      const at = out.indexOf(k);
      if (at < 0) {
        pending.push(k);
      } else if (pending.length) {
        out.splice(at, 0, ...pending);
        pending = [];
      }
    }
    out.push(...pending);
  }
  return out;
}

/** One row per task across the runs (oldest first), with a note on what differs and in which run. */
export function compareRows(runs: Run[], schedules: ScheduledTask[][]): CompareRow[] {
  const maps = schedules.map(keyed);
  const order = mergeOrder([...maps].reverse().map((m) => [...m.keys()]));
  const at = (i: number) => dayTime(runs[i]?.startTime ?? 0);
  return order.map((key) => {
    const cells = maps.map((m) => m.get(key) ?? null);
    const name = cells.find(Boolean)?.name ?? key;
    const present = cells.map(Boolean);
    const k = present.findIndex((p, i) => i > 0 && p !== present[i - 1]);
    if (k > 0) return { key, name, cells, note: `${present[k] ? 'added' : 'removed'} at ${at(k)}`, tone: 'chg' };
    const idx = (pred: (t: ScheduledTask) => boolean) => cells.findIndex((t) => t !== null && pred(t));
    const f = idx((t) => t.state === 'f');
    if (f >= 0) return { key, name, cells, note: `failed at ${at(f)}`, tone: 'bad' };
    const ran = cells.map((t, i) => [t, i] as const).filter((x): x is readonly [ScheduledTask, number] => x[0]?.state === 'ok' && x[0].dur > 0);
    if (ran.length >= 2) {
      const fastest = Math.min(...ran.map(([t]) => t.dur));
      const [worst, wi] = ran.reduce((m, x) => (x[0].dur > m[0].dur ? x : m));
      if (worst.dur > fastest * 1.5) return { key, name, cells, note: `+${dur(worst.dur - fastest)} at ${at(wi)}`, tone: 'slow', slowIdx: wi };
    }
    const r = idx((t) => t.state === 'r');
    if (r >= 0) return { key, name, cells, note: `running at ${at(r)}`, tone: '' };
    const s = idx((t) => t.state === 's' || t.state === 'p');
    if (s >= 0) return { key, name, cells, note: `${cells[s]?.state === 'p' ? 'not started' : 'skipped'} at ${at(s)}`, tone: '' };
    return { key, name, cells, note: 'same', tone: '' };
  });
}

/** Every parameter any run used, with each run's value (null when not set). No diffing yet. */
export function paramRows(runs: Run[]): { key: string; values: (string | null)[] }[] {
  const keys = mergeOrder(runs.map((r) => Object.keys(r.params)));
  return keys.map((key) => ({ key, values: runs.map((r) => r.params[key] ?? null) }));
}

/** Adds a run to a comparison stack; a run of another job starts a new stack (comparing across jobs comes later). */
export function addToStack(stack: number[], id: number, byId: Map<number, Run>): number[] {
  const run = byId.get(id);
  if (!run) return stack;
  const first = stack.length ? byId.get(stack[0] ?? -1) : undefined;
  if (!first || first.name !== run.name) return [id];
  return stack.includes(id) ? stack : [...stack, id];
}

/** Runs of a stack, oldest first, skipping ids no longer in the data. */
export function stackRuns(stack: number[], byId: Map<number, Run>): Run[] {
  return stack.map((id) => byId.get(id)).filter((r): r is Run => r !== undefined).sort((a, b) => a.startTime - b.startTime);
}

/** "?compare=1,2,3" → [1, 2, 3]. */
export function idsFromSearch(search: string): number[] {
  const raw = new URLSearchParams(search).get('compare') ?? '';
  return raw.split(',').filter((x) => /^\d+$/.test(x)).map(Number);
}
