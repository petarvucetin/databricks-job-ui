import type { jobs, pipelines } from '@databricks/sdk-experimental';
import type { HistoryInfo, ItemsResponse, RefreshInfo, Run, RunsResponse } from '../../../shared/domain/types';
import type { RunSource } from '../runSource';
import { SourceError } from '../sourceError';
import type { LiveApi } from './api';
import { apiErrorParts, toSourceError } from './apiError';
import { Deadline, EVENTS_PAGE_SIZE, FINISHED_UPDATE, TIMEOUT, collectJobRuns, collectPipelines, eventsSince } from './collect';
import { DeltaError, baseFromFull, collectEarlier, fetchDelta, keepEarlierUpdates, mergeBase, mergeEvents, type Base } from './delta';
import { createLiveItems } from './items';
import { jobDraft } from './jobs';
import { finalize, runKey, usualByKey, type Draft } from './kinds';
import { DEFAULT_REFRESH, type LiveLimits, type RefreshSettings } from './limits';
import { indexEvents, pipelineNumber, updateDraft, type PipelineInfo } from './pipelines';
import { findTask, jobLogText, pipelineLogText } from './taskLog';
import { attemptChain, pipelineOutputOf, pipelineTaskCause, pipelineTaskLogText } from './pipelineTask';
import { noDiag, type Trace } from './trace';
import type { HistoryConfig } from '../systables/config';
import { cutoffs, type HistoryPlan } from '../systables/cutoff';
import { readHistory, type HistoryFailure, type HistoryRead } from '../systables/history';
import { createHistoryProbe, knownProbe, type ProbeCache, type ProbeResult } from '../systables/probe';

const DAY = 86400000;
const HOUR = 3600000;
/**
 * A transient history failure (the warehouse starting, a timeout) is served as the API fallback this long before it is
 * tried again (ruling R11); a lasting one (no access, no table, a result too large) until the local day ends (finding 2c).
 * A history read for an incomplete job list, or without task detail after a transient failure, is re-read after it too.
 */
const HISTORY_RETRY_MS = 5 * 60000;
/** The probe, the job list and the history read together wait at most this long next to the API (finding 3). */
export const HISTORY_BUDGET_MS = 25000;
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

/** One reading identity's run history from system tables, for one local day. */
export interface HistoryEntry extends HistoryRead {
  /** The local midnight history ends at (exclusive); a new day re-queries. */
  cutoff: number;
  /** When it was read (clock ms). */
  at: number;
  /** Read again from this time on (an incomplete job list, or task detail missing for a transient reason). */
  expires?: number;
  /** Read for an incomplete job list: runs of the jobs past it are missing. Read again once a complete list is cached. */
  partialItems?: boolean;
  /** Where the API window starts for the whole day: min(cutoff, the time of the read less the overlap). */
  apiFrom: number;
  /** Where the history read started (:from_ts). */
  historyFrom: number;
  workspaceId: string;
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
  /**
   * Run history before today per reading identity, time zone and local day (historyKey), until the local day changes.
   * A failed read is never stored. In JOBS_CONSOLE_AUTH=app mode every viewer reads as the app: one entry for all.
   */
  history: Map<string, HistoryEntry>;
  /** History reads in flight by historyKey: concurrent first lists share one (finding 10). */
  historyReads: Map<string, Promise<HistoryEntry | DayFailure>>;
  /** Per reading identity: can it read the system tables (10 minutes either way). */
  probes: ProbeCache;
  /** By historyKey: the last failed history read, served as the API fallback until `until`. */
  historyFailures: Map<string, { at: number; until: number; reason: string }>;
  /** The workspace id from the SCIM header, once per process (dropped after a failure or an empty answer). */
  workspaceId?: Promise<string>;
}

export const createLiveState = (): LiveState => ({
  pipelineRefs: new Map(),
  cache: new Map(),
  bases: new Map(),
  items: new Map(),
  history: new Map(),
  historyReads: new Map(),
  probes: new Map(),
  historyFailures: new Map(),
});

/** Why one day's history read failed. `probe`: the access probe said no (it has its own 10-minute cache). */
export type DayFailure = HistoryFailure & { probe?: true };

/** The history cache key (finding 4a): who reads (the app, in app mode), in which time zone, for which local day. */
export const historyKey = (readKey: string, tzOffsetMin: number | undefined, day: number): string => `${readKey}|${tzOffsetMin ?? ''}|${day}`;

/**
 * The access probe (H5) for this user, over their own API; answers are shared through `state`. The workspace id is
 * DATABRICKS_WORKSPACE_ID, else the SCIM header, read once per process.
 */
export async function probeHistory(o: { api: LiveApi; userKey: string; state: LiveState; config: HistoryConfig; clock?: () => number }): Promise<ProbeResult> {
  const { state, config } = o;
  let workspaceId = config.workspaceId;
  if (!workspaceId && config.enabled) {
    const p = (state.workspaceId ??= o.api.workspaceId().catch(() => ''));
    workspaceId = await p;
    if (!workspaceId && state.workspaceId === p) state.workspaceId = undefined;
  }
  return createHistoryProbe({ api: o.api, config: { ...config, workspaceId: workspaceId || undefined }, clock: o.clock, cache: state.probes }).check(o.userKey);
}

/** What the header says about history, from a probe answer and, when there is one, the history read (capped or partial). */
export function historyInfoOf(p: ProbeResult, limits: LiveLimits, hist?: Pick<HistoryEntry, 'capped' | 'partialItems'>): HistoryInfo {
  if (!p.ok) return { source: 'api', days: limits.windowDays, reason: p.reason };
  if (hist?.partialItems) return { source: 'system-tables', days: limits.historyDays, capped: true, reason: 'job list incomplete' };
  return hist?.capped ? { source: 'system-tables', days: limits.historyDays, capped: true } : { source: 'system-tables', days: limits.historyDays };
}

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
  /** Identifies who the APIs read as, for the history and probe caches (default userKey; 'app' in app mode). */
  readKey?: string;
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
  /** Run history before today from system tables (absent: the API alone, and no `history` in the response). */
  history?: HistoryConfig;
  /** Replay: the history window the recorded list used, instead of one computed from the clock and time zone. */
  historyPin?: HistoryPlan;
  /** How long the probe and history read may take next to the API (default HISTORY_BUDGET_MS; the sweep's is longer). */
  historyBudgetMs?: number;
}

/**
 * Where one list's runs come from: the API window, its base key, and the history next to it: cached (`hist`), or being
 * read alongside the API (`pending`). `day` is set whenever the API reads only today (history mode).
 */
interface Plan {
  from: number;
  windowKey: Base['since'];
  day?: number;
  hist?: HistoryEntry;
  info?: HistoryInfo;
  pending?: Promise<{ hist: HistoryEntry } | { failure: DayFailure }>;
}

/** What one list collected from the API, before mapping; `commit` stores it as the requester's base. */
interface ApiPart {
  mode: RefreshInfo['mode'];
  col: Collected;
  host: string;
  me: string | typeof TIMEOUT;
  listed: number;
  skipped: number;
  capped: boolean;
  timedOut: boolean;
  commit: () => void;
}

/** The job and pipeline ids of a cached items list, built once per list. */
const visibleCache = new WeakMap<ItemsResponse, Set<string>>();
function visibleIds(items: ItemsResponse): Set<string> {
  let ids = visibleCache.get(items);
  if (!ids) {
    ids = new Set(items.items.map((i) => `${i.type}:${i.id}`));
    visibleCache.set(items, ids);
  }
  return ids;
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
  const readKey = o.readKey ?? o.userKey;
  const historyBudgetMs = o.historyBudgetMs ?? HISTORY_BUDGET_MS;

  /**
   * Is this history draft's job or pipeline in the requester's latest cached item list (finding 5)? Checked on every
   * list, so an item gone from the list leaves history without another SQL read. No cached list: all are kept.
   */
  function visibleFilter(): ((d: Pick<Draft, 'type' | 'jobId' | 'pipelineId'>) => boolean) | undefined {
    const items = state.items.get(o.userKey)?.data;
    if (!items) return undefined;
    const ids = visibleIds(items);
    return (d) => ids.has(d.type === 'job' ? `job:${d.jobId ?? ''}` : `pipeline:${d.pipelineId ?? ''}`);
  }

  /** Maps what was collected (a full load's lists, or a merged base) with the pure mappers; remembers pipeline refs. */
  function mapCollected(col: Collected, now: number, me: string | undefined, host: string, hist?: HistoryEntry): { all: Run[]; jobRuns: number; withUpdates: number } {
    const drafts: Draft[] = [];
    const visible = hist && visibleFilter();
    // History updates first, so the API's refs win for an update in both.
    for (const ref of hist?.refs ?? []) if (!visible || visible({ type: 'pipeline', pipelineId: ref.pipelineId })) remember(state.pipelineRefs, pipelineNumber(ref.updateId), ref, ID_MAP_MAX);
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
    if (hist) {
      // Before finalize, so usualSec and slow are computed over the whole history. The API wins on the same id.
      const have = new Set(drafts.map((d) => d.id));
      for (const d of hist.drafts) if (!have.has(d.id) && (!visible || visible(d))) drafts.push(d);
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
  function fullReason(base: Base | undefined, since: Base['since'], now: number, asked: boolean): string | null {
    if (o.mode === 'full') return 'replayed as a full load';
    if (!refresh.incremental) return 'deltas are off (JOBS_CONSOLE_INCREMENTAL=0)';
    if (!base) return 'no base yet';
    if (base.since !== since) return 'the window changed';
    if (o.mode === 'delta') return null;
    if (asked) return 'asked for (full=1)';
    if (now - base.fullAt >= refresh.fullRefreshMs) return `the base is older than ${refresh.fullRefreshMs}ms`;
    return null;
  }

  /** Can the cached history entry still be served? Not past `expires`, nor, read for a partial job list, once a complete one is cached. */
  function fresh(e: HistoryEntry, now: number): boolean {
    if (e.expires !== undefined && now >= e.expires) return false;
    const items = state.items.get(o.userKey);
    return !(e.partialItems && items && items.at > e.at);
  }

  /**
   * One local day's history for this reading identity: the probe, the job list and the four queries, within `dl`.
   * Stored on success (the identity's other days in this time zone are dropped), its failure remembered otherwise.
   * Concurrent first lists share one read (finding 10).
   */
  function readDay(key: string, w: { day: number; apiFrom: number; historyFrom: number }, now: number, config: HistoryConfig, hostP: Promise<string>, dl: Deadline): Promise<HistoryEntry | DayFailure> {
    const inFlight = state.historyReads.get(key);
    if (inFlight) return inFlight;
    const read = (async (): Promise<HistoryEntry | DayFailure> => {
      const timedOut: DayFailure = { reason: 'timed out', lasting: false };
      // The items list (cached for the Jobs & ETL tab too) alongside the probe.
      const itemsP = itemsSrc.listItems().catch((e: unknown) => (e instanceof Error ? e : new Error(String(e))));
      const probe = await dl.call(() => probeHistory({ api, userKey: readKey, state, config, clock }));
      if (probe === TIMEOUT) return timedOut;
      o.trace?.note({ probe });
      if (!probe.ok) return { reason: probe.reason, lasting: false, probe: true };
      const items = await dl.call(() => itemsP);
      if (items === TIMEOUT) return timedOut;
      if (items instanceof Error) return { reason: `the job list failed: ${apiErrorParts(items).message}`, lasting: false };
      const host = await hostP;
      const got = await readHistory({ api, warehouseId: config.warehouseId ?? '', workspaceId: probe.workspaceId, from: w.historyFrom, to: w.day, maxRuns: limits.historyMaxRuns, items: items.items, host, dl });
      if ('reason' in got) return got;
      // An incomplete job list (finding 6) or task detail missing for a transient reason: served now, read again later.
      const retry = !!items.partial || (!!got.noTasks && !got.noTasks.lasting);
      return {
        ...got,
        cutoff: w.day,
        apiFrom: w.apiFrom,
        historyFrom: w.historyFrom,
        workspaceId: probe.workspaceId,
        at: now,
        ...(retry ? { expires: now + HISTORY_RETRY_MS } : {}),
        ...(items.partial ? { partialItems: true } : {}),
      };
    })()
      .catch((e: unknown): DayFailure => ({ reason: `the history read failed: ${apiErrorParts(e).message}`, lasting: false }))
      .then((out) => {
        if ('reason' in out) {
          if (!out.probe) remember(state.historyFailures, key, { at: now, until: out.lasting ? w.day + DAY : now + HISTORY_RETRY_MS, reason: out.reason }, BASES_MAX);
          return out;
        }
        // One day per identity and time zone: yesterday's entry goes when today's lands.
        const prefix = key.slice(0, key.lastIndexOf('|') + 1);
        for (const k of [...state.history.keys()]) if (k !== key && k.startsWith(prefix)) state.history.delete(k);
        state.historyFailures.delete(key);
        remember(state.history, key, out, BASES_MAX);
        return out;
      })
      .finally(() => state.historyReads.delete(key));
    state.historyReads.set(key, read);
    return read;
  }

  /**
   * History mode (H1): today's cached history (no probe, no SQL), or, the first list of the day, the history read
   * alongside the API (`pending`, within the history budget). Otherwise, when the probe says no or a read failed
   * (remembered, R11 / finding 2c), the API alone over windowDays, with why.
   */
  async function plan(since: number | undefined, now: number, tzOffsetMin: number | undefined, hostP: Promise<string>): Promise<Plan> {
    const apiOnly = (reason?: string): Plan => ({
      from: since ?? now - limits.windowDays * DAY,
      windowKey: since,
      info: o.history && since === undefined ? { source: 'api', days: limits.windowDays, ...(reason ? { reason } : {}) } : undefined,
    });
    const config = o.history;
    if (!config || since !== undefined) return apiOnly();
    if (!config.enabled) {
      // No warehouse, or off: answered without a call, the API alone exactly as before history existed.
      const probe = await probeHistory({ api, userKey: readKey, state, config, clock });
      o.trace?.note({ probe });
      const reason = probe.ok ? undefined : probe.reason;
      diag({ level: 'info', code: 'history-api', message: `run history from the API: ${reason ?? 'off'}` });
      return apiOnly(reason);
    }
    const pin = o.historyPin;
    const w = pin ? { day: pin.cutoff, apiFrom: pin.apiFrom, historyFrom: pin.from } : cutoffs(now, tzOffsetMin, limits);
    const key = historyKey(readKey, tzOffsetMin, w.day);
    // Today's history is cached: no probe, no SQL (R11).
    const cached = state.history.get(key);
    if (cached && fresh(cached, now)) return withHistory(cached);
    const failed = state.historyFailures.get(key);
    if (failed && now < failed.until) {
      // The read to refresh a stale entry failed: the stale one is still today's.
      if (cached) return withHistory(cached);
      // Recorded, so a replay of this list answers it the same way (finding 14).
      o.trace?.note({ historyFailure: { cutoff: w.day, reason: failed.reason, until: failed.until } });
      diag({ level: 'info', code: 'history-api', message: `run history from the API: ${failed.reason} (failed ${Math.round((now - failed.at) / 1000)}s ago)` });
      return apiOnly(failed.reason);
    }
    // The probe already said no (it is kept 10 minutes): straight to the API.
    const known = knownProbe(state.probes, readKey, now);
    if (known && !known.ok) {
      o.trace?.note({ probe: known });
      diag({ level: 'info', code: 'history-api', message: `run history from the API: ${known.reason}` });
      return apiOnly(known.reason);
    }
    // Read alongside the API, with one budget for the probe, the job list and the queries (finding 3).
    const dl = new Deadline(timer() + historyBudgetMs, timer);
    const pending = dl.call(() => readDay(key, w, now, config, hostP, dl)).then((got): { hist: HistoryEntry } | { failure: DayFailure } => {
      if (got === TIMEOUT) {
        // This list waited its budget out (another list's read may still land): remembered unless that read already did.
        if (!state.history.has(key) && !state.historyFailures.has(key)) remember(state.historyFailures, key, { at: now, until: now + HISTORY_RETRY_MS, reason: 'timed out' }, BASES_MAX);
        return cached ? { hist: cached } : { failure: { reason: 'timed out', lasting: false } };
      }
      if (!('reason' in got)) return { hist: got };
      // A stale entry of the same day (read again for a partial list) is better than none.
      return cached ? { hist: cached } : { failure: got };
    });
    return { from: w.apiFrom, windowKey: `h:${w.day}`, day: w.day, pending };
  }

  /** The plan next to history entry `hist`, recorded so a replay issues the same SQL and API window. */
  function withHistory(hist: HistoryEntry): Plan {
    o.trace?.note({ historyPlan: { cutoff: hist.cutoff, apiFrom: hist.apiFrom, from: hist.historyFrom, to: hist.cutoff, workspaceId: hist.workspaceId } });
    return { from: hist.apiFrom, windowKey: `h:${hist.cutoff}`, day: hist.cutoff, hist, info: historyInfoOf({ ok: true, workspaceId: hist.workspaceId }, limits, hist) };
  }

  /**
   * The API part of one list for plan `p`: a delta over the requester's base when one will do, else a full load. In
   * history mode (`p.day`) the window is today, plus what started before it and is still live or ended late (H2, R6, R10).
   */
  async function collectApi(p: Plan, c: ReturnType<typeof counting>, now: number, askedFull: boolean, hostP: Promise<string>, user: () => Promise<string>): Promise<ApiPart> {
    const { from } = p;
    const historyMode = p.day !== undefined;
    const base = state.bases.get(o.userKey);
    const reason = fullReason(base, p.windowKey, now, askedFull);
    if (base && !reason) {
      const dl = new Deadline(timer() + limits.timeoutMs, timer);
      try {
        const [host, me, d] = await Promise.all([hostP, dl.call(user), fetchDelta(c.api, base, { now, from, maxRuns: limits.maxRuns, concurrency: limits.concurrency, dl, diag, keep: historyMode ? keepEarlierUpdates(base, now) : undefined })]);
        const merged = mergeBase(base, d, from, limits.maxRuns, historyMode);
        const k = merged.counts;
        diag({
          level: 'info',
          code: 'delta',
          message: `active runs ${k.active}, new runs ${k.fresh}, finished via getRun ${k.finished}, deleted ${k.deleted}, pipelines re-read ${k.reread} of ${k.pipelines}, aged out of the window ${k.agedOut}`,
        });
        diag({ level: 'info', code: 'pages', message: [...c.counts].map(([key, n]) => `${key} ${n}`).join(', ') || 'no calls' });
        return { mode: 'delta', col: collectedOf(merged.base), host, me, listed: k.pipelines, skipped: 0, capped: merged.base.capped, timedOut: me === TIMEOUT, commit: () => commitBase(merged.base) };
      } catch (e) {
        // Nothing of the delta is kept: the full load starts from scratch.
        diag({ level: 'warn', code: 'delta-fallback', message: `delta refresh failed, loading in full: ${apiErrorParts(e).message}` });
      }
    } else {
      diag({ level: 'info', code: 'full-load', message: `full load: ${reason ?? 'no base yet'}` });
    }

    const dl = new Deadline(timer() + limits.timeoutMs, timer);
    // Next to history the window starts today. What started before it stays when still live (H2, R6), from the base
    // of the same day, and, at a new day, from the old base when it ended late enough that history may lack it (R10).
    const endAfter = historyMode && base && base.since !== p.windowKey ? p.day! - limits.apiOverlapHours * HOUR : undefined;
    const keep = historyMode ? keepEarlierUpdates(base, now, endAfter) : undefined;
    const [host, me, jobsR, pipesR] = await Promise.all([hostP, dl.call(user), collectJobRuns(c.api, from, limits.maxRuns, dl), collectPipelines(c.api, from, limits.concurrency, dl, diag, keep)]);
    if (historyMode && !jobsR.timedOut) {
      const have = new Set(jobsR.runs.map((r) => r.run_id ?? 0));
      const earlier = await collectEarlier(c.api, { from, maxRuns: limits.maxRuns, concurrency: limits.concurrency, dl, diag, old: base, endAfter, have }).catch((e: unknown): typeof TIMEOUT => {
        if (e instanceof DeltaError) return TIMEOUT;
        throw e;
      });
      if (earlier === TIMEOUT) jobsR.timedOut = true;
      else jobsR.runs.push(...earlier);
    }
    diag({ level: 'info', code: 'pages', message: [...c.counts].map(([k, n]) => `${k} ${n}`).join(', ') || 'no calls' });
    const timedOut = jobsR.timedOut || pipesR.timedOut || me === TIMEOUT;
    // A load the time budget cut short is served, but is no base: the next list loads in full again.
    const commit = () => {
      if (!jobsR.timedOut && !pipesR.timedOut && refresh.incremental) commitBase(baseFromFull(p.windowKey, now, jobsR, pipesR));
    };
    return { mode: 'full', col: { runs: jobsR.runs, pipelines: pipesR.pipelines }, host, me, listed: pipesR.listed, skipped: pipesR.skipped, capped: jobsR.capped, timedOut, commit };
  }

  async function fetchRuns(since: number | undefined, askedFull: boolean, tzOffsetMin: number | undefined): Promise<RunsResponse> {
    const started = timer();
    const now = clock();
    o.trace?.note({ now, limits });
    const c = counting(api);
    const user = () =>
      o.user().then((u) => {
        o.trace?.note({ user: u });
        return u;
      });
    // Straight from o.api: the host is configuration, not a counted or recorded call.
    const hostP = o.api.host().catch(() => '');
    // History SQL is recorded (api) but not counted: refresh.calls and the pages diagnostic describe the API refresh.
    let p = await plan(since, now, tzOffsetMin, hostP);
    // The API part starts now, next to a history read when there is one (finding 3).
    let part = collectApi(p, c, now, askedFull, hostP, user);
    let { hist, info } = p;
    if (p.pending) {
      // Handled now, so a failure while history is read is no unhandled rejection; it is still awaited below.
      part.catch(() => undefined);
      const got = await p.pending;
      if ('hist' in got) {
        hist = got.hist;
        info = withHistory(hist).info;
        diag({
          level: 'info',
          code: 'history-read',
          message: `${hist.drafts.length} runs from system tables before ${new Date(hist.cutoff).toISOString()}${hist.capped ? ` (cap ${limits.historyMaxRuns} hit)` : ''}${hist.partialItems ? ' (job list incomplete)' : ''}${hist.noTasks ? ` (no task detail: ${hist.noTasks.reason})` : ''}`,
        });
      } else if (got.failure.reason === 'timed out') {
        // Out of time: the API part read alongside is served (today, and what is still live); history is tried again in 5 minutes.
        diag({ level: 'warn', code: 'history-failed', message: `run history from the API: timed out after ${historyBudgetMs}ms` });
        info = { source: 'api', days: Math.max(1, Math.ceil((now - p.from) / DAY)), reason: 'timed out' };
      } else {
        const { reason, probe } = got.failure;
        diag({ level: probe ? 'info' : 'warn', code: probe ? 'history-api' : 'history-failed', message: `run history from the API: ${reason}` });
        // The API alone over windowDays; the part read for today is dropped (and never becomes the base).
        p = { from: now - limits.windowDays * DAY, windowKey: undefined, info: { source: 'api', days: limits.windowDays, reason } };
        part = collectApi(p, c, now, askedFull, hostP, user);
        info = p.info;
      }
    }
    const out = await part;
    out.commit();
    const { me } = out;
    const { all, jobRuns, withUpdates } = mapCollected(out.col, now, me === TIMEOUT ? undefined : me, out.host, hist);
    // Next to history, the API part keeps maxRuns on its own (collect / mergeBase) and history has its cap.
    const runs = hist ? all : all.slice(0, limits.maxRuns);
    const capped = out.capped || all.length > runs.length;
    const counts = `returned ${runs.length} of ${all.length} (job runs ${jobRuns}, pipeline updates ${all.length - jobRuns}, pipelines ${withUpdates} with updates / ${out.listed} listed, ${out.skipped} skipped)`;
    if (capped) diag({ level: 'warn', code: 'cap-hit', message: `cap ${limits.maxRuns} hit; ${counts}` });
    if (out.timedOut) diag({ level: 'warn', code: 'timeout-hit', message: `timeout ${limits.timeoutMs}ms hit${me === TIMEOUT ? ' (user name not resolved)' : ''}; ${counts}` });
    if (capped || out.timedOut || out.skipped) {
      warn(`[live] runs list cut short:${capped ? ` cap ${limits.maxRuns} hit;` : ''}${out.timedOut ? ` timeout ${limits.timeoutMs}ms hit;` : ''} ${counts}`);
    }
    const refreshInfo: RefreshInfo = { mode: out.mode, calls: [...c.counts.values()].reduce((a, b) => a + b, 0), ms: Math.max(0, Math.round(timer() - started)) };
    o.trace?.note({ refresh: refreshInfo });
    const history: HistoryInfo | undefined = info && (capped && !info.capped ? { ...info, capped: true } : info);
    return { asOf: now, source: o.source ?? 'live', runs, refresh: refreshInfo, ...(history ? { history } : {}) };
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
    async listRuns(since, tzOffsetMin, opts: ListOptions = {}) {
      const key = `${o.userKey}|${since ?? ''}|${tzOffsetMin ?? ''}`;
      const hit = state.cache.get(key);
      if (hit && !opts.full && clock() - hit.at < CACHE_TTL_MS) {
        o.trace?.note({ now: hit.data.asOf });
        diag({ level: 'info', code: 'cache-hit', message: `served from the ${CACHE_TTL_MS / 1000}s cache (asOf ${new Date(hit.data.asOf).toISOString()})` });
        return hit.data;
      }
      let data: RunsResponse;
      try {
        data = await fetchRuns(since, !!opts.full, tzOffsetMin);
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
