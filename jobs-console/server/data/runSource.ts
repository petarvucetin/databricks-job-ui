import type { RunsResponse } from '../../shared/domain/types';
import { createMockRunSource } from './mock/mockRunSource';

/** Where runs come from. The mock source ships now; a live one (Jobs + Pipelines APIs as the signed-in user) comes later. */
export interface RunSource {
  readonly kind: 'mock' | 'live';
  /**
   * Runs with startTime >= since (all runs when since is undefined), newest first.
   * tzOffsetMin is the caller's `Date.getTimezoneOffset()`; the mock source buckets its
   * generated "now" and quiet days by that zone instead of the server's.
   */
  listRuns(since?: number, tzOffsetMin?: number): Promise<RunsResponse>;
  /**
   * Log text of one task in a run. `hint` is what the client already knows about how the task ended
   * (its failure cause label, or "retrying"); the mock source uses it to write a matching ending, a live one ignores it.
   */
  taskLog(runId: number, task: string, hint?: string): Promise<string>;
}

export function selectRunSource(env: Record<string, string | undefined>): RunSource {
  const mode = env.JOBS_CONSOLE_DATA ?? 'mock';
  if (mode === 'mock') return createMockRunSource();
  if (mode === 'live') throw new Error('JOBS_CONSOLE_DATA=live is not available yet');
  throw new Error(`Unknown JOBS_CONSOLE_DATA "${mode}"`);
}
