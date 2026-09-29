import type { DataSource, Run, RunsResponse } from '../../shared/domain/types';
import { createMockRunSource } from './mock/mockRunSource';
import { createLiveProvider } from './live/liveProvider';
import type { Trace } from './live/trace';
import { createReplayProvider } from './capture/replayProvider';

/** Where runs come from: the generated mock data set, the Jobs + Pipelines APIs as the signed-in user, or a capture of those replayed. */
export interface RunSource {
  readonly kind: DataSource;
  /**
   * Runs with startTime >= since, newest first. When since is undefined the mock returns every run, the live source its default window.
   * tzOffsetMin is the caller's `Date.getTimezoneOffset()`; the mock source buckets its
   * generated "now" and quiet days by that zone instead of the server's.
   */
  listRuns(since?: number, tzOffsetMin?: number): Promise<RunsResponse>;
  /**
   * Log text of one task in a run. `hint` is what the client already knows about how the task ended
   * (its failure cause label, or "retrying"); the mock source uses it to write a matching ending, a live one ignores it.
   * Throws SourceError for an unknown run (404) or a refused one (401/403).
   */
  taskLog(runId: number, task: string, hint?: string): Promise<string>;
  /**
   * One run, freshly read, in the same shape as in listRuns (for refreshing an open drawer). `tzOffsetMin` as in listRuns.
   * Throws SourceError for an unknown run (404) or a refused one (401/403).
   */
  getRun(runId: number, tzOffsetMin?: number): Promise<Run>;
}

export interface RequestLike {
  headers: Record<string, string | string[] | undefined>;
}

/** Hands each request its RunSource (live sources act as the request's user), or the status to refuse it with. */
export interface RunSourceProvider {
  readonly kind: DataSource;
  /** Live and replay: whose authorization reads the data ('app' = the app's service principal, JOBS_CONSOLE_AUTH=app). */
  readonly auth?: 'user' | 'app';
  /** `trace` (live only) records the request's calls and diagnostics into the capture. */
  forRequest(req: RequestLike, trace?: Trace): RunSource | { status: number; error: string };
}

export function selectRunSource(env: Record<string, string | undefined>): RunSourceProvider {
  const mode = env.JOBS_CONSOLE_DATA ?? 'mock';
  if (mode === 'mock') {
    const source = createMockRunSource();
    return { kind: 'mock', forRequest: () => source };
  }
  if (mode === 'live') return createLiveProvider(env);
  if (mode === 'replay') return createReplayProvider(env);
  throw new Error(`Unknown JOBS_CONSOLE_DATA "${mode}"`);
}
