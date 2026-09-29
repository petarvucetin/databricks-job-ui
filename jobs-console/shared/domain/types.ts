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

/**
 * Task state, one letter-ish code per task: ok = succeeded, f = failed, s = skipped (did not run: an upstream task
 * failed, or it was cancelled or excluded), r = running (or waiting to retry), p = pending (not started yet).
 */
export type TaskState = 'ok' | 'f' | 's' | 'r' | 'p';

/**
 * One task of a run, as the workspace reported it (the latest attempt of each task key). Kept small: the list response
 * carries it for every run.
 */
export interface RunTask {
  /** task_key (for a pipeline update, the pipeline name). */
  key: string;
  /** Seconds from the run's start; -1 when the task has not started. */
  startSec: number;
  /** Seconds it took, or has taken so far when running; 0 when not started. */
  durSec: number;
  state: TaskState;
  /** Indexes into the run's tasks this one waits on. */
  deps: number[];
  /** attempt_number of the attempt shown (0 = first try). */
  attempt: number;
  /** Index into Run.failed when this task failed. */
  failIndex?: number;
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
  /**
   * The run's real tasks, dependencies first (topological order, ties by start time). Live and replay data only;
   * absent in mock data, where the client draws synthetic tasks from `ntasks` and `failed`.
   */
  tasks?: RunTask[];
  /** The run's (or update's) own page in the Databricks workspace. Absent in mock data or when the host is unknown. */
  url?: string;
  /** Job id of a job run. */
  jobId?: number;
  /** Pipeline id of a pipeline update. */
  pipelineId?: string;
}

export type DataSource = 'mock' | 'live' | 'replay';

/** GET /api/mode: what the shell badge and the Capture menu need to know. */
export interface DataMode {
  source: DataSource;
  /** Live and replay: whose authorization the data was read with ('app' = the app's service principal). */
  auth?: 'user' | 'app';
  /** The Capture menu (download / sweep) is available. Live mode only. */
  capture: boolean;
  /** Live: the workspace being monitored; replay: the workspace the capture came from. Origin URL, e.g. https://adb-1.2.azuredatabricks.net. */
  workspace?: string;
  /** Live, local runs: the Databricks CLI profile the workspace was resolved from. */
  profile?: string;
  /** Who is looking: the signed-in viewer (deployed), the CLI login (local), or the capture's user (replay). */
  user?: string;
  /** The identity the Databricks APIs are called as, when it isn't `user` (deployed with JOBS_CONSOLE_AUTH=app: the app's service principal). */
  readAs?: string;
}

export interface RunsResponse {
  /** Epoch ms the data describes ("now" for the data set). */
  asOf: number;
  /** 'replay': recorded live data served back from a capture file (JOBS_CONSOLE_DATA=replay). */
  source: DataSource;
  /** Newest first. */
  runs: Run[];
  /** Live and replay: how the server got this list. The client ignores it (tests and diagnostics read it). */
  refresh?: RefreshInfo;
}

/** A full load re-reads the whole window; a delta only what can have changed since the last list. */
export interface RefreshInfo {
  mode: 'full' | 'delta';
  /** Databricks API calls it made. */
  calls: number;
  ms: number;
}
