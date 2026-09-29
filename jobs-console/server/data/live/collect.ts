import type { jobs, pipelines } from '@databricks/sdk-experimental';
import type { LiveApi } from './api';
import type { PipelineInfo } from './pipelines';

export const TIMEOUT = Symbol('timeout');

/** One shared time budget for every call a request fans out to. A call cut off by it is dropped, not failed. */
export class Deadline {
  constructor(
    private readonly at: number,
    private readonly clock: () => number = Date.now
  ) {}
  get expired(): boolean {
    return this.clock() >= this.at;
  }
  call<T>(fn: () => Promise<T>): Promise<T | typeof TIMEOUT> {
    const left = this.at - this.clock();
    if (left <= 0) return Promise.resolve(TIMEOUT);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const cut = new Promise<typeof TIMEOUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMEOUT), left);
    });
    return Promise.race([fn(), cut]).finally(() => clearTimeout(timer));
  }
}

/** Runs fn over items with at most `limit` in flight. */
export async function pool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

export interface JobsCollected {
  runs: jobs.BaseRun[];
  /** More runs existed past maxRuns. */
  capped: boolean;
  timedOut: boolean;
}

/** runs/list pages (25 per page, newest first) from `from` on, until maxRuns or the deadline. */
export async function collectJobRuns(api: LiveApi, from: number, maxRuns: number, dl: Deadline): Promise<JobsCollected> {
  const runs: jobs.BaseRun[] = [];
  let token: string | undefined;
  do {
    const page = await dl.call(() => api.listJobRuns({ expand_tasks: true, start_time_from: from, limit: 25, page_token: token }));
    if (page === TIMEOUT) return { runs, capped: false, timedOut: true };
    runs.push(...(page.runs ?? []));
    token = page.next_page_token;
    if (runs.length >= maxRuns) return { runs: runs.slice(0, maxRuns), capped: runs.length > maxRuns || !!token, timedOut: false };
  } while (token);
  return { runs, capped: false, timedOut: false };
}

export interface PipelineCollected {
  info: PipelineInfo;
  updates: pipelines.UpdateInfo[];
  /** One events page (newest first) when some update in the window has finished. */
  events?: pipelines.PipelineEvent[];
}

export interface PipelinesCollected {
  pipelines: PipelineCollected[];
  /** Pipelines listed, including those skipped or not reached. */
  listed: number;
  /** Pipelines skipped because they vanished or are not visible (404/403). */
  skipped: number;
  timedOut: boolean;
}

const statusOf = (e: unknown): number | undefined => (e as { statusCode?: unknown })?.statusCode as number | undefined;
const FINISHED = new Set<string>(['COMPLETED', 'FAILED', 'CANCELED']);

/**
 * All pipelines (100 per page), then per pipeline, `concurrency` at a time: getPipeline + listUpdates back to `from`,
 * and at most one events call (INFO/WARN/ERROR since `from`) for end times and failure causes.
 */
export async function collectPipelines(api: LiveApi, from: number, concurrency: number, dl: Deadline): Promise<PipelinesCollected> {
  const listed: pipelines.PipelineStateInfo[] = [];
  let timedOut = false;
  let token: string | undefined;
  do {
    const page = await dl.call(() => api.listPipelines({ max_results: 100, page_token: token }));
    if (page === TIMEOUT) {
      timedOut = true;
      break;
    }
    listed.push(...(page.statuses ?? []));
    token = page.next_page_token;
  } while (token);

  const out: PipelineCollected[] = [];
  let skipped = 0;
  await pool(listed, concurrency, async (p) => {
    const pipelineId = p.pipeline_id;
    if (!pipelineId || dl.expired) {
      if (dl.expired) timedOut = true;
      return;
    }
    try {
      const [spec, updates] = await Promise.all([dl.call(() => api.getPipeline({ pipeline_id: pipelineId })), updatesSince(api, pipelineId, from, dl)]);
      if (spec === TIMEOUT || updates === TIMEOUT) {
        timedOut = true;
        return;
      }
      if (!updates.length) return;
      const info: PipelineInfo = {
        pipelineId,
        name: spec.name ?? p.name ?? pipelineId,
        continuous: !!spec.spec?.continuous,
        runAs: spec.run_as_user_name ?? p.run_as_user_name ?? spec.creator_user_name ?? p.creator_user_name ?? '',
      };
      const item: PipelineCollected = { info, updates };
      if (updates.some((u) => FINISHED.has(u.state ?? ''))) {
        const page = await dl.call(() =>
          api.listPipelineEvents({ pipeline_id: pipelineId, max_results: 1000, filter: `level in ('INFO', 'WARN', 'ERROR') AND timestamp >= '${new Date(from).toISOString()}'` })
        );
        if (page === TIMEOUT) timedOut = true;
        else item.events = page.events ?? [];
      }
      out.push(item);
    } catch (e) {
      const s = statusOf(e);
      if (s !== 403 && s !== 404) throw e;
      skipped++;
    }
  });
  return { pipelines: out, listed: listed.length, skipped, timedOut: timedOut || dl.expired };
}

async function updatesSince(api: LiveApi, pipelineId: string, from: number, dl: Deadline): Promise<pipelines.UpdateInfo[] | typeof TIMEOUT> {
  const out: pipelines.UpdateInfo[] = [];
  let token: string | undefined;
  do {
    const page = await dl.call(() => api.listUpdates({ pipeline_id: pipelineId, page_token: token }));
    if (page === TIMEOUT) return out.length ? out : TIMEOUT;
    const updates = page.updates ?? [];
    out.push(...updates.filter((u) => (u.creation_time ?? 0) >= from));
    if (updates.some((u) => (u.creation_time ?? 0) < from)) break;
    token = page.next_page_token;
  } while (token);
  return out;
}
