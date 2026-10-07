import type { DataSource, HistoryInfo, ItemDetail, ItemsResponse, Run, RunsResponse } from '../../shared/domain/types';
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
   * `full` (live): re-read the whole window instead of a delta over the last list, bypassing the response cache.
   */
  listRuns(since?: number, tzOffsetMin?: number, opts?: { full?: boolean }): Promise<RunsResponse>;
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
  /** Every job and pipeline definition the user can see (the Jobs & ETL tab). Live: own time budget, `partial` when it runs out. */
  listItems(): Promise<ItemsResponse>;
  /** One definition with its tasks (job) or facts (pipeline). Throws SourceError(404) for an unknown id, 401/403 when refused. */
  getItem(type: 'job' | 'pipeline', id: string): Promise<ItemDetail>;
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
  /** Live: where the requester's run history comes from (probed as them); replay: as the recorded session had it. Mock: absent. */
  history?(req: RequestLike): Promise<HistoryInfo | undefined>;
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
