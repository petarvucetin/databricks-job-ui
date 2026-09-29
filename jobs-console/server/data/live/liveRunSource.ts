import type { Run, RunsResponse } from '../../../shared/domain/types';
import type { RunSource } from '../runSource';
import { SourceError } from '../sourceError';
import type { LiveApi } from './api';
import { apiErrorParts } from './apiError';
import { Deadline, EVENTS_PAGE_SIZE, TIMEOUT, collectJobRuns, collectPipelines } from './collect';
import { jobDraft } from './jobs';
import { finalize, type Draft } from './kinds';
import type { LiveLimits } from './limits';
import { indexEvents, updateDraft } from './pipelines';
import { findTask, jobLogText, pipelineLogText } from './taskLog';
import { noDiag, type Trace } from './trace';

const DAY = 86400000;
const CACHE_TTL_MS = 20000;
const CACHE_MAX = 50;
const ID_MAP_MAX = 50000;

export { apiErrorParts };

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
  /** Clock for the time budget only (default: clock). Replay freezes `clock` at the recorded asOf but keeps a real budget. */
  timer?: () => number;
  warn?: (msg: string) => void;
  /** Capture hooks: records every call and the diagnostics of this request. */
  trace?: Trace;
  /** What the response says it is (default 'live'). */
  source?: 'live' | 'replay';
}

/** Counts calls per LiveApi method, for the `pages` diagnostic. */
function counting(api: LiveApi): { api: LiveApi; counts: Map<string, number> } {
  const counts = new Map<string, number>();
  const out = {} as Record<string, unknown>;
  for (const name of Object.keys(api) as (keyof LiveApi)[]) {
    const fn = api[name] as (req: unknown) => Promise<unknown>;
    if (typeof fn !== 'function') continue;
    out[name] = (req: unknown) => {
      counts.set(name, (counts.get(name) ?? 0) + 1);
      return fn(req);
    };
  }
  return { api: out as unknown as LiveApi, counts };
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
  const timer = o.timer ?? clock;
  const warn = o.warn ?? ((m: string) => console.warn(m));
  const diag = o.trace?.diag ?? noDiag;
  const { limits, state } = o;
  const api = o.trace ? o.trace.wrap(o.api) : o.api;

  async function fetchRuns(since: number | undefined): Promise<RunsResponse> {
    const now = clock();
    o.trace?.note({ now, limits });
    const from = since ?? now - limits.windowDays * DAY;
    const dl = new Deadline(timer() + limits.timeoutMs, timer);
    const c = counting(api);
    const user = () =>
      o.user().then((u) => {
        o.trace?.note({ user: u });
        return u;
      });
    // Straight from o.api: the host is configuration, not a counted or recorded call.
    const [host, me, jobsR, pipesR] = await Promise.all([
      o.api.host().catch(() => ''),
      dl.call(user),
      collectJobRuns(c.api, from, limits.maxRuns, dl),
      collectPipelines(c.api, from, limits.concurrency, dl, diag),
    ]);
    diag({ level: 'info', code: 'pages', message: [...c.counts].map(([k, n]) => `${k} ${n}`).join(', ') || 'no calls' });
    const drafts: Draft[] = jobsR.runs.map((r) => jobDraft(r, now, diag, host));
    for (const p of pipesR.pipelines) {
      const events = indexEvents(p.events ?? []);
      for (const u of p.updates) {
        const d = updateDraft(u, p.info, events.get(u.update_id ?? ''), now, diag, host);
        drafts.push(d);
        remember(state.pipelineRefs, d.id, { pipelineId: p.info.pipelineId, updateId: u.update_id ?? '', startTime: d.startTime }, ID_MAP_MAX);
      }
    }
    const all: Run[] = finalize(drafts, me === TIMEOUT ? undefined : me).sort((a, b) => b.startTime - a.startTime || b.id - a.id);
    const runs = all.slice(0, limits.maxRuns);
    const capped = jobsR.capped || all.length > runs.length;
    const timedOut = jobsR.timedOut || pipesR.timedOut || me === TIMEOUT;
    const counts = `returned ${runs.length} of ${all.length} (job runs ${jobsR.runs.length}, pipeline updates ${all.length - jobsR.runs.length}, pipelines ${pipesR.pipelines.length} with updates / ${pipesR.listed} listed, ${pipesR.skipped} skipped)`;
    if (capped) diag({ level: 'warn', code: 'cap-hit', message: `cap ${limits.maxRuns} hit; ${counts}` });
    if (timedOut) diag({ level: 'warn', code: 'timeout-hit', message: `timeout ${limits.timeoutMs}ms hit${me === TIMEOUT ? ' (user name not resolved)' : ''}; ${counts}` });
    if (capped || timedOut || pipesR.skipped) {
      warn(
        `[live] runs list cut short:${capped ? ` cap ${limits.maxRuns} hit;` : ''}${timedOut ? ` timeout ${limits.timeoutMs}ms hit;` : ''} ` +
          `returned ${runs.length} of ${all.length} (job runs ${jobsR.runs.length}, pipeline updates ${all.length - jobsR.runs.length}, ` +
          `pipelines ${pipesR.pipelines.length} with updates / ${pipesR.listed} listed, ${pipesR.skipped} skipped)`
      );
    }
    return { asOf: now, source: o.source ?? 'live', runs };
  }

  async function pipelineLog(ref: PipelineRef): Promise<string> {
    const events = [];
    let token: string | undefined;
    for (let pages = 0; pages < 8; pages++) {
      const page = await api.listPipelineEvents(
        token
          ? { pipeline_id: ref.pipelineId, page_token: token, max_results: EVENTS_PAGE_SIZE }
          : { pipeline_id: ref.pipelineId, max_results: EVENTS_PAGE_SIZE, order_by: ['timestamp asc'], filter: `level in ('WARN', 'ERROR') AND timestamp >= '${new Date(ref.startTime).toISOString()}'` }
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
      if (hit && clock() - hit.at < CACHE_TTL_MS) {
        o.trace?.note({ now: hit.data.asOf });
        diag({ level: 'info', code: 'cache-hit', message: `served from the ${CACHE_TTL_MS / 1000}s cache (asOf ${new Date(hit.data.asOf).toISOString()})` });
        return hit.data;
      }
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
