import { WorkspaceClient, type iam, type jobs, type pipelines } from '@databricks/sdk-experimental';

/**
 * Every Databricks call the live source makes, one page per call, returning the SDK objects unchanged.
 * Mapping lives in pure functions over these objects, so a recorder or replayer can wrap or replace this.
 */
export interface LiveApi {
  me(): Promise<iam.User>;
  listJobRuns(req: jobs.ListRunsRequest): Promise<jobs.ListRunsResponse>;
  getRun(req: jobs.GetRunRequest): Promise<jobs.Run>;
  getRunOutput(req: jobs.GetRunOutputRequest): Promise<jobs.RunOutput>;
  listPipelines(req: pipelines.ListPipelinesRequest): Promise<pipelines.ListPipelinesResponse>;
  getPipeline(req: pipelines.GetPipelineRequest): Promise<pipelines.GetPipelineResponse>;
  listUpdates(req: pipelines.ListUpdatesRequest): Promise<pipelines.ListUpdatesResponse>;
  listPipelineEvents(req: pipelines.ListPipelineEventsRequest): Promise<pipelines.ListPipelineEventsResponse>;
}

/** `token` given: that user's token (Databricks Apps forwards it). Omitted: the SDK default auth chain (local dev profile). */
export function createSdkApi(opts: { host?: string; token?: string }): LiveApi {
  const client = opts.token ? new WorkspaceClient({ host: opts.host, token: opts.token, authType: 'pat' }) : new WorkspaceClient({});
  // The SDK's list methods are async iterators over every page; these fetch exactly one page, same paths and fields.
  const page = <T>(path: string, query: Record<string, unknown>): Promise<T> => {
    const q = Object.fromEntries(Object.entries(query).filter(([k, v]) => v !== undefined && k !== 'pipeline_id'));
    return client.apiClient.request({ path, method: 'GET', headers: new Headers({ Accept: 'application/json' }), raw: false, query: q as never }) as Promise<T>;
  };
  return {
    me: () => client.currentUser.me(),
    listJobRuns: (req) => page('/api/2.2/jobs/runs/list', { ...req }),
    getRun: (req) => client.jobs.getRun(req),
    getRunOutput: (req) => client.jobs.getRunOutput(req),
    listPipelines: (req) => page('/api/2.0/pipelines', { ...req }),
    getPipeline: (req) => client.pipelines.get(req),
    listUpdates: (req) => client.pipelines.listUpdates(req),
    listPipelineEvents: (req) => page(`/api/2.0/pipelines/${encodeURIComponent(req.pipeline_id)}/events`, { ...req }),
  };
}
