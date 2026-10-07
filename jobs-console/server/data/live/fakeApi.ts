import type { jobs, pipelines, sql } from '@databricks/sdk-experimental';
import type { LiveApi } from './api';
import { isTerminated } from './jobs';

/** Test double: serves canned SDK objects page by page. Only used by tests. */
export interface FakeData {
  user?: string;
  /** Workspace host host() answers with ('' when absent). */
  host?: string;
  jobs?: jobs.BaseJob[];
  jobPageSize?: number;
  jobsById?: Record<number, jobs.Job>;
  runs?: jobs.BaseRun[];
  runPageSize?: number;
  pipelines?: pipelines.PipelineStateInfo[];
  specs?: Record<string, pipelines.GetPipelineResponse>;
  updates?: Record<string, pipelines.UpdateInfo[]>;
  events?: Record<string, pipelines.PipelineEvent[]>;
  runsById?: Record<number, jobs.Run>;
  outputs?: Record<number, jobs.RunOutput>;
  /** Answers executeStatement inline (state SUCCEEDED); an Error is thrown. Params are the request's parameters by name. */
  sql?: (statement: string, params: Record<string, string>) => string[][] | Error;
  /** What workspaceId() answers ('' when absent). */
  workspaceId?: string;
  /** Delay (ms) before each call resolves. */
  delay?: number;
  fail?: Partial<Record<keyof LiveApi, Error>>;
}

export function fakeApi(data: FakeData): LiveApi & { calls: string[] } {
  const calls: string[] = [];
  const reply = async <T>(name: keyof LiveApi, value: () => T): Promise<T> => {
    calls.push(name);
    if (data.delay) await new Promise((r) => setTimeout(r, data.delay));
    if (data.fail?.[name]) throw data.fail[name];
    return value();
  };
  const size = data.runPageSize ?? 25;
  const jobSize = data.jobPageSize ?? 100;
  return {
    calls,
    host: () => Promise.resolve(data.host ?? ''),
    me: () => reply('me', () => ({ userName: data.user ?? 'me@x.com' })),
    listJobs: (req) =>
      reply('listJobs', () => {
        const all = data.jobs ?? [];
        const at = Number(req.page_token ?? 0);
        const next = at + jobSize;
        return { jobs: all.slice(at, next), next_page_token: next < all.length ? String(next) : undefined, has_more: next < all.length };
      }),
    getJob: (req) =>
      reply('getJob', () => {
        const j = data.jobsById?.[req.job_id];
        if (!j) throw Object.assign(new Error(`Job ${req.job_id} does not exist.`), { statusCode: 400, errorCode: 'INVALID_PARAMETER_VALUE' });
        return j;
      }),
    listJobRuns: (req) =>
      reply('listJobRuns', () => {
        const all = (data.runs ?? []).filter((r) => (r.start_time ?? 0) >= (req.start_time_from ?? 0) && (!req.active_only || !isTerminated(r)));
        const at = Number(req.page_token ?? 0);
        const next = at + size;
        return { runs: all.slice(at, next), next_page_token: next < all.length ? String(next) : undefined };
      }),
    getRun: (req) =>
      reply('getRun', () => {
        const r = data.runsById?.[req.run_id];
        if (!r) throw Object.assign(new Error(`Run ${req.run_id} does not exist.`), { statusCode: 400, errorCode: 'INVALID_PARAMETER_VALUE' });
        return r;
      }),
    getRunOutput: (req) => reply('getRunOutput', () => data.outputs?.[req.run_id] ?? {}),
    listPipelines: () => reply('listPipelines', () => ({ statuses: data.pipelines ?? [] })),
    getPipeline: (req) => reply('getPipeline', () => data.specs?.[req.pipeline_id] ?? { pipeline_id: req.pipeline_id }),
    listUpdates: (req) => reply('listUpdates', () => ({ updates: data.updates?.[req.pipeline_id] ?? [] })),
    getUpdate: (req) =>
      reply('getUpdate', () => {
        const u = data.updates?.[req.pipeline_id]?.find((x) => x.update_id === req.update_id);
        if (!u) throw Object.assign(new Error(`Update ${req.update_id} does not exist.`), { statusCode: 404, errorCode: 'RESOURCE_DOES_NOT_EXIST' });
        return { update: u };
      }),
    listPipelineEvents: (req) => reply('listPipelineEvents', () => ({ events: data.events?.[req.pipeline_id] ?? [] })),
    executeStatement: (req) =>
      reply('executeStatement', (): sql.StatementResponse => {
        const params = Object.fromEntries((req.parameters ?? []).map((p) => [p.name, p.value ?? '']));
        const rows = data.sql?.(req.statement, params) ?? [];
        if (rows instanceof Error) throw rows;
        return { statement_id: 'fake-statement', status: { state: 'SUCCEEDED' }, result: { data_array: rows, row_count: rows.length } };
      }),
    getStatement: (req) => reply('getStatement', () => ({ statement_id: req.statement_id, status: { state: 'SUCCEEDED' } })),
    getStatementChunk: () => reply('getStatementChunk', () => ({ data_array: [] })),
    workspaceId: () => reply('workspaceId', () => data.workspaceId ?? ''),
  };
}
