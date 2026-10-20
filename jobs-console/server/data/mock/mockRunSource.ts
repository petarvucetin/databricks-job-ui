import type { Item, RunsResponse } from '../../../shared/domain/types';
import { mockDetail, mockItems } from './mockItems';
import type { RunSource } from '../runSource';
import { SourceError } from '../sourceError';
import { generateRuns } from './generateRuns';
import { mockTaskLog } from './taskLog';

const DEFAULT_TZ_OFFSET_MIN = new Date(2026, 8, 22).getTimezoneOffset();
const MINUTE = 60000;

/** Moves a generated data set so its "now" is the current minute: the timeline then always ends today. */
function shiftTo(data: RunsResponse, nowMs: number): RunsResponse {
  const delta = Math.floor(nowMs / MINUTE) * MINUTE - data.asOf;
  return { ...data, asOf: data.asOf + delta, runs: data.runs.map((r) => ({ ...r, startTime: r.startTime + delta })) };
}

export type MockVariant = 'dev' | 'stg' | 'prod';

// Share of jobs kept per variant, by a stable hash of the job's type and name: prod all, stg about 2/3, dev about 1/2.
const KEEP: Record<MockVariant, (h: number) => boolean> = { prod: () => true, stg: (h) => h % 3 !== 0, dev: (h) => h % 2 === 0 };

function nameHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Drops the runs of jobs this variant lacks; the rest keep their names (prefixed later, see prefixed). */
function applyVariant(data: RunsResponse, variant: MockVariant): RunsResponse {
  const keep = KEEP[variant];
  return { ...data, runs: data.runs.filter((r) => keep(nameHash(`${r.type}|${r.name}`))) };
}

/** `variant` (multi-env mock) gives each environment its own subset of the data with names prefixed `<variant>_`; none leaves the data as generated. */
export function createMockRunSource(clock: () => number = Date.now, variant?: MockVariant): RunSource {
  const prefixed = (name: string): string => (variant ? `${variant}_${name}` : name);
  const cache = new Map<number, RunsResponse>();
  let items: Item[] | undefined;
  const dataFor = (tzOffsetMin: number): RunsResponse => {
    let data = cache.get(tzOffsetMin);
    if (!data) {
      data = generateRuns(tzOffsetMin);
      if (variant) data = applyVariant(data, variant);
      cache.set(tzOffsetMin, data);
    }
    return data;
  };
  /** Runs as the UI sees them: names prefixed. */
  const named = (data: RunsResponse): RunsResponse => (variant ? { ...data, runs: data.runs.map((r) => ({ ...r, name: prefixed(r.name) })) } : data);
  /** Items built from the unprefixed runs (so ids, tags and trigger shapes match the base data), then named. */
  const itemsFor = (data: RunsResponse): Item[] =>
    mockItems(data.runs, data.asOf).map((i) => ({
      ...i,
      name: prefixed(i.name),
      ...(i.startedBy && { startedBy: i.startedBy.map((s) => ({ ...s, jobName: prefixed(s.jobName) })) }),
    }));
  return {
    kind: 'mock',
    listRuns(since, tzOffsetMin) {
      const data = named(shiftTo(dataFor(tzOffsetMin ?? DEFAULT_TZ_OFFSET_MIN), clock()));
      return Promise.resolve({ ...data, runs: since === undefined ? data.runs : data.runs.filter((r) => r.startTime >= since) });
    },
    taskLog(runId, task, hint) {
      return Promise.resolve(mockTaskLog(runId, task, hint));
    },
    getRun(runId, tzOffsetMin) {
      const run = named(shiftTo(dataFor(tzOffsetMin ?? DEFAULT_TZ_OFFSET_MIN), clock())).runs.find((r) => r.id === runId);
      return run ? Promise.resolve(run) : Promise.reject(new SourceError(404, `Run ${runId} does not exist`));
    },
    listItems() {
      const data = shiftTo(dataFor(DEFAULT_TZ_OFFSET_MIN), clock());
      items ??= itemsFor(data);
      return Promise.resolve({ asOf: data.asOf, source: 'mock', items });
    },
    getItem(type, id) {
      const data = dataFor(DEFAULT_TZ_OFFSET_MIN); // detail needs only names and ntasks: no shift
      items ??= itemsFor(data);
      const item = items.find((i) => i.type === type && i.id === id);
      return item ? Promise.resolve(mockDetail(item, named(data).runs)) : Promise.reject(new SourceError(404, `${type} ${id} does not exist`));
    },
  };
}
