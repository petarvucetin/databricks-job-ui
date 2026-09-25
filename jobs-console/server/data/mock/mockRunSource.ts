import type { RunSource } from '../runSource';
import { generateRuns } from './generateRuns';

export function createMockRunSource(): RunSource {
  const data = generateRuns();
  return {
    kind: 'mock',
    listRuns(since) {
      return Promise.resolve({ ...data, runs: since === undefined ? data.runs : data.runs.filter((r) => r.startTime >= since) });
    },
  };
}
