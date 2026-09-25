import type { RunsResponse } from '../../../shared/domain/types';
import type { RunSource } from '../runSource';
import { generateRuns } from './generateRuns';

const DEFAULT_TZ_OFFSET_MIN = new Date(2026, 8, 22).getTimezoneOffset();

export function createMockRunSource(): RunSource {
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
      const data = dataFor(tzOffsetMin ?? DEFAULT_TZ_OFFSET_MIN);
      return Promise.resolve({ ...data, runs: since === undefined ? data.runs : data.runs.filter((r) => r.startTime >= since) });
    },
  };
}
