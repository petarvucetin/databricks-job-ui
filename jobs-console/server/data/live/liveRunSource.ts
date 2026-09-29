import type { Run, RunsResponse } from '../../../shared/domain/types';
import type { RunSource } from '../runSource';
import { SourceError } from '../sourceError';
import type { LiveApi } from './api';
import { Deadline, TIMEOUT, collectJobRuns, collectPipelines } from './collect';
import { jobDraft } from './jobs';
import { finalize, type Draft } from './kinds';
import type { LiveLimits } from './limits';
import { indexEvents, updateDraft } from './pipelines';
import { findTask, jobLogText, pipelineLogText } from './taskLog';

const DAY = 86400000;
const CACHE_TTL_MS = 20000;
const CACHE_MAX = 50;
const ID_MAP_MAX = 50000;

export interface PipelineRef {
  pipelineId: string;
  updateId: string;
  startTime: number;
}

/** Process-wide state shared by every request's source. Nothing in it grants access: every call still runs as the requester. */
export interface LiveState {
  /** Run.id of a pipeline update -> the update, for the log route. Refreshed on every list call. */
  pipelineRefs: Map<number, PipelineRef>;
  /** Per user and window, so reloads within the TTL don't fan out again. */
  cache: Map<string, { at: number; data: RunsResponse }>;
}

export const createLiveState = (): LiveState => ({ pipelineRefs: new Map(), cache: new Map() });

export interface LiveSourceOptions {
  api: LiveApi;
  /** User name (email) of the requester, compared with runAs for `mine`. */
  user: () => Promise<string>;
  /** Identifies the requester in the cache. */
  userKey: string;
  state: LiveState;
  limits: LiveLimits;
  clock?: () => number;
  warn?: (msg: string) => void;
}

/**
 * Status, error code and message of an SDK ApiError. When the SDK can't parse an error body (0.17.0 fails on
 * `details` entries without `metadata`, e.g. RequestInfo) it reports "Response from server (Bad Request) {json}";
 * the code and message are recovered from that JSON.
 */
export function apiErrorParts(e: unknown): { status?: number; code: string; message: string } {
  const x = e as { statusCode?: unknown; errorCode?: unknown };
  const status = typeof x?.statusCode === 'number' ? x.statusCode : undefined;
  let code = typeof x?.errorCode === 'string' ? x.errorCode : '';
  let message = e instanceof Error ? e.message : String(e);
  const raw = /^Response from server \([^)]*\) (\{.*\})$/s.exec(message)?.[1];
  if (raw) {
    try {
      const body = JSON.parse(raw) as { error_code?: unknown; message?: unknown };
      if (typeof body.error_code === 'string') code = body.error_code;
      if (typeof body.message === 'string') message = body.message;
    } catch {
      // not JSON after all: keep the SDK's message
    }
  }
  return { status, code, message };
}

/** SDK failures as SourceError: auth stays 401/403, the rest is a bad gateway. With `lookup`, a missing or invalid id is 404. */
export function toSourceError(e: unknown, lookup = false): SourceError {
  if (e instanceof SourceError) return e;
  const { status: s, code, message } = apiErrorParts(e);
  if (s === 401) return new SourceError(401, message);
  if (s === 403 || code === 'PERMISSION_DENIED') return new SourceError(403, message);
  if (lookup && (s === 404 || code === 'RESOURCE_DOES_NOT_EXIST' || code === 'INVALID_PARAMETER_VALUE')) return new SourceError(404, message);
  return new SourceError(502, message);
}

function remember<K, V>(map: Map<K, V>, key: K, value: V, max: number): void {
  map.delete(key);
  map.set(key, value);
  while (map.size > max) map.delete(map.keys().next().value as K);
}

export function createLiveRunSource(o: LiveSourceOptions): RunSource {
  const clock = o.clock ?? Date.now;
  const warn = o.warn ?? ((m: string) => console.warn(m));
  const { limits, state, api } = o;

  async function fetchRuns(since: number | undefined): Promise<RunsResponse> {
    const now = clock();
    const from = since ?? now - limits.windowDays * DAY;
    const dl = new Deadline(now + limits.timeoutMs, clock);
    const [me, jobsR, pipesR] = await Promise.all([
      dl.call(o.user),
      collectJobRuns(api, from, limits.maxRuns, dl),
      collectPipelines(api, from, limits.concurrency, dl),
    ]);
    const drafts: Draft[] = jobsR.runs.map((r) => jobDraft(r, now));
    for (const p of pipesR.pipelines) {
      const events = indexEvents(p.events ?? []);
      for (const u of p.updates) {
        const d = updateDraft(u, p.info, events.get(u.update_id ?? ''), now);
        drafts.push(d);
        remember(state.pipelineRefs, d.id, { pipelineId: p.info.pipelineId, updateId: u.update_id ?? '', startTime: d.startTime }, ID_MAP_MAX);
      }
    }
    const all: Run[] = finalize(drafts, me === TIMEOUT ? undefined : me).sort((a, b) => b.startTime - a.startTime || b.id - a.id);
    const runs = all.slice(0, limits.maxRuns);
    const capped = jobsR.capped || all.length > runs.length;
    const timedOut = jobsR.timedOut || pipesR.timedOut || me === TIMEOUT;
    if (capped || timedOut || pipesR.skipped) {
      warn(
        `[live] runs list cut short:${capped ? ` cap ${limits.maxRuns} hit;` : ''}${timedOut ? ` timeout ${limits.timeoutMs}ms hit;` : ''} ` +
          `returned ${runs.length} of ${all.length} (job runs ${jobsR.runs.length}, pipeline updates ${all.length - jobsR.runs.length}, ` +
          `pipelines ${pipesR.pipelines.length} with updates / ${pipesR.listed} listed, ${pipesR.skipped} skipped)`
      );
    }
    return { asOf: now, source: 'live', runs };
  }

  async function pipelineLog(ref: PipelineRef): Promise<string> {
    const events = [];
    let token: string | undefined;
    for (let pages = 0; pages < 5; pages++) {
      const page = await api.listPipelineEvents(
        token
          ? { pipeline_id: ref.pipelineId, page_token: token, max_results: 1000 }
          : { pipeline_id: ref.pipelineId, max_results: 1000, order_by: ['timestamp asc'], filter: `level in ('WARN', 'ERROR') AND timestamp >= '${new Date(ref.startTime).toISOString()}'` }
      );
      events.push(...(page.events ?? []));
      token = page.next_page_token;
      if (!token) break;
    }
    return pipelineLogText(events, ref.updateId);
  }

  async function jobLog(runId: number, taskKey: string): Promise<string> {
    const run = await api.getRun({ run_id: runId });
    const task = findTask(run, taskKey);
    if (!task) throw new SourceError(404, `Run ${runId} has no task "${taskKey}"`);
    const state = task.status?.state ?? task.state?.life_cycle_state;
    const started = state === 'RUNNING' || state === 'TERMINATING' || state === 'TERMINATED';
    const output = started && task.run_id ? await api.getRunOutput({ run_id: task.run_id }) : undefined;
    return jobLogText(task, output);
  }

  return {
    kind: 'live',
    async listRuns(since) {
      const key = `${o.userKey}|${since ?? ''}`;
      const hit = state.cache.get(key);
      if (hit && clock() - hit.at < CACHE_TTL_MS) return hit.data;
      let data: RunsResponse;
      try {
        data = await fetchRuns(since);
      } catch (e) {
        throw toSourceError(e);
      }
      remember(state.cache, key, { at: clock(), data }, CACHE_MAX);
      return data;
    },
    async taskLog(runId, task) {
      const ref = state.pipelineRefs.get(runId);
      try {
        return ref ? await pipelineLog(ref) : await jobLog(runId, task);
      } catch (e) {
        throw toSourceError(e, true);
      }
    },
  };
}
