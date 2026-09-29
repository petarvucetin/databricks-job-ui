export const RUN_KINDS = ['failed', 'retrying', 'slow', 'running', 'queued', 'succeeded'] as const;
export type RunKind = (typeof RUN_KINDS)[number];
export type RunType = 'job' | 'pipeline';
/** Finished-run outcome (Databricks result state): SUCCESS, FAILED, CANCELED, SUCCESS_WITH_FAILURES. */
export type RunResult = 'succeeded' | 'failed' | 'cancelled' | 'partial';

export interface Cause {
  label: string;
  code: string;
  detail: string;
}

export interface FailedTask {
  name: string;
  cause: Cause;
  secs: number;
}

export interface Run {
  id: number;
  runId: string;
  type: RunType;
  /** Full job or pipeline name, including the bundle target prefix such as "[dev john_smith] " (prod has none). */
  name: string;
  kind: RunKind;
  cause: Cause;
  /** Epoch milliseconds. */
  startTime: number;
  /** Elapsed so far for live runs, total otherwise; 0 while queued. */
  durationSec: number;
  /** Average duration of this job. */
  usualSec: number;
  ntasks: number;
  failed: FailedTask[];
  runAs: string;
  mine: boolean;
  /** Still going at `asOf`. */
  live: boolean;
  /** Continuous pipeline. */
  continuous: boolean;
  /** Final outcome once the run has finished; null while queued or running. */
  result: RunResult | null;
  /** Job parameters this run used, resolved (name -> value). */
  params: Record<string, string>;
}

export type DataSource = 'mock' | 'live' | 'replay';

/** GET /api/mode: what the shell badge and the Capture menu need to know. */
export interface DataMode {
  source: DataSource;
  /** Live and replay: whose authorization the data was read with ('app' = the app's service principal). */
  auth?: 'user' | 'app';
  /** The Capture menu (download / sweep) is available. Live mode only. */
  capture: boolean;
}

export interface RunsResponse {
  /** Epoch ms the data describes ("now" for the data set). */
  asOf: number;
  /** 'replay': recorded live data served back from a capture file (JOBS_CONSOLE_DATA=replay). */
  source: DataSource;
  /** Newest first. */
  runs: Run[];
}
