import type { jobs, pipelines } from '@databricks/sdk-experimental';
import type { LiveApi } from './api';
import { apiErrorParts } from './apiError';
import { Deadline, FINISHED_UPDATE, TIMEOUT, listAllPipelines, pool, readPipeline, type JobsCollected, type PipelinesCollected } from './collect';
import { isTerminated } from './jobs';
import type { PipelineInfo } from './pipelines';
import type { Diag } from './trace';

/** Clock skew and runs reported late: a delta asks for runs that started this long before the base's asOf. */
export const DELTA_MARGIN_MS = 2 * 60000;

/** A value as it was fetched, and when (clock ms), so an older fetch never overwrites a newer one. */
export interface Stamped<T> {
  value: T;
  at: number;
}

export interface BasePipeline {
  /** The pipeline as listPipelines showed it (latest_updates decides whether a delta re-reads it). */
  status: pipelines.PipelineStateInfo;
  info: PipelineInfo;
  /** Updates in the window by update_id. */
  updates: Map<string, Stamped<pipelines.UpdateInfo>>;
  /** Events read for the updates (end times, failure causes). */
  events: pipelines.PipelineEvent[];
}

/**
 * One user's snapshot of the collected SDK objects (not the mapped runs), so a delta can merge into it and re-map
 * everything with the same pure mappers a full load uses.
 */
export interface Base {
  /**
   * The window the base was loaded for: the `since` asked for (undefined: the default window), or `h:<local midnight>`
   * when the API covers today next to cached history. Another window means a full load.
   */
  since: number | string | undefined;
  /** Clock time of the fetch the base describes (the last full load or delta). */
  asOf: number;
  /** Clock time of the last full load. */
  fullAt: number;
  /** More job runs existed than maxRuns when it was loaded in full. */
  capped: boolean;
  runs: Map<number, Stamped<jobs.BaseRun>>;
  pipelines: Map<string, BasePipeline>;
}

/** A full load's collections as a base. Only pipelines read completely are in it; the rest count as new to the next delta. */
export function baseFromFull(since: Base['since'], now: number, jobsR: JobsCollected, pipesR: PipelinesCollected): Base {
  const runs = new Map<number, Stamped<jobs.BaseRun>>();
  for (const r of jobsR.runs) if (r.run_id !== undefined) runs.set(r.run_id, { value: r, at: now });
  const pipes = new Map<string, BasePipeline>();
  for (const { status, item } of pipesR.read) {
    pipes.set(item.info.pipelineId, {
      status,
      info: item.info,
      updates: new Map(item.updates.map((u) => [u.update_id ?? '', { value: u, at: now }])),
      events: item.events ?? [],
    });
  }
  return { since, asOf: now, fullAt: now, capped: jobsR.capped, runs, pipelines: pipes };
}

/** What a delta fetched. */
export interface DeltaFetched {
  /** Clock time the delta started (its fetches are at least this fresh). */
  asOf: number;
  /** runs/list active_only. */
  active: jobs.BaseRun[];
  /** runs/list since the base's asOf less the margin. */
  fresh: jobs.BaseRun[];
  /** getRun of runs that were live in the base and in neither list. */
  finished: jobs.BaseRun[];
  /** Runs getRun said no longer exist. */
  deleted: number[];
  /** The whole pipeline list. */
  statuses: pipelines.PipelineStateInfo[];
  /** Pipelines re-read (null: skipped, as a full load would skip it). */
  reread: Map<string, { info: PipelineInfo; updates: pipelines.UpdateInfo[]; events?: pipelines.PipelineEvent[] } | null>;
}

/** A delta step that failed: the caller falls back to a full load. */
export class DeltaError extends Error {}

const latestKey = (s: pipelines.PipelineStateInfo): string => {
  const u = s.latest_updates?.[0];
  return `${u?.update_id ?? ''}|${u?.state ?? ''}`;
};

/** Pipelines a delta must re-read: new ones, ones whose newest update changed id or state, and ones with a live update. */
export function pipelinesToReread(base: Base, statuses: pipelines.PipelineStateInfo[]): string[] {
  const out: string[] = [];
  for (const s of statuses) {
    const id = s.pipeline_id;
    if (!id) continue;
    const old = base.pipelines.get(id);
    if (!old || latestKey(old.status) !== latestKey(s) || [...old.updates.values()].some((u) => !FINISHED_UPDATE.has(u.value.state ?? ''))) out.push(id);
  }
  return out;
}

const isGone = (e: unknown): boolean => {
  // A deleted run: 404, or (runs/get) 400 INVALID_PARAMETER_VALUE "Run 123 does not exist."
  const { status, code, message } = apiErrorParts(e);
  return status === 404 || code === 'RESOURCE_DOES_NOT_EXIST' || (code === 'INVALID_PARAMETER_VALUE' && /does not exist/i.test(message));
};

async function allRunPages(api: LiveApi, req: jobs.ListRunsRequest, max: number, dl: Deadline, what: string): Promise<jobs.BaseRun[]> {
  const out: jobs.BaseRun[] = [];
  let token: string | undefined;
  do {
    const page = await dl.call(() => api.listJobRuns({ ...req, expand_tasks: true, limit: 25, page_token: token }));
    if (page === TIMEOUT) throw new DeltaError(`the time budget ran out listing ${what}`);
    out.push(...(page.runs ?? []));
    if (out.length > max) throw new DeltaError(`more than ${max} ${what}`);
    token = page.next_page_token;
  } while (token);
  return out;
}

/**
 * Everything that can have changed since the base: active runs, runs started since base.asOf less the margin, a
 * getRun for each run live in the base but in neither list (404: deleted), the pipeline list, and a re-read of the
 * pipelines pipelinesToReread picks. Any failure or timeout throws (DeltaError, or the SDK error).
 */
export async function fetchDelta(api: LiveApi, base: Base, o: { now: number; from: number; maxRuns: number; concurrency: number; dl: Deadline; diag: Diag }): Promise<DeltaFetched> {
  const { dl, diag } = o;
  const [active, fresh, listing] = await Promise.all([
    allRunPages(api, { active_only: true }, o.maxRuns, dl, 'active runs'),
    allRunPages(api, { start_time_from: base.asOf - DELTA_MARGIN_MS }, o.maxRuns, dl, 'new runs'),
    listAllPipelines(api, dl),
  ]);
  if (listing.timedOut) throw new DeltaError('the time budget ran out listing pipelines');

  const seen = new Set<number | undefined>([...active, ...fresh].map((r) => r.run_id));
  const check = [...base.runs.values()].filter((e) => !isTerminated(e.value) && !seen.has(e.value.run_id)).map((e) => e.value.run_id!);
  const finished: jobs.BaseRun[] = [];
  const deleted: number[] = [];
  await pool(check, o.concurrency, async (runId) => {
    const got = await dl.call(() => api.getRun({ run_id: runId })).catch((e: unknown) => {
      if (isGone(e)) return undefined;
      throw e;
    });
    if (got === undefined) deleted.push(runId);
    else if (got === TIMEOUT) throw new DeltaError(`the time budget ran out reading run ${runId}`);
    else finished.push(got);
  });

  const wanted = new Set(pipelinesToReread(base, listing.statuses));
  const reread: DeltaFetched['reread'] = new Map();
  const todo = listing.statuses.filter((s): s is pipelines.PipelineStateInfo & { pipeline_id: string } => !!s.pipeline_id && wanted.has(s.pipeline_id));
  await pool(todo, o.concurrency, async (s) => {
    const got = await readPipeline(api, s, o.from, dl, diag, base.pipelines.get(s.pipeline_id)?.info);
    if (got === 'timeout' || (got !== 'skipped' && got.partial)) throw new DeltaError(`the time budget ran out reading pipeline ${s.pipeline_id}`);
    reread.set(s.pipeline_id, got === 'skipped' ? null : got.item);
  });
  return { asOf: o.now, active, fresh, finished, deleted, statuses: listing.statuses, reread };
}

/**
 * History mode, for a full load: the job runs that started before `from` the API must still cover (H2, ruling R6).
 * Every active run, and the runs of the `old` base (same window) from before `from` that are no longer active, read
 * once more with getRun (gone: dropped). Runs in `have` are left out. A timeout throws DeltaError.
 */
export async function collectEarlier(api: LiveApi, o: { from: number; maxRuns: number; concurrency: number; dl: Deadline; old?: Base; have: Set<number> }): Promise<jobs.BaseRun[]> {
  const active = await allRunPages(api, { active_only: true }, o.maxRuns, o.dl, 'active runs');
  const out = active.filter((r) => r.run_id !== undefined && !o.have.has(r.run_id));
  const seen = new Set([...o.have, ...out.map((r) => r.run_id!)]);
  const check: number[] = [];
  for (const { value: r } of o.old?.runs.values() ?? []) {
    if (r.run_id === undefined || seen.has(r.run_id) || (r.start_time ?? 0) >= o.from) continue;
    if (isTerminated(r)) out.push(r);
    else check.push(r.run_id);
  }
  await pool(check, o.concurrency, async (runId) => {
    const got = await o.dl.call(() => api.getRun({ run_id: runId })).catch((e: unknown) => {
      if (isGone(e)) return undefined;
      throw e;
    });
    if (got === TIMEOUT) throw new DeltaError(`the time budget ran out reading run ${runId}`);
    if (got) out.push(got);
  });
  return out;
}

export interface MergeCounts {
  active: number;
  fresh: number;
  finished: number;
  deleted: number;
  reread: number;
  pipelines: number;
  /** Job runs and pipeline updates dropped because they started before the window. */
  agedOut: number;
}

const eventKey = (e: pipelines.PipelineEvent): string => e.id ?? `${e.timestamp ?? ''}|${e.event_type ?? ''}|${e.origin?.update_id ?? ''}|${e.message ?? ''}`;

/** Events of both lists, each once, newest first, none before `from`. */
export function mergeEvents(a: pipelines.PipelineEvent[], b: pipelines.PipelineEvent[], from: number): pipelines.PipelineEvent[] {
  const byKey = new Map<string, pipelines.PipelineEvent>();
  for (const e of [...a, ...b]) {
    const t = e.timestamp ? Date.parse(e.timestamp) : NaN;
    if (!Number.isNaN(t) && t < from) continue;
    byKey.set(eventKey(e), e);
  }
  return [...byKey.values()].sort((x, y) => (y.timestamp ?? '').localeCompare(x.timestamp ?? ''));
}

/** Puts `v` at `k` unless what is there was fetched later. */
function put<K, T>(map: Map<K, Stamped<T>>, k: K, v: T, at: number): void {
  const old = map.get(k);
  if (!old || old.at <= at) map.set(k, { value: v, at });
}

/**
 * base + a delta -> the new base (a new object; `base` is not changed). By run_id / update_id, keeping whichever copy
 * was fetched later; deleted runs and pipelines no longer listed go; anything that started before `from` ages out;
 * job runs are capped at maxRuns, newest kept. `keepEarlier` (history mode, where `from` is fixed for the day): job runs
 * that started before `from` stay (they came in active), so a finished one is read once more and kept until midnight.
 */
export function mergeBase(base: Base, d: DeltaFetched, from: number, maxRuns: number, keepEarlier = false): { base: Base; counts: MergeCounts } {
  const runs = new Map(base.runs);
  for (const r of [...d.fresh, ...d.active, ...d.finished]) if (r.run_id !== undefined) put(runs, r.run_id, r, d.asOf);
  for (const id of d.deleted) runs.delete(id);
  let agedOut = 0;
  for (const [id, e] of runs) {
    if (!keepEarlier && (e.value.start_time ?? 0) < from) {
      runs.delete(id);
      agedOut++;
    }
  }
  let capped = base.capped;
  if (runs.size > maxRuns) {
    const keep = [...runs.values()].sort((a, b) => (b.value.start_time ?? 0) - (a.value.start_time ?? 0) || (b.value.run_id ?? 0) - (a.value.run_id ?? 0)).slice(0, maxRuns);
    runs.clear();
    for (const e of keep) runs.set(e.value.run_id!, e);
    capped = true;
  }

  const pipes = new Map<string, BasePipeline>();
  for (const status of d.statuses) {
    const id = status.pipeline_id;
    if (!id) continue;
    const old = base.pipelines.get(id);
    const got = d.reread.get(id);
    let next: BasePipeline;
    if (got === null) continue; // skipped, as a full load would
    if (got) {
      const updates = new Map<string, Stamped<pipelines.UpdateInfo>>();
      for (const u of got.updates) updates.set(u.update_id ?? '', { value: u, at: d.asOf });
      // A single-run refresh newer than this read keeps its copy.
      for (const [uid, e] of old?.updates ?? []) if (e.at > d.asOf && updates.has(uid)) updates.set(uid, e);
      next = { status, info: got.info, updates, events: mergeEvents(got.events ?? [], old?.events ?? [], from) };
    } else if (old) next = { ...old, status, updates: new Map(old.updates), events: mergeEvents(old.events, [], from) };
    else continue;
    for (const [uid, e] of [...next.updates]) {
      if ((e.value.creation_time ?? 0) < from) {
        next.updates.delete(uid);
        agedOut++;
      }
    }
    pipes.set(id, next);
  }
  const counts: MergeCounts = {
    active: d.active.length,
    fresh: d.fresh.length,
    finished: d.finished.length,
    deleted: d.deleted.length,
    reread: [...d.reread.values()].filter(Boolean).length,
    pipelines: d.statuses.length,
    agedOut,
  };
  return { base: { since: base.since, asOf: d.asOf, fullAt: base.fullAt, capped, runs, pipelines: pipes }, counts };
}
