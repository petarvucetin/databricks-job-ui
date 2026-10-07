import { Config, WorkspaceClient, type iam, type jobs, type pipelines, type sql } from '@databricks/sdk-experimental';
import { workspaceOrigin } from './links';

/**
 * Every Databricks call the live source makes, one page per call, returning the SDK objects unchanged.
 * Mapping lives in pure functions over these objects, so a recorder or replayer can wrap or replace this.
 */
export interface LiveApi {
  /** Workspace URL this API reads from ('' when unknown), for links to runs. Configuration, not a call: never recorded. */
  host: () => Promise<string>;
  me: () => Promise<iam.User>;
  /** One page of job definitions (GET /api/2.2/jobs/list). */
  listJobs: (req: jobs.ListJobsRequest) => Promise<jobs.ListJobsResponse>;
  /** One job definition with its tasks (GET /api/2.2/jobs/get). */
  getJob: (req: jobs.GetJobRequest) => Promise<jobs.Job>;
  listJobRuns: (req: jobs.ListRunsRequest) => Promise<jobs.ListRunsResponse>;
  getRun: (req: jobs.GetRunRequest) => Promise<jobs.Run>;
  getRunOutput: (req: jobs.GetRunOutputRequest) => Promise<jobs.RunOutput>;
  listPipelines: (req: pipelines.ListPipelinesRequest) => Promise<pipelines.ListPipelinesResponse>;
  getPipeline: (req: pipelines.GetPipelineRequest) => Promise<pipelines.GetPipelineResponse>;
  listUpdates: (req: pipelines.ListUpdatesRequest) => Promise<pipelines.ListUpdatesResponse>;
  /** One pipeline update, for refreshing a single run (GET /api/2.0/pipelines/{pipeline_id}/updates/{update_id}). */
  getUpdate: (req: pipelines.GetUpdateRequest) => Promise<pipelines.GetUpdateResponse>;
  listPipelineEvents: (req: pipelines.ListPipelineEventsRequest) => Promise<pipelines.ListPipelineEventsResponse>;
  /** Run one SQL statement on a warehouse (POST /api/2.0/sql/statements). */
  executeStatement: (req: sql.ExecuteStatementRequest) => Promise<sql.StatementResponse>;
  /** Poll a statement that was still PENDING/RUNNING. */
  getStatement: (req: { statement_id: string }) => Promise<sql.StatementResponse>;
  /** One further result chunk of a statement. */
  getStatementChunk: (req: { statement_id: string; chunk_index: number }) => Promise<sql.ResultData>;
  /** The workspace id from the x-databricks-org-id header of SCIM Me ('' when absent). Recorded, unlike host. */
  workspaceId: () => Promise<string>;
}

/** Workspace URL the SDK default auth chain resolves to (local dev: the DATABRICKS_CONFIG_PROFILE host). */
export async function resolveDefaultHost(): Promise<string | undefined> {
  try {
    return (await new Config({}).getHost()).origin;
  } catch {
    return undefined;
  }
}

/** `token` given: that user's token (Databricks Apps forwards it). Omitted: the SDK default auth chain (local dev profile). */
export function createSdkApi(opts: { host?: string; token?: string }): LiveApi {
  const client = opts.token ? new WorkspaceClient({ host: opts.host, token: opts.token, authType: 'pat' }) : new WorkspaceClient({});
  // The SDK's list methods are async iterators over every page; these fetch exactly one page, same paths and fields.
  const page = <T>(path: string, query: Record<string, unknown>): Promise<T> => {
    const q = Object.fromEntries(Object.entries(query).filter(([k, v]) => v !== undefined && k !== 'pipeline_id'));
    return client.apiClient.request({ path, method: 'GET', headers: new Headers({ Accept: 'application/json' }), raw: false, query: q as never }) as Promise<T>;
  };
  let host: Promise<string> | undefined;
  return {
    // The host the client resolved (explicit, or the default chain's profile / DATABRICKS_HOST), once per client.
    host: () => (host ??= client.config.getHost().then((u) => workspaceOrigin(u.origin), () => '')),
    me: () => client.currentUser.me(),
    listJobs: (req) => page('/api/2.2/jobs/list', { ...req }),
    getJob: (req) => client.jobs.get(req),
    listJobRuns: (req) => page('/api/2.2/jobs/runs/list', { ...req }),
    getRun: (req) => client.jobs.getRun(req),
    getRunOutput: (req) => client.jobs.getRunOutput(req),
    listPipelines: (req) => page('/api/2.0/pipelines', { ...req }),
    getPipeline: (req) => client.pipelines.get(req),
    listUpdates: (req) => client.pipelines.listUpdates(req),
    getUpdate: (req) => client.pipelines.getUpdate(req),
    listPipelineEvents: (req) => page(`/api/2.0/pipelines/${encodeURIComponent(req.pipeline_id)}/events`, { ...req }),
    executeStatement: (req) => client.statementExecution.executeStatement(req),
    getStatement: (req) => client.statementExecution.getStatement(req),
    getStatementChunk: (req) => client.statementExecution.getStatementResultChunkN(req),
    workspaceId: async () => {
      const res = (await client.apiClient.request({
        path: '/api/2.0/preview/scim/v2/Me',
        method: 'GET',
        headers: new Headers(),
        raw: false,
        query: {},
        responseHeaders: ['x-databricks-org-id'],
      })) as Record<string, unknown>;
      const id = res['x-databricks-org-id'];
      return typeof id === 'string' ? id : '';
    },
  };
}
