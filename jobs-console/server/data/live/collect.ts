import type { jobs, pipelines } from '@databricks/sdk-experimental';
import type { LiveApi } from './api';
import { apiErrorParts } from './apiError';
import type { PipelineInfo } from './pipelines';
import { noDiag, type Diag } from './trace';

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
export async function collectPipelines(api: LiveApi, from: number, concurrency: number, dl: Deadline, diag: Diag = noDiag): Promise<PipelinesCollected> {
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
  let notReached = 0;
  await pool(listed, concurrency, async (p) => {
    const pipelineId = p.pipeline_id;
    if (!pipelineId) {
      diag({ level: 'warn', code: 'missing-field', message: `listed pipeline "${p.name ?? ''}" has no pipeline_id; skipped` });
      return;
    }
    if (dl.expired) {
      timedOut = true;
      notReached++;
      return;
    }
    try {
      const [spec, updates] = await Promise.all([dl.call(() => api.getPipeline({ pipeline_id: pipelineId })), updatesSince(api, pipelineId, from, dl)]);
      if (spec === TIMEOUT || updates === TIMEOUT) {
        timedOut = true;
        diag({ level: 'warn', code: 'updates-skipped', message: 'the time budget ran out while reading this pipeline; its updates are left out', ref: `pipeline ${pipelineId}` });
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
        const events = await eventsSince(api, pipelineId, from, dl, diag);
        if (events === TIMEOUT) timedOut = true;
        else item.events = events;
      }
      out.push(item);
    } catch (e) {
      // One pipeline's failure (permissions, a gone pipeline, an API quirk) skips that pipeline only. Sign-in failures
      // affect every call, so they still fail the list.
      const s = statusOf(e);
      if (s === 401) throw e;
      skipped++;
      diag({ level: 'warn', code: 'pipeline-skipped', message: `skipped (${s ?? 'error'}): ${apiErrorParts(e).message}`, ref: `pipeline ${pipelineId}` });
    }
  });
  if (notReached) diag({ level: 'warn', code: 'pipelines-not-reached', message: `${notReached} of ${listed.length} pipelines not read: the time budget ran out` });
  return { pipelines: out, listed: listed.length, skipped, timedOut: timedOut || dl.expired };
}

/** The events API rejects max_results above 250 ("Cannot have more than 250 events per page"). */
export const EVENTS_PAGE_SIZE = 250;
const EVENTS_MAX_PAGES = 4;

/**
 * A pipeline's events since `from`, newest first, up to EVENTS_MAX_PAGES pages. Events only add end times and
 * failure causes, so a failing events call costs this pipeline those details (with a diagnostic), never the whole list.
 */
async function eventsSince(api: LiveApi, pipelineId: string, from: number, dl: Deadline, diag: Diag): Promise<pipelines.PipelineEvent[] | undefined | typeof TIMEOUT> {
  const out: pipelines.PipelineEvent[] = [];
  let token: string | undefined;
  for (let n = 0; n < EVENTS_MAX_PAGES; n++) {
    let page: pipelines.ListPipelineEventsResponse | typeof TIMEOUT;
    try {
      // A page token carries the query; the API rejects filter alongside it.
      page = await dl.call(() =>
        api.listPipelineEvents(
          token
            ? { pipeline_id: pipelineId, max_results: EVENTS_PAGE_SIZE, page_token: token }
            : { pipeline_id: pipelineId, max_results: EVENTS_PAGE_SIZE, filter: `level in ('INFO', 'WARN', 'ERROR') AND timestamp >= '${new Date(from).toISOString()}'` }
        )
      );
    } catch (e) {
      diag({ level: 'warn', code: 'events-failed', message: `events call failed; finished updates have no end time or cause: ${apiErrorParts(e).message}`, ref: `pipeline ${pipelineId}` });
      return out.length ? out : undefined;
    }
    if (page === TIMEOUT) {
      diag({ level: 'warn', code: 'events-skipped-budget', message: 'events call skipped: the time budget ran out; finished updates have no end time or cause', ref: `pipeline ${pipelineId}` });
      return out.length ? out : TIMEOUT;
    }
    out.push(...(page.events ?? []));
    token = page.next_page_token;
    if (!token) return out;
  }
  diag({ level: 'info', code: 'events-truncated', message: `more than ${EVENTS_MAX_PAGES} events pages (${out.length} read); older updates may have no end time`, ref: `pipeline ${pipelineId}` });
  return out;
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
