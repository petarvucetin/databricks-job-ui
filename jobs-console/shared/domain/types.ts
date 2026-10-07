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
  /**
   * A job's pipeline task. Its own message only says to see the pipeline's logs: 'unread' until the run's own refresh
   * has taken the cause from the pipeline's events ('read').
   */
  pipeline?: 'unread' | 'read';
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
  /** Live with a warehouse: where run history comes from. Absent in mock mode. */
  history?: HistoryInfo;
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
  /** Live and replay: where the older runs came from. Absent in mock mode. */
  history?: HistoryInfo;
}

export type HistoryInfo =
  | { source: 'system-tables'; days: number; capped?: boolean }
  | { source: 'api'; days: number; reason?: string; capped?: boolean };

/** A full load re-reads the whole window; a delta only what can have changed since the last list. */
export interface RefreshInfo {
  mode: 'full' | 'delta';
  /** Databricks API calls it made. */
  calls: number;
  ms: number;
}

export type TriggerKind = 'schedule' | 'periodic' | 'file_arrival' | 'table_update' | 'continuous' | 'manual';

export interface Schedule {
  /** Quartz cron as the Jobs API returns it (settings.schedule.quartz_cron_expression). */
  cron: string;
  /** settings.schedule.timezone_id, e.g. "UTC", "America/Los_Angeles". */
  tz: string;
  paused: boolean;
}

export interface Item {
  type: 'job' | 'pipeline';
  /** job_id as a string, or pipeline_id. */
  id: string;
  /** Full name including the bundle target prefix. */
  name: string;
  description?: string;
  creator?: string;
  /** Who it runs as: settings.run_as.service_principal_name ?? .user_name ?? creator (jobs); run_as_user_name ?? creator (pipelines). */
  runAs?: string;
  /** Runs as a service principal (decision #11 "Deployed"). */
  deployed: boolean;
  /** Created or runs as the signed-in user (decision #11 "Mine"). */
  mine: boolean;
  tags: Record<string, string>;
  trigger: TriggerKind;
  /** Present when trigger = 'schedule'. */
  schedule?: Schedule;
  /** Present when trigger = 'periodic': trigger.periodic {interval, unit}. */
  periodic?: { interval: number; unit: 'HOURS' | 'DAYS' | 'WEEKS' };
  /** Trigger paused (schedule, periodic, file arrival, table update or continuous). */
  paused: boolean;
  /** settings.deployment.kind === 'BUNDLE' (jobs) / spec.deployment.kind (pipelines). */
  bundle: boolean;
  /** Pipelines only: the jobs that start it through a pipeline_task. */
  startedBy?: { jobId: string; jobName: string }[];
  /** Item page in the workspace; absent in mock data. */
  url?: string;
}

export interface ItemsResponse {
  asOf: number;
  source: DataSource;
  items: Item[];
  /** The list was cut short (time budget or page cap): it shows what was read. */
  partial?: { reason: string };
}

export interface ItemDetail {
  item: Item;
  /** Jobs: tasks from jobs/get, dependencies first. */
  tasks?: { key: string; type: string; dependsOn: string[] }[];
  /** Pipelines: from pipelines/{id} spec. */
  pipeline?: { kind: 'ETL' | 'Ingestion'; continuous: boolean; target?: string; serverless: boolean; channel?: string };
}
