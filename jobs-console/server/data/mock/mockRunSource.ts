import type { RunsResponse } from '../../../shared/domain/types';
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

export function createMockRunSource(clock: () => number = Date.now): RunSource {
  const cache = new Map<number, RunsResponse>();
  const dataFor = (tzOffsetMin: number): RunsResponse => {
    let data = cache.get(tzOffsetMin);
    if (!data) {
      data = generateRuns(tzOffsetMin);
      cache.set(tzOffsetMin, data);
    }
    return data;
  };
  return {
    kind: 'mock',
    listRuns(since, tzOffsetMin) {
      const data = shiftTo(dataFor(tzOffsetMin ?? DEFAULT_TZ_OFFSET_MIN), clock());
      return Promise.resolve({ ...data, runs: since === undefined ? data.runs : data.runs.filter((r) => r.startTime >= since) });
    },
    taskLog(runId, task, hint) {
      return Promise.resolve(mockTaskLog(runId, task, hint));
    },
    getRun(runId, tzOffsetMin) {
      const run = shiftTo(dataFor(tzOffsetMin ?? DEFAULT_TZ_OFFSET_MIN), clock()).runs.find((r) => r.id === runId);
      return run ? Promise.resolve(run) : Promise.reject(new SourceError(404, `Run ${runId} does not exist`));
    },
    // Temporary stubs until the mock items land.
    listItems: () => Promise.reject(new SourceError(501, 'items not implemented yet')),
    getItem: () => Promise.reject(new SourceError(501, 'items not implemented yet')),
  };
}
