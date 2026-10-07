import type { jobs, pipelines } from '@databricks/sdk-experimental';
import type { ItemsResponse, RefreshInfo, Run, RunsResponse } from '../../../shared/domain/types';
import type { RunSource } from '../runSource';
import { SourceError } from '../sourceError';
import type { LiveApi } from './api';
import { apiErrorParts, toSourceError } from './apiError';
import { Deadline, EVENTS_PAGE_SIZE, FINISHED_UPDATE, TIMEOUT, collectJobRuns, collectPipelines, eventsSince } from './collect';
import { baseFromFull, fetchDelta, mergeBase, mergeEvents, type Base } from './delta';
import { createLiveItems } from './items';
import { jobDraft } from './jobs';
import { finalize, runKey, usualByKey, type Draft } from './kinds';
import { DEFAULT_REFRESH, type LiveLimits, type RefreshSettings } from './limits';
import { indexEvents, updateDraft, type PipelineInfo } from './pipelines';
import { findTask, jobLogText, pipelineLogText } from './taskLog';
import { attemptChain, pipelineOutputOf, pipelineTaskCause, pipelineTaskLogText } from './pipelineTask';
import { noDiag, type Trace } from './trace';

const DAY = 86400000;
const CACHE_TTL_MS = 20000;
const CACHE_MAX = 50;
const BASES_MAX = 50;
const ID_MAP_MAX = 50000;
type UpdateEventsInput = Parameters<typeof indexEvents>[0] | undefined;

/** What one list reads and maps: job runs, and each pipeline's updates with the events read for them. */
interface Collected {
  runs: Iterable<jobs.BaseRun>;
  pipelines: Iterable<{ info: PipelineInfo; updates: Iterable<pipelines.UpdateInfo>; events?: pipelines.PipelineEvent[] }>;
}

const collectedOf = (b: Base): Collected => ({
  runs: [...b.runs.values()].map((e) => e.value),
  pipelines: [...b.pipelines.values()].map((p) => ({ info: p.info, updates: [...p.updates.values()].map((e) => e.value), events: p.events })),
});

/** Entries of `older` fetched later than their copy in `next` (a single-run refresh that raced a list): copied into next. */
function carryNewer(next: Base, older: Base): void {
  for (const [id, e] of older.runs) {
    const n = next.runs.get(id);
    if (n && e.at > n.at) next.runs.set(id, e);
  }
  for (const [pid, p] of older.pipelines) {
    const n = next.pipelines.get(pid);
    if (!n) continue;
    for (const [uid, e] of p.updates) {
      const u = n.updates.get(uid);
      if (u && e.at > u.at) {
        n.updates.set(uid, e);
        n.events = mergeEvents(n.events, p.events, 0);
      }
    }
  }
}

export { apiErrorParts, toSourceError };

export interface PipelineRef {
  pipelineId: string;
  updateId: string;
  startTime: number;
  /** The pipeline as the list read it (name, continuous, run as), so refreshing one update needs no getPipeline. */
  info: PipelineInfo;
}

/** Process-wide state shared by every request's source. Nothing in it grants access: every call still runs as the requester. */
export interface LiveState {
  /** Run.id of a pipeline update -> the update, for the log and single-run routes. Refreshed on every list call. */
  pipelineRefs: Map<number, PipelineRef>;
  /** Per user and window, so reloads within the TTL don't fan out again. */
  cache: Map<string, { at: number; data: RunsResponse }>;
  /** Per user: the collected SDK objects of the last full load, with every delta since merged in. */
  bases: Map<string, Base>;
  /** Per user: the Jobs & ETL definitions list (TTL 5 min), separate from the run caches. */
  items: Map<string, { at: number; data: ItemsResponse }>;
}

export const createLiveState = (): LiveState => ({ pipelineRefs: new Map(), cache: new Map(), bases: new Map(), items: new Map() });

export interface ListOptions {
  /** A full load even when a delta would do (the filter bar's refresh-now button: `?full=1`). Skips the response cache. */
  full?: boolean;
}

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
  /** Deltas on or off, and how old a base may get (default DEFAULT_REFRESH). */
  refresh?: RefreshSettings;
  /**
   * Replay: the mode the recorded request ran in. 'delta' does a delta whenever there is a base for the same window
   * (whatever its age); 'full' always loads in full.
   */
  mode?: RefreshInfo['mode'];
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
  const refresh = o.refresh ?? DEFAULT_REFRESH;
  const itemsSrc = createLiveItems({ api, user: o.user, userKey: o.userKey, state, limits, clock, timer, source: o.source });

  /** Maps what was collected (a full load's lists, or a merged base) with the pure mappers; remembers pipeline refs. */
  function mapCollected(col: Collected, now: number, me: string | undefined, host: string): { all: Run[]; jobRuns: number; withUpdates: number } {
    const drafts: Draft[] = [];
    for (const r of col.runs) drafts.push(jobDraft(r, now, diag, host));
    const jobRuns = drafts.length;
    let withUpdates = 0;
    for (const p of col.pipelines) {
      const events = indexEvents(p.events ?? []);
      let any = false;
      for (const u of p.updates) {
        const d = updateDraft(u, p.info, events.get(u.update_id ?? ''), now, diag, host);
        drafts.push(d);
        any = true;
        remember(state.pipelineRefs, d.id, { pipelineId: p.info.pipelineId, updateId: u.update_id ?? '', startTime: d.startTime, info: p.info }, ID_MAP_MAX);
      }
      if (any) withUpdates++;
    }
    const all: Run[] = finalize(drafts, me).sort((a, b) => b.startTime - a.startTime || b.id - a.id);
    return { all, jobRuns, withUpdates };
  }

  /** Stores `next` as the requester's base unless a newer one landed meanwhile; keeps single-run fetches newer than it. */
  function commitBase(next: Base): void {
    const cur = state.bases.get(o.userKey);
    if (cur && cur !== next) {
      if (cur.asOf > next.asOf) return;
      carryNewer(next, cur);
    }
    remember(state.bases, o.userKey, next, BASES_MAX);
  }

  /** Why this list must be a full load, or null when a delta over the base will do. */
  function fullReason(base: Base | undefined, since: number | undefined, now: number, asked: boolean): string | null {
    if (o.mode === 'full') return 'replayed as a full load';
    if (!refresh.incremental) return 'deltas are off (JOBS_CONSOLE_INCREMENTAL=0)';
    if (!base) return 'no base yet';
    if (base.since !== since) return 'the window changed';
    if (o.mode === 'delta') return null;
    if (asked) return 'asked for (full=1)';
    if (now - base.fullAt >= refresh.fullRefreshMs) return `the base is older than ${refresh.fullRefreshMs}ms`;
    return null;
  }

  async function fetchRuns(since: number | undefined, askedFull: boolean): Promise<RunsResponse> {
    const started = timer();
    const now = clock();
    o.trace?.note({ now, limits });
    const from = since ?? now - limits.windowDays * DAY;
    const c = counting(api);
    const user = () =>
      o.user().then((u) => {
        o.trace?.note({ user: u });
        return u;
      });
    // Straight from o.api: the host is configuration, not a counted or recorded call.
    const hostP = o.api.host().catch(() => '');
    const base = state.bases.get(o.userKey);
    const reason = fullReason(base, since, now, askedFull);

    let out: { mode: RefreshInfo['mode']; all: Run[]; jobRuns: number; withUpdates: number; listed: number; skipped: number; capped: boolean; timedOut: boolean; me: string | typeof TIMEOUT } | undefined;
    if (base && !reason) {
      const dl = new Deadline(timer() + limits.timeoutMs, timer);
      try {
        const [host, me, d] = await Promise.all([hostP, dl.call(user), fetchDelta(c.api, base, { now, from, maxRuns: limits.maxRuns, concurrency: limits.concurrency, dl, diag })]);
        const merged = mergeBase(base, d, from, limits.maxRuns);
        const k = merged.counts;
        diag({
          level: 'info',
          code: 'delta',
          message: `active runs ${k.active}, new runs ${k.fresh}, finished via getRun ${k.finished}, deleted ${k.deleted}, pipelines re-read ${k.reread} of ${k.pipelines}, aged out of the window ${k.agedOut}`,
        });
        diag({ level: 'info', code: 'pages', message: [...c.counts].map(([key, n]) => `${key} ${n}`).join(', ') || 'no calls' });
        commitBase(merged.base);
        const m = mapCollected(collectedOf(merged.base), now, me === TIMEOUT ? undefined : me, host);
        out = { mode: 'delta', ...m, listed: k.pipelines, skipped: 0, capped: merged.base.capped, timedOut: me === TIMEOUT, me };
      } catch (e) {
        // Nothing of the delta is kept: the full load starts from scratch.
        diag({ level: 'warn', code: 'delta-fallback', message: `delta refresh failed, loading in full: ${apiErrorParts(e).message}` });
      }
    } else {
      diag({ level: 'info', code: 'full-load', message: `full load: ${reason ?? 'no base yet'}` });
    }

    if (!out) {
      const dl = new Deadline(timer() + limits.timeoutMs, timer);
      const [host, me, jobsR, pipesR] = await Promise.all([hostP, dl.call(user), collectJobRuns(c.api, from, limits.maxRuns, dl), collectPipelines(c.api, from, limits.concurrency, dl, diag)]);
      diag({ level: 'info', code: 'pages', message: [...c.counts].map(([k, n]) => `${k} ${n}`).join(', ') || 'no calls' });
      const timedOut = jobsR.timedOut || pipesR.timedOut || me === TIMEOUT;
      // A load the time budget cut short is served, but is no base: the next list loads in full again.
      if (!jobsR.timedOut && !pipesR.timedOut && refresh.incremental) commitBase(baseFromFull(since, now, jobsR, pipesR));
      const m = mapCollected({ runs: jobsR.runs, pipelines: pipesR.pipelines }, now, me === TIMEOUT ? undefined : me, host);
      out = { mode: 'full', ...m, listed: pipesR.listed, skipped: pipesR.skipped, capped: jobsR.capped, timedOut, me };
    }

    const { all, me } = out;
    const runs = all.slice(0, limits.maxRuns);
    const capped = out.capped || all.length > runs.length;
    const counts = `returned ${runs.length} of ${all.length} (job runs ${out.jobRuns}, pipeline updates ${all.length - out.jobRuns}, pipelines ${out.withUpdates} with updates / ${out.listed} listed, ${out.skipped} skipped)`;
    if (capped) diag({ level: 'warn', code: 'cap-hit', message: `cap ${limits.maxRuns} hit; ${counts}` });
    if (out.timedOut) diag({ level: 'warn', code: 'timeout-hit', message: `timeout ${limits.timeoutMs}ms hit${me === TIMEOUT ? ' (user name not resolved)' : ''}; ${counts}` });
    if (capped || out.timedOut || out.skipped) {
      warn(`[live] runs list cut short:${capped ? ` cap ${limits.maxRuns} hit;` : ''}${out.timedOut ? ` timeout ${limits.timeoutMs}ms hit;` : ''} ${counts}`);
    }
    const info: RefreshInfo = { mode: out.mode, calls: [...c.counts.values()].reduce((a, b) => a + b, 0), ms: Math.max(0, Math.round(timer() - started)) };
    o.trace?.note({ refresh: info });
    return { asOf: now, source: o.source ?? 'live', runs, refresh: info };
  }

  /** A pipeline's WARN and ERROR events since `from`, oldest first, up to 8 pages. */
  async function warnErrorEvents(pipelineId: string, from: number): Promise<pipelines.PipelineEvent[]> {
    const events = [];
    let token: string | undefined;
    for (let pages = 0; pages < 8; pages++) {
      const page = await api.listPipelineEvents(
        token
          ? { pipeline_id: pipelineId, page_token: token, max_results: EVENTS_PAGE_SIZE }
          : { pipeline_id: pipelineId, max_results: EVENTS_PAGE_SIZE, order_by: ['timestamp asc'], filter: `level in ('WARN', 'ERROR') AND timestamp >= '${new Date(from).toISOString()}'` }
      );
      events.push(...(page.events ?? []));
      token = page.next_page_token;
      if (!token) break;
    }
    return events;
  }

  async function pipelineLog(ref: PipelineRef): Promise<string> {
    return pipelineLogText(await warnErrorEvents(ref.pipelineId, ref.startTime), ref.updateId);
  }

  /**
   * The updates a job's pipeline task ran (the one it started and the pipeline's retries) and their WARN/ERROR events;
   * undefined for other tasks. A failing update list only costs the retries in between.
   */
  async function pipelineTaskRead(task: jobs.RunTask, output: jobs.RunOutput | undefined): Promise<{ chain: string[]; events: pipelines.PipelineEvent[] } | undefined> {
    const pipelineId = task.pipeline_task?.pipeline_id;
    const po = pipelineOutputOf(output);
    if (!pipelineId || !po) return undefined;
    const updates = await api.listUpdates({ pipeline_id: pipelineId, max_results: 25 }).then((r) => r.updates ?? [], (): pipelines.UpdateInfo[] => []);
    const events = await warnErrorEvents(pipelineId, task.start_time ?? 0);
    return { chain: attemptChain(updates, po.requestId, po.updateId), events };
  }

  async function jobLog(runId: number, taskKey: string): Promise<string> {
    const run = await api.getRun({ run_id: runId });
    const task = findTask(run, taskKey);
    if (!task) throw new SourceError(404, `Run ${runId} has no task "${taskKey}"`);
    const state = task.status?.state ?? task.state?.life_cycle_state;
    const started = state === 'RUNNING' || state === 'TERMINATING' || state === 'TERMINATED';
    const output = started && task.run_id ? await api.getRunOutput({ run_id: task.run_id }) : undefined;
    const pipe = await pipelineTaskRead(task, output);
    return pipe ? pipelineTaskLogText(pipe.events, pipe.chain, output?.error) : jobLogText(task, output);
  }

  /**
   * A failed pipeline task says only "refer to the logs for this pipeline": its cause comes from the pipeline's events
   * instead (the run's too when it was taken from that task). Best effort: a failed read keeps the task's cause.
   */
  async function withPipelineCauses(run: jobs.Run, draft: Draft, dl: Deadline): Promise<void> {
    for (const [i, f] of draft.failed.entries()) {
      const task = findTask(run, f.name);
      if (!task?.pipeline_task || !task.run_id) continue;
      const got = await dl
        .call(async () => {
          const pipe = await pipelineTaskRead(task, await api.getRunOutput({ run_id: task.run_id! }));
          return pipe && pipelineTaskCause(pipe.events, pipe.chain);
        })
        .catch(() => undefined);
      if (!got || got === TIMEOUT) continue;
      if (draft.cause === f.cause) draft.cause = got.cause;
      draft.failed[i] = { ...f, cause: got.cause, pipeline: 'read' };
    }
  }

  const mineKey = `${o.userKey}|`;

  /** The requester's newest cached list (any window): the runs a single refreshed run is averaged with. */
  function cachedRuns(): Run[] {
    let best: { at: number; data: RunsResponse } | undefined;
    for (const [k, v] of state.cache) if (k.startsWith(mineKey) && (!best || v.at > best.at)) best = v;
    return best?.data.runs ?? [];
  }

  /** Puts a refreshed run into the requester's cached lists, so a list served from the cache does not go back in time. */
  function patchCache(run: Run): void {
    for (const [k, v] of state.cache) {
      if (!k.startsWith(mineKey)) continue;
      const i = v.data.runs.findIndex((r) => r.id === run.id);
      if (i < 0) continue;
      const runs = v.data.runs.slice();
      runs[i] = run;
      state.cache.set(k, { at: v.at, data: { ...v.data, runs } });
    }
  }

  /** One pipeline update: getUpdate, plus the pipeline's events since it started (end time and cause) once it has finished. */
  async function updateDraftOf(ref: PipelineRef, now: number, host: string, dl: Deadline): Promise<{ draft: Draft; commit: () => void }> {
    const got = await api.getUpdate({ pipeline_id: ref.pipelineId, update_id: ref.updateId });
    const u = got.update;
    if (!u) throw new SourceError(404, `Pipeline ${ref.pipelineId} has no update ${ref.updateId}`);
    let events: UpdateEventsInput = undefined;
    if (FINISHED_UPDATE.has(u.state ?? '')) {
      const got = await eventsSince(api, ref.pipelineId, u.creation_time ?? ref.startTime, dl, diag);
      if (got !== TIMEOUT) events = got;
    }
    const draft = updateDraft(u, ref.info, indexEvents(events ?? []).get(ref.updateId), now, diag, host);
    // Into the base too, so the next delta starts from this copy (it only re-reads the pipeline when it has changed).
    const commit = () => {
      const p = state.bases.get(o.userKey)?.pipelines.get(ref.pipelineId);
      const old = p?.updates.get(ref.updateId);
      if (!p || !old || old.at > now) return;
      p.updates.set(ref.updateId, { value: u, at: now });
      if (events?.length) p.events = mergeEvents(p.events, events, 0);
    };
    return { draft, commit };
  }

  /** A job run read on its own, into the base (unless the base holds a later copy or no longer has the run). */
  function commitJobRun(run: jobs.Run, now: number): void {
    const runs = state.bases.get(o.userKey)?.runs;
    const old = run.run_id === undefined ? undefined : runs?.get(run.run_id);
    if (runs && old && old.at <= now) runs.set(run.run_id!, { value: run, at: now });
  }

  return {
    kind: 'live',
    async getRun(runId) {
      const now = clock();
      o.trace?.note({ now, limits });
      const dl = new Deadline(timer() + limits.timeoutMs, timer);
      const ref = state.pipelineRefs.get(runId);
      try {
        const host = await o.api.host().catch(() => '');
        let draft: Draft;
        let commit: () => void;
        if (ref) ({ draft, commit } = await updateDraftOf(ref, now, host, dl));
        else {
          const got = await api.getRun({ run_id: runId });
          draft = jobDraft(got, now, diag, host);
          await withPipelineCauses(got, draft, dl);
          commit = () => commitJobRun(got, now);
        }
        // A replayed call answered by a nearby recording can be another run: that is not this one.
        if (draft.id !== runId) throw new SourceError(404, `Run ${runId} does not exist`);
        commit();
        const cached = cachedRuns();
        // usualSec as the list computes it: this run with the other runs of its job in the list.
        const peers = cached.filter((r) => r.id !== runId && runKey(r) === draft.key).map((r) => ({ key: draft.key, live: r.live, queued: r.kind === 'queued', result: r.result, durationSec: r.durationSec }));
        const me = await dl.call(() => o.user()).catch((): typeof TIMEOUT => TIMEOUT);
        const [run] = finalize([draft], me === TIMEOUT ? undefined : me, usualByKey([...peers, draft]));
        if (me === TIMEOUT) run.mine = cached.find((r) => r.id === runId)?.mine ?? false;
        patchCache(run);
        return run;
      } catch (e) {
        throw toSourceError(e, true);
      }
    },
    async listRuns(since, _tzOffsetMin, opts: ListOptions = {}) {
      const key = `${o.userKey}|${since ?? ''}`;
      const hit = state.cache.get(key);
      if (hit && !opts.full && clock() - hit.at < CACHE_TTL_MS) {
        o.trace?.note({ now: hit.data.asOf });
        diag({ level: 'info', code: 'cache-hit', message: `served from the ${CACHE_TTL_MS / 1000}s cache (asOf ${new Date(hit.data.asOf).toISOString()})` });
        return hit.data;
      }
      let data: RunsResponse;
      try {
        data = await fetchRuns(since, !!opts.full);
      } catch (e) {
        throw toSourceError(e);
      }
      remember(state.cache, key, { at: clock(), data }, CACHE_MAX);
      return data;
    },
    listItems: itemsSrc.listItems,
    getItem: itemsSrc.getItem,
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
